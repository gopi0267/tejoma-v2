/**
 * Integration tests for /api/candidate-resume/* - real multipart file uploads (supertest
 * .attach), real text extraction (a .txt file needs no PDF/DOCX library), mocked Gemini SDK, and
 * a real, minimal stand-in for the monolith's /internal/resume/* API. Uses a real temp directory
 * on disk for storage (LocalDiskStorageAdapter), cleaned up after each test.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const candidateCookie = () => `candidate_access_token=${jwt.sign({ candidate_id: 5, email: 'jane@example.test', phone: null, name: 'Jane Doe' }, DEV_SECRET, { expiresIn: '15m' })}`;

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          Name: 'Jane Doe', Email: 'jane@example.test', Phone: '9876543210', Skills: 'Node.js',
          Primary_Skills: null, Secondary_Skills: null, Years_of_Experience: '5 Years',
          Current_Location: null, Preferred_Location: null, Current_Company: 'Acme', Previous_Companies: null,
          Current_Job_Title: 'Engineer', Industry_Domain: null, Education: null, Highest_Qualification: null,
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

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `resume-service-test-storage-${Date.now()}`);
let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.RESUME_STORAGE_DIR = TEST_STORAGE_DIR;
  process.env.TEMP_UPLOAD_DIR = path.join(TEST_STORAGE_DIR, 'tmp');
  fs.mkdirSync(process.env.TEMP_UPLOAD_DIR, { recursive: true });
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await monolith.close();
  fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
});

afterEach(() => {
  monolith.responses = {};
});

const RESUME_BUFFER = Buffer.from('Jane Doe\njane@example.test\n9876543210\n\nEngineer at Acme.\nSkills: Node.js');

describe('POST /candidate-resume/parse', () => {
  it('rejects unauthenticated requests', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/candidate-resume/parse');
    expect(res.status).toBe(401);
  });

  it('rejects a request with no file', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/candidate-resume/parse').set('Cookie', candidateCookie());
    expect(res.status).toBe(400);
  });

  it('extracts text from a real .txt upload and returns the (mocked) Gemini-parsed result, deleting the temp file', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/candidate-resume/parse')
      .set('Cookie', candidateCookie())
      .attach('file', RESUME_BUFFER, { filename: 'resume.txt', contentType: 'text/plain' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Jane Doe');
    expect(res.body.data.email).toBe('jane@example.test');
    // No leftover files in the temp upload dir after a successful parse.
    expect(fs.readdirSync(process.env.TEMP_UPLOAD_DIR!).length).toBe(0);
  });
});

describe('POST /candidate-resume/file (permanent storage)', () => {
  it('stores the file, calls the monolith to update the pointer, and returns the stored filename', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = {
      '/internal/resume/candidate/5': { status: 200, body: { resume_file_path: null, resume_original_filename: null } },
    };

    const res = await request(app)
      .post('/api/candidate-resume/file')
      .set('Cookie', candidateCookie())
      .attach('file', RESUME_BUFFER, { filename: 'my-resume.txt', contentType: 'text/plain' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The PATCH call to the monolith actually happened, with a real stored file path.
    const patchCall = monolith.received.find((r) => r.method === 'PATCH' && r.url === '/internal/resume/candidate/5');
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall!.body);
    expect(body.resume_original_filename).toBe('my-resume.txt');
    expect(fs.existsSync(body.resume_file_path)).toBe(true);
  });

  it('returns 404 when the monolith reports no such candidate profile', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = {
      '/internal/resume/candidate/5': { status: 404, body: { error: 'Profile not found' } },
    };
    const res = await request(app)
      .post('/api/candidate-resume/file')
      .set('Cookie', candidateCookie())
      .attach('file', RESUME_BUFFER, { filename: 'resume.txt', contentType: 'text/plain' });
    expect(res.status).toBe(404);
  });
});

describe('GET /candidate-resume/file (download)', () => {
  it('returns 404 when no resume file is on record', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = {
      '/internal/resume/candidate/5': { status: 200, body: { resume_file_path: null, resume_original_filename: null } },
    };
    const res = await request(app).get('/api/candidate-resume/file').set('Cookie', candidateCookie());
    expect(res.status).toBe(404);
  });

  it('downloads the real stored file when one is on record', async () => {
    const request = (await import('supertest')).default;
    fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
    const realFilePath = path.join(TEST_STORAGE_DIR, 'candidate-5-existing.txt');
    fs.writeFileSync(realFilePath, 'stored resume content');
    monolith.responses = {
      '/internal/resume/candidate/5': { status: 200, body: { resume_file_path: realFilePath, resume_original_filename: 'existing.txt' } },
    };

    const res = await request(app).get('/api/candidate-resume/file').set('Cookie', candidateCookie());
    expect(res.status).toBe(200);
    expect(res.text).toBe('stored resume content');
  });
});
