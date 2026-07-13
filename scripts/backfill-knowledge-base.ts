// One-off / re-runnable maintenance script: (re)indexes every existing candidate and job into
// the RAG knowledge base (knowledge_base_chunks). New candidates/jobs are indexed automatically
// on creation (see src/rag.service.ts usage in candidate.routes.ts / job.routes.ts) - this
// script exists to backfill data that existed before the chatbot feature shipped, or to force a
// full resync if chunks ever drift out of date.
//
// Usage: npx tsx scripts/backfill-knowledge-base.ts

import { reindexAllCandidates, reindexAllJobs } from '../src/rag.service.js';
import { db } from '../src/db.js';

async function main() {
  console.log('Reindexing candidates...');
  const candidateResult = await reindexAllCandidates();
  console.log('Candidates:', candidateResult);

  console.log('Reindexing jobs...');
  const jobResult = await reindexAllJobs();
  console.log('Jobs:', jobResult);

  const total = await db.countKnowledgeChunks();
  console.log('Total knowledge_base_chunks rows:', total);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
