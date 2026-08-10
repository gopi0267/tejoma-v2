// Validates that Candidate Core Service's database is a faithful, complete mirror of the
// monolith's candidates table. See validate-identity-service-sync.ts's header comment for the
// full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-candidate-core-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

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

async function main() {
  console.log(`=== Validating Candidate Core Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'candidates', targetTable: 'candidates', columns: CANDIDATE_COLUMNS,
    });

    printCompareResult(result);

    const ok = result.ok;
    console.log(ok ? '\n✓ Candidate Core Service is fully in sync with the monolith.' : '\n✗ Candidate Core Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
