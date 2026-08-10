/**
 * Integration tests for POST /api/parse-resume (recruiter/admin bulk upload). Same mocked Gemini
 * approach as candidateResume.routes.test.ts - purely stateless, no monolith call needed.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const DEV_SECRET = 'dev-only-insecure-secret';
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 1, email: 'r@tejoma.com', name: 'Recruiter', company_id: 1, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;
const candidateCookie = () => `candidate_access_token=${jwt.sign({ candidate_id: 1, email: null, phone: null, name: 'C' }, DEV_SECRET, { expiresIn: '15m' })}`;

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          Name: 'Bulk Candidate', Email: 'bulk@example.test', Phone: '9999999999', Skills: 'Java',
          Primary_Skills: null, Secondary_Skills: null, Years_of_Experience: '3 Years',
          Current_Location: null, Preferred_Location: null, Current_Company: null, Previous_Companies: null,
          Current_Job_Title: null, Industry_Domain: null, Education: null, Highest_Qualification: null,
          Graduation_Year: null, University: null, Certifications: null, Projects: null, Technical_Tools: null,
          Languages_Known: null, Current_CTC: null, Expected_CTC: null, Notice_Period: null,
          Willingness_to_Relocate: null, LinkedIn_URL: null, GitHub_or_Portfolio_URL: null, Resume_Summary: null,
          AI_Confidence_Score: '90%', Data_Status: 'Complete', Work_History: [], Project_Entries: [],
        }),
      }),
    };
  }
  return { GoogleGenAI, Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', BOOLEAN: 'BOOLEAN' } };
});

let app: import('express').Express;

beforeAll(async () => {
  process.env.MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || 'http://127.0.0.1:1';
  ({ app } = await import('../src/server.js'));
});

describe('POST /parse-resume', () => {
  it('rejects unauthenticated requests', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/parse-resume');
    expect(res.status).toBe(401);
  });

  it('rejects a candidate session outright - staff and candidate use entirely separate cookies, so this is a 401 (no staff session), not a 403 (wrong role)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/parse-resume').set('Cookie', candidateCookie());
    expect(res.status).toBe(401);
  });

  it('rejects a request with no file', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/parse-resume').set('Cookie', recruiterCookie());
    expect(res.status).toBe(400);
  });

  it('parses a real .txt upload for a recruiter and returns the result', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/parse-resume')
      .set('Cookie', recruiterCookie())
      .attach('file', Buffer.from('Bulk Candidate resume text'), { filename: 'bulk.txt', contentType: 'text/plain' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Bulk Candidate');
  });
});
