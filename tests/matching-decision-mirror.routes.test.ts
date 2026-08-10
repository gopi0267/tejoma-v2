/**
 * Integration tests for src/api/matching-decision-internal.routes.ts's mirror-and-notify
 * endpoints - POST /swipes/mirror-and-notify (write-cutover completion plan, Phase C, extended in
 * Phase D for source: 'decision-change') and the new POST /recruiter-review/notes/mirror-and-
 * notify / POST /recruiter-review/detailed-score/mirror-and-notify (Phase D) - real HTTP against a
 * minimal standalone Express app that mounts only this router, against the real database. Same
 * mount-just-the-router pattern as tests/candidate-core-mirror.routes.test.ts and
 * tests/job-mirror.routes.test.ts.
 *
 * Scope: the reverse-mirror mechanics (explicit-id upsert into each table, and that the
 * candidate/job lookup + fire-and-forget hooks don't throw synchronously for the swipe endpoint)
 * - not the hooks' own behavior (broadcastEvent, enqueueRetrain, the mutual-match check,
 * syncApplicationStatusFromRecruiterDecision, shadow logging), which are the same
 * already-proven, unchanged monolith-local functions db.recordSwipe/recordSwipeWithSideEffects/
 * changeRecruiterReviewDecision always called; nothing about their own behavior changed here,
 * only how they're reached. Notes/detailed-score have no hook bundle at all - the endpoint's
 * entire job is the upsert.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import matchingDecisionInternalRoutes from '../src/api/matching-decision-internal.routes.js';

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

const app = express();
app.use(express.json());
app.use('/internal/matching-decision', matchingDecisionInternalRoutes);

let companyId: number;
let candidateId: number;
let jobId: number;
const mirroredSwipeIds: number[] = [];
const mirroredNoteIds: number[] = [];
const mirroredReportIds: number[] = [];

beforeAll(async () => {
  const company = await pool.query(
    `INSERT INTO companies (name, company_slug) VALUES ('Swipe Mirror Test Co', 'swipe-mirror-test-co') RETURNING id`
  );
  companyId = company.rows[0].id;

  const candidate = await pool.query(
    `INSERT INTO candidates (company_id, name, email) VALUES ($1, 'Swipe Mirror Candidate', 'swipe-mirror-candidate@example.test') RETURNING id`,
    [companyId]
  );
  candidateId = candidate.rows[0].id;

  const job = await pool.query(
    `INSERT INTO jobs (company_id, title, description, required_skills, status) VALUES ($1, 'Swipe Mirror Job', 'desc', ARRAY['Go'], 'open') RETURNING id`,
    [companyId]
  );
  jobId = job.rows[0].id;
});

afterAll(async () => {
  if (mirroredSwipeIds.length > 0) {
    await pool.query('DELETE FROM swipes WHERE id = ANY($1)', [mirroredSwipeIds]);
  }
  if (mirroredNoteIds.length > 0) {
    await pool.query('DELETE FROM recruiter_notes WHERE id = ANY($1)', [mirroredNoteIds]);
  }
  if (mirroredReportIds.length > 0) {
    await pool.query('DELETE FROM detailed_scoring_reports WHERE id = ANY($1)', [mirroredReportIds]);
  }
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('POST /internal/matching-decision/swipes/mirror-and-notify', () => {
  it('rejects a request with no swipe id', async () => {
    const res = await request(app).post('/internal/matching-decision/swipes/mirror-and-notify').send({ swipe: { action: 1 } });
    expect(res.status).toBe(400);
  });

  it('upserts the row into this table by its explicit id - a genuinely new id inserts', async () => {
    // A high, explicit id standing in for one matching-decision-service's own sequence would
    // assign - this endpoint must never re-run this table's own sequence.
    const id = 900903;
    mirroredSwipeIds.push(id);
    const res = await request(app).post('/internal/matching-decision/swipes/mirror-and-notify').send({
      swipe: {
        id, company_id: companyId, recruiter_id: 1, candidate_id: candidateId, job_id: jobId,
        action: 1, match_score: 88, used_for_training: false, reason: null,
        breakdown: { skills: { score: 100, matched: ['Go'], missing: [] } }, decision_time_seconds: 4.2,
        timestamp: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM swipes WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(Number(row.rows[0].action)).toBe(1);
    expect(Number(row.rows[0].match_score)).toBe(88);
    expect(row.rows[0].candidate_id).toBe(candidateId);
  });

  it('the same id a second time updates in place, not a duplicate insert', async () => {
    const id = 900903;
    const res = await request(app).post('/internal/matching-decision/swipes/mirror-and-notify').send({
      swipe: {
        id, company_id: companyId, recruiter_id: 1, candidate_id: candidateId, job_id: jobId,
        action: 0, match_score: 55, used_for_training: false, reason: null, breakdown: null,
        decision_time_seconds: null, timestamp: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(200);

    const rows = await pool.query('SELECT * FROM swipes WHERE id = $1', [id]);
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].action)).toBe(0);
    expect(Number(rows.rows[0].match_score)).toBe(55);
  });

  // `swipes.candidate_id`/`job_id` are real foreign keys against this table's own `candidates`/
  // `jobs` - unlike mirrorUpsertJob/mirrorUpsertCandidate (which mirror into a table with no such
  // constraint), a swipe mirror genuinely fails if the referenced candidate/job's own Phase A/B
  // mirror hasn't landed here yet. That's fine, not a gap: matching-decision-service's own route
  // handler always resolves job/candidate via job-service's/candidate-core-service's real
  // databases before recording a swipe, so they exist by construction; if this table's copy is
  // somehow stale, monolithClient.mirrorAndNotifySwipe on the calling side already treats this
  // endpoint's failure as non-fatal (logs and moves on) - only this row's monolith-local mirror
  // is affected, never the swipe the recruiter actually recorded.
  it('surfaces a clear error (not a silent partial write) when the referenced candidate/job has no local mirror', async () => {
    const id = 900904;
    const res = await request(app).post('/internal/matching-decision/swipes/mirror-and-notify').send({
      swipe: {
        id, company_id: companyId, recruiter_id: 1, candidate_id: 999999999, job_id: 999999999,
        action: 1, match_score: 70, used_for_training: false, reason: null, breakdown: null,
        decision_time_seconds: null, timestamp: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(500);

    const row = await pool.query('SELECT id FROM swipes WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(0);
  });

  // Write-cutover completion plan, Phase D - PATCH /recruiter-review/:id/decision mirrors through
  // this same endpoint with source: 'decision-change'; the row lands identically (the branch only
  // affects which broadcast fires and whether enqueueRetrain runs, neither observable from this
  // mount-just-the-router test), so this just confirms the extra field doesn't break the upsert.
  it('accepts source: "decision-change" and still upserts normally', async () => {
    const id = 900905;
    mirroredSwipeIds.push(id);
    const res = await request(app).post('/internal/matching-decision/swipes/mirror-and-notify').send({
      swipe: {
        id, company_id: companyId, recruiter_id: 1, candidate_id: candidateId, job_id: jobId,
        action: 1, match_score: 91, used_for_training: false, reason: 'Great fit', breakdown: null,
        decision_time_seconds: null, timestamp: new Date().toISOString(),
      },
      source: 'decision-change',
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM swipes WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].reason).toBe('Great fit');
  });
});

describe('POST /internal/matching-decision/recruiter-review/notes/mirror-and-notify', () => {
  it('rejects a request with no note id', async () => {
    const res = await request(app).post('/internal/matching-decision/recruiter-review/notes/mirror-and-notify').send({ note: { note: 'No Id' } });
    expect(res.status).toBe(400);
  });

  it('upserts the row into this table by its explicit id - a genuinely new id inserts', async () => {
    const id = 900906;
    mirroredNoteIds.push(id);
    const res = await request(app).post('/internal/matching-decision/recruiter-review/notes/mirror-and-notify').send({
      note: { id, company_id: companyId, candidate_id: candidateId, job_id: jobId, note: 'Mirrored note', created_by: 1, updated_by: 1 },
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM recruiter_notes WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].note).toBe('Mirrored note');
  });

  it('the same id a second time updates in place, not a duplicate insert', async () => {
    const id = 900906;
    const res = await request(app).post('/internal/matching-decision/recruiter-review/notes/mirror-and-notify').send({
      note: { id, company_id: companyId, candidate_id: candidateId, job_id: jobId, note: 'Mirrored note (updated)', created_by: 1, updated_by: 1 },
    });
    expect(res.status).toBe(200);

    const rows = await pool.query('SELECT * FROM recruiter_notes WHERE id = $1', [id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].note).toBe('Mirrored note (updated)');
  });
});

describe('POST /internal/matching-decision/recruiter-review/detailed-score/mirror-and-notify', () => {
  it('rejects a request with no report id', async () => {
    const res = await request(app).post('/internal/matching-decision/recruiter-review/detailed-score/mirror-and-notify').send({ report: { report: {} } });
    expect(res.status).toBe(400);
  });

  it('upserts the row into this table by its explicit id - a genuinely new id inserts', async () => {
    const id = 900907;
    mirroredReportIds.push(id);
    const res = await request(app).post('/internal/matching-decision/recruiter-review/detailed-score/mirror-and-notify').send({
      report: { id, company_id: companyId, candidate_id: candidateId, job_id: jobId, report: { finalScorePercent: 82 }, generated_by: 1 },
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM detailed_scoring_reports WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].report.finalScorePercent).toBe(82);
  });

  it('the same id a second time updates in place, not a duplicate insert', async () => {
    const id = 900907;
    const res = await request(app).post('/internal/matching-decision/recruiter-review/detailed-score/mirror-and-notify').send({
      report: { id, company_id: companyId, candidate_id: candidateId, job_id: jobId, report: { finalScorePercent: 90 }, generated_by: 1 },
    });
    expect(res.status).toBe(200);

    const rows = await pool.query('SELECT * FROM detailed_scoring_reports WHERE id = $1', [id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].report.finalScorePercent).toBe(90);
  });
});
