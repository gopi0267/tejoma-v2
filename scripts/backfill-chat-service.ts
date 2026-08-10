// One-time backfill: copies the monolith's knowledge_base_chunks table into Chat Service's own
// database (tejoma_chat). See backfill-identity-service.ts's header comment for the full
// methodology (read-only against the monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-chat-service.ts             (writes for real)
//   npx tsx scripts/backfill-chat-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.CHAT_SERVICE_DB_NAME || 'tejoma_chat';

const KNOWLEDGE_CHUNK_COLUMNS = ['id', 'company_id', 'source_type', 'source_id', 'content', 'embedding', 'created_at', 'updated_at'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Chat Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source, target,
      { sourceTable: 'knowledge_base_chunks', targetTable: 'knowledge_base_chunks', columns: KNOWLEDGE_CHUNK_COLUMNS },
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
