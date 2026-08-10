// One-time backfill: copies the monolith's candidates table into Candidate Core Service's own
// database (tejoma_candidate_core). See backfill-identity-service.ts's header comment for the
// full methodology (read-only against the monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-candidate-core-service.ts             (writes for real)
//   npx tsx scripts/backfill-candidate-core-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.CANDIDATE_CORE_SERVICE_DB_NAME || 'tejoma_candidate_core';

const CANDIDATE_COLUMNS = [
  'id', 'name', 'email', 'phone', 'skills', 'primary_skills', 'secondary_skills', 'skills_array',
  'years_of_experience', 'current_location', 'preferred_location', 'current_company',
  'previous_companies', 'current_job_title', 'industry_domain', 'education',
  'highest_qualification', 'graduation_year', 'university', 'certifications', 'projects',
  'technical_tools', 'languages_known', 'current_ctc', 'expected_ctc', 'notice_period',
  'willingness_to_relocate', 'linkedin_url', 'github_or_portfolio_url', 'resume_summary',
  'resume_text', 'ai_confidence_score', 'created_at', 'updated_at', 'extraction_status',
  'resume_file_path', 'candidate_hash', 'resume_embedding', 'company_id', 'candidate_account_id',
  'confidence_profile', 'skills_embedding', 'responsibilities_embedding', 'title_embedding',
  'work_history', 'project_entries', 'project_intelligence',
];
const CANDIDATE_JSON_COLUMNS = ['confidence_profile', 'work_history', 'project_entries', 'project_intelligence'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Candidate Core Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source, target,
      { sourceTable: 'candidates', targetTable: 'candidates', columns: CANDIDATE_COLUMNS, jsonColumns: CANDIDATE_JSON_COLUMNS },
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
