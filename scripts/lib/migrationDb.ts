/**
 * Shared connection + upsert helpers for the Tier 0 backfill scripts (Batch 13). Deliberately
 * does NOT reuse `db` from ../../src/db.js for reading the monolith's tables - that module's
 * getters apply business-logic filtering (e.g. excluding soft-deleted rows) that a backfill must
 * NOT apply. A backfill needs the true, complete, unfiltered table contents, so every read here
 * is a raw SQL SELECT against a dedicated read-only connection to the monolith's own database.
 *
 * The target connection points at one of the new Tier 0 services' own databases - same Postgres
 * host/credentials as the monolith (both currently run on the same instance - see each service's
 * own db.ts for the identical DB_HOST/DB_PORT/DB_USER/DB_PASSWORD convention), just a different
 * database name.
 */
import pkg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const { Pool } = pkg;
export type Pool = InstanceType<typeof pkg.Pool>;

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] || fallback;
  if (!value) {
    console.error(`FATAL: ${key} is not set. Refusing to run a migration script without an explicit connection.`);
    process.exit(1);
  }
  return value;
}

/** The monolith's own database - read-only for every script in this directory. */
export function connectMonolith(): InstanceType<typeof Pool> {
  return new Pool({
    host: requireEnv('DB_HOST', 'localhost'),
    port: parseInt(requireEnv('DB_PORT', '5432'), 10),
    database: requireEnv('DB_NAME', 'tejoma_recruiting'),
    user: requireEnv('DB_USER', 'postgres'),
    password: String(process.env.DB_PASSWORD || ''),
  });
}

/** One of the new Tier 0 services' own databases - the backfill target. */
export function connectTarget(dbName: string): InstanceType<typeof Pool> {
  return new Pool({
    host: requireEnv('DB_HOST', 'localhost'),
    port: parseInt(requireEnv('DB_PORT', '5432'), 10),
    database: dbName,
    user: requireEnv('DB_USER', 'postgres'),
    password: String(process.env.DB_PASSWORD || ''),
  });
}

export interface BackfillTableSpec {
  /** Table name in the monolith's database. */
  sourceTable: string;
  /** Table name in the target service's database (usually identical). */
  targetTable: string;
  /** Exact column list, in order - shared by the source SELECT and the target INSERT. This is
   *  also how column narrowing happens (e.g. candidate_accounts backfills only its auth columns,
   *  never the profile columns the monolith's row also has - see backfill-identity-service.ts). */
  columns: string[];
  /** Defaults to 'id'. The column the upsert treats as the stable identity for ON CONFLICT. */
  conflictColumn?: string;
  /** Columns whose target type is JSONB and whose JS value may be an array (e.g.
   *  proficiency_shadow_scores.skill_multipliers). node-pg serializes a bare JS array parameter as
   *  a Postgres array literal, not JSON text, which fails against a jsonb column - so these columns
   *  must be explicitly JSON.stringify'd before being sent as a param. Not needed for JSONB columns
   *  that only ever hold plain objects (pg auto-stringifies those correctly on its own). */
  jsonColumns?: string[];
}

export interface BackfillResult {
  table: string;
  read: number;
  written: number;
}

const BATCH_SIZE = 500;

/**
 * Reads every row of `spec.sourceTable` from the monolith (unfiltered, full table scan - real
 * production tables would want a keyset-paginated read instead of one large SELECT, but at this
 * system's actual current scale a single query is simpler and correct; the batching below is on
 * the WRITE side, where Postgres's per-statement parameter limit is the real constraint).
 *
 * Upserts into `spec.targetTable`, preserving the exact source `id` values (critical: other
 * tables reference these ids as opaque, unconstrained integers - see identity-service's
 * migrations/001_initial_schema.up.sql header comment on why - so a backfill that assigned new
 * ids would silently break every cross-table reference). ON CONFLICT (id) DO UPDATE makes this
 * safe to re-run: re-running after new monolith writes converges the target to the monolith's
 * current state rather than erroring or duplicating rows.
 *
 * After writing, resets the target table's sequence past the highest backfilled id, so the next
 * row created directly through the new service (not by a future backfill run) gets a fresh id
 * that can never collide with a backfilled one.
 */
export async function backfillTable(source: InstanceType<typeof Pool>, target: InstanceType<typeof Pool>, spec: BackfillTableSpec, dryRun: boolean): Promise<BackfillResult> {
  const columnList = spec.columns.join(', ');
  const sourceResult = await source.query(`SELECT ${columnList} FROM ${spec.sourceTable} ORDER BY id`);
  const rows = sourceResult.rows;
  console.log(`  ${spec.sourceTable}: read ${rows.length} row(s) from the monolith`);

  if (dryRun) {
    console.log(`  [dry-run] would upsert ${rows.length} row(s) into ${spec.targetTable} - no write performed`);
    return { table: spec.targetTable, read: rows.length, written: 0 };
  }

  if (rows.length === 0) {
    console.log(`  ${spec.targetTable}: nothing to write`);
    return { table: spec.targetTable, read: 0, written: 0 };
  }

  const conflictCol = spec.conflictColumn || 'id';
  const updateSet = spec.columns.filter((c) => c !== conflictCol).map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const jsonColumns = new Set(spec.jsonColumns || []);

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const params: unknown[] = [];
    const valuesSql = batch.map((row: Record<string, unknown>) => {
      const placeholders = spec.columns.map((c) => {
        const v = row[c];
        params.push(jsonColumns.has(c) && v !== null && v !== undefined ? JSON.stringify(v) : v);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await target.query(
      `INSERT INTO ${spec.targetTable} (${columnList})
       VALUES ${valuesSql.join(', ')}
       ON CONFLICT (${conflictCol}) DO UPDATE SET ${updateSet}`,
      params
    );
    written += batch.length;
    console.log(`  ${spec.targetTable}: upserted ${written}/${rows.length}`);
  }

  await target.query(
    `SELECT setval(pg_get_serial_sequence('${spec.targetTable}', 'id'), COALESCE((SELECT MAX(id) FROM ${spec.targetTable}), 1))`
  );

  return { table: spec.targetTable, read: rows.length, written };
}
