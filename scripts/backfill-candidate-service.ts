// One-time backfill: copies the monolith's candidate_accounts (full row - see dualWrite.ts's
// header comment on why the whole row, not just the profile-column slice) and
// candidate_experiences tables into Candidate Service's own database (tejoma_candidate). See
// backfill-identity-service.ts's header comment for the full methodology (read-only against the
// monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-candidate-service.ts             (writes for real)
//   npx tsx scripts/backfill-candidate-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.CANDIDATE_SERVICE_DB_NAME || 'tejoma_candidate';

const CANDIDATE_ACCOUNT_COLUMNS = [
  'id', 'name', 'email', 'phone', 'password_hash', 'is_active', 'deleted_at',
  'headline', 'skills', 'years_of_experience', 'location', 'education', 'summary',
  'created_at', 'updated_at', 'onboarding_completed_at', 'current_company', 'certifications',
  'tools', 'languages', 'notice_period', 'current_ctc', 'expected_ctc', 'open_to_work',
  'visible_to_recruiters', 'course_name', 'course_type', 'specialization', 'institution_name',
  'start_year', 'end_year', 'grading_system', 'grade_value', 'primary_skill', 'secondary_skills',
  'resume_file_path', 'resume_original_filename', 'resume_file_uploaded_at', 'current_job_title',
  'projects', 'linkedin_url', 'github_url',
];

const CANDIDATE_EXPERIENCE_COLUMNS = [
  'id', 'candidate_account_id', 'job_title', 'company', 'employment_type', 'experience_years',
  'experience_months', 'current_ctc', 'expected_ctc', 'notice_period', 'current_location',
  'preferred_location', 'key_responsibilities', 'skills_used', 'created_at', 'updated_at',
];

// Batch 20 - candidate_notifications.candidate_account_id has a real FK to candidate_accounts in
// this service's own schema (migrations/002_candidate_notifications.up.sql), so it backfills
// after candidate_accounts too, same ordering reasoning as candidate_experiences.
const CANDIDATE_NOTIFICATION_COLUMNS = [
  'id', 'candidate_account_id', 'match_id', 'type', 'title', 'message', 'read_at', 'created_at', 'job_id',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Candidate Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    // candidate_accounts first - candidate_experiences/candidate_notifications' candidate_account_id
    // both have a real FK dependency on it in this service's own schema.
    const accountsResult = await backfillTable(
      source, target,
      { sourceTable: 'candidate_accounts', targetTable: 'candidate_accounts', columns: CANDIDATE_ACCOUNT_COLUMNS },
      dryRun
    );
    const experiencesResult = await backfillTable(
      source, target,
      { sourceTable: 'candidate_experiences', targetTable: 'candidate_experiences', columns: CANDIDATE_EXPERIENCE_COLUMNS },
      dryRun
    );
    const notificationsResult = await backfillTable(
      source, target,
      { sourceTable: 'candidate_notifications', targetTable: 'candidate_notifications', columns: CANDIDATE_NOTIFICATION_COLUMNS },
      dryRun
    );

    console.log('\n=== Summary ===');
    for (const result of [accountsResult, experiencesResult, notificationsResult]) {
      console.log(`  ${result.table.padEnd(24)} read=${result.read}  ${dryRun ? '' : `written=${result.written}`}`);
    }
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
