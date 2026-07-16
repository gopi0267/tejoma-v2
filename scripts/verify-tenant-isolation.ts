// Verifies the multi-tenant foundation actually isolates data between companies.
//
// Setup seeds two fresh companies + users directly via db.ts (not through the
// signup/OTP HTTP flow - that requires a real inbox/SMS delivery, which isn't scriptable
// headlessly) with known passwords, then exercises every request through the real
// /api/auth/login endpoint and real HTTP routes, same as scripts/e2e-test-matching.ts.
// Unlike that script, every check here is a real assertion that throws (and exits non-zero)
// on failure, rather than just logging output for a human to eyeball.
//
// Usage: npx tsx scripts/verify-tenant-isolation.ts
// Requires the Node dev server running on :3006 (npm run dev).

import bcrypt from 'bcrypt';
import { db } from '../src/db.js';

const BASE = 'http://localhost:3006';
const TEST_PASSWORD = 'TenantTest@123';

function parseSetCookies(res: Response): string {
  const raw = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [];
  const jar: Record<string, string> = {};
  for (const line of raw as string[]) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

let passed = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  passed++;
  console.log(`  ok - ${message}`);
}

async function loginAs(email: string): Promise<string> {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: TEST_PASSWORD }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  }
  return parseSetCookies(res);
}

