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
    name: 'jobs',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'company_id', dataType: 'integer', nullable: false },
      { name: 'title', dataType: 'character varying', nullable: false },
      { name: 'description', dataType: 'text', nullable: true },
      { name: 'required_skills', dataType: 'ARRAY', nullable: true },
      { name: 'experience_years', dataType: 'integer', nullable: true },
      { name: 'location', dataType: 'character varying', nullable: true },
      { name: 'salary_min', dataType: 'numeric', nullable: true },
      { name: 'salary_max', dataType: 'numeric', nullable: true },
      { name: 'status', dataType: 'character varying', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'optional_skills', dataType: 'ARRAY', nullable: true },
      { name: 'min_experience', dataType: 'numeric', nullable: true },
      { name: 'max_experience', dataType: 'numeric', nullable: true },
      { name: 'experience_unit', dataType: 'character varying', nullable: true },
      { name: 'remote_type', dataType: 'character varying', nullable: true },
      { name: 'employment_type', dataType: 'character varying', nullable: true },
      { name: 'industry', dataType: 'character varying', nullable: true },
      { name: 'department', dataType: 'character varying', nullable: true },
      { name: 'education', dataType: 'ARRAY', nullable: true },
      { name: 'certifications', dataType: 'ARRAY', nullable: true },
      { name: 'salary_currency', dataType: 'character varying', nullable: true },
      { name: 'notice_period', dataType: 'character varying', nullable: true },
      { name: 'number_of_openings', dataType: 'integer', nullable: true },
      { name: 'required_languages', dataType: 'ARRAY', nullable: true },
      { name: 'responsibilities', dataType: 'ARRAY', nullable: true },
      { name: 'tech_stack', dataType: 'jsonb', nullable: true },
      { name: 'keywords', dataType: 'ARRAY', nullable: true },
      { name: 'job_summary', dataType: 'text', nullable: true },
      { name: 'source_raw_text', dataType: 'text', nullable: true },
      { name: 'parse_confidence', dataType: 'jsonb', nullable: true },
      { name: 'description_embedding', dataType: 'ARRAY', nullable: true },
      { name: 'skills_embedding', dataType: 'ARRAY', nullable: true },
      { name: 'responsibilities_embedding', dataType: 'ARRAY', nullable: true },
      { name: 'title_embedding', dataType: 'ARRAY', nullable: true },
    ],
  },
];

const EXPECTED_INDEXES: string[] = ['idx_jobs_company_id', 'idx_jobs_status', 'idx_jobs_required_skills'];

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
      `✓ Schema validation passed - ${EXPECTED_TABLES.length} table matches migrations/001_initial_schema.up.sql exactly.`
    );
  }

  await pool.end();
}

main();
