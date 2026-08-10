/**
 * Integration tests for the Gateway's health/readiness/liveness - real HTTP against real, minimal
 * stand-in upstreams so /health's best-effort upstream summary is exercised for real (one
 * healthy, one deliberately unreachable), never mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startMockUpstream, type MockUpstream } from './helpers/mockUpstream.js';

let identityMock: MockUpstream;
let app: import('express').Express;

beforeAll(async () => {
  identityMock = await startMockUpstream('identity-service');

  process.env.IDENTITY_SERVICE_URL = identityMock.url;
  process.env.PLATFORM_GOVERNANCE_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.JD_PARSER_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.CANDIDATE_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.CHAT_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.RESUME_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.RECRUITING_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.ANALYTICS_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.MATCHING_EVALUATION_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.MATCHING_SKILL_DISCOVERY_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.MATCHING_SCORING_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.CANDIDATE_CORE_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.JOB_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.MATCHING_DECISION_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  process.env.MONOLITH_URL = 'http://127.0.0.1:1'; // deliberately unreachable

  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await identityMock.close();
});

describe('GET /live', () => {
  it('always returns 200 - liveness never depends on any upstream', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /ready', () => {
  it('returns 200 - no local dependency to be unready for', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('reports a per-upstream summary, correctly distinguishing reachable from unreachable', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('api-gateway');

    const byName = Object.fromEntries(res.body.upstreams.map((u: any) => [u.name, u.status]));
    expect(byName['identity-service']).toBe('ok');
    expect(byName['platform-governance-service']).toBe('down');
    expect(byName['jd-parser-service']).toBe('down');
    expect(byName['candidate-service']).toBe('down');
    expect(byName['chat-service']).toBe('down');
    expect(byName['resume-service']).toBe('down');
    expect(byName['recruiting-service']).toBe('down');
    expect(byName['analytics-service']).toBe('down');
    expect(byName['matching-evaluation-service']).toBe('down');
    expect(byName['matching-decision-service']).toBe('down');
    expect(byName['monolith']).toBe('down');
  });
});
