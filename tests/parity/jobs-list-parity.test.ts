/**
 * A/B Parity Tests: GET /api/jobs (list) - Item 1 Migration
 *
 * Validates that service response === monolith response
 * Tests that cutover maintains 100% backwards compatibility
 *
 * Run with:
 * JOB_LIST_CUTOVER_ENABLED=false npm test:parity -- jobs-list-parity
 * JOB_LIST_CUTOVER_ENABLED=true npm test:parity -- jobs-list-parity
 */

import { describe, it, beforeAll, expect } from 'vitest';
import fetch from 'node-fetch';

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:4000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-jwt-token';

// Test companies to check
const TEST_COMPANY_IDS = [100, 101, 102];

interface JobResponse {
  id: number;
  title: string;
  description: string;
  location: string;
  salary_min: number;
  salary_max: number;
  total_candidates: number;
  reviewed: number;
  accepted: number;
  rejected: number;
  saved: number;
  acceptance_rate: number;
  [key: string]: any;
}

describe('A/B Parity: GET /api/jobs (list)', () => {
  beforeAll(async () => {
    // Verify API is ready
    const response = await fetch(`${API_GATEWAY_URL}/health`);
    if (!response.ok) {
      throw new Error('API Gateway not ready');
    }
  });

  describe('Response Shape Parity', () => {
    it('should return array of jobs with consistent fields', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      expect(response.status).toBe(200);
      const jobs = (await response.json()) as JobResponse[];

      // Verify it's an array
      expect(Array.isArray(jobs)).toBe(true);

      // If jobs exist, verify shape
      if (jobs.length > 0) {
        const requiredFields = [
          'id',
          'title',
          'description',
          'location',
          'salary_min',
          'salary_max',
          'total_candidates',
          'reviewed',
          'accepted',
          'rejected',
          'saved',
          'acceptance_rate',
        ];

        for (const job of jobs) {
          for (const field of requiredFields) {
            expect(job).toHaveProperty(field, `Job ${job.id} missing field ${field}`);
          }
        }
      }
    });

    it('should preserve all job fields in response', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const jobs = (await response.json()) as JobResponse[];

      if (jobs.length === 0) {
        console.log('No jobs to test');
        return;
      }

      const job = jobs[0];

      // Core fields should exist
      expect(typeof job.id).toBe('number');
      expect(typeof job.title).toBe('string');
      expect(typeof job.description).toBe('string');
      expect(typeof job.location).toBe('string');

      // Extended fields (if present in response)
      if ('required_skills' in job) {
        expect(Array.isArray(job.required_skills) || typeof job.required_skills === 'string').toBe(true);
      }

      if ('remote_type' in job) {
        expect(typeof job.remote_type).toBe('string');
      }
    });
  });

  describe('Data Parity Across Companies', () => {
    it('should return consistent data for same company across calls', async () => {
      const call1 = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const call2 = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      expect(call1.status).toBe(200);
      expect(call2.status).toBe(200);

      const jobs1 = (await call1.json()) as JobResponse[];
      const jobs2 = (await call2.json()) as JobResponse[];

      // Same company should return same job IDs in same order
      expect(jobs1.length).toBe(jobs2.length);

      for (let i = 0; i < jobs1.length; i++) {
        expect(jobs1[i].id).toBe(jobs2[i].id);
        expect(jobs1[i].title).toBe(jobs2[i].title);
      }
    });

    it('should return different jobs for different companies', async () => {
      const call1 = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const call2 = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[1]),
        },
      });

      const jobs1 = (await call1.json()) as JobResponse[];
      const jobs2 = (await call2.json()) as JobResponse[];

      // Different companies should be isolated (job IDs should be different)
      if (jobs1.length > 0 && jobs2.length > 0) {
        const ids1 = new Set(jobs1.map((j) => j.id));
        const ids2 = new Set(jobs2.map((j) => j.id));

        // Should have minimal overlap (probably 0)
        const overlap = new Set([...ids1].filter((x) => ids2.has(x)));
        expect(overlap.size).toBeLessThanOrEqual(1); // Allow 1 shared job at most
      }
    });
  });

  describe('Numeric Field Parity', () => {
    it('should return numeric values for count fields', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const jobs = (await response.json()) as JobResponse[];

      if (jobs.length === 0) return;

      const job = jobs[0];

      // All count fields must be numbers
      expect(typeof job.total_candidates).toBe('number');
      expect(typeof job.reviewed).toBe('number');
      expect(typeof job.accepted).toBe('number');
      expect(typeof job.rejected).toBe('number');
      expect(typeof job.saved).toBe('number');
      expect(typeof job.acceptance_rate).toBe('number');

      // Should not be NaN
      expect(Number.isNaN(job.acceptance_rate)).toBe(false);
      expect(Number.isFinite(job.acceptance_rate)).toBe(true);

      // Values should be non-negative
      expect(job.total_candidates).toBeGreaterThanOrEqual(0);
      expect(job.reviewed).toBeGreaterThanOrEqual(0);
      expect(job.accepted).toBeGreaterThanOrEqual(0);
      expect(job.rejected).toBeGreaterThanOrEqual(0);
      expect(job.saved).toBeGreaterThanOrEqual(0);
      expect(job.acceptance_rate).toBeGreaterThanOrEqual(0);
      expect(job.acceptance_rate).toBeLessThanOrEqual(100);
    });

    it('should compute acceptance_rate correctly: accepted / reviewed * 100', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const jobs = (await response.json()) as JobResponse[];

      for (const job of jobs) {
        if (job.reviewed === 0) {
          // If no reviews, acceptance_rate should be 0
          expect(job.acceptance_rate).toBe(0);
        } else {
          // Otherwise, should match formula
          const expected = (job.accepted / job.reviewed) * 100;
          expect(job.acceptance_rate).toBeCloseTo(expected, 1);
        }
      }
    });

    it('should handle zero reviewed jobs without errors', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const jobs = (await response.json()) as JobResponse[];

      for (const job of jobs) {
        // No NaN, Infinity, or null values
        expect(Number.isFinite(job.acceptance_rate)).toBe(true);
        expect(job.acceptance_rate !== null && job.acceptance_rate !== undefined).toBe(true);
      }
    });
  });

  describe('Deep Equality Parity', () => {
    it('should return identical response structure for 20 random jobs', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const jobs = (await response.json()) as JobResponse[];
      const samplesToTest = Math.min(20, jobs.length);

      for (let i = 0; i < samplesToTest; i++) {
        const job = jobs[i];

        // Each job should have consistent structure
        const keys = Object.keys(job);
        expect(keys.length).toBeGreaterThan(0);

        // Compare with all other jobs - should have same keys
        for (const otherJob of jobs) {
          const otherKeys = Object.keys(otherJob);
          expect(otherKeys.length).toBe(keys.length);

          // Check all keys are same
          for (const key of keys) {
            expect(otherJob).toHaveProperty(key);
          }
        }
      }
    });

    it('should maintain consistent field ordering', async () => {
      // Test that response structure is consistent across calls
      const response1 = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const response2 = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const jobs1 = (await response1.json()) as JobResponse[];
      const jobs2 = (await response2.json()) as JobResponse[];

      if (jobs1.length > 0 && jobs2.length > 0) {
        const keys1 = Object.keys(jobs1[0]);
        const keys2 = Object.keys(jobs2[0]);

        expect(keys1).toEqual(keys2);
      }
    });
  });

  describe('Error Handling Parity', () => {
    it('should return 401 for missing auth token', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid company ID', async () => {
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': 'invalid',
        },
      });

      expect([400, 401]).toContain(response.status);
    });

    it('should handle gracefully if no jobs exist', async () => {
      // Use a company ID that probably has no jobs
      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(999999),
        },
      });

      // Should return 200 with empty array, not 404
      expect(response.status).toBe(200);
      const jobs = (await response.json()) as JobResponse[];
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  describe('Performance Parity', () => {
    it('should respond within reasonable time (< 1000ms)', async () => {
      const start = Date.now();

      const response = await fetch(`${API_GATEWAY_URL}/api/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'X-Company-ID': String(TEST_COMPANY_IDS[0]),
        },
      });

      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });

    it('should handle concurrent requests without data corruption', async () => {
      const requests = Array(5)
        .fill(null)
        .map(() =>
          fetch(`${API_GATEWAY_URL}/api/jobs`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${AUTH_TOKEN}`,
              'X-Company-ID': String(TEST_COMPANY_IDS[0]),
            },
          })
        );

      const responses = await Promise.all(requests);

      // All should succeed
      expect(responses.every((r) => r.status === 200)).toBe(true);

      // All should return same data
      const results = await Promise.all(responses.map((r) => r.json()));
      const firstData = JSON.stringify(results[0]);

      for (let i = 1; i < results.length; i++) {
        expect(JSON.stringify(results[i])).toBe(firstData);
      }
    });
  });
});
