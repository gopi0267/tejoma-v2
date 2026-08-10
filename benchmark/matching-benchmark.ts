// Matching pipeline performance benchmark - scores a realistic candidate pool against a job via
// the real batched scoring path (calculateMatchScoresBatch), same code path production traffic
// uses (GET /jobs/:id, GET /matches/queue/:job_id).
//
// Usage: npx tsx benchmark/matching-benchmark.ts
// Requires: Postgres running with seeded candidates/jobs, and (optionally) the Python
// matching-ml-service running on :8009 for the full ensemble path - gracefully measures the
// deterministic-only path if it's not reachable.

import { calculateMatchScoresBatch } from '../src/matching/services.js';
import { db } from '../src/db.js';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const jobs = await db.getJobs();
  const candidates = await db.getCandidates();

  if (jobs.length === 0 || candidates.length === 0) {
    console.error('Need at least 1 job and 1 candidate in the database to benchmark. Seed some data first.');
    process.exit(1);
  }

  const job = jobs[0];
  console.log('Matching Benchmark');
  console.log(`Job: "${job.title}" | Candidate pool: ${candidates.length}\n`);

  const RUNS = 10;
  const timings: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await calculateMatchScoresBatch(job, candidates, { skipGeminiSummary: true });
    timings.push(performance.now() - start);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;

  console.log(`Scoring ${candidates.length} candidates against 1 job, ${RUNS} runs:`);
  console.log(`  Min: ${sorted[0].toFixed(1)}ms`);
  console.log(`  Avg: ${avg.toFixed(1)}ms`);
  console.log(`  P50: ${percentile(sorted, 50).toFixed(1)}ms`);
  console.log(`  Max: ${sorted[sorted.length - 1].toFixed(1)}ms`);
  console.log(`  Per-candidate avg: ${(avg / candidates.length).toFixed(2)}ms`);
  console.log(`\n(For comparison: N separate per-candidate calls to the ML service, instead of 1 batched call, would multiply the network round-trip cost by ${candidates.length}x.)`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
