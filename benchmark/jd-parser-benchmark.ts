// JD Parser performance benchmark.
//
// Usage:
//   npx tsx benchmark/jd-parser-benchmark.ts            # Tier 1-2 only (regex + dictionary)
//   npx tsx benchmark/jd-parser-benchmark.ts --with-nlp  # full pipeline incl. Python NLP tier
//                                                          (requires the service running on
//                                                          JD_NLP_SERVICE_URL, default :8008)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJobDescription } from '../src/jd-parser/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'jd-parser', 'fixtures', 'sample-jds');
const RUNS_PER_FIXTURE = 20;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const includeNlp = process.argv.includes('--with-nlp');
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.txt'));

  if (files.length === 0) {
    console.error(`No fixture files found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  console.log(`JD Parser Benchmark`);
  console.log(`Mode: ${includeNlp ? 'Full pipeline (Tier 1-2 + Python NLP tier)' : 'Tier 1-2 only (regex + dictionary)'}`);
  console.log(`Fixtures: ${files.length}, Runs per fixture: ${RUNS_PER_FIXTURE}\n`);

  const allTimings: number[] = [];
  const perFixtureResults: { file: string; avg: number; min: number; max: number }[] = [];

  for (const file of files) {
    const text = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8');
    const timings: number[] = [];

    for (let i = 0; i < RUNS_PER_FIXTURE; i++) {
      const result = await parseJobDescription(text, { skipNlpTier: !includeNlp });
      timings.push(result.parseTimeMs);
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    perFixtureResults.push({ file, avg, min, max });
    allTimings.push(...timings);
  }

  console.log('Per-fixture results:');
  console.log('-'.repeat(70));
  for (const r of perFixtureResults) {
    console.log(`${r.file.padEnd(40)} avg: ${r.avg.toFixed(2)}ms  min: ${r.min.toFixed(2)}ms  max: ${r.max.toFixed(2)}ms`);
  }

  const sorted = [...allTimings].sort((a, b) => a - b);
  const overallAvg = allTimings.reduce((a, b) => a + b, 0) / allTimings.length;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1];
  const min = sorted[0];

  console.log('\n' + '='.repeat(70));
  console.log('Overall (all fixtures x all runs):');
  console.log(`  Samples: ${allTimings.length}`);
  console.log(`  Min:     ${min.toFixed(2)}ms`);
  console.log(`  Avg:     ${overallAvg.toFixed(2)}ms`);
  console.log(`  P50:     ${p50.toFixed(2)}ms`);
  console.log(`  P95:     ${p95.toFixed(2)}ms`);
  console.log(`  Max:     ${max.toFixed(2)}ms`);
  console.log('='.repeat(70));

  const target = 300;
  if (overallAvg < target) {
    console.log(`\n✅ PASS: average ${overallAvg.toFixed(2)}ms is under the ${target}ms target.`);
  } else {
    console.log(`\n❌ FAIL: average ${overallAvg.toFixed(2)}ms exceeds the ${target}ms target.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
