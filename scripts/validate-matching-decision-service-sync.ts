// Validates that Matching Decision Service's database is a faithful, complete mirror of the
// monolith's swipes, recruiter_notes, and detailed_scoring_reports tables. See
// validate-identity-service-sync.ts's header comment for the full methodology. Exits non-zero on
// any mismatch.
//
// Usage: npx tsx scripts/validate-matching-decision-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.MATCHING_DECISION_SERVICE_DB_NAME || 'tejoma_matching_decision';

const SWIPE_COLUMNS = ['id', 'recruiter_id', 'candidate_id', 'job_id', 'action', 'match_score', 'timestamp', 'used_for_training', 'company_id', 'reason', 'breakdown', 'decision_time_seconds'];
const RECRUITER_NOTE_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'note', 'created_by', 'updated_by', 'created_at', 'updated_at'];
const DETAILED_SCORING_REPORT_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'report', 'generated_by', 'generated_at'];

async function main() {
  console.log(`=== Validating Matching Decision Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const swipeResult = await compareTable(source, target, { sourceTable: 'swipes', targetTable: 'swipes', columns: SWIPE_COLUMNS });
    const noteResult = await compareTable(source, target, { sourceTable: 'recruiter_notes', targetTable: 'recruiter_notes', columns: RECRUITER_NOTE_COLUMNS });
    const reportResult = await compareTable(source, target, { sourceTable: 'detailed_scoring_reports', targetTable: 'detailed_scoring_reports', columns: DETAILED_SCORING_REPORT_COLUMNS });

    printCompareResult(swipeResult);
    printCompareResult(noteResult);
    printCompareResult(reportResult);

    const ok = swipeResult.ok && noteResult.ok && reportResult.ok;
    console.log(ok ? '\n✓ Matching Decision Service is fully in sync with the monolith.' : '\n✗ Matching Decision Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
