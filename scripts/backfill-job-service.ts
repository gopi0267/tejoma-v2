// One-time backfill: copies the monolith's jobs table into Job Service's own database
// (tejoma_job). See backfill-identity-service.ts's header comment for the full methodology
// (read-only against the monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-job-service.ts             (writes for real)
//   npx tsx scripts/backfill-job-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

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
const JOB_JSON_COLUMNS = ['tech_stack', 'parse_confidence'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Job Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source, target,
      { sourceTable: 'jobs', targetTable: 'jobs', columns: JOB_COLUMNS, jsonColumns: JOB_JSON_COLUMNS },
      dryRun
    );

    console.log('\n=== Summary ===');
    console.log(`  ${result.table.padEnd(24)} read=${result.read}  ${dryRun ? '' : `written=${result.written}`}`);
    console.log(dryRun ? '\nDry run complete - no data was written.' : '\nBackfill complete.');
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
