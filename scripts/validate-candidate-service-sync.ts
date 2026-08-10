// Validates that Candidate Service's database is a faithful, complete mirror of the monolith's
// candidate_accounts and candidate_experiences tables. See validate-identity-service-sync.ts's
// header comment for the full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-candidate-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

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

// Batch 20
const CANDIDATE_NOTIFICATION_COLUMNS = [
  'id', 'candidate_account_id', 'match_id', 'type', 'title', 'message', 'read_at', 'created_at', 'job_id',
];

async function main() {
  console.log(`=== Validating Candidate Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const accountsResult = await compareTable(source, target, {
      sourceTable: 'candidate_accounts', targetTable: 'candidate_accounts', columns: CANDIDATE_ACCOUNT_COLUMNS,
    });
    const experiencesResult = await compareTable(source, target, {
      sourceTable: 'candidate_experiences', targetTable: 'candidate_experiences', columns: CANDIDATE_EXPERIENCE_COLUMNS,
    });
    const notificationsResult = await compareTable(source, target, {
      sourceTable: 'candidate_notifications', targetTable: 'candidate_notifications', columns: CANDIDATE_NOTIFICATION_COLUMNS,
    });

    printCompareResult(accountsResult);
    printCompareResult(experiencesResult);
    printCompareResult(notificationsResult);

    const ok = accountsResult.ok && experiencesResult.ok && notificationsResult.ok;
    console.log(ok ? '\n✓ Candidate Service is fully in sync with the monolith.' : '\n✗ Candidate Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
