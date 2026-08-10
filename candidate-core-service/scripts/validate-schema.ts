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
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

// Mirrors migrations/001_initial_schema.up.sql exactly, column for column.
const EXPECTED_TABLES: ExpectedTable[] = [
  {
    name: 'candidates',
    columns: [
      { name: 'id', dataType: 'integer' },
      { name: 'name', dataType: 'text' },
      { name: 'email', dataType: 'text' },
      { name: 'phone', dataType: 'text' },
      { name: 'skills', dataType: 'text' },
      { name: 'primary_skills', dataType: 'text' },
      { name: 'secondary_skills', dataType: 'text' },
      { name: 'skills_array', dataType: 'ARRAY' },
      { name: 'years_of_experience', dataType: 'text' },
      { name: 'current_location', dataType: 'text' },
      { name: 'preferred_location', dataType: 'text' },
      { name: 'current_company', dataType: 'text' },
      { name: 'previous_companies', dataType: 'text' },
      { name: 'current_job_title', dataType: 'text' },
      { name: 'industry_domain', dataType: 'text' },
      { name: 'education', dataType: 'text' },
      { name: 'highest_qualification', dataType: 'text' },
      { name: 'graduation_year', dataType: 'text' },
      { name: 'university', dataType: 'text' },
      { name: 'certifications', dataType: 'text' },
      { name: 'projects', dataType: 'text' },
      { name: 'technical_tools', dataType: 'text' },
      { name: 'languages_known', dataType: 'text' },
      { name: 'current_ctc', dataType: 'text' },
      { name: 'expected_ctc', dataType: 'text' },
      { name: 'notice_period', dataType: 'text' },
      { name: 'willingness_to_relocate', dataType: 'text' },
      { name: 'linkedin_url', dataType: 'text' },
      { name: 'github_or_portfolio_url', dataType: 'text' },
      { name: 'resume_summary', dataType: 'text' },
      { name: 'resume_text', dataType: 'text' },
      { name: 'ai_confidence_score', dataType: 'text' },
      { name: 'created_at', dataType: 'timestamp without time zone' },
      { name: 'updated_at', dataType: 'timestamp without time zone' },
      { name: 'extraction_status', dataType: 'text' },
      { name: 'resume_file_path', dataType: 'text' },
      { name: 'candidate_hash', dataType: 'character varying' },
      { name: 'resume_embedding', dataType: 'ARRAY' },
      { name: 'company_id', dataType: 'integer' },
      { name: 'candidate_account_id', dataType: 'integer' },
      { name: 'confidence_profile', dataType: 'jsonb' },
      { name: 'skills_embedding', dataType: 'ARRAY' },
      { name: 'responsibilities_embedding', dataType: 'ARRAY' },
      { name: 'title_embedding', dataType: 'ARRAY' },
      { name: 'work_history', dataType: 'jsonb' },
      { name: 'project_entries', dataType: 'jsonb' },
      { name: 'project_intelligence', dataType: 'jsonb' },
    ],
  },
];

const EXPECTED_INDEXES: string[] = ['idx_candidates_company_id', 'idx_candidates_email', 'idx_candidates_skills_array'];

async function fetchActualColumns(tableName: string): Promise<Map<string, { dataType: string }>> {
  const result = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const map = new Map<string, { dataType: string }>();
  for (const row of result.rows) {
    map.set(row.column_name, { dataType: row.data_type });
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
