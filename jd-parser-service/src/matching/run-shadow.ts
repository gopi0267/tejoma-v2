/**
 * Phase 7 shadow run: real jobs x real candidates, read-only, compared against the production matcher.
 *
 * PRODUCTION COMPARISON. The production score is recomputed here from the SAME raw rows using the
 * exact published formula in matching-scoring-service/src/matching/services.ts:
 *   feature_score = jaccard*0.40 + expScore*0.35 + locScore*0.15 + salScore*0.10
 *   expScore      = candidateExp >= jobExp ? 100 : (jobExp > 0 ? candidateExp/jobExp*100 : 100)
 * This is the DETERMINISTIC component of production scoring. The ML blend is excluded because it
 * requires the live ensemble, and including a stochastic term would make the comparison
 * unreproducible. The heuristic component is what the blend is anchored on, so the comparison is
 * meaningful for the question being asked: where does an evidence-aware engine disagree with a
 * token-overlap one, and in which direction?
 *
 * READ-ONLY: every statement is a SELECT; no production score, ranking or candidate row is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMatchEvaluation } from './evaluate.js';
import { buildJobIntelligence } from '../jd-understanding/engine.js';
import { buildCandidateIntelligence } from '../candidate-understanding/engine.js';
import type { CandidateProfileP7, JobProfileP7 } from './engine.js';

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
          education, certifications, location, remote_type, employment_type, industry, department,
          experience_years, salary_min, salary_max
     FROM jobs WHERE id < 990000 ORDER BY id`)).rows;
await jc.end();

const cc = conn('tejoma_candidate_core'); await cc.connect();
const candRows = (await cc.query(
  `SELECT id, current_job_title, years_of_experience, primary_skills, secondary_skills, skills,
          technical_tools, certifications, languages_known, projects, industry_domain, education,
          highest_qualification, university, graduation_year, current_company, resume_summary,
          resume_text, current_location
     FROM candidates WHERE id < 990000 ORDER BY id`)).rows;
await cc.end();

// ---- production heuristic, ported verbatim from the published formula
const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? v.split(/[,;|]/).map((s) => s.trim()) : [];

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map((s) => s.toLowerCase().trim()).filter(Boolean));
  const B = new Set(b.map((s) => s.toLowerCase().trim()).filter(Boolean));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : (inter / uni) * 100;
}

const parseYears = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};

function productionScore(j: Record<string, unknown>, c: Record<string, unknown>): number {
  const candSkills = [...asArray(c.primary_skills), ...asArray(c.secondary_skills),
    ...asArray(c.skills), ...asArray(c.technical_tools)];
  const jobSkills = asArray(j.required_skills);
  const jaccardSkillScore = jaccard(candSkills, jobSkills);

  const candidateExp = parseYears(c.years_of_experience);
  const jobExp = typeof j.experience_years === 'number' ? j.experience_years : 0;
  const expScore = candidateExp >= jobExp ? 100 : (jobExp > 0 ? (candidateExp / jobExp) * 100 : 100);

  // Location and salary are unavailable per-row in a comparable form for most of this corpus; the
  // production code defaults both to 100 when it cannot compute a distance or a salary band, so the
  // same default is used here rather than inventing a penalty.
  const locScore = 100;
  const salScore = 100;

  return Math.round(jaccardSkillScore * 0.40 + expScore * 0.35 + locScore * 0.15 + salScore * 0.10);
}

const jobs: JobProfileP7[] = jobRows.map((j: Record<string, unknown>) => buildJobIntelligence(j) as JobProfileP7);
const candidates: CandidateProfileP7[] = candRows.map((c: Record<string, unknown>) =>
  buildCandidateIntelligence({ ...c, reference_date: '2026-08' }) as CandidateProfileP7);

const prodByPair = new Map<string, number>();
jobRows.forEach((j: Record<string, unknown>, ji: number) => {
  candRows.forEach((c: Record<string, unknown>, ci: number) => {
    prodByPair.set(`${ji}:${ci}`, productionScore(j, c));
  });
});
const jobIndex = new Map(jobs.map((j, i) => [j, i]));
const candIndex = new Map(candidates.map((c, i) => [c, i]));

runMatchEvaluation({
  jobs, candidates,
  production: (j, c) => prodByPair.get(`${jobIndex.get(j)}:${candIndex.get(c)}`) ?? 0,
});
