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
    name: 'candidate_accounts',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'name', dataType: 'character varying', nullable: false },
      { name: 'email', dataType: 'character varying', nullable: true },
      { name: 'phone', dataType: 'character varying', nullable: true },
      { name: 'password_hash', dataType: 'character varying', nullable: false },
      { name: 'is_active', dataType: 'boolean', nullable: true },
      { name: 'deleted_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'headline', dataType: 'character varying', nullable: true },
      { name: 'skills', dataType: 'ARRAY', nullable: true },
      { name: 'years_of_experience', dataType: 'character varying', nullable: true },
      { name: 'location', dataType: 'character varying', nullable: true },
      { name: 'education', dataType: 'text', nullable: true },
      { name: 'summary', dataType: 'text', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'onboarding_completed_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'current_company', dataType: 'character varying', nullable: true },
      { name: 'certifications', dataType: 'ARRAY', nullable: true },
      { name: 'tools', dataType: 'ARRAY', nullable: true },
      { name: 'languages', dataType: 'ARRAY', nullable: true },
      { name: 'notice_period', dataType: 'character varying', nullable: true },
      { name: 'current_ctc', dataType: 'character varying', nullable: true },
      { name: 'expected_ctc', dataType: 'character varying', nullable: true },
      { name: 'open_to_work', dataType: 'boolean', nullable: true },
      { name: 'visible_to_recruiters', dataType: 'boolean', nullable: true },
      { name: 'course_name', dataType: 'character varying', nullable: true },
      { name: 'course_type', dataType: 'character varying', nullable: true },
      { name: 'specialization', dataType: 'character varying', nullable: true },
      { name: 'institution_name', dataType: 'character varying', nullable: true },
      { name: 'start_year', dataType: 'character varying', nullable: true },
      { name: 'end_year', dataType: 'character varying', nullable: true },
      { name: 'grading_system', dataType: 'character varying', nullable: true },
      { name: 'grade_value', dataType: 'character varying', nullable: true },
      { name: 'primary_skill', dataType: 'text', nullable: true },
      { name: 'secondary_skills', dataType: 'ARRAY', nullable: true },
      { name: 'resume_file_path', dataType: 'character varying', nullable: true },
      { name: 'resume_original_filename', dataType: 'character varying', nullable: true },
      { name: 'resume_file_uploaded_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'current_job_title', dataType: 'character varying', nullable: true },
      { name: 'projects', dataType: 'text', nullable: true },
      { name: 'linkedin_url', dataType: 'character varying', nullable: true },
      { name: 'github_url', dataType: 'character varying', nullable: true },
    ],
  },
  {
    name: 'candidate_experiences',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'candidate_account_id', dataType: 'integer', nullable: false },
      { name: 'job_title', dataType: 'character varying', nullable: true },
      { name: 'company', dataType: 'character varying', nullable: true },
      { name: 'employment_type', dataType: 'character varying', nullable: true },
      { name: 'experience_years', dataType: 'integer', nullable: true },
      { name: 'experience_months', dataType: 'integer', nullable: true },
      { name: 'current_ctc', dataType: 'character varying', nullable: true },
      { name: 'expected_ctc', dataType: 'character varying', nullable: true },
      { name: 'notice_period', dataType: 'character varying', nullable: true },
      { name: 'current_location', dataType: 'character varying', nullable: true },
      { name: 'preferred_location', dataType: 'character varying', nullable: true },
      { name: 'key_responsibilities', dataType: 'text', nullable: true },
      { name: 'skills_used', dataType: 'ARRAY', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
  {
    // Mirrors migrations/002_candidate_notifications.up.sql exactly, column for column (Batch 20).
    name: 'candidate_notifications',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'candidate_account_id', dataType: 'integer', nullable: false },
      { name: 'match_id', dataType: 'integer', nullable: true },
      { name: 'type', dataType: 'character varying', nullable: false },
      { name: 'title', dataType: 'character varying', nullable: false },
      { name: 'message', dataType: 'text', nullable: false },
      { name: 'read_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'job_id', dataType: 'integer', nullable: true },
    ],
  },
  {
    // Mirrors migrations/003_candidate_search.up.sql exactly, column for column (Remaining-monolith migration, Step 5).
    name: 'saved_candidates',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'recruiter_user_id', dataType: 'integer', nullable: false },
      { name: 'company_id', dataType: 'integer', nullable: false },
      { name: 'candidate_account_id', dataType: 'integer', nullable: false },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
  {
    // Mirrors migrations/003_candidate_search.up.sql exactly, column for column (Remaining-monolith migration, Step 5).
    name: 'candidate_profile_views',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'recruiter_user_id', dataType: 'integer', nullable: false },
      { name: 'company_id', dataType: 'integer', nullable: false },
      { name: 'candidate_account_id', dataType: 'integer', nullable: false },
      { name: 'viewed_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
];

const EXPECTED_INDEXES: string[] = ['idx_candidate_experiences_account', 'idx_candidate_notifications_account'];

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
      `✓ Schema validation passed - ${EXPECTED_TABLES.length} tables match their migrations exactly.`
    );
  }

  await pool.end();
}

main();
