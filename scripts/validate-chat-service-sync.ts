// Validates that Chat Service's database is a faithful, complete mirror of the monolith's
// knowledge_base_chunks table. See validate-identity-service-sync.ts's header comment for the
// full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-chat-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.CHAT_SERVICE_DB_NAME || 'tejoma_chat';

const KNOWLEDGE_CHUNK_COLUMNS = ['id', 'company_id', 'source_type', 'source_id', 'content', 'embedding', 'created_at', 'updated_at'];

async function main() {
  console.log(`=== Validating Chat Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'knowledge_base_chunks', targetTable: 'knowledge_base_chunks', columns: KNOWLEDGE_CHUNK_COLUMNS,
    });

    printCompareResult(result);
    console.log(result.ok ? '\n✓ Chat Service is fully in sync with the monolith.' : '\n✗ Chat Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
