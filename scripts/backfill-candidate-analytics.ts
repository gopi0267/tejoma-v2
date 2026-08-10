/**
 * Backfill candidate-analytics tables (candidate-service)
 *
 * Phase 4, Item 4: Populates 3 mirrored tables from monolith:
 * - candidate_decisions
 * - candidate_application_status
 * - mutual_matches
 *
 * Batched inserts with minimal monolith lock time. All 3 tables are idempotent
 * (unique ID constraint), so re-running is safe.
 */

import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const monolithPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const candidateServicePool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.CANDIDATE_SERVICE_DB_NAME || 'tejoma_candidate',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const BATCH_SIZE = 1000;

async function backfillTable(
  tableName: string,
  columns: string[]
): Promise<void> {
  console.log(`\n[${tableName}] Starting backfill...`);

  try {
    // Check if table exists in monolith
    const checkResult = await monolithPool.query(
      `SELECT to_regclass('public.${tableName}') IS NOT NULL as exists`
    );

    if (!checkResult.rows[0].exists) {
      console.log(`[${tableName}] Table does not exist in monolith, skipping.`);
      return;
    }

    let offset = 0;
    let totalInserted = 0;

    while (true) {
      const columnList = columns.join(', ');
      const rows = await monolithPool.query(
        `SELECT ${columnList} FROM ${tableName} ORDER BY id OFFSET $1 LIMIT $2`,
        [offset, BATCH_SIZE]
      );

      if (rows.rows.length === 0) break;

      const values = rows.rows.map((row) =>
        `(${columns.map((col) => {
          const val = row[col];
          if (val === null) return 'NULL';
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
          return val;
        }).join(', ')})`
      );

      const insertSql = `
        INSERT INTO ${tableName} (${columnList})
        VALUES ${values.join(', ')}
        ON CONFLICT (id) DO NOTHING
      `;

      await candidateServicePool.query(insertSql);

      totalInserted += rows.rows.length;
      offset += BATCH_SIZE;

      console.log(`[${tableName}] Backfilled ${totalInserted} rows...`);
    }

    console.log(`[${tableName}] ✅ Backfill complete: ${totalInserted} rows`);
  } catch (err) {
    // If table doesn't exist (42P01), log and continue
    if (err instanceof Error && err.message.includes('42P01')) {
      console.log(`[${tableName}] Table does not exist in monolith, skipping.`);
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    console.log('Starting candidate-analytics backfill...\n');

    // Backfill all 3 tables
    await backfillTable('candidate_decisions', [
      'id',
      'company_id',
      'candidate_id',
      'recruiter_id',
      'decision_type',
      'decision_date',
      'notes',
      'created_at',
      'updated_at',
    ]);

    await backfillTable('candidate_application_status', [
      'id',
      'company_id',
      'candidate_id',
      'job_id',
      'status',
      'status_date',
      'notes',
      'created_at',
      'updated_at',
    ]);

    await backfillTable('mutual_matches', [
      'id',
      'company_id',
      'candidate_id',
      'job_id',
      'candidate_interested',
      'job_interested',
      'matched_at',
      'created_at',
      'updated_at',
    ]);

    console.log('\n✅ All tables backfilled successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Backfill failed:', err);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await candidateServicePool.end();
  }
}

main();
