function parseSetCookies(res: Response) {
  const raw = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [];
  const jar: Record<string, string> = {};
  for (const line of raw as string[]) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

async function main() {
  const BASE = 'http://localhost:3006';
  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'recruiter@tejoma.com', password: 'Tejoma@123' }),
  });
  const cookies = parseSetCookies(loginRes);
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  console.log('Login status:', loginRes.status);

  const jobsRes = await fetch(BASE + '/api/jobs', { headers: { Cookie: cookieHeader } });
  const jobs = await jobsRes.json();
  console.log('Jobs available:', jobs.length);
  if (jobs.length === 0) {
    console.log('No jobs to test against - creating a temporary test job...');
    const createRes = await fetch(BASE + '/api/jobs', {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Backend Engineer',
        description: 'Looking for a backend engineer with Node.js and PostgreSQL experience to build scalable services.',
        required_skills: ['Node.js', 'PostgreSQL', 'AWS'],
        experience_years: 4,
        location: 'Hyderabad',
        salary_min: 1000000,
        salary_max: 1800000,
      }),
    });
    const created = await createRes.json();
    jobs.push(created);
  }

  const job = jobs[0];
  console.log('\nScoring candidates against job:', job.title, '(id:', job.id + ')');

  const start = Date.now();
  const detailRes = await fetch(BASE + '/api/jobs/' + job.id, { headers: { Cookie: cookieHeader } });
  const elapsed = Date.now() - start;
  const detail = await detailRes.json();
  console.log('Status:', detailRes.status, 'Elapsed:', elapsed, 'ms');
  console.log('Matched candidates:', detail.matched_candidates?.length);

  const top = detail.matched_candidates?.[0];
  if (top) {
    console.log('\n=== TOP MATCH ===');
    console.log('Candidate:', top.candidate.name);
    console.log('match_score:', top.match_score);
    console.log('breakdown.skills:', JSON.stringify(top.breakdown.skills));
    console.log('breakdown.experience:', JSON.stringify(top.breakdown.experience));
    console.log('breakdown.location:', JSON.stringify(top.breakdown.location));
    console.log('breakdown.salary:', JSON.stringify(top.breakdown.salary));
    console.log('breakdown.similarity:', JSON.stringify(top.breakdown.similarity));
    console.log('breakdown.ensemble:', JSON.stringify(top.breakdown.ensemble));
    console.log('summary:', top.summary);
  }
}

main().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
