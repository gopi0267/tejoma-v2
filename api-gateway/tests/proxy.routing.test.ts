/**
 * Integration tests for the Gateway's routing table - real HTTP against real, minimal stand-in
 * upstream servers (tests/helpers/mockUpstream.ts) for Identity Service, Platform Governance
 * Service, and "the monolith." Verifies the full chain end-to-end: correct upstream selected,
 * full original path preserved (not stripped), request body arrives intact, cookies pass through
 * in both directions, and /internal/* is never forwarded anywhere.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startMockUpstream, type MockUpstream } from './helpers/mockUpstream.js';

let identityMock: MockUpstream;
let platformGovernanceMock: MockUpstream;
let jdParserMock: MockUpstream;
let candidateServiceMock: MockUpstream;
let chatServiceMock: MockUpstream;
let resumeServiceMock: MockUpstream;
let recruitingServiceMock: MockUpstream;
let analyticsServiceMock: MockUpstream;
let matchingEvaluationServiceMock: MockUpstream;
let matchingSkillDiscoveryServiceMock: MockUpstream;
let matchingScoringServiceMock: MockUpstream;
let candidateCoreServiceMock: MockUpstream;
let jobServiceMock: MockUpstream;
let matchingDecisionServiceMock: MockUpstream;
let monolithMock: MockUpstream;
let app: import('express').Express;

beforeAll(async () => {
  identityMock = await startMockUpstream('identity-service');
  platformGovernanceMock = await startMockUpstream('platform-governance-service');
  jdParserMock = await startMockUpstream('jd-parser-service');
  candidateServiceMock = await startMockUpstream('candidate-service');
  chatServiceMock = await startMockUpstream('chat-service');
  resumeServiceMock = await startMockUpstream('resume-service');
  recruitingServiceMock = await startMockUpstream('recruiting-service');
  analyticsServiceMock = await startMockUpstream('analytics-service');
  matchingEvaluationServiceMock = await startMockUpstream('matching-evaluation-service');
  matchingSkillDiscoveryServiceMock = await startMockUpstream('matching-skill-discovery-service');
  matchingScoringServiceMock = await startMockUpstream('matching-scoring-service');
  candidateCoreServiceMock = await startMockUpstream('candidate-core-service');
  jobServiceMock = await startMockUpstream('job-service');
  matchingDecisionServiceMock = await startMockUpstream('matching-decision-service');
  monolithMock = await startMockUpstream('monolith');

  process.env.IDENTITY_SERVICE_URL = identityMock.url;
  process.env.PLATFORM_GOVERNANCE_SERVICE_URL = platformGovernanceMock.url;
  process.env.JD_PARSER_SERVICE_URL = jdParserMock.url;
  process.env.CANDIDATE_SERVICE_URL = candidateServiceMock.url;
  process.env.CHAT_SERVICE_URL = chatServiceMock.url;
  process.env.RESUME_SERVICE_URL = resumeServiceMock.url;
  process.env.RECRUITING_SERVICE_URL = recruitingServiceMock.url;
  process.env.ANALYTICS_SERVICE_URL = analyticsServiceMock.url;
  process.env.MATCHING_EVALUATION_SERVICE_URL = matchingEvaluationServiceMock.url;
  process.env.MATCHING_SKILL_DISCOVERY_SERVICE_URL = matchingSkillDiscoveryServiceMock.url;
  process.env.MATCHING_SCORING_SERVICE_URL = matchingScoringServiceMock.url;
  process.env.CANDIDATE_CORE_SERVICE_URL = candidateCoreServiceMock.url;
  process.env.JOB_SERVICE_URL = jobServiceMock.url;
  process.env.MATCHING_DECISION_SERVICE_URL = matchingDecisionServiceMock.url;
  process.env.MONOLITH_URL = monolithMock.url;

  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await identityMock.close();
  await platformGovernanceMock.close();
  await jdParserMock.close();
  await candidateServiceMock.close();
  await chatServiceMock.close();
  await resumeServiceMock.close();
  await recruitingServiceMock.close();
  await analyticsServiceMock.close();
  await matchingEvaluationServiceMock.close();
  await matchingSkillDiscoveryServiceMock.close();
  await matchingScoringServiceMock.close();
  await candidateCoreServiceMock.close();
  await jobServiceMock.close();
  await matchingDecisionServiceMock.close();
  await monolithMock.close();
});

describe('routing to Identity Service', () => {
  it('forwards /api/auth/* with the full original path preserved', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/auth/me');
    const received = identityMock.received.at(-1)!;
    expect(received.url).toBe('/api/auth/me');
  });

  it('forwards /api/candidate-auth/* to the same target', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/candidate-auth/login').send({ identifier: 'x@example.test', password: 'x' });
    const received = identityMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-auth/login');
  });

  it('forwards a POST body intact (the express.json()-would-break-this case)', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/auth/login').send({ identifier: 'gateway-test@example.test', password: 'CorrectHorse9!' });
    const received = identityMock.received.at(-1)!;
    expect(JSON.parse(received.body)).toEqual({ identifier: 'gateway-test@example.test', password: 'CorrectHorse9!' });
  });

  it('forwards a client-sent Cookie header to the upstream', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/auth/me').set('Cookie', 'access_token=abc123');
    const received = identityMock.received.at(-1)!;
    expect(received.headers.cookie).toBe('access_token=abc123');
  });

  it('forwards the upstream Set-Cookie header back to the client', async () => {
    const request = (await import('supertest')).default;
    identityMock.nextResponse = { status: 200, body: { ok: true }, headers: { 'Set-Cookie': 'access_token=freshtoken; Path=/; HttpOnly' } };
    const res = await request(app).get('/api/auth/me');
    expect(res.headers['set-cookie']?.[0]).toContain('access_token=freshtoken');
  });

  it('forwards GET /api/users (Batch 21 - staff user management) with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/users').set('Cookie', 'access_token=admintoken');
    const received = identityMock.received.at(-1)!;
    expect(received.url).toBe('/api/users');
    expect(received.headers.cookie).toBe('access_token=admintoken');
  });

  it('forwards PATCH /api/users/:id/status with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).patch('/api/users/7/status').set('Cookie', 'access_token=admintoken').send({ is_active: false });
    const received = identityMock.received.at(-1)!;
    expect(received.url).toBe('/api/users/7/status');
    expect(JSON.parse(received.body)).toEqual({ is_active: false });
  });
});

describe('routing to Platform Governance Service', () => {
  it('forwards /api/company-registration with the request body intact', async () => {
    const request = (await import('supertest')).default;
    const payload = { companyName: 'Gateway Test Co', businessEmail: 'biz@gatewaytest.example.test' };
    await request(app).post('/api/company-registration').send(payload);
    const received = platformGovernanceMock.received.at(-1)!;
    expect(received.url).toBe('/api/company-registration');
    expect(JSON.parse(received.body)).toEqual(payload);
  });

  it('forwards /api/admin/company-requests/:id/approve with method and path preserved', async () => {
    const request = (await import('supertest')).default;
    await request(app).patch('/api/admin/company-requests/42/approve').set('Cookie', 'access_token=supertoken');
    const received = platformGovernanceMock.received.at(-1)!;
    expect(received.method).toBe('PATCH');
    expect(received.url).toBe('/api/admin/company-requests/42/approve');
    expect(received.headers.cookie).toBe('access_token=supertoken');
  });
});

describe('routing to JD Parser Service', () => {
  it('forwards POST /api/jobs/parse-description with the request body and cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', 'access_token=recruitertoken')
      .send({ text: 'Senior Backend Engineer, 5+ years Node.js' });
    const received = jdParserMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs/parse-description');
    expect(received.method).toBe('POST');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
    expect(JSON.parse(received.body)).toEqual({ text: 'Senior Backend Engineer, 5+ years Node.js' });
  });

  it('does NOT swallow other /api/jobs/* paths - those now belong to Job Service (Remaining-monolith migration, Step 4)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/jobs/123');
    const received = jobServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs/123');
  });
});

describe('routing to Job Service (Remaining-monolith migration, Step 4)', () => {
  it('forwards GET /api/jobs with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/jobs').set('Cookie', 'access_token=recruitertoken');
    const received = jobServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards GET /api/jobs/:id (this service own real cutover, transparent to the Gateway)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/jobs/42').set('Cookie', 'access_token=recruitertoken');
    const received = jobServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs/42');
  });

  it('forwards POST /api/jobs with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/jobs').set('Cookie', 'access_token=recruitertoken').send({ title: 'Senior Backend Engineer' });
    const received = jobServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs');
    expect(JSON.parse(received.body)).toEqual({ title: 'Senior Backend Engineer' });
  });

  it('forwards PUT /api/jobs/:id with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).put('/api/jobs/42').set('Cookie', 'access_token=recruitertoken').send({ title: 'Staff Backend Engineer' });
    const received = jobServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs/42');
    expect(received.method).toBe('PUT');
    expect(JSON.parse(received.body)).toEqual({ title: 'Staff Backend Engineer' });
  });

  it('forwards DELETE /api/jobs/:id', async () => {
    const request = (await import('supertest')).default;
    await request(app).delete('/api/jobs/42').set('Cookie', 'access_token=recruitertoken');
    const received = jobServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs/42');
    expect(received.method).toBe('DELETE');
  });

  // The whole reason '/api/jobs/parse-description' is listed BEFORE the broader '/api/jobs' entry
  // in proxy.ts's ROUTES - array-order precedence lets this narrower leaf path keep winning.
  it('does NOT swallow /api/jobs/parse-description - that stays on JD Parser Service', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/jobs/parse-description').set('Cookie', 'access_token=recruitertoken').send({ text: 'JD text' });
    const received = jdParserMock.received.at(-1)!;
    expect(received.url).toBe('/api/jobs/parse-description');
    expect(jobServiceMock.received.some((r) => r.url === '/api/jobs/parse-description')).toBe(false);
  });
});

describe('routing to Candidate Service', () => {
  it('forwards GET /api/candidate-profile/me with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-profile/me').set('Cookie', 'candidate_access_token=footoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-profile/me');
    expect(received.headers.cookie).toBe('candidate_access_token=footoken');
  });

  it('forwards GET /api/candidate-jobs', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-jobs?search=engineer');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-jobs?search=engineer');
  });

  it('forwards POST /api/candidate-decisions with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/candidate-decisions').send({ job_id: 42, decision_type: 'swipe_right' });
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-decisions');
    expect(JSON.parse(received.body)).toEqual({ job_id: 42, decision_type: 'swipe_right' });
  });

  it('forwards GET /api/candidate-applications', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-applications');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-applications');
  });

  it('forwards GET /api/candidate-matches', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-matches');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-matches');
  });
});

describe('routing to Candidate Core Service (Remaining-monolith migration, Step 3a - a different bounded context from Candidate Service above)', () => {
  it('forwards GET /api/candidates with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidates').set('Cookie', 'access_token=recruitertoken');
    const received = candidateCoreServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidates');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards GET /api/candidates/:id', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidates/42').set('Cookie', 'access_token=recruitertoken');
    const received = candidateCoreServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidates/42');
  });

  it('forwards POST /api/candidates with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/candidates').set('Cookie', 'access_token=recruitertoken').send({ name: 'Jane', email: 'jane@example.test' });
    const received = candidateCoreServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidates');
    expect(JSON.parse(received.body)).toEqual({ name: 'Jane', email: 'jane@example.test' });
  });

  it('forwards POST /api/bulk-upload-candidates (distinct top-level path, not nested under /api/candidates)', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/bulk-upload-candidates').set('Cookie', 'access_token=recruitertoken');
    const received = candidateCoreServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/bulk-upload-candidates');
  });

  it('forwards POST /api/candidates/import (sub-path of /api/candidates)', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/candidates/import').set('Cookie', 'access_token=recruitertoken');
    const received = candidateCoreServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidates/import');
  });

  // The whole reason candidate-service's own 'candidate-*' prefixes are safe - '/api/candidates'
  // (no hyphen) is a genuinely different literal string, never a sub-path of any of them.
  it('does NOT capture /api/candidate-profile (Candidate Service, different bounded context)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-profile/me').set('Cookie', 'candidate_access_token=footoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-profile/me');
    expect(candidateCoreServiceMock.received.some((r) => r.url === '/api/candidate-profile/me')).toBe(false);
  });
});

describe('routing to Chat Service', () => {
  it('forwards POST /api/chat with the body and cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/chat').set('Cookie', 'access_token=recruitertoken').send({ message: 'Who are our React candidates?' });
    const received = chatServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/chat');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
    expect(JSON.parse(received.body)).toEqual({ message: 'Who are our React candidates?' });
  });

  it('forwards POST /api/chat/reindex (same prefix, no separate rule needed)', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/chat/reindex').set('Cookie', 'access_token=admintoken');
    const received = chatServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/chat/reindex');
  });
});

describe('routing to Resume Service', () => {
  it('forwards POST /api/candidate-resume/parse with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/candidate-resume/parse').set('Cookie', 'candidate_access_token=footoken');
    const received = resumeServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-resume/parse');
    expect(received.headers.cookie).toBe('candidate_access_token=footoken');
  });

  it('forwards GET /api/candidate-resume/file', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-resume/file').set('Cookie', 'candidate_access_token=footoken');
    const received = resumeServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-resume/file');
  });

  it('forwards POST /api/parse-resume (recruiter bulk upload) to the same service', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/parse-resume').set('Cookie', 'access_token=recruitertoken');
    const received = resumeServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/parse-resume');
  });
});

describe('routing to Recruiting Service', () => {
  it('forwards GET /api/matches (exact) with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/matches').set('Cookie', 'access_token=recruitertoken');
    const received = recruitingServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/matches');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards GET /api/recruiter-notifications', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/recruiter-notifications').set('Cookie', 'access_token=recruitertoken');
    const received = recruitingServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/recruiter-notifications');
  });

  it('forwards PUT /api/recruiter-notifications/:id/read', async () => {
    const request = (await import('supertest')).default;
    await request(app).put('/api/recruiter-notifications/7/read').set('Cookie', 'access_token=recruitertoken');
    const received = recruitingServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/recruiter-notifications/7/read');
    expect(received.method).toBe('PUT');
  });

  // The whole reason /api/matches needed `exact: true` (proxy.ts's matchesRoute) - Matching
  // Decision Service (Remaining-monolith migration, Step 6) owns these two sub-paths. A plain
  // prefix match on '/api/matches' would have wrongly captured them too.
  it('does NOT forward /api/matches/queue/:job_id to Recruiting Service - that belongs to Matching Decision Service', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/matches/queue/42');
    const received = matchingDecisionServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/matches/queue/42');
    expect(recruitingServiceMock.received.some((r) => r.url.includes('/queue/42'))).toBe(false);
  });

  it('does NOT forward /api/matches/score to Recruiting Service - that belongs to Matching Decision Service', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/matches/score').send({ candidate_id: 1, job_id: 2 });
    const received = matchingDecisionServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/matches/score');
    expect(recruitingServiceMock.received.some((r) => r.url === '/api/matches/score')).toBe(false);
  });
});

describe('routing to Matching Decision Service (Remaining-monolith migration, Step 6)', () => {
  it('forwards GET /api/matches/queue/:job_id with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/matches/queue/42').set('Cookie', 'access_token=recruitertoken');
    const received = matchingDecisionServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/matches/queue/42');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards POST /api/matches/score with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/matches/score').set('Cookie', 'access_token=recruitertoken').send({ job_id: 700, candidate_id: 42 });
    const received = matchingDecisionServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/matches/score');
    expect(JSON.parse(received.body)).toEqual({ job_id: 700, candidate_id: 42 });
  });

  it('forwards POST /api/swipes with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/swipes').set('Cookie', 'access_token=recruitertoken').send({ job_id: 700, candidate_id: 42, action: 1 });
    const received = matchingDecisionServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/swipes');
    expect(JSON.parse(received.body)).toEqual({ job_id: 700, candidate_id: 42, action: 1 });
  });

  it('forwards GET /api/swipes/history and /api/swipes/stats (sub-paths of the same prefix)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/swipes/history').set('Cookie', 'access_token=recruitertoken');
    expect(matchingDecisionServiceMock.received.at(-1)!.url).toBe('/api/swipes/history');
    await request(app).get('/api/swipes/stats').set('Cookie', 'access_token=recruitertoken');
    expect(matchingDecisionServiceMock.received.at(-1)!.url).toBe('/api/swipes/stats');
  });

  it('forwards GET /api/recruiter-review (list) and /api/recruiter-review/:candidateId/:jobId (detail)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/recruiter-review?jobId=700').set('Cookie', 'access_token=recruitertoken');
    expect(matchingDecisionServiceMock.received.at(-1)!.url).toBe('/api/recruiter-review?jobId=700');
    await request(app).get('/api/recruiter-review/42/700').set('Cookie', 'access_token=recruitertoken');
    expect(matchingDecisionServiceMock.received.at(-1)!.url).toBe('/api/recruiter-review/42/700');
  });

  it('forwards POST /api/recruiter-review/:id/notes and PATCH /api/recruiter-review/:id/decision', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/recruiter-review/1/notes').set('Cookie', 'access_token=recruitertoken').send({ note: 'Great fit' });
    expect(matchingDecisionServiceMock.received.at(-1)!.url).toBe('/api/recruiter-review/1/notes');
    await request(app).patch('/api/recruiter-review/1/decision').set('Cookie', 'access_token=recruitertoken').send({ action: 'accepted' });
    const received = matchingDecisionServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/recruiter-review/1/decision');
    expect(received.method).toBe('PATCH');
  });

  // The whole reason Recruiting Service's own '/api/matches' needed `exact: true` in the first
  // place - a plain prefix there would have wrongly swallowed this service's own leaves too.
  it('does NOT capture the exact /api/matches (Recruiting Service, a different bounded context)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/matches').set('Cookie', 'access_token=recruitertoken');
    const received = recruitingServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/matches');
    expect(matchingDecisionServiceMock.received.some((r) => r.url === '/api/matches')).toBe(false);
  });
});

describe('routing to Analytics Service', () => {
  it('forwards GET /api/analytics/dashboard with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/analytics/dashboard').set('Cookie', 'access_token=recruitertoken');
    const received = analyticsServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/analytics/dashboard');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards GET /api/analytics/job/:job_id', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/analytics/job/42').set('Cookie', 'access_token=recruitertoken');
    const received = analyticsServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/analytics/job/42');
  });

  // The reason /api/analytics uses a narrow prefix, not something broader - these distinct
  // "*analytics*"-named paths must never be swallowed by it (Batch 22 domain audit). candidate-
  // analytics moved to Candidate Service (Remaining-monolith migration, Step 3c - see below);
  // proficiency-analytics and shadow-data-health moved to Matching Evaluation Service in Batch 25
  // (see below) - neither must ever land on Analytics Service.
  it('does not forward /api/candidate-analytics to Analytics Service', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-analytics').set('Cookie', 'candidate_access_token=footoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-analytics');
    expect(analyticsServiceMock.received.some((r) => r.url === '/api/candidate-analytics')).toBe(false);
  });
});

describe('routing to Matching Evaluation Service', () => {
  it('forwards POST /api/ml/evaluate with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/ml/evaluate').set('Cookie', 'access_token=admintoken').send({ k: 10 });
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/evaluate');
    expect(received.headers.cookie).toBe('access_token=admintoken');
  });

  it('forwards GET /api/ml/evaluate/history (sub-path of the same prefix)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/ml/evaluate/history').set('Cookie', 'access_token=admintoken');
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/evaluate/history');
  });

  it('forwards POST /api/ml/train/ranking', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/ml/train/ranking').set('Cookie', 'access_token=admintoken');
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/train/ranking');
  });

  it('forwards GET /api/ml/ranking/status', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/ml/ranking/status').set('Cookie', 'access_token=recruitertoken');
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/ranking/status');
  });

  // Batch 25 - the shadow-analytics reporting routes, extended onto this same service.
  it('forwards GET /api/proficiency-analytics with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/proficiency-analytics').set('Cookie', 'access_token=recruitertoken');
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/proficiency-analytics');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards GET /api/shadow-data-health', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/shadow-data-health').set('Cookie', 'access_token=recruitertoken');
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/shadow-data-health');
  });

  // Remaining-monolith migration, Step 1: these four leaf paths now route to Matching Scoring
  // Service instead - never to this service, never to the monolith.
  it.each([
    '/api/ml/config',
    '/api/ml/train',
    '/api/ml/model/status',
    '/api/ml/model/versions',
  ])('does not forward %s to Matching Evaluation Service', async (path) => {
    const request = (await import('supertest')).default;
    await request(app).get(path);
    expect(matchingEvaluationServiceMock.received.some((r) => r.url === path)).toBe(false);
  });
});

describe('routing to Matching Scoring Service (Remaining-monolith migration, Step 1 - ML admin)', () => {
  it('forwards GET /api/ml/config with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/ml/config').set('Cookie', 'access_token=admintoken');
    const received = matchingScoringServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/config');
    expect(received.headers.cookie).toBe('access_token=admintoken');
  });

  it('forwards POST /api/ml/train (exact) with the body intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/ml/train').set('Cookie', 'access_token=admintoken');
    const received = matchingScoringServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/train');
  });

  it('forwards GET /api/ml/model/status', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/ml/model/status').set('Cookie', 'access_token=recruitertoken');
    const received = matchingScoringServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/model/status');
  });

  it('forwards GET /api/ml/model/versions', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/ml/model/versions').set('Cookie', 'access_token=recruitertoken');
    const received = matchingScoringServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/model/versions');
  });

  // The whole reason /api/ml/train needed `exact: true` - without it, a plain prefix match would
  // ALSO capture this sibling leaf, stealing it from Matching Evaluation Service.
  it('does NOT swallow /api/ml/train/ranking - that stays on Matching Evaluation Service', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/ml/train/ranking').set('Cookie', 'access_token=admintoken');
    const received = matchingEvaluationServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/ml/train/ranking');
    expect(matchingScoringServiceMock.received.some((r) => r.url === '/api/ml/train/ranking')).toBe(false);
  });
});

describe('candidate-notifications now routes to Candidate Service (Batch 20 - extends the Batch 16 scope)', () => {
  it('forwards GET /api/candidate-notifications with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-notifications').set('Cookie', 'candidate_access_token=footoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-notifications');
    expect(received.headers.cookie).toBe('candidate_access_token=footoken');
  });

  it('forwards PUT /api/candidate-notifications/:id/read', async () => {
    const request = (await import('supertest')).default;
    await request(app).put('/api/candidate-notifications/7/read').set('Cookie', 'candidate_access_token=footoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-notifications/7/read');
    expect(received.method).toBe('PUT');
  });
});

describe('routing to Candidate Service - candidate-search (Remaining-monolith migration, Step 5)', () => {
  it('forwards GET /api/candidate-search with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-search').set('Cookie', 'access_token=recruitertoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-search');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards GET /api/candidate-search/tab/shortlisted (sub-path of the same prefix)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-search/tab/shortlisted').set('Cookie', 'access_token=recruitertoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-search/tab/shortlisted');
  });

  it('forwards POST /api/candidate-search/:id/save', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/candidate-search/42/save').set('Cookie', 'access_token=recruitertoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-search/42/save');
    expect(received.method).toBe('POST');
  });

  // The whole reason '/api/candidate-search' is a genuinely different literal string from every
  // other 'candidate-*' prefix above - real distinct strings, no collision risk either direction.
  it('does NOT capture /api/candidate-profile (Candidate Service, same target, different feature)', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-profile/me').set('Cookie', 'candidate_access_token=footoken');
    const received = candidateServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-profile/me');
  });
});

describe('candidate-auth is already routed to Identity Service (pre-existing, not part of Batch 16)', () => {
  it('does not forward /api/candidate-auth/me to Candidate Service either', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/candidate-auth/me');
    const received = identityMock.received.at(-1)!;
    expect(received.url).toBe('/api/candidate-auth/me');
  });
});

describe('routing to Matching Skill Discovery Service (reusing the existing Batch 27 service)', () => {
  it('forwards GET /api/skills/discovery/pending with the cookie intact', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/api/skills/discovery/pending').set('Cookie', 'access_token=recruitertoken');
    const received = matchingSkillDiscoveryServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/skills/discovery/pending');
    expect(received.headers.cookie).toBe('access_token=recruitertoken');
  });

  it('forwards POST /api/skills/discovery/:id/approve', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/skills/discovery/7/approve').set('Cookie', 'access_token=admintoken');
    const received = matchingSkillDiscoveryServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/skills/discovery/7/approve');
  });

  it('forwards POST /api/skills/discovery/:id/reject', async () => {
    const request = (await import('supertest')).default;
    await request(app).post('/api/skills/discovery/7/reject').set('Cookie', 'access_token=admintoken');
    const received = matchingSkillDiscoveryServiceMock.received.at(-1)!;
    expect(received.url).toBe('/api/skills/discovery/7/reject');
  });
});

describe('strangler-fig fallback to the monolith', () => {
  it('forwards an unmatched path to the monolith unchanged', async () => {
    const request = (await import('supertest')).default;
    // A synthetic, permanently-unmatched path rather than a real feature's - real feature paths
    // keep getting migrated as this migration proceeds (this exact test has already needed fixing
    // twice: /api/jobs/123 in Step 4, /api/matches/queue/42 in Step 6), so a placeholder proves
    // the fallback mechanism itself without going stale on the next cutover.
    await request(app).get('/api/definitely-not-a-registered-route');
    const received = monolithMock.received.at(-1)!;
    expect(received.url).toBe('/api/definitely-not-a-registered-route');
  });

  it('forwards a non-API (frontend asset) path to the monolith too', async () => {
    const request = (await import('supertest')).default;
    await request(app).get('/static/app.js');
    const received = monolithMock.received.at(-1)!;
    expect(received.url).toBe('/static/app.js');
  });
});

describe('/internal/* is never proxied anywhere', () => {
  it('returns 404 without forwarding to any upstream', async () => {
    const request = (await import('supertest')).default;
    const beforeCounts = [identityMock.received.length, platformGovernanceMock.received.length, monolithMock.received.length];

    const res = await request(app).get('/internal/companies/exists?name=x');
    expect(res.status).toBe(404);

    const afterCounts = [identityMock.received.length, platformGovernanceMock.received.length, monolithMock.received.length];
    expect(afterCounts).toEqual(beforeCounts);
  });
});

describe('upstream failure handling', () => {
  it('returns 502 when the target upstream is unreachable, without crashing the Gateway', async () => {
    const request = (await import('supertest')).default;
    // A closed mock server on a real (but now-dead) port - a genuine connection failure, not a simulated one.
    const deadUpstream = await startMockUpstream('temporarily-alive');
    await deadUpstream.close();

    process.env.IDENTITY_SERVICE_URL = deadUpstream.url;
    vi.resetModules();
    const { app: appWithDeadUpstream } = await import('../src/server.js');

    const res = await request(appWithDeadUpstream).get('/api/auth/me');
    expect(res.status).toBe(502);

    // Restore for any subsequent test file state (module registry is reset again by later files anyway).
    process.env.IDENTITY_SERVICE_URL = identityMock.url;
  });
});
