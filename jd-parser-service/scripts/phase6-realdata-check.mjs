/**
 * Phase 6 post-cutover check against REAL production data, through the DEPLOYED endpoint.
 *
 * Reads a sample of real jobs and candidates (SELECT only), builds Phase 3 / Phase 4 profiles on the
 * host exactly as the shadow harness does, then POSTs each pair to the deployed service and audits
 * the response. Nothing is written back: the evidence engine is a pure function of the profiles in
 * the request body, and no ranking, score or candidate row is touched.
 *
 * Usage: npx tsx scripts/phase6-realdata-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildJobIntelligence } from '../src/jd-understanding/engine.js';
import { buildCandidateIntelligence } from '../src/candidate-understanding/engine.js';

const REPO = path.resolve(process.cwd(), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const pg = require('pg');
const jwt = require('jsonwebtoken');

const env = {};
for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
const pem = fs.readFileSync(path.join(REPO, '.env.local'), 'utf8')
  .match(/^IDENTITY_JWT_PRIVATE_KEY="([\s\S]*?)"$/m)[1].replace(/\\n/g, '\n');
const token = jwt.sign({ user_id: 1, email: 'audit@tejoma.com', role: 'recruiter', company_id: 7 },
  pem, { algorithm: 'RS256', expiresIn: '20m' });

const conn = (database) => new pg.Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database,
});

const jc = conn('tejoma_job'); await jc.connect();
const jobRows = (await jc.query(
  `SELECT id, title, description, job_summary, responsibilities, required_skills, optional_skills,
          education, certifications, location, remote_type, employment_type, industry, department
     FROM jobs WHERE id < 990000 ORDER BY id LIMIT 5`)).rows;
await jc.end();

const cc = conn('tejoma_candidate_core'); await cc.connect();
const candRows = (await cc.query(
  `SELECT id, current_job_title, years_of_experience, primary_skills, secondary_skills, skills,
          technical_tools, certifications, languages_known, projects, industry_domain, education,
          highest_qualification, university, graduation_year, current_company, resume_summary, resume_text
     FROM candidates WHERE id < 990000 ORDER BY id LIMIT 8`)).rows;
await cc.end();

const jobs = jobRows.map((j) => buildJobIntelligence(j));
const cands = candRows.map((c) => buildCandidateIntelligence({ ...c, reference_date: '2026-08' }));

const post = (body) => {
  const tmp = path.join(process.env.TEMP ?? '.', `phase6-real-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(body));
  execFileSync('docker', ['cp', tmp, 'tejoma-nginx-1:/tmp/phase6-real.json'], { stdio: 'ignore' });
  fs.unlinkSync(tmp);
  const out = execFileSync('docker', ['exec', 'tejoma-nginx-1', 'wget', '-q', '-O', '-', '--timeout=30',
    '--post-file=/tmp/phase6-real.json', '--header', 'Content-Type: application/json',
    '--header', `Authorization: Bearer ${token}`,
    'http://jd-parser-service:4004/api/evidence/evaluate'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
};

let pairs = 0, reqs = 0, units = 0, provComplete = 0, falseProf = 0, falseProd = 0, scoreLeak = 0;
const states = {};
const t0 = Date.now();
const NON_PROF = new Set(['EXPLICIT_SKILL', 'EXPLICIT_TECHNOLOGY', 'ACADEMIC_PROJECT', 'CERTIFICATION',
  'EDUCATION', 'INDIRECT_EVIDENCE', 'CONTEXTUAL_EVIDENCE']);
const NON_PROD = new Set([...NON_PROF, 'PROJECT_EXPERIENCE', 'WORK_EXPERIENCE',
  'PROFESSIONAL_EXPERIENCE', 'DURATION_EVIDENCE', 'RESPONSIBILITY']);

for (const j of jobs) {
  for (const c of cands) {
    const res = post({ job: j, candidate: c });
    pairs++;
    if (/match_score|percentage|ranking|fit_score/.test(JSON.stringify(res.assessment))) scoreLeak++;
    for (const r of res.assessment.assessments) {
      reqs++;
      states[r.state] = (states[r.state] ?? 0) + 1;
      for (const u of r.evidence) {
        units++;
        if (u.provenance?.source_field && u.provenance?.rule && u.provenance?.derivation) provComplete++;
        if (u.professional && NON_PROF.has(u.evidence_type)) falseProf++;
        if (u.production && NON_PROD.has(u.evidence_type)) falseProd++;
      }
    }
  }
}
const el = Date.now() - t0;

console.log('PHASE 6 REAL-DATA CHECK THROUGH DEPLOYED SERVICE (read-only)');
console.log(`  ${jobs.length} real jobs x ${cands.length} real candidates = ${pairs} pairs over HTTP`);
console.log(`  requirements assessed ${reqs} · evidence units ${units}`);
console.log(`  states ${JSON.stringify(states)}`);
console.log(`  provenance completeness ${provComplete}/${units}`);
console.log(`  FALSE PROFESSIONAL ATTRIBUTION ${falseProf}`);
console.log(`  FALSE PRODUCTION ATTRIBUTION   ${falseProd}`);
console.log(`  MATCH-SCORE LEAKS              ${scoreLeak}`);
console.log(`  ${el} ms total = ${(el / pairs).toFixed(1)} ms per pair (includes docker exec + HTTP overhead)`);
process.exit(falseProf === 0 && falseProd === 0 && scoreLeak === 0 && provComplete === units ? 0 : 1);
