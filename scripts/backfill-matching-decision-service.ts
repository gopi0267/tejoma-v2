// One-time backfill: copies the monolith's swipes, recruiter_notes, and detailed_scoring_reports
// tables into Matching Decision Service's own database (tejoma_matching_decision). See
// backfill-identity-service.ts's header comment for the full methodology (read-only against the
// monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-matching-decision-service.ts             (writes for real)
//   npx tsx scripts/backfill-matching-decision-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.MATCHING_DECISION_SERVICE_DB_NAME || 'tejoma_matching_decision';

const SWIPE_COLUMNS = ['id', 'recruiter_id', 'candidate_id', 'job_id', 'action', 'match_score', 'timestamp', 'used_for_training', 'company_id', 'reason', 'breakdown', 'decision_time_seconds'];
const RECRUITER_NOTE_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'note', 'created_by', 'updated_by', 'created_at', 'updated_at'];
const DETAILED_SCORING_REPORT_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'report', 'generated_by', 'generated_at'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Matching Decision Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const swipeResult = await backfillTable(
      source, target,
      { sourceTable: 'swipes', targetTable: 'swipes', columns: SWIPE_COLUMNS, jsonColumns: ['breakdown'] },
      dryRun
    );
    const noteResult = await backfillTable(
      source, target,
      { sourceTable: 'recruiter_notes', targetTable: 'recruiter_notes', columns: RECRUITER_NOTE_COLUMNS },
      dryRun
    );
    const reportResult = await backfillTable(
      source, target,
      { sourceTable: 'detailed_scoring_reports', targetTable: 'detailed_scoring_reports', columns: DETAILED_SCORING_REPORT_COLUMNS, jsonColumns: ['report'] },
      dryRun
    );

    console.log('\n=== Summary ===');
    for (const result of [swipeResult, noteResult, reportResult]) {
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
