/**
 * Integration tests for the Gateway's rate limiting - real HTTP, real express-rate-limit
 * enforcement, against real (tiny, env-overridden) limits so the tests can deterministically
 * trigger 429 in a handful of requests rather than needing hundreds.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startMockUpstream, type MockUpstream } from './helpers/mockUpstream.js';

let identityMock: MockUpstream;
let monolithMock: MockUpstream;
let platformGovernanceMock: MockUpstream;
let jdParserMock: MockUpstream;
let candidateServiceMock: MockUpstream;
let chatServiceMock: MockUpstream;
let resumeServiceMock: MockUpstream;
let recruitingServiceMock: MockUpstream;
let analyticsServiceMock: MockUpstream;
let matchingEvaluationServiceMock: MockUpstream;
let app: import('express').Express;

beforeAll(async () => {
  identityMock = await startMockUpstream('identity-service');
  monolithMock = await startMockUpstream('monolith');
  platformGovernanceMock = await startMockUpstream('platform-governance-service');
  jdParserMock = await startMockUpstream('jd-parser-service');
  candidateServiceMock = await startMockUpstream('candidate-service');
  chatServiceMock = await startMockUpstream('chat-service');
  resumeServiceMock = await startMockUpstream('resume-service');
  recruitingServiceMock = await startMockUpstream('recruiting-service');
  analyticsServiceMock = await startMockUpstream('analytics-service');
  matchingEvaluationServiceMock = await startMockUpstream('matching-evaluation-service');

  process.env.IDENTITY_SERVICE_URL = identityMock.url;
  process.env.PLATFORM_GOVERNANCE_SERVICE_URL = platformGovernanceMock.url;
  process.env.JD_PARSER_SERVICE_URL = jdParserMock.url;
  process.env.CANDIDATE_SERVICE_URL = candidateServiceMock.url;
  process.env.CHAT_SERVICE_URL = chatServiceMock.url;
  process.env.RESUME_SERVICE_URL = resumeServiceMock.url;
  process.env.RECRUITING_SERVICE_URL = recruitingServiceMock.url;
  process.env.ANALYTICS_SERVICE_URL = analyticsServiceMock.url;
  process.env.MATCHING_EVALUATION_SERVICE_URL = matchingEvaluationServiceMock.url;
  process.env.MATCHING_SKILL_DISCOVERY_SERVICE_URL = 'http://127.0.0.1:1'; // not exercised by this test file
  process.env.MATCHING_SCORING_SERVICE_URL = 'http://127.0.0.1:1'; // not exercised by this test file
  process.env.CANDIDATE_CORE_SERVICE_URL = 'http://127.0.0.1:1'; // not exercised by this test file
  process.env.JOB_SERVICE_URL = 'http://127.0.0.1:1'; // not exercised by this test file
  process.env.MATCHING_DECISION_SERVICE_URL = 'http://127.0.0.1:1'; // not exercised by this test file
  process.env.MONOLITH_URL = monolithMock.url;
  process.env.GATEWAY_AUTH_RATE_MAX = '3';
  process.env.GATEWAY_AUTH_RATE_WINDOW_MS = '60000';
  process.env.GATEWAY_GLOBAL_RATE_MAX = '5';
  process.env.GATEWAY_GLOBAL_RATE_WINDOW_MS = '60000';

  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  delete process.env.GATEWAY_AUTH_RATE_MAX;
  delete process.env.GATEWAY_AUTH_RATE_WINDOW_MS;
  delete process.env.GATEWAY_GLOBAL_RATE_MAX;
  delete process.env.GATEWAY_GLOBAL_RATE_WINDOW_MS;
  await identityMock.close();
  await monolithMock.close();
  await platformGovernanceMock.close();
  await jdParserMock.close();
  await candidateServiceMock.close();
  await chatServiceMock.close();
  await resumeServiceMock.close();
  await recruitingServiceMock.close();
  await analyticsServiceMock.close();
  await matchingEvaluationServiceMock.close();
});

describe('authLimiter on auth-sensitive paths', () => {
  it('allows up to the configured max, then returns 429', async () => {
    const request = (await import('supertest')).default;
    // Each call uses a distinct path suffix so express-rate-limit's default IP-only key still
    // counts them together (the limiter keys on IP, not path) - real successive requests.
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push((await request(app).get('/api/auth/me')).status);
    }
    expect(results.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(results[3]).toBe(429);
  });
});

describe('globalLimiter on non-auth paths', () => {
  it('allows up to the configured max, then returns 429', async () => {
    const request = (await import('supertest')).default;
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push((await request(app).get('/api/jobs/123')).status);
    }
    expect(results.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(results[5]).toBe(429);
  });
});
