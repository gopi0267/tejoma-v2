// Validates that Job Service's database is a faithful, complete mirror of the monolith's jobs
// table. See validate-identity-service-sync.ts's header comment for the full methodology. Exits
// non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-job-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.JOB_SERVICE_DB_NAME || 'tejoma_job';

const JOB_COLUMNS = [
  'id', 'company_id', 'title', 'description', 'required_skills', 'experience_years', 'location',
  'salary_min', 'salary_max', 'status', 'created_at', 'updated_at', 'optional_skills',
  'min_experience', 'max_experience', 'experience_unit', 'remote_type', 'employment_type',
  'industry', 'department', 'education', 'certifications', 'salary_currency', 'notice_period',
  'number_of_openings', 'required_languages', 'responsibilities', 'tech_stack', 'keywords',
  'job_summary', 'source_raw_text', 'parse_confidence', 'description_embedding',
  'skills_embedding', 'responsibilities_embedding', 'title_embedding',
];

async function main() {
  console.log(`=== Validating Job Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'jobs', targetTable: 'jobs', columns: JOB_COLUMNS,
    });

    printCompareResult(result);

    const ok = result.ok;
    console.log(ok ? '\n✓ Job Service is fully in sync with the monolith.' : '\n✗ Job Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
