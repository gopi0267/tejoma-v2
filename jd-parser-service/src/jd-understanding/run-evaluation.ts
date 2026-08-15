/** Entry point: loads the real production JDs read-only, then runs the full evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runEvaluation } from './evaluate.js';
import type { JobRecordInput } from './engine.js';

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
  password: env.DB_PASSWORD, database: 'tejoma_job',
});
await client.connect();
const rows: JobRecordInput[] = (await client.query(
  `SELECT id, title, description, job_summary, responsibilities, required_skills, optional_skills,
          education, certifications, location, remote_type, employment_type, industry, department,
          matching_embedding_provenance->>'source_hash' AS source_hash,
          matching_embedding_source_hash AS representation_hash
     FROM jobs WHERE id < 990000 ORDER BY id`)).rows;
await client.end();

runEvaluation(rows);
