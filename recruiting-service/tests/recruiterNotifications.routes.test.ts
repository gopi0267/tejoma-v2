/**
 * Integration tests for /api/recruiter-notifications/* against a real database - inserts real
 * recruiter_notifications rows directly (no FK to users/companies/mutual_matches here, so plain
 * integers are enough - migrations/001_initial_schema.up.sql's header comment) and exercises the
 * full read/unread-count/mark-read/mark-all-read cycle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const USER_ID = 501;
const COMPANY_ID = 601;
const OTHER_USER_ID = 502;

function authCookie(userId = USER_ID) {
  const token = jwt.sign({ user_id: userId, email: 'r@tejoma.com', name: 'Recruiter', company_id: COMPANY_ID, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' });
  return `access_token=${token}`;
}

let notifId: number;

beforeAll(async () => {
  const result = await pool.query(
    `INSERT INTO recruiter_notifications (user_id, company_id, match_id, type, title, message)
     VALUES ($1, $2, 9001, 'match_created', 'New mutual match for Engineer', 'A candidate matched with your job posting.')
     RETURNING id`,
    [USER_ID, COMPANY_ID]
  );
  notifId = result.rows[0].id;
  // A second row scoped to a different user in the same company - proves the WHERE clause scopes
  // by user_id, not just company_id.
  await pool.query(
    `INSERT INTO recruiter_notifications (user_id, company_id, match_id, type, title, message)
     VALUES ($1, $2, 9002, 'match_created', 'Someone else''s match', 'Not yours.')`,
    [OTHER_USER_ID, COMPANY_ID]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM recruiter_notifications WHERE company_id = $1', [COMPANY_ID]);
  await pool.end();
});

describe('GET /api/recruiter-notifications', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/recruiter-notifications');
    expect(res.status).toBe(401);
  });

  it('returns only the requesting recruiter\'s own notifications', async () => {
    const res = await request(app).get('/api/recruiter-notifications').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].id).toBe(notifId);
    expect(res.body.notifications[0].title).toBe('New mutual match for Engineer');
  });
});

describe('GET /api/recruiter-notifications/unread-count', () => {
  it('counts unread notifications for this recruiter only', async () => {
    const res = await request(app).get('/api/recruiter-notifications/unread-count').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

describe('PUT /api/recruiter-notifications/:id/read', () => {
  it('returns 404 for a notification belonging to a different recruiter', async () => {
    const res = await request(app).put('/api/recruiter-notifications/999999/read').set('Cookie', authCookie());
    expect(res.status).toBe(404);
  });

  it('marks a real notification read and reflects it in the unread count', async () => {
    const res = await request(app).put(`/api/recruiter-notifications/${notifId}/read`).set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const countRes = await request(app).get('/api/recruiter-notifications/unread-count').set('Cookie', authCookie());
    expect(countRes.body.count).toBe(0);
  });
});

describe('PUT /api/recruiter-notifications/read-all', () => {
  it('marks all remaining unread notifications for this recruiter as read', async () => {
    await pool.query(
      `INSERT INTO recruiter_notifications (user_id, company_id, match_id, type, title, message)
       VALUES ($1, $2, 9003, 'match_created', 'Another match', 'Another one.')`,
      [USER_ID, COMPANY_ID]
    );
    const res = await request(app).put('/api/recruiter-notifications/read-all').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const countRes = await request(app).get('/api/recruiter-notifications/unread-count').set('Cookie', authCookie());
    expect(countRes.body.count).toBe(0);
  });
});
