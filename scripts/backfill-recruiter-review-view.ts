/**
 * Backfill recruiter_review_view (matching-decision-service)
 *
 * Phase 4, Item 5: Populates materialized view from 4 source databases:
 * - monolith: swipes, recruiter_notes, career_trajectories
 * - candidate-core-service: candidates
 * - job-service: jobs
 * - identity-service: users (recruiters)
 *
 * One row per (candidate_id, job_id, company_id), denormalized with all fields
 * needed for list query (no cross-database joins at read time).
 *
 * Idempotent: UNIQUE constraint + ON CONFLICT DO UPDATE.
 * Re-running is safe; existing rows are updated to latest state.
 */

import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const monolithPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const matchingDecisionPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.MATCHING_DECISION_SERVICE_DB_NAME || 'tejoma_matching_decision',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const candidateCorePool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.CANDIDATE_CORE_SERVICE_DB_NAME || 'tejoma_candidate_core',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const jobServicePool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.JOB_SERVICE_DB_NAME || 'tejoma_job',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const identityServicePool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.IDENTITY_SERVICE_DB_NAME || 'tejoma_identity',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const BATCH_SIZE = 500;

async function backfillRecruiterReviewView(): Promise<void> {
  console.log('\n[recruiter_review_view] Starting backfill...');

  try {
    // Step 1: Fetch all swipes from monolith (the anchor table)
    const swipesResult = await monolithPool.query(`
      SELECT DISTINCT
        s.id,
        s.company_id,
        s.candidate_id,
        s.job_id,
        s.action,
        s.score,
        s.reason,
        s.created_at as swipe_created_at,
        s.updated_at as swipe_updated_at
      FROM swipes s
      ORDER BY s.id
    `);

    const swipes = swipesResult.rows;
    console.log(`[recruiter_review_view] Found ${swipes.length} swipes to process`);

    if (swipes.length === 0) {
      console.log('[recruiter_review_view] No swipes found, skipping backfill');
      return;
    }

    // Fetch candidate data from candidate-core-service
    const candidateIds = [...new Set(swipes.map((s) => s.candidate_id))];
    const candidatesResult = await candidateCorePool.query(
      `SELECT id, email, first_name, last_name, phone, skills, experience_years
       FROM candidates WHERE id = ANY($1)`,
      [candidateIds]
    );
    const candidatesMap = new Map(candidatesResult.rows.map((c) => [c.id, c]));

    // Fetch job data from job-service
    const jobIds = [...new Set(swipes.map((s) => s.job_id))];
    const jobsResult = await jobServicePool.query(
      `SELECT id, title, required_skills, location FROM jobs WHERE id = ANY($1)`,
      [jobIds]
    );
    const jobsMap = new Map(jobsResult.rows.map((j) => [j.id, j]));

    // Fetch recruiter data from identity-service
    const recruiterIds = [...new Set(swipes.map((s) => s.recruiter_id).filter((x) => x))];
    let recruitersMap = new Map<number, any>();
    if (recruiterIds.length > 0) {
      const recruitersResult = await identityServicePool.query(
        `SELECT id, email, full_name FROM users WHERE id = ANY($1)`,
        [recruiterIds]
      );
      recruitersMap = new Map(recruitersResult.rows.map((u) => [u.id, u]));
    }

    // Fetch recruiter notes from monolith
    const notesResult = await monolithPool.query(`
      SELECT candidate_id, job_id, company_id, note
      FROM recruiter_notes
    `);
    const notesMap = new Map<string, string>();
    for (const note of notesResult.rows) {
      notesMap.set(`${note.candidate_id}-${note.job_id}-${note.company_id}`, note.note);
    }

    // Fetch latest decisions from monolith
    const decisionsResult = await monolithPool.query(`
      SELECT DISTINCT ON (candidate_id, job_id, company_id)
        candidate_id, job_id, company_id, decision_date
      FROM candidate_decisions
      ORDER BY candidate_id, job_id, company_id, created_at DESC
    `);
    const decisionsMap = new Map<string, Date>();
    for (const decision of decisionsResult.rows) {
      decisionsMap.set(
        `${decision.candidate_id}-${decision.job_id}-${decision.company_id}`,
        decision.decision_date
      );
    }

    // Step 2: Batch upsert into recruiter_review_view
    let processed = 0;
    for (let i = 0; i < swipes.length; i += BATCH_SIZE) {
      const batch = swipes.slice(i, i + BATCH_SIZE);

      const values = batch.map((s) => {
        const candidate = candidatesMap.get(s.candidate_id);
        const job = jobsMap.get(s.job_id);
        const recruiter = s.recruiter_id ? recruitersMap.get(s.recruiter_id) : null;
        const note = notesMap.get(`${s.candidate_id}-${s.job_id}-${s.company_id}`);
        const decision_date = decisionsMap.get(
          `${s.candidate_id}-${s.job_id}-${s.company_id}`
        );

        const candidateName = candidate
          ? `${candidate.first_name} ${candidate.last_name}`.trim()
          : null;
        const skillsArray = candidate?.skills
          ? typeof candidate.skills === 'string'
            ? JSON.parse(candidate.skills)
            : candidate.skills
          : [];
        const requiredSkillsArray = job?.required_skills
          ? typeof job.required_skills === 'string'
            ? JSON.parse(job.required_skills)
            : job.required_skills
          : [];

        return `(
          ${s.company_id}, ${s.candidate_id}, ${s.job_id},
          '${candidate?.email || ''}', '${(candidateName || '').replace(/'/g, "''")}', '${candidate?.phone || ''}',
          '${JSON.stringify(skillsArray).replace(/'/g, "''")}', ${candidate?.experience_years || null},
          '${(job?.title || '').replace(/'/g, "''")}', '${JSON.stringify(requiredSkillsArray).replace(/'/g, "''")}', '${job?.location || ''}',
          ${s.recruiter_id || null}, '${(recruiter?.full_name || '').replace(/'/g, "''")}', '${recruiter?.email || ''}',
          ${s.action}, ${s.score}, '${(s.reason || '').replace(/'/g, "''")}', '${(note || '').replace(/'/g, "''")}',
          ${decision_date ? `'${decision_date.toISOString()}'` : null},
          '${s.swipe_created_at.toISOString()}', '${s.swipe_updated_at.toISOString()}'
        )`;
      });

      const insertSql = `
        INSERT INTO recruiter_review_view (
          company_id, candidate_id, job_id,
          candidate_email, candidate_name, candidate_phone,
          candidate_skills, candidate_experience_years,
          job_title, job_required_skills, job_location,
          recruiter_id, recruiter_name, recruiter_email,
          action, score, reason, recruiter_note,
          decision_date, swipe_created_at, swipe_updated_at
        )
        VALUES ${values.join(', ')}
        ON CONFLICT (company_id, candidate_id, job_id) DO UPDATE SET
          candidate_email = EXCLUDED.candidate_email,
          candidate_name = EXCLUDED.candidate_name,
          candidate_phone = EXCLUDED.candidate_phone,
          candidate_skills = EXCLUDED.candidate_skills,
          candidate_experience_years = EXCLUDED.candidate_experience_years,
          job_title = EXCLUDED.job_title,
          job_required_skills = EXCLUDED.job_required_skills,
          job_location = EXCLUDED.job_location,
          recruiter_id = EXCLUDED.recruiter_id,
          recruiter_name = EXCLUDED.recruiter_name,
          recruiter_email = EXCLUDED.recruiter_email,
          action = EXCLUDED.action,
          score = EXCLUDED.score,
          reason = EXCLUDED.reason,
          recruiter_note = EXCLUDED.recruiter_note,
          decision_date = EXCLUDED.decision_date,
          swipe_created_at = EXCLUDED.swipe_created_at,
          swipe_updated_at = EXCLUDED.swipe_updated_at,
          updated_at = CURRENT_TIMESTAMP
      `;

      await matchingDecisionPool.query(insertSql);
      processed += batch.length;
      console.log(`[recruiter_review_view] Backfilled ${processed}/${swipes.length} rows...`);
    }

    console.log(`\n[recruiter_review_view] ✅ Backfill complete: ${processed} rows`);
  } catch (err) {
    console.error('\n❌ Backfill failed:', err);
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    console.log('Starting recruiter_review_view backfill...');
    await backfillRecruiterReviewView();
    console.log('\n✅ All backfill steps completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Backfill failed:', err);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await matchingDecisionPool.end();
    await candidateCorePool.end();
    await jobServicePool.end();
    await identityServicePool.end();
  }
}

main();
