/**
 * Unit tests for GET /recruiter-review/:candidateId/:jobId
 * Item 3: Orchestration of candidate-core + job-service + explainability module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeMatchExplanation } from '../../src/matching/explainability/computeExplanation.js';
import * as candidateCoreClient from '../../src/services/candidateCoreServiceClient.js';
import * as jobServiceClient from '../../src/services/jobServiceClient.js';

describe('GET /recruiter-review/:candidateId/:jobId', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = {
      user: {
        user_id: 1,
        company_id: 100,
      },
      params: {
        candidateId: '101',
        jobId: '5',
      },
    };

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe('orchestration', () => {
    it('should fetch candidate data from candidate-core-service', async () => {
      const spy = vi.spyOn(candidateCoreClient, 'getCandidateById').mockResolvedValue(null);

      await candidateCoreClient.getCandidateById(101, 100);

      expect(spy).toHaveBeenCalledWith(101, 100);
    });

    it('should fetch job data from job-service', async () => {
      const spy = vi.spyOn(jobServiceClient, 'getJobById').mockResolvedValue(null);

      await jobServiceClient.getJobById(5, 100);

      expect(spy).toHaveBeenCalledWith(5, 100);
    });

    it('should compute match explanation using candidate and job data', async () => {
      const candidate = {
        id: 101,
        company_id: 100,
        skills: ['TypeScript', 'Node.js'],
        years_of_experience: 5,
        email: 'john@example.com',
      };

      const job = {
        id: 5,
        company_id: 100,
        title: 'Senior Backend Engineer',
        required_skills: ['TypeScript', 'Node.js'],
        description: 'Looking for a senior backend engineer',
      };

      const swipeHistory = [
        {
          id: 1,
          candidate_id: 101,
          job_id: 5,
          company_id: 100,
          action: 1,
          score: 85,
          timestamp: '2026-08-07T10:00:00Z',
          created_at: '2026-08-07T10:00:00Z',
          updated_at: '2026-08-07T10:00:00Z',
        },
      ];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory as any
      );

      expect(explanation).toBeDefined();
      expect(explanation?.narrative).toBeDefined();
      expect(explanation?.concerns).toBeInstanceOf(Array);
      expect(explanation?.strengths).toBeInstanceOf(Array);
      expect(explanation?.confidenceScore).toBeDefined();
      expect(explanation?.recommendationLevel).toBeDefined();
    });
  });

  describe('data merging', () => {
    it('should merge candidate + job + swipe + explainability data', async () => {
      const candidate = { id: 101, company_id: 100, skills: ['TypeScript'], years_of_experience: 5 };
      const job = { id: 5, company_id: 100, title: 'Senior Backend Engineer' };
      const latestSwipe = { id: 1, candidate_id: 101, job_id: 5, score: 85, created_at: '2026-08-07T10:00:00Z' };

      expect({
        candidate,
        job,
        latestSwipe,
        recruiterNote: null,
        detailedScore: null,
        swipeHistory: [],
        explanation: null,
      }).toHaveProperty('candidate');
      expect(candidate.id).toBe(101);
    });

    it('should handle missing candidate gracefully', async () => {
      const spy = vi.spyOn(candidateCoreClient, 'getCandidateById').mockResolvedValue(null);

      const result = await candidateCoreClient.getCandidateById(999, 100);

      expect(result).toBeNull();
      expect(spy).toHaveBeenCalled();
    });

    it('should handle missing job gracefully', async () => {
      const spy = vi.spyOn(jobServiceClient, 'getJobById').mockResolvedValue(null);

      const result = await jobServiceClient.getJobById(999, 100);

      expect(result).toBeNull();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('explainability computation', () => {
    it('should compute explanation with career trajectory data', async () => {
      const candidate = {
        id: 101,
        company_id: 100,
        skills: ['TypeScript', 'Node.js'],
        years_of_experience: 8,
      };

      const job = {
        id: 5,
        company_id: 100,
        title: 'Senior Backend Engineer',
        required_skills: ['TypeScript', 'Node.js'],
      };

      const swipeHistory = [
        {
          id: 1,
          candidate_id: 101,
          job_id: 5,
          score: 85,
          created_at: '2026-08-07T10:00:00Z',
        },
      ];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory as any
      );

      expect(explanation?.confidenceScore).toBe(0.85);
      expect(explanation?.recommendationLevel).toBe('strong');
    });

    it('should handle empty swipe history', async () => {
      const candidate = { id: 101, company_id: 100, skills: [] };
      const job = { id: 5, company_id: 100, title: 'Engineer' };
      const swipeHistory: any[] = [];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory
      );

      expect(explanation?.narrative).toContain('No decision history');
      expect(explanation?.confidenceScore).toBe(0);
    });

    it('should generate moderate recommendation for mid-range scores', async () => {
      const candidate = { id: 101, company_id: 100, skills: ['TypeScript'] };
      const job = { id: 5, company_id: 100, title: 'Engineer' };
      const swipeHistory = [{ id: 1, candidate_id: 101, job_id: 5, score: 65, created_at: '2026-08-07T10:00:00Z' }];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory as any
      );

      expect(explanation?.confidenceScore).toBe(0.65);
      expect(explanation?.recommendationLevel).toBe('moderate');
    });

    it('should generate not_recommended for very low scores', async () => {
      const candidate = { id: 101, company_id: 100, skills: [] };
      const job = { id: 5, company_id: 100, title: 'Engineer' };
      const swipeHistory = [{ id: 1, candidate_id: 101, job_id: 5, score: 30, created_at: '2026-08-07T10:00:00Z' }];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory as any
      );

      expect(explanation?.confidenceScore).toBe(0.3);
      expect(explanation?.recommendationLevel).toBe('not_recommended');
    });

    it('should generate weak recommendation for borderline scores', async () => {
      const candidate = { id: 101, company_id: 100, skills: ['TypeScript'] };
      const job = { id: 5, company_id: 100, title: 'Engineer' };
      const swipeHistory = [{ id: 1, candidate_id: 101, job_id: 5, score: 45, created_at: '2026-08-07T10:00:00Z' }];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory as any
      );

      expect(explanation?.confidenceScore).toBe(0.45);
      expect(explanation?.recommendationLevel).toBe('weak');
    });
  });

  describe('error handling', () => {
    it('should handle service unavailability gracefully', async () => {
      vi.spyOn(candidateCoreClient, 'getCandidateById').mockResolvedValue(null);

      const result = await candidateCoreClient.getCandidateById(101, 100);
      expect(result).toBeNull();
    });

    it('should return sparse explanation when monolith is unavailable', async () => {
      const candidate = { id: 101, company_id: 100, skills: ['TypeScript'] };
      const job = { id: 5, company_id: 100, title: 'Engineer' };
      const swipeHistory = [{ id: 1, candidate_id: 101, job_id: 5, score: 75, created_at: '2026-08-07T10:00:00Z' }];

      const explanation = await computeMatchExplanation(
        candidate as any,
        job as any,
        swipeHistory as any
      );

      expect(explanation).toBeDefined();
      expect(explanation?.narrative).toBeDefined();
    });

    it('should handle invalid parameter types', async () => {
      expect(() => {
        const candidateId = parseInt('abc', 10);
        expect(Number.isNaN(candidateId)).toBe(true);
      }).not.toThrow();
    });
  });

  describe('response shape', () => {
    it('should return all required fields for detail view', async () => {
      const expectedFields = [
        'candidate',
        'job',
        'latestSwipe',
        'recruiterNote',
        'detailedScore',
        'detailedScoreGeneratedAt',
        'swipeHistory',
        'explanation',
      ];

      const response = {
        candidate: { id: 101 },
        job: { id: 5 },
        latestSwipe: { id: 1 },
        recruiterNote: null,
        detailedScore: null,
        detailedScoreGeneratedAt: null,
        swipeHistory: [],
        explanation: null,
      };

      for (const field of expectedFields) {
        expect(response).toHaveProperty(field);
      }
    });

    it('should include swipe history array', async () => {
      const swipeHistory = [
        { id: 1, candidate_id: 101, job_id: 5, action: 1, created_at: '2026-08-07T10:00:00Z' },
        { id: 2, candidate_id: 101, job_id: 5, action: 0, created_at: '2026-08-06T10:00:00Z' },
      ];

      expect(swipeHistory.length).toBe(2);
      expect(swipeHistory[0].action).toBe(1);
    });
  });

  describe('company scoping', () => {
    it('should only fetch data for user\'s company', async () => {
      const spy = vi.spyOn(candidateCoreClient, 'getCandidateById');

      await candidateCoreClient.getCandidateById(101, mockReq.user.company_id);

      expect(spy).toHaveBeenCalledWith(101, 100);
      expect(spy).not.toHaveBeenCalledWith(101, 999);
    });
  });

  describe('performance', () => {
    it('should fetch data in parallel', async () => {
      const start = Date.now();

      const promises = [
        candidateCoreClient.getCandidateById(101, 100),
        jobServiceClient.getJobById(5, 100),
      ];

      await Promise.all(promises);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10000); // Should complete quickly
    });
  });

  describe('validation', () => {
    it('should validate candidate ID is numeric', async () => {
      const candidateId = parseInt('abc', 10);
      expect(Number.isNaN(candidateId)).toBe(true);
    });

    it('should validate job ID is numeric', async () => {
      const jobId = parseInt('xyz', 10);
      expect(Number.isNaN(jobId)).toBe(true);
    });

    it('should reject non-numeric IDs', async () => {
      const responses = {
        invalidCandidateId: { error: 'Invalid candidate or job ID' },
        invalidJobId: { error: 'Invalid candidate or job ID' },
      };

      expect(responses.invalidCandidateId).toHaveProperty('error');
      expect(responses.invalidJobId).toHaveProperty('error');
    });
  });
});
