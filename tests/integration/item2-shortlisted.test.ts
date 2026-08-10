/**
 * Integration tests for Item 2: GET /candidate-search/tab/shortlisted
 * Tests cross-service communication between candidate-service, matching-decision-service, and candidate-core-service
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.CANDIDATE_SERVICE_URL || 'http://localhost:4019';
const MATCHING_DECISION_URL = process.env.MATCHING_DECISION_SERVICE_URL || 'http://localhost:4020';
const CANDIDATE_CORE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4019';

async function checkServiceHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { timeout: 5000 });
    return response.ok;
  } catch {
    return false;
  }
}

describe('Integration: Item 2 - Shortlisted Candidates', () => {
  describe('service availability', () => {
    it('should have matching-decision-service running', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/health`, { timeout: 5000 });
      expect(response.ok).toBe(true);
    });

    it('should have candidate-core-service running', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/health`, { timeout: 5000 });
      expect(response.ok).toBe(true);
    });

    it('should have candidate-service running', async () => {
      const response = await fetch(`${BASE_URL}/health`, { timeout: 5000 });
      expect(response.ok).toBe(true);
    });
  });

  describe('endpoint availability', () => {
    it('should respond to internal swipes/latest-per-pair endpoint', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1`, {
        timeout: 5000,
      });
      expect(response.status).toBeLessThan(500);
    });

    it('should respond to internal candidates/by-ids endpoint', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?ids=1,2,3`, {
        timeout: 5000,
      });
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('data format', () => {
    it('should return swipes with required fields', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1`, {
        timeout: 5000,
      });
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('swipes');
        expect(Array.isArray(data.swipes)).toBe(true);

        if (data.swipes.length > 0) {
          const swipe = data.swipes[0];
          expect(swipe).toHaveProperty('id');
          expect(swipe).toHaveProperty('candidate_id');
          expect(swipe).toHaveProperty('job_id');
          expect(swipe).toHaveProperty('company_id');
          expect(swipe).toHaveProperty('action');
          expect(swipe).toHaveProperty('created_at');
        }
      }
    });

    it('should return candidates with required fields', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?ids=1,2`, {
        timeout: 5000,
      });
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('candidates');
        expect(Array.isArray(data.candidates)).toBe(true);

        if (data.candidates.length > 0) {
          const candidate = data.candidates[0];
          expect(candidate).toHaveProperty('id');
          expect(candidate).toHaveProperty('company_id');
          expect(candidate).toHaveProperty('email');
          expect(candidate).toHaveProperty('first_name');
          expect(candidate).toHaveProperty('last_name');
        }
      }
    });
  });

  describe('action filtering', () => {
    it('should support action parameter for swipes filtering', async () => {
      const response = await fetch(
        `${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1&action=1`,
        { timeout: 5000 }
      );
      expect(response.status).toBeLessThan(500);

      if (response.ok) {
        const data = await response.json();
        if (data.swipes.length > 0) {
          for (const swipe of data.swipes) {
            expect(swipe.action).toBe(1);
          }
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle missing companyId gracefully', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair`, {
        timeout: 5000,
      });
      expect(response.status).toBe(400);
    });

    it('should handle empty IDs list', async () => {
      const response = await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?ids=`, {
        timeout: 5000,
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.candidates).toEqual([]);
    });

    it('should handle invalid companyId', async () => {
      const response = await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=invalid`, {
        timeout: 5000,
      });
      expect(response.status).toBe(400);
    });
  });

  describe('performance', () => {
    it('should respond to swipes query within 5 seconds', async () => {
      const start = Date.now();
      await fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1`, {
        timeout: 5000,
      });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });

    it('should respond to candidates query within 5 seconds', async () => {
      const start = Date.now();
      await fetch(`${CANDIDATE_CORE_URL}/internal/candidates/by-ids?ids=1,2,3`, {
        timeout: 5000,
      });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('concurrent requests', () => {
    it('should handle concurrent requests without errors', async () => {
      const promises = Array(5).fill(null).map(() =>
        fetch(`${MATCHING_DECISION_URL}/internal/swipes/latest-per-pair?companyId=1`, {
          timeout: 5000,
        })
      );

      const responses = await Promise.all(promises);
      for (const response of responses) {
        expect(response.status).toBeLessThan(500);
      }
    });
  });
});
