/**
 * Generates a structured mismatch report comparing the monolith's candidate-facing responses
 * against Candidate Service's, across every active candidate (or a --limit). Distinct from the
 * per-request shadow-validation hook (src/candidateShadow.ts, which only fires opportunistically
 * on real traffic) - this is a standalone auditing tool an operator runs deliberately, covering
 * every candidate at once, before deciding to cut real traffic over.
 *
 * Currently covers GET /api/candidate-profile/me (the one endpoint Candidate Service fully owns
 * end-to-end without proxying back to the monolith - see candidate-service/README.md). Extending
 * to the proxied endpoints (jobs/decisions/applications/matches) would mostly re-validate that the
 * monolith agrees with itself through an extra hop, since Candidate Service's own proxy routes
 * call back into the exact same monolith code - lower value, same reasoning candidateShadow.ts's
 * own header comment gives for its scope.
 *
 * Usage:
 *   MONOLITH_URL=... CANDIDATE_SERVICE_URL=... JWT_SECRET=... \
 *   DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=... \
 *   npx tsx scripts/candidate-service-mismatch-report.ts [--limit N]
 */
import fs from 'fs';
import path from 'path';
import pkg from 'pg';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';

config({ path: '.env.local' });

const { Pool } = pkg;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`FATAL: ${key} is not set.`);
    process.exit(1);
  }
  return value;
}

const MONOLITH_URL = requireEnv('MONOLITH_URL');
const CANDIDATE_SERVICE_URL = requireEnv('CANDIDATE_SERVICE_URL');
const JWT_SECRET = requireEnv('JWT_SECRET');
const REQUEST_TIMEOUT_MS = 8000;

interface EndpointResult {
  candidateId: number;
  monolithStatus: number;
  candidateServiceStatus: number;
  monolithMs: number;
  candidateServiceMs: number;
  mismatchedFields: string[];
  error?: string;
}

function diffFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const mismatched: string[] = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) mismatched.push(key);
  }
  return mismatched;
}

async function timedFetch(url: string, cookie: string): Promise<{ status: number; body: any; ms: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, ms: performance.now() - start };
  } catch (err: any) {
    return { status: 0, body: { error: err.message }, ms: performance.now() - start };
  }
}

async function compareProfile(candidateId: number, name: string, email: string | null, phone: string | null): Promise<EndpointResult> {
  const token = jwt.sign({ candidate_id: candidateId, email, phone, name }, JWT_SECRET, { expiresIn: '15m' });
  const cookie = `candidate_access_token=${token}`;

  const [monolith, candidateService] = await Promise.all([
    timedFetch(`${MONOLITH_URL}/api/candidate-profile/me`, cookie),
    timedFetch(`${CANDIDATE_SERVICE_URL}/api/candidate-profile/me`, cookie),
  ]);

  return {
    candidateId,
    monolithStatus: monolith.status,
    candidateServiceStatus: candidateService.status,
    monolithMs: Math.round(monolith.ms),
    candidateServiceMs: Math.round(candidateService.ms),
    mismatchedFields: monolith.status === candidateService.status ? diffFields(monolith.body, candidateService.body) : ['<status code mismatch>'],
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: requireEnv('DB_NAME'),
    user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD || ''),
  });

  console.log(`=== Candidate Service mismatch report ===`);
  console.log(`Monolith:          ${MONOLITH_URL}`);
  console.log(`Candidate Service: ${CANDIDATE_SERVICE_URL}\n`);

  const candidatesResult = await pool.query(
    `SELECT id, name, email, phone FROM candidate_accounts WHERE is_active = true AND deleted_at IS NULL ORDER BY id` +
      (limit ? ` LIMIT ${limit}` : '')
  );
  await pool.end();

  console.log(`Comparing GET /api/candidate-profile/me for ${candidatesResult.rows.length} candidate(s)...\n`);

  const results: EndpointResult[] = [];
  for (const row of candidatesResult.rows) {
    const result = await compareProfile(row.id, row.name, row.email, row.phone);
    results.push(result);
    const status = result.mismatchedFields.length === 0 ? 'OK' : 'MISMATCH';
    console.log(`  [${status}] candidate ${row.id} (${row.name}) - monolith=${result.monolithMs}ms candidate-service=${result.candidateServiceMs}ms${result.mismatchedFields.length ? ` - fields: ${result.mismatchedFields.join(', ')}` : ''}`);
  }

  const mismatches = results.filter((r) => r.mismatchedFields.length > 0);
  const monolithTimings = results.map((r) => r.monolithMs).sort((a, b) => a - b);
  const candidateServiceTimings = results.map((r) => r.candidateServiceMs).sort((a, b) => a - b);

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint: 'GET /api/candidate-profile/me',
    monolithUrl: MONOLITH_URL,
    candidateServiceUrl: CANDIDATE_SERVICE_URL,
    totalCompared: results.length,
    totalMismatches: mismatches.length,
    mismatchRate: results.length > 0 ? mismatches.length / results.length : 0,
    timing: {
      monolith: { p50: percentile(monolithTimings, 50), p95: percentile(monolithTimings, 95), max: monolithTimings.at(-1) || 0 },
      candidateService: { p50: percentile(candidateServiceTimings, 50), p95: percentile(candidateServiceTimings, 95), max: candidateServiceTimings.at(-1) || 0 },
    },
    mismatches: mismatches.map((m) => ({ candidateId: m.candidateId, mismatchedFields: m.mismatchedFields, monolithStatus: m.monolithStatus, candidateServiceStatus: m.candidateServiceStatus })),
  };

  const reportsDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `candidate-service-mismatch-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  Compared:  ${report.totalCompared}`);
  console.log(`  Mismatches: ${report.totalMismatches} (${(report.mismatchRate * 100).toFixed(1)}%)`);
  console.log(`  Timing (p50/p95/max ms) - monolith: ${report.timing.monolith.p50}/${report.timing.monolith.p95}/${report.timing.monolith.max}, candidate-service: ${report.timing.candidateService.p50}/${report.timing.candidateService.p95}/${report.timing.candidateService.max}`);
  console.log(`  Report written to ${reportPath}`);
  console.log(report.totalMismatches === 0 ? '\n✓ Zero mismatches - safe to consider cutover for this endpoint.' : '\n✗ Mismatches found - do NOT cut over until resolved. See report for details.');

  process.exitCode = report.totalMismatches === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Mismatch report generation failed:', err);
  process.exit(1);
});
