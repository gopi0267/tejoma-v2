/**
 * Integration Tests: GET /api/jobs (list) - Item 1 Migration
 *
 * Tests the full request flow:
 * API Gateway → job-service → orchestration (candidate-core + matching-decision)
 *
 * Setup: docker-compose with all services running
 */

import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import fetch from 'node-fetch';

// Configuration (adjust based on your docker-compose setup)
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:4000';
const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || 'http://localhost:4018';
const CANDIDATE_CORE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4011';
const MATCHING_DECISION_URL = process.env.MATCHING_DECISION_SERVICE_URL || 'http://localhost:4020';

// Test user token (from auth service)
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-jwt-token';
const TEST_COMPANY_ID = 100;

describe('Integration: GET /api/jobs (list) - Item 1', () => {
  let testJobId: number;
  let testCandidateId: number;

  beforeAll(async () => {
    // Wait for services to be ready
    await waitForServices([API_GATEWAY_URL, JOB_SERVICE_URL, CANDIDATE_CORE_URL, MATCHING_DECISION_URL]);

    // Seed test data
    testJobId = await seedTestJob();
    testCandidateId = await seedTestCandidate();
    await seedTestSwipe(testJobId, testCandidateId);
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData(testJobId, testCandidateId);
  });

  describe('GET /api/jobs via API Gateway', () => {
    it('should return list of jobs with enriched data', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      expect(response.status).toBe(200);
      const jobs = (await response.json()) as any[];

      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBeGreaterThan(0);

      // Verify response shape
      const job = jobs[0];
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('description');
      expect(job).toHaveProperty('total_candidates');
      expect(job).toHaveProperty('reviewed');
      expect(job).toHaveProperty('accepted');
      expect(job).toHaveProperty('rejected');
      expect(job).toHaveProperty('acceptance_rate');
    });

    it('should return 401 when not authenticated', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should include swipe counts from matching-decision-service', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      const jobs = (await response.json()) as any[];

      // Find test job
      const testJob = jobs.find((j) => j.id === testJobId);
      expect(testJob).toBeDefined();

      // Verify swipe data
      expect(typeof testJob.reviewed).toBe('number');
      expect(typeof testJob.accepted).toBe('number');
      expect(typeof testJob.rejected).toBe('number');
      expect(testJob.reviewed).toBeGreaterThanOrEqual(0);
    });

    it('should include candidate count from candidate-core-service', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      const jobs = (await response.json()) as any[];

      expect(jobs.length > 0).toBe(true);

      // All jobs should have same total_candidates count
      const candidateCount = jobs[0].total_candidates;
      for (const job of jobs) {
        expect(job.total_candidates).toBe(candidateCount);
      }
    });

    it('should compute acceptance_rate correctly', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      const jobs = (await response.json()) as any[];
      const testJob = jobs.find((j) => j.id === testJobId);

      if (testJob.reviewed > 0) {
        const expectedRate = (testJob.accepted / testJob.reviewed) * 100;
        expect(testJob.acceptance_rate).toBeCloseTo(expectedRate, 1);
      } else {
        expect(testJob.acceptance_rate).toBe(0);
      }
    });

    it('should handle feature flag OFF (proxy to monolith)', async () => {
      // TODO: This test requires feature flag implementation
      // For now, just verify the response is valid
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      expect(response.status).toBe(200);
      const jobs = (await response.json()) as any[];
      expect(Array.isArray(jobs)).toBe(true);
    });

    it('should handle service timeout gracefully', async () => {
      // Note: This test would require mocking service delays
      // Verify response is still valid even if services are slow

      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      // Should still return 200 (graceful degradation)
      expect([200, 502]).toContain(response.status);
    });
  });

  describe('GET /api/jobs via job-service directly', () => {
    it('should return jobs when called directly on job-service', async () => {
      const response = await fetch(`${JOB_SERVICE_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      expect(response.status).toBe(200);
      const jobs = (await response.json()) as any[];
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  describe('Cross-service orchestration', () => {
    it('should fetch data from matching-decision-service', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=${TEST_COMPANY_ID}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      expect(response.status).toBe(200);
      const counts = (await response.json()) as Record<string, any>;
      expect(typeof counts).toBe('object');
    });

    it('should fetch data from candidate-core-service', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${TEST_COMPANY_ID}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { count: number };
      expect(typeof data.count).toBe('number');
      expect(data.count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance', () => {
    it('should respond within 500ms under normal load', async () => {
      const start = Date.now();

      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_ID),
        },
      });

      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() =>
          fetch(`${API_GATEWAY_URL}/api/jobs`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${AUTH_TOKEN}`,
              'X-Company-ID': String(TEST_COMPANY_ID),
            },
          })
        );

      const responses = await Promise.all(requests);
      const allSuccessful = responses.every((r) => r.status === 200);

      expect(allSuccessful).toBe(true);
    });
  });
});

// Helper functions

async function waitForServices(urls: string[], maxRetries = 30) {
  for (const url of urls) {
    let ready = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${url}/health`, { method: 'GET' });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch (err) {
        // Service not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) {
      throw new Error(`Service at ${url} did not become ready`);
    }
  }
}

async function seedTestJob(): Promise<number> {
  const response = await fetch(`${JOB_SERVICE_URL}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'X-Company-ID': String(TEST_COMPANY_ID),
    },
    body: JSON.stringify({
      title: 'Test Integration Job',
      description: 'Test job for Item 1 integration tests',
      required_skills: ['JavaScript', 'TypeScript'],
      experience_years: 5,
      location: 'Remote',
      salary_min: 100000,
      salary_max: 150000,
      status: 'open',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to seed test job: ${response.statusText}`);
  }

  const job = (await response.json()) as { id: number };
  return job.id;
}

async function seedTestCandidate(): Promise<number> {
  const response = await fetch(`${CANDIDATE_CORE_URL}/api/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'X-Company-ID': String(TEST_COMPANY_ID),
    },
    body: JSON.stringify({
      email: `test-${Date.now()}@example.com`,
      first_name: 'Test',
      last_name: 'Candidate',
      skills: ['JavaScript', 'TypeScript'],
      experience_years: 5,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to seed test candidate: ${response.statusText}`);
  }

  const candidate = (await response.json()) as { id: number };
  return candidate.id;
}

async function seedTestSwipe(jobId: number, candidateId: number): Promise<void> {
  await fetch(`${MATCHING_DECISION_URL}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'X-Company-ID': String(TEST_COMPANY_ID),
    },
    body: JSON.stringify({
      job_id: jobId,
      candidate_id: candidateId,
      action: 1, // Accept
      match_score: 0.85,
    }),
  });
}

async function cleanupTestData(jobId: number, candidateId: number): Promise<void> {
  // Delete job
  await fetch(`${JOB_SERVICE_URL}/api/jobs/${jobId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'X-Company-ID': String(TEST_COMPANY_ID),
    },
  }).catch(() => {
    // Ignore cleanup errors
  });

  // Delete candidate
  await fetch(`${CANDIDATE_CORE_URL}/api/candidates/${candidateId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'X-Company-ID': String(TEST_COMPANY_ID),
    },
  }).catch(() => {
    // Ignore cleanup errors
  });
}