async function main() {
  console.log('=== Tenant isolation verification ===\n');

  console.log('Seeding two fresh companies + users...');
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const stamp = Date.now();

  const companyA = await db.getOrCreateCompany(`Tenant Test Co A ${stamp}`);
  const companyB = await db.getOrCreateCompany(`Tenant Test Co B ${stamp}`);
  if (!companyA || !companyB) throw new Error('Failed to seed test companies');

  const emailA = `tenant-a-${stamp}@test.local`;
  const emailB = `tenant-b-${stamp}@test.local`;
  const userA = await db.createUser({ name: 'Tenant A User', email: emailA, phone: null, password_hash: passwordHash, company_id: companyA.id, role: 'admin', is_active: true } as any);
  const userB = await db.createUser({ name: 'Tenant B User', email: emailB, phone: null, password_hash: passwordHash, company_id: companyB.id, role: 'admin', is_active: true } as any);
  if (!userA || !userB) throw new Error('Failed to seed test users');
  console.log(`  Company A: id=${companyA.id} slug=${companyA.company_slug}`);
  console.log(`  Company B: id=${companyB.id} slug=${companyB.company_slug}\n`);

  console.log('Logging in as both users...');
  const cookieA = await loginAs(emailA);
  const cookieB = await loginAs(emailB);
  console.log('  Both logins succeeded\n');

  let jobId = 0;
  let candidateId = 0;

  try {
    console.log('Creating a job + candidate as Company A...');
    const jobRes = await fetch(BASE + '/api/jobs', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Tenant Isolation Test Job',
        description: 'Test job for tenant isolation verification.',
        required_skills: ['Node.js'],
        experience_years: 2,
        location: 'Remote',
        salary_min: 500000,
        salary_max: 900000,
      }),
    });
    assert(jobRes.status === 201, `Company A can create a job (got ${jobRes.status})`);
    const job = await jobRes.json();
    jobId = job.id;

    const candRes = await fetch(BASE + '/api/candidates', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tenant Isolation Test Candidate', email: `tenant-cand-${stamp}@test.local`, skills: ['Node.js'] }),
    });
    assert(candRes.status === 201, `Company A can create a candidate (got ${candRes.status})`);
    const candidate = await candRes.json();
    candidateId = candidate.id;
    console.log('');

    console.log('Verifying Company A can see its own data...');
    const ownJobRes = await fetch(BASE + `/api/jobs/${jobId}`, { headers: { Cookie: cookieA } });
    assert(ownJobRes.status === 200, `Company A can GET its own job (got ${ownJobRes.status})`);

    const ownCandRes = await fetch(BASE + `/api/candidates/${candidateId}`, { headers: { Cookie: cookieA } });
    assert(ownCandRes.status === 200, `Company A can GET its own candidate (got ${ownCandRes.status})`);

    const ownListRes = await fetch(BASE + '/api/jobs', { headers: { Cookie: cookieA } });
    const ownList = await ownListRes.json();
    assert(ownList.some((j: any) => j.id === jobId), 'Company A\'s job list includes the job it just created');
    console.log('');

    console.log('Verifying Company B CANNOT see Company A\'s data...');
    const crossJobRes = await fetch(BASE + `/api/jobs/${jobId}`, { headers: { Cookie: cookieB } });
    assert(crossJobRes.status === 404, `Company B GET on Company A's job is rejected (got ${crossJobRes.status})`);

    const crossCandRes = await fetch(BASE + `/api/candidates/${candidateId}`, { headers: { Cookie: cookieB } });
    assert(crossCandRes.status === 404, `Company B GET on Company A's candidate is rejected (got ${crossCandRes.status})`);

    const crossListRes = await fetch(BASE + '/api/jobs', { headers: { Cookie: cookieB } });
    const crossList = await crossListRes.json();
    assert(!crossList.some((j: any) => j.id === jobId), 'Company B\'s job list does NOT include Company A\'s job');

    const crossCandListRes = await fetch(BASE + '/api/candidates', { headers: { Cookie: cookieB } });
    const crossCandList = await crossCandListRes.json();
    assert(!crossCandList.some((c: any) => c.id === candidateId), 'Company B\'s candidate list does NOT include Company A\'s candidate');

    const crossSwipeRes = await fetch(BASE + '/api/swipes', {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, candidate_id: candidateId, action: 1 }),
    });
    assert(crossSwipeRes.status === 404, `Company B swiping on Company A's job/candidate is rejected (got ${crossSwipeRes.status})`);

    const crossDeleteRes = await fetch(BASE + `/api/candidates/${candidateId}`, { method: 'DELETE', headers: { Cookie: cookieB } });
    assert(crossDeleteRes.status === 404, `Company B deleting Company A's candidate is rejected (got ${crossDeleteRes.status})`);

    const crossJobDeleteRes = await fetch(BASE + `/api/jobs/${jobId}`, { method: 'DELETE', headers: { Cookie: cookieB } });
    assert(crossJobDeleteRes.status === 404, `Company B deleting Company A's job is rejected (got ${crossJobDeleteRes.status})`);
    console.log('');

    console.log('Verifying Company A can still swipe on its own job/candidate...');
    const ownSwipeRes = await fetch(BASE + '/api/swipes', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, candidate_id: candidateId, action: 1 }),
    });
    assert(ownSwipeRes.status === 201, `Company A can swipe on its own job/candidate (got ${ownSwipeRes.status})`);
    console.log('');

    console.log(`=== ALL ${passed} CHECKS PASSED ===`);
  } finally {
    console.log('\nCleaning up test data...');
    // Cascading deletes (match_scores/swipes -> candidates/jobs) are handled by FK ON DELETE
    // CASCADE where the schema defines it; explicit cleanup here covers the rest. The seeded
    // test companies/users themselves are intentionally left in place - there's no
    // delete-user/delete-company primitive in this codebase yet (out of scope for this
    // verification), and the timestamp in their name makes them easy to identify/prune later.
    if (jobId) await db.deleteJob(jobId, companyA.id).catch(() => {});
    if (candidateId) await db.deleteCandidate(candidateId, companyA.id).catch(() => {});
    console.log(`  Done. (Test companies "${companyA.name}" / "${companyB.name}" and their users were left in place - no delete-company primitive exists yet.)`);
  }
}

main()
  .catch((e) => {
    console.error('\n' + e.message);
    console.error(`\n${passed} check(s) passed before failure.`);
    process.exitCode = 1;
  })
  .finally(() => db.closeConnection());
