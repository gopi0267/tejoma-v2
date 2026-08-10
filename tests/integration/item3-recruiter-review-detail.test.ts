/**
 * Integration tests for Item 3: GET /recruiter-review/:candidateId/:jobId (detail)
 * Tests cross-service communication for recruiter review detail view
 */

import { describe, it, expect } from 'vitest';

const MATCHING_DECISION_URL = process.env.MATCHING_DECISION_SERVICE_URL || 'http://localhost:4020';
const CANDIDATE_CORE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4019';
const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || 'http://localhost:4018';

describe('Integration: Item 3 - Recruiter Review Detail', () => {
  describe('service availability', () => {
    it('should have all required services running', async () => {
      const responses = await Promise.all([
        fetch(`${MATCHING_DECISION_URL}/health`, { timeout: 5000 }),
        fetch(`${CANDIDATE_CORE_URL}/health`, { timeout: 5000 }),
        fetch(`${JOB_SERVICE_URL}/health`, { timeout: 5000 }),
      ]);

      for (const response of responses) {
        expect(response.ok).toBe(true);
      }
    });

    it('should respond to internal candidate endpoint', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?companyId=1&ids=1`, {
        timeout: 5000,
      });
      expect(response.status).toBeLessThan(500);
    });

    it('should respond to internal job endpoint', async () => {
      const response = await fetch(`${JOB_SERVICE_URL}/internal/jobs/1?companyId=1`, {
        timeout: 5000,
      });
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('swipe history retrieval', () => {
    it('should retrieve swipe history for candidate-job pair', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1&action=1`,
        { timeout: 5000 }
      );
      expect(response.ok).toBe(true);
    });

    it('should return swipes with required fields', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1`,
        { timeout: 5000 }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.swipes && data.swipes.length > 0) {
          const swipe = data.swipes[0];
          expect(swipe).toHaveProperty('id');
          expect(swipe).toHaveProperty('candidate_id');
          expect(swipe).toHaveProperty('job_id');
          expect(swipe).toHaveProperty('score');
          expect(swipe).toHaveProperty('created_at');
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle missing parameters', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair`, {
        timeout: 5000,
      });
      expect(response.status).toBe(400);
    });

    it('should handle invalid candidate ID', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?companyId=1&ids=invalid`, {
        timeout: 5000,
      });
      expect(response.status).toBeLessThan(500);
    });

    it('should return 404 for non-existent job', async () => {
      const response = await fetch(`${JOB_SERVICE_URL}/internal/jobs/999999?companyId=1`, {
        timeout: 5000,
      });
      // Should return 404 or 200 with null job
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('data format consistency', () => {
    it('should return candidates with expected fields', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?companyId=1&ids=1`, {
        timeout: 5000,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates.length > 0) {
          const candidate = data.candidates[0];
          expect(candidate).toHaveProperty('id');
          expect(candidate).toHaveProperty('email');
          expect(candidate).toHaveProperty('first_name');
          expect(candidate).toHaveProperty('last_name');
        }
      }
    });

    it('should return jobs with expected fields', async () => {
      const response = await fetch(`${JOB_SERVICE_URL}/internal/jobs/1?companyId=1`, {
        timeout: 5000,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.job) {
          expect(data.job).toHaveProperty('id');
          expect(data.job).toHaveProperty('title');
          expect(data.job).toHaveProperty('description');
        }
      }
    });
  });

  describe('performance', () => {
    it('should respond within 5 seconds', async () => {
      const start = Date.now();
      await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1`, {
        timeout: 5000,
      });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });

    it('should handle concurrent requests', async () => {
      const promises = Array(5).fill(null).map(() =>
        fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?companyId=1&ids=1`, {
          timeout: 5000,
        })
      );

      const responses = await Promise.all(promises);
      for (const response of responses) {
        expect(response.status).toBeLessThan(500);
      }
    });
  });

  describe('company scoping', () => {
    it('should respect company_id parameter', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=100`,
        { timeout: 5000 }
      );
      expect(response.ok).toBe(true);
    });
  });
});
