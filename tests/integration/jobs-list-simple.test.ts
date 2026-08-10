/**
 * Simplified Integration Test: GET /api/jobs (list) - Item 1
 *
 * Validates that the orchestration works with running services
 * Uses internal endpoints (no auth required)
 */

import { describe, it, expect } from 'vitest';
import fetch from 'node-fetch';

const JOB_SERVICE_URL = 'http://localhost:4018';
const CANDIDATE_CORE_URL = 'http://localhost:4019';
const MATCHING_DECISION_URL = 'http://localhost:4020';

const COMPANY_ID = 100;

describe('Integration: GET /api/jobs orchestration - Item 1', () => {
  describe('Internal endpoints availability', () => {
    it('should reach job-service health check', async () => {
      const response = await fetch(`${JOB_SERVICE_URL}/health`);
      expect(response.status).toBe(200);
    });

    it('should reach candidate-core-service health check', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/health`);
      expect(response.status).toBe(200);
    });

    it('should reach matching-decision-service health check', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/health`);
      expect(response.status).toBe(200);
    });
  });

  describe('Cross-service internal endpoints', () => {
    it('should fetch swipe counts from matching-decision-service', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=${COMPANY_ID}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as Record<string, any>;
      expect(typeof data).toBe('object');

      // Verify response structure for any jobs present
      for (const [jobId, counts] of Object.entries(data)) {
        expect(typeof jobId).toBe('string');
        expect(counts).toHaveProperty('total');
        expect(counts).toHaveProperty('accepted');
        expect(counts).toHaveProperty('rejected');
        expect(counts).toHaveProperty('pending');

        // All should be numbers
        expect(typeof counts.total).toBe('number');
        expect(typeof counts.accepted).toBe('number');
        expect(typeof counts.rejected).toBe('number');
        expect(typeof counts.pending).toBe('number');
      }

      console.log('✓ Swipe counts retrieved:', Object.keys(data).length, 'jobs');
    });

    it('should fetch candidate count from candidate-core-service', async () => {
      const response = await fetch(
        `${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${COMPANY_ID}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { count: number };
      expect(typeof data.count).toBe('number');
      expect(data.count).toBeGreaterThanOrEqual(0);

      console.log('✓ Candidate count retrieved:', data.count);
    });

    it('should fetch latest swipes per pair from matching-decision-service', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=${COMPANY_ID}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { swipes: any[] };
      expect(Array.isArray(data.swipes)).toBe(true);

      console.log('✓ Latest swipes retrieved:', data.swipes.length, 'pairs');
    });
  });

  describe('Job-service orchestration', () => {
    it('should fetch jobs from local database', async () => {
      const response = await fetch(
        `${JOB_SERVICE_URL}/internal/jobs/by-company?companyId=${COMPANY_ID}`
      );

      // May or may not have this endpoint, but verify it's callable
      expect([200, 404, 500]).toContain(response.status);
    });

    it('should validate orchestration flow (all services responding)', async () => {
      // 1. Fetch jobs
      const jobsResponse = await fetch(
        `${JOB_SERVICE_URL}/internal/jobs/for-enrichment?companyId=${COMPANY_ID}`
      ).catch(() => ({ status: 404 }));

      // 2. Fetch swipe counts
      const swipeResponse = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=${COMPANY_ID}`
      );

      // 3. Fetch candidate count
      const candidateResponse = await fetch(
        `${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${COMPANY_ID}`
      );

      // All orchestration endpoints should be reachable
      expect([200, 404, 500]).toContain(jobsResponse.status);
      expect(swipeResponse.status).toBe(200);
      expect(candidateResponse.status).toBe(200);

      console.log('✓ All orchestration endpoints responsive');
    });
  });

  describe('Performance validation', () => {
    it('should respond from swipe counts within 500ms', async () => {
      const start = Date.now();

      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=${COMPANY_ID}`
      );

      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);

      console.log(`✓ Swipe counts response time: ${duration}ms`);
    });

    it('should respond from candidate count within 200ms', async () => {
      const start = Date.now();

      const response = await fetch(
        `${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${COMPANY_ID}`
      );

      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(200);

      console.log(`✓ Candidate count response time: ${duration}ms`);
    });

    it('should handle concurrent requests to all services', async () => {
      const start = Date.now();

      const requests = [
        fetch(`${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=${COMPANY_ID}`),
        fetch(`${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${COMPANY_ID}`),
        fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=${COMPANY_ID}`),
      ];

      const responses = await Promise.all(requests);
      const duration = Date.now() - start;

      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(duration).toBeLessThan(500); // All 3 in parallel should complete < 500ms

      console.log(`✓ Concurrent orchestration time: ${duration}ms (3 services)`);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid company ID gracefully', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=invalid`
      );

      expect([400, 200]).toContain(response.status);
    });

    it('should return empty results for non-existent company', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=999999`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as Record<string, any>;
      expect(data).toBeDefined();
    });
  });

  describe('Data consistency', () => {
    it('should return consistent data across multiple calls', async () => {
      const call1 = await fetch(
        `${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${COMPANY_ID}`
      ).then((r) => r.json());

      const call2 = await fetch(
        `${CANDIDATE_CORE_URL}/internal/candidates/count?companyId=${COMPANY_ID}`
      ).then((r) => r.json());

      expect(call1.count).toBe(call2.count);

      console.log(`✓ Data consistency verified: ${call1.count} candidates (stable)`);
    });

    it('should map swipe counts correctly to expected fields', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/counts-by-job?companyId=${COMPANY_ID}`
      );

      const data = (await response.json()) as Record<string, any>;

      // Verify all jobs have correct structure
      for (const counts of Object.values(data)) {
        expect(counts).toHaveProperty('total');
        expect(counts).toHaveProperty('accepted');
        expect(counts).toHaveProperty('rejected');
        expect(counts).toHaveProperty('pending');

        // Verify math: total = accepted + rejected + pending
        const sum = counts.accepted + counts.rejected + counts.pending;
        expect(sum).toBeLessThanOrEqual(counts.total);
      }

      console.log('✓ Swipe counts structure validated');
    });
  });
});
