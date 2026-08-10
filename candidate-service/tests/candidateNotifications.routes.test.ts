/**
 * Integration tests for /api/candidate-notifications/* against a real database - inserts a real
 * candidate_accounts row (candidate_notifications.candidate_account_id has a REAL FK here, unlike
 * Recruiting Service's recruiter_notifications - see migrations/002_candidate_notifications.up.sql's
 * header comment) and exercises the full read/unread-count/mark-read/mark-all-read cycle. Mirrors
 * recruiting-service's tests/recruiterNotifications.routes.test.ts approach.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

const DEV_SECRET = 'dev-only-insecure-secret';
let candidateId: number;
let otherCandidateId: number;
let notifId: number;

function authCookie(id = candidateId) {
  const token = jwt.sign({ candidate_id: id, email: 'notif-test@example.test', phone: null, name: 'Notif Test' }, DEV_SECRET, { expiresIn: '15m' });
  return `candidate_access_token=${token}`;
}

beforeAll(async () => {
  const account = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Notif Test', 'notif-test@example.test', 'hashed', true) RETURNING id`
  );
  candidateId = account.rows[0].id;
  const otherAccount = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Other Candidate', 'notif-other@example.test', 'hashed', true) RETURNING id`
  );
  otherCandidateId = otherAccount.rows[0].id;

  const notif = await pool.query(
    `INSERT INTO candidate_notifications (candidate_account_id, match_id, type, title, message)
     VALUES ($1, 9001, 'match_created', 'You matched with Engineer', 'You and the recruiter both showed interest.')
     RETURNING id`,
    [candidateId]
  );
  notifId = notif.rows[0].id;
  // A row scoped to a different candidate - proves the WHERE clause scopes by candidate_account_id.
  await pool.query(
    `INSERT INTO candidate_notifications (candidate_account_id, match_id, type, title, message)
     VALUES ($1, 9002, 'match_created', 'Someone else''s match', 'Not yours.')`,
    [otherCandidateId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_notifications WHERE candidate_account_id = ANY($1)', [[candidateId, otherCandidateId]]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = ANY($1)', [[candidateId, otherCandidateId]]);
  await pool.end();
});

describe('GET /api/candidate-notifications', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/candidate-notifications');
    expect(res.status).toBe(401);
  });

  it("returns only the requesting candidate's own notifications", async () => {
    const res = await request(app).get('/api/candidate-notifications').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].id).toBe(notifId);
    expect(res.body.notifications[0].title).toBe('You matched with Engineer');
  });
});

describe('GET /api/candidate-notifications/unread-count', () => {
  it('counts unread notifications for this candidate only', async () => {
    const res = await request(app).get('/api/candidate-notifications/unread-count').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

describe('PUT /api/candidate-notifications/:id/read', () => {
  it('returns 404 for a notification belonging to a different candidate', async () => {
    const res = await request(app).put('/api/candidate-notifications/999999/read').set('Cookie', authCookie());
    expect(res.status).toBe(404);
  });

  it('marks a real notification read and reflects it in the unread count', async () => {
    const res = await request(app).put(`/api/candidate-notifications/${notifId}/read`).set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const countRes = await request(app).get('/api/candidate-notifications/unread-count').set('Cookie', authCookie());
    expect(countRes.body.count).toBe(0);
  });
});

describe('PUT /api/candidate-notifications/read-all', () => {
  it('marks all remaining unread notifications for this candidate as read', async () => {
    await pool.query(
      `INSERT INTO candidate_notifications (candidate_account_id, job_id, type, title, message)
       VALUES ($1, 9003, 'application_status_changed', 'Application update', 'Your application is now Shortlisted.')`,
      [candidateId]
    );
    const res = await request(app).put('/api/candidate-notifications/read-all').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const countRes = await request(app).get('/api/candidate-notifications/unread-count').set('Cookie', authCookie());
    expect(countRes.body.count).toBe(0);
  });
});
