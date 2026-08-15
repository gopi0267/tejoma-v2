/** Entry point: loads real candidates read-only, then runs the Phase 4 evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runCandidateEvaluation } from './evaluate.js';
import type { CandidateRecordInput } from './engine.js';

const REPO = path.resolve(process.cwd(), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const pg = require('pg');

const env: Record<string, string> = {};
for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}

const client = new pg.Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
  password: env.DB_PASSWORD, database: 'tejoma_candidate_core',
});
await client.connect();
const rows: CandidateRecordInput[] = (await client.query(
  `SELECT id, current_job_title, years_of_experience, primary_skills, secondary_skills, skills,
          technical_tools, certifications, languages_known, projects, industry_domain, education,
          highest_qualification, university, graduation_year, current_company, previous_companies,
          resume_summary, resume_text,
          matching_embedding_provenance->>'source_hash' AS source_hash,
          matching_embedding_source_hash AS representation_hash
     FROM candidates WHERE id < 990000 ORDER BY id`)).rows;
await client.end();

// Deterministic reference date for the shadow run, so repeated runs are comparable.
runCandidateEvaluation(rows.map((r) => ({ ...r, reference_date: '2026-08' })));
