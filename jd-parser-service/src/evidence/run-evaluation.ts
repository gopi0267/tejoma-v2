/** Entry point: loads real jobs and candidates read-only, builds Phase 3/4 profiles, then evaluates. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runEvidenceEvaluation } from './evaluate.js';
import { buildJobIntelligence } from '../jd-understanding/engine.js';
import { buildCandidateIntelligence } from '../candidate-understanding/engine.js';

const REPO = path.resolve(process.cwd(), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const pg = require('pg');
const env: Record<string, string> = {};
for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
const conn = (database: string) => new pg.Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database,
});

const jc = conn('tejoma_job'); await jc.connect();
const jobRows = (await jc.query(
  `SELECT id, title, description, job_summary, responsibilities, required_skills, optional_skills,
          education, certifications, location, remote_type, employment_type, industry, department
     FROM jobs WHERE id < 990000 ORDER BY id`)).rows;
await jc.end();

const cc = conn('tejoma_candidate_core'); await cc.connect();
const candRows = (await cc.query(
  `SELECT id, current_job_title, years_of_experience, primary_skills, secondary_skills, skills,
          technical_tools, certifications, languages_known, projects, industry_domain, education,
          highest_qualification, university, graduation_year, current_company, resume_summary, resume_text
     FROM candidates WHERE id < 990000 ORDER BY id`)).rows;
await cc.end();

runEvidenceEvaluation({
  jobs: jobRows.map((j: Record<string, unknown>) => buildJobIntelligence(j)),
  candidates: candRows.map((c: Record<string, unknown>) =>
    buildCandidateIntelligence({ ...c, reference_date: '2026-08' })),
});
