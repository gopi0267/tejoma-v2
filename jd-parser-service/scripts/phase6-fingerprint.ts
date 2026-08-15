/**
 * Phase 6 production fingerprint.
 *
 * READ-ONLY BY CONSTRUCTION. Every statement below is a SELECT; the script opens no transaction that
 * writes, creates no temp objects and touches no sequence. It exists to prove that deploying Phase 6
 * changed nothing it was not supposed to change, so a fingerprint that itself mutated state would be
 * worthless.
 *
 * REPRODUCIBILITY. Output is a stable JSON document: databases, tables and columns are all ordered,
 * row checksums are computed with a deterministic aggregate over an explicit ORDER BY, and no
 * timestamp of the run appears inside the hashed section. Running it twice against an unchanged
 * database must produce a byte-identical `fingerprint` object and the same top-level digest.
 *
 * Usage:  npx tsx scripts/phase6-fingerprint.ts <label>
 * Writes: reports/phase6/fingerprint-<label>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildKnowledgeGraph } from '../src/knowledge-graph/graph.js';
import { EVIDENCE_ENGINE_VERSION, EVIDENCE_SCHEMA_VERSION } from '../src/evidence/contract.js';

const REPO = path.resolve(process.cwd(), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const pg = require('pg');

const env: Record<string, string> = {};
for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}

const label = process.argv[2] ?? 'unlabelled';
const conn = (database: string) => new pg.Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database,
});

/**
 * Tables whose contents Phase 6 must never touch. Phase 6 is a stateless read-only evaluator, so the
 * correct expected delta for every one of these is zero - including the match-score tables, which are
 * the ones a false "Phase 6 changed ranking" would show up in.
 */
const SENSITIVE = /^(candidates|jobs|matches|match_scores|.*_embedding.*|.*_score.*|.*_match.*|users|companies|tenants)$/i;

async function fingerprintDb(db: string) {
  const c = conn(db);
  await c.connect();
  try {
    // ---- schema: every column of every public table, ordered, hashed as one string
    const cols = (await c.query(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, column_name`)).rows;
    const schemaHash = 'sha256:' + createHash('sha256')
      .update(cols.map((r: Record<string, string>) =>
        `${r.table_name}.${r.column_name}:${r.data_type}:${r.is_nullable}`).join('\n')).digest('hex');

    const tables = (await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows
      .map((r: { table_name: string }) => r.table_name);

    const counts: Record<string, number> = {};
    const checksums: Record<string, string> = {};
    for (const t of tables) {
      const q = `SELECT COUNT(*)::bigint AS n FROM "${t}"`;
      counts[t] = Number((await c.query(q)).rows[0].n);

      // Content checksum for the tables that matter. md5 of the row's text form, XOR-free ordered
      // concatenation via string_agg over an explicit ORDER BY so the result cannot depend on
      // physical row order or parallel scan scheduling.
      if (SENSITIVE.test(t) && counts[t] > 0 && counts[t] <= 200_000) {
        const r = await c.query(
          `SELECT md5(COALESCE(string_agg(h, '' ORDER BY h), '')) AS ck
             FROM (SELECT md5("${t}"::text) AS h FROM "${t}") s`);
        checksums[t] = r.rows[0].ck;
      }
    }
    return { schema_hash: schemaHash, column_count: cols.length, table_count: tables.length, counts, checksums };
  } finally {
    await c.end();
  }
}

const stable = (o: unknown): string => JSON.stringify(o, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : v);

async function main() {
  const admin = conn('postgres');
  await admin.connect();
  const dbs = (await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE 'tejoma%' ORDER BY datname`))
    .rows.map((r: { datname: string }) => r.datname);
  await admin.end();

  const databases: Record<string, unknown> = {};
  for (const d of dbs) databases[d] = await fingerprintDb(d);

  // Phase 5's graph fingerprint is a pure function of the curated ontology, so it belongs in the
  // fingerprint as the upstream-semantics anchor: if it moves, Phase 6 changed shared knowledge.
  const graph = buildKnowledgeGraph();

  const fingerprint = {
    databases,
    phase5_graph_fingerprint: graph.fingerprint(),
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    evidence_engine_version: EVIDENCE_ENGINE_VERSION,
  };

  const digest = 'sha256:' + createHash('sha256').update(stable(fingerprint)).digest('hex');
  const out = { label, captured_at: new Date().toISOString(), digest, fingerprint };

  const dir = path.join(REPO, 'reports', 'phase6');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fingerprint-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`FINGERPRINT ${label}`);
  console.log(`  digest ${digest}`);
  console.log(`  databases ${dbs.length}: ${dbs.join(', ')}`);
  for (const [d, v] of Object.entries(databases)) {
    const f = v as { table_count: number; counts: Record<string, number>; checksums: Record<string, string> };
    const rows = Object.values(f.counts).reduce((a, b) => a + b, 0);
    console.log(`  ${d.padEnd(26)} tables=${String(f.table_count).padStart(3)} rows=${String(rows).padStart(7)} checksummed=${Object.keys(f.checksums).length}`);
  }
  console.log(`  phase5_graph ${graph.fingerprint().slice(0, 30)}`);
  console.log(`  written ${path.relative(REPO, file)}`);
}

await main();
