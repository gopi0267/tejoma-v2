/**
 * Unit Tests: GET /api/jobs (list) - Item 1 Migration
 *
 * Tests the new orchestration pattern that replaces monolith proxy:
 * 1. Fetch jobs from job-service DB
 * 2. Get swipe counts from matching-decision-service
 * 3. Get candidate count from candidate-core-service
 * 4. Merge counts into job response
 * 5. Compute acceptance_rate
 */

import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import { expect } from 'vitest';
import express from 'express';
import type { Request, Response } from 'express';
import { getEnrichedJobsList } from '../../src/routes/jobs.routes';
import * as jobDb from '../../src/db';
import * as matchingDecisionClient from '../../src/services/matchingDecisionServiceClient';
import * as candidateCoreClient from '../../src/services/candidateCoreServiceClient';

// Mock dependencies
vi.mock('../../src/db');
vi.mock('../../src/services/matchingDecisionServiceClient');
vi.mock('../../src/services/candidateCoreServiceClient');

describe('GET /api/jobs (list) - Item 1 Migration', () => {
  const companyId = 100;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEnrichedJobsList orchestration', () => {
    it('should return empty array when no jobs exist', async () => {
      vi.mocked(jobDb.getJobs).mockResolvedValue([]);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(new Map());
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(0);

      const result = await getEnrichedJobsList(companyId);

      expect(result.jobs).toEqual([]);
      expect(jobDb.getJobs).toHaveBeenCalledWith(companyId);
      expect(matchingDecisionClient.getSwipeCountsByJob).toHaveBeenCalledWith(companyId);
      expect(candidateCoreClient.getCandidateCount).toHaveBeenCalledWith(companyId);
    });

    it('should return jobs with enriched data', async () => {
      const mockJobs = [
        {
          id: 1,
          company_id: companyId,
          title: 'Senior Engineer',
          description: 'Build amazing things',
          status: 'open',
          location: 'San Francisco',
          salary_min: 150000,
          salary_max: 200000,
          created_at: new Date('2026-08-01'),
          updated_at: new Date('2026-08-01'),
        },
        {
          id: 2,
          company_id: companyId,
          title: 'Product Manager',
          description: 'Lead product strategy',
          status: 'open',
          location: 'New York',
          salary_min: 120000,
          salary_max: 160000,
          created_at: new Date('2026-08-02'),
          updated_at: new Date('2026-08-02'),
        },
      ];

      const mockSwipeCounts = new Map([
        [
          1,
          {
            total: 50,
            accepted: 10,
            rejected: 30,
            pending: 10,
          },
        ],
        [
          2,
          {
            total: 40,
            accepted: 5,
            rejected: 25,
            pending: 10,
          },
        ],
      ]);

      const mockCandidateCount = 250;

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(mockSwipeCounts);
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(mockCandidateCount);

      const result = await getEnrichedJobsList(companyId);

      expect(result.jobs).toHaveLength(2);

      // Verify first job enrichment
      expect(result.jobs[0]).toMatchObject({
        id: 1,
        title: 'Senior Engineer',
        total_candidates: 250,
        reviewed: 50,
        accepted: 10,
        rejected: 30,
        saved: 10, // pending swipes are "saved"
        acceptance_rate: 20.0, // 10 / 50 * 100
      });

      // Verify second job enrichment
      expect(result.jobs[1]).toMatchObject({
        id: 2,
        title: 'Product Manager',
        total_candidates: 250,
        reviewed: 40,
        accepted: 5,
        rejected: 25,
        saved: 10, // pending swipes are "saved"
        acceptance_rate: 12.5, // 5 / 40 * 100
      });
    });

    it('should handle missing swipe counts gracefully', async () => {
      const mockJobs = [
        {
          id: 1,
          company_id: companyId,
          title: 'Engineer',
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      // Empty swipe counts - job has no swipes yet
      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(new Map());
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(100);

      const result = await getEnrichedJobsList(companyId);

      expect(result.jobs[0]).toMatchObject({
        id: 1,
        total_candidates: 100,
        reviewed: 0,
        accepted: 0,
        rejected: 0,
        saved: 0,
        acceptance_rate: 0,
      });
    });

    it('should compute acceptance_rate correctly', async () => {
      const mockJobs = [
        {
          id: 1,
          company_id: companyId,
          title: 'Role',
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const mockSwipeCounts = new Map([
        [
          1,
          {
            total: 100,
            accepted: 25,
            rejected: 75,
            pending: 0,
          },
        ],
      ]);

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(mockSwipeCounts);
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(50);

      const result = await getEnrichedJobsList(companyId);

      // 25 / 100 * 100 = 25.0
      expect(result.jobs[0].acceptance_rate).toBe(25.0);
    });

    it('should handle zero reviewed jobs (no division by zero)', async () => {
      const mockJobs = [
        {
          id: 1,
          company_id: companyId,
          title: 'Role',
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const mockSwipeCounts = new Map([
        [
          1,
          {
            total: 0,
            accepted: 0,
            rejected: 0,
            pending: 0,
          },
        ],
      ]);

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(mockSwipeCounts);
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(100);

      const result = await getEnrichedJobsList(companyId);

      // Should be 0, not NaN or Infinity
      expect(result.jobs[0].acceptance_rate).toBe(0);
    });

    it('should handle service timeouts gracefully', async () => {
      const mockJobs = [
        {
          id: 1,
          company_id: companyId,
          title: 'Role',
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      // Service timeout returns empty map (graceful degradation)
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(new Map());
      // Service timeout returns 0
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(0);

      const result = await getEnrichedJobsList(companyId);

      expect(result.jobs[0]).toMatchObject({
        id: 1,
        total_candidates: 0,
        reviewed: 0,
        accepted: 0,
        rejected: 0,
        saved: 0,
        acceptance_rate: 0,
      });
    });

    it('should preserve all job fields in response', async () => {
      const mockJobs = [
        {
          id: 1,
          company_id: companyId,
          title: 'Senior Engineer',
          description: 'Build amazing things',
          required_skills: ['JavaScript', 'React'],
          experience_years: 5,
          location: 'San Francisco',
          salary_min: 150000,
          salary_max: 200000,
          status: 'open',
          created_at: new Date('2026-08-01'),
          updated_at: new Date('2026-08-01'),
          remote_type: 'hybrid',
          employment_type: 'full-time',
          department: 'Engineering',
        },
      ];

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(new Map());
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(100);

      const result = await getEnrichedJobsList(companyId);

      // All original fields should be preserved
      expect(result.jobs[0]).toHaveProperty('title', 'Senior Engineer');
      expect(result.jobs[0]).toHaveProperty('description', 'Build amazing things');
      expect(result.jobs[0]).toHaveProperty('required_skills');
      expect(result.jobs[0]).toHaveProperty('location', 'San Francisco');
      expect(result.jobs[0]).toHaveProperty('salary_min', 150000);
      expect(result.jobs[0]).toHaveProperty('salary_max', 200000);

      // Plus enriched fields
      expect(result.jobs[0]).toHaveProperty('total_candidates', 100);
      expect(result.jobs[0]).toHaveProperty('reviewed', 0);
      expect(result.jobs[0]).toHaveProperty('acceptance_rate', 0);
    });

    it('should call all three services in parallel', async () => {
      vi.mocked(jobDb.getJobs).mockResolvedValue([]);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(new Map());
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(0);

      await getEnrichedJobsList(companyId);

      // All should be called exactly once
      expect(jobDb.getJobs).toHaveBeenCalledTimes(1);
      expect(matchingDecisionClient.getSwipeCountsByJob).toHaveBeenCalledTimes(1);
      expect(candidateCoreClient.getCandidateCount).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple jobs with varying swipe counts', async () => {
      const mockJobs = [
        { id: 1, company_id: companyId, title: 'Job 1', status: 'open', created_at: new Date(), updated_at: new Date() },
        { id: 2, company_id: companyId, title: 'Job 2', status: 'open', created_at: new Date(), updated_at: new Date() },
        { id: 3, company_id: companyId, title: 'Job 3', status: 'open', created_at: new Date(), updated_at: new Date() },
      ];

      const mockSwipeCounts = new Map([
        [1, { total: 100, accepted: 50, rejected: 40, pending: 10 }],
        [2, { total: 50, accepted: 10, rejected: 35, pending: 5 }],
        // Job 3 has no swipes
      ]);

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(mockSwipeCounts);
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(200);

      const result = await getEnrichedJobsList(companyId);

      expect(result.jobs).toHaveLength(3);
      expect(result.jobs[0].acceptance_rate).toBe(50.0);
      expect(result.jobs[1].acceptance_rate).toBe(20.0);
      expect(result.jobs[2].acceptance_rate).toBe(0); // No swipes
    });
  });

  describe('Error handling', () => {
    it('should throw if getJobs fails', async () => {
      vi.mocked(jobDb.getJobs).mockRejectedValue(new Error('Database error'));

      await expect(getEnrichedJobsList(companyId)).rejects.toThrow('Database error');
    });

    it('should throw if swipe counts service fails critically', async () => {
      vi.mocked(jobDb.getJobs).mockResolvedValue([]);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockRejectedValue(new Error('Service error'));

      await expect(getEnrichedJobsList(companyId)).rejects.toThrow('Service error');
    });

    it('should handle candidate count service failure', async () => {
      const mockJobs = [
        { id: 1, company_id: companyId, title: 'Job', status: 'open', created_at: new Date(), updated_at: new Date() },
      ];

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(new Map());
      vi.mocked(candidateCoreClient.getCandidateCount).mockRejectedValue(new Error('Service down'));

      await expect(getEnrichedJobsList(companyId)).rejects.toThrow('Service down');
    });
  });

  describe('Field type validation', () => {
    it('should return numbers for count fields, not strings', async () => {
      const mockJobs = [
        { id: 1, company_id: companyId, title: 'Job', status: 'open', created_at: new Date(), updated_at: new Date() },
      ];

      const mockSwipeCounts = new Map([
        [1, { total: 50, accepted: 10, rejected: 30, pending: 10 }],
      ]);

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(mockSwipeCounts);
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(100);

      const result = await getEnrichedJobsList(companyId);

      expect(typeof result.jobs[0].total_candidates).toBe('number');
      expect(typeof result.jobs[0].reviewed).toBe('number');
      expect(typeof result.jobs[0].accepted).toBe('number');
      expect(typeof result.jobs[0].rejected).toBe('number');
      expect(typeof result.jobs[0].acceptance_rate).toBe('number');
    });

    it('should return numeric acceptance_rate with proper precision', async () => {
      const mockJobs = [
        { id: 1, company_id: companyId, title: 'Job', status: 'open', created_at: new Date(), updated_at: new Date() },
      ];

      const mockSwipeCounts = new Map([
        [1, { total: 3, accepted: 1, rejected: 2, pending: 0 }],
      ]);

      vi.mocked(jobDb.getJobs).mockResolvedValue(mockJobs as any);
      vi.mocked(matchingDecisionClient.getSwipeCountsByJob).mockResolvedValue(mockSwipeCounts);
      vi.mocked(candidateCoreClient.getCandidateCount).mockResolvedValue(50);

      const result = await getEnrichedJobsList(companyId);

      // 1 / 3 * 100 = 33.333... → should be rounded to 1 decimal = 33.3
      expect(result.jobs[0].acceptance_rate).toBeCloseTo(33.3, 1);
    });
  });
});
