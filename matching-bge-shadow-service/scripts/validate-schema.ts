/**
 * Schema validation script. Mirrors every other Tier 0 service's scripts/validate-schema.ts
 * exactly.
 *
 * Usage: tsx scripts/validate-schema.ts
 */
import pkg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

interface ExpectedColumn {
  name: string;
  dataType: string;
  nullable: boolean;
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

// Mirrors migrations/001_initial_schema.up.sql exactly, column for column.
const EXPECTED_TABLES: ExpectedTable[] = [
  {
    name: 'bge_retrieval_shadow_comparisons',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'company_id', dataType: 'integer', nullable: false },
      { name: 'job_id', dataType: 'integer', nullable: false },
      { name: 'pool_size', dataType: 'integer', nullable: false },
      { name: 'existing_ranking', dataType: 'jsonb', nullable: false },
      { name: 'bge_ranking', dataType: 'jsonb', nullable: true },
      { name: 'top10_overlap_count', dataType: 'integer', nullable: true },
      { name: 'top10_overlap_pct', dataType: 'numeric', nullable: true },
      { name: 'rank_correlation', dataType: 'numeric', nullable: true },
      { name: 'bge_available', dataType: 'boolean', nullable: false },
      { name: 'embed_latency_ms', dataType: 'numeric', nullable: true },
      { name: 'rerank_latency_ms', dataType: 'numeric', nullable: true },
      { name: 'computed_at', dataType: 'timestamp without time zone', nullable: false },
    ],
  },
];

const EXPECTED_INDEXES: string[] = ['idx_bge_retrieval_shadow_job', 'idx_bge_retrieval_shadow_company'];

async function fetchActualColumns(tableName: string): Promise<Map<string, { dataType: string; nullable: boolean }>> {
  const result = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const map = new Map<string, { dataType: string; nullable: boolean }>();
  for (const row of result.rows) {
    map.set(row.column_name, { dataType: row.data_type, nullable: row.is_nullable === 'YES' });
  }
  return map;
}

async function fetchActualIndexes(): Promise<Set<string>> {
  const result = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
  return new Set(result.rows.map((r) => r.indexname));
}

async function main(): Promise<void> {
  const errors: string[] = [];

  for (const expectedTable of EXPECTED_TABLES) {
    const actualColumns = await fetchActualColumns(expectedTable.name);

    if (actualColumns.size === 0) {
      errors.push(`Table "${expectedTable.name}" does not exist.`);
      continue;
    }

    for (const expectedColumn of expectedTable.columns) {
      const actual = actualColumns.get(expectedColumn.name);
      if (!actual) {
        errors.push(`Table "${expectedTable.name}": missing column "${expectedColumn.name}".`);
        continue;
      }
      if (actual.dataType !== expectedColumn.dataType) {
        errors.push(
          `Table "${expectedTable.name}", column "${expectedColumn.name}": expected type ` +
            `"${expectedColumn.dataType}", found "${actual.dataType}".`
        );
      }
      if (actual.nullable !== expectedColumn.nullable) {
        errors.push(
          `Table "${expectedTable.name}", column "${expectedColumn.name}": expected nullable=` +
            `${expectedColumn.nullable}, found nullable=${actual.nullable}.`
        );
      }
    }

    const expectedNames = new Set(expectedTable.columns.map((c) => c.name));
    for (const actualName of actualColumns.keys()) {
      if (!expectedNames.has(actualName)) {
        errors.push(`Table "${expectedTable.name}": unexpected column "${actualName}" present (schema drift).`);
      }
    }
  }

  const actualIndexes = await fetchActualIndexes();
  for (const expectedIndex of EXPECTED_INDEXES) {
    if (!actualIndexes.has(expectedIndex)) {
      errors.push(`Missing expected index "${expectedIndex}".`);
    }
  }

  if (errors.length > 0) {
    console.error(`✗ Schema validation FAILED - ${errors.length} issue(s):\n`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Schema validation passed - ${EXPECTED_TABLES.length} tables match migrations/001_initial_schema.up.sql exactly.`
    );
  }

  await pool.end();
}

main();
