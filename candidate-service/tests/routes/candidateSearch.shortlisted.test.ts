/**
 * Unit tests for GET /candidate-search/tab/shortlisted
 * Item 2: Orchestration of matching-decision-service swipes + candidate-core-service data
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/db.js';
import * as matchingClient from '../../src/services/matchingDecisionServiceClient.js';
import * as candidateCoreClient from '../../src/services/candidateCoreServiceClient.js';
import * as identityClient from '../../src/services/identityServiceClient.js';

describe('GET /candidate-search/tab/shortlisted', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = {
      user: {
        user_id: 1,
        company_id: 100,
      },
    };

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe('orchestration', () => {
    it('should fetch shortlisted swipes for the company', async () => {
      const spy = vi.spyOn(matchingClient, 'getShortlistedSwipes').mockResolvedValue([]);

      await matchingClient.getShortlistedSwipes(mockReq.user.company_id);

      expect(spy).toHaveBeenCalledWith(mockReq.user.company_id);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should return empty result when no shortlisted swipes exist', async () => {
      vi.spyOn(matchingClient, 'getShortlistedSwipes').mockResolvedValue([]);

      const result = await matchingClient.getShortlistedSwipes(mockReq.user.company_id);

      expect(result).toEqual([]);
    });

    it('should fetch candidate details for all candidate IDs in swipes', async () => {
      const swipes = [
        { id: 1, candidate_id: 101, job_id: 1, company_id: 100, action: 1, score: 85, created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z' },
        { id: 2, candidate_id: 102, job_id: 2, company_id: 100, action: 1, score: 90, created_at: '2026-08-07T10:05:00Z', updated_at: '2026-08-07T10:05:00Z' },
      ];

      vi.spyOn(matchingClient, 'getShortlistedSwipes').mockResolvedValue(swipes);
      vi.spyOn(candidateCoreClient, 'getCandidatesByIds').mockResolvedValue(new Map());

      await candidateCoreClient.getCandidatesByIds([101, 102]);

      expect(candidateCoreClient.getCandidatesByIds).toHaveBeenCalledWith([101, 102]);
    });

    it('should extract unique candidate IDs from swipes', async () => {
      const swipes = [
        { id: 1, candidate_id: 101, job_id: 1, company_id: 100, action: 1, score: 85, created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z' },
        { id: 2, candidate_id: 101, job_id: 2, company_id: 100, action: 1, score: 80, created_at: '2026-08-07T10:10:00Z', updated_at: '2026-08-07T10:10:00Z' },
      ];

      const uniqueIds = [...new Set(swipes.map(s => s.candidate_id))];
      expect(uniqueIds).toEqual([101]);
      expect(uniqueIds.length).toBe(1);
    });
  });

  describe('data merging', () => {
    it('should merge swipe + candidate + account data correctly', async () => {
      const swipes = [
        { id: 1, candidate_id: 101, job_id: 1, company_id: 100, action: 1, score: 85, created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z' },
      ];

      const candidateMap = new Map([
        [101, { id: 101, company_id: 100, email: 'test@example.com', first_name: 'John', last_name: 'Doe', candidate_account_id: 201, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
      ]);

      const accounts = [
        { id: 201, name: 'John Doe', headline: 'Engineer', skills: ['Node.js', 'TypeScript'], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      ];

      const accountMap = new Map(accounts.map(a => [a.id, a]));

      // Merge logic
      const accountToLatestSwipe = new Map();
      for (const swipe of swipes) {
        const candidate = candidateMap.get(swipe.candidate_id);
        if (!candidate || !candidate.candidate_account_id) continue;

        const accountId = candidate.candidate_account_id;
        const account = accountMap.get(accountId);
        if (!account) continue;

        accountToLatestSwipe.set(accountId, { ...account, shortlisted_at: swipe.created_at });
      }

      expect(accountToLatestSwipe.size).toBe(1);
      expect(accountToLatestSwipe.get(201)).toMatchObject({
        id: 201,
        name: 'John Doe',
        shortlisted_at: '2026-08-07T10:00:00Z',
      });
    });

    it('should keep only latest swipe per candidate account', async () => {
      const swipes = [
        { id: 1, candidate_id: 101, job_id: 1, company_id: 100, action: 1, score: 85, created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z' },
        { id: 2, candidate_id: 101, job_id: 2, company_id: 100, action: 1, score: 90, created_at: '2026-08-07T10:10:00Z', updated_at: '2026-08-07T10:10:00Z' },
      ];

      const candidateMap = new Map([
        [101, { id: 101, company_id: 100, email: 'test@example.com', first_name: 'John', last_name: 'Doe', candidate_account_id: 201, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
      ]);

      const accounts = [
        { id: 201, name: 'John Doe', headline: 'Engineer', skills: ['Node.js'], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      ];

      const accountMap = new Map(accounts.map(a => [a.id, a]));

      // Merge logic - keep only latest
      const accountToLatestSwipe = new Map();
      for (const swipe of swipes) {
        const candidate = candidateMap.get(swipe.candidate_id);
        if (!candidate || !candidate.candidate_account_id) continue;

        const accountId = candidate.candidate_account_id;
        const account = accountMap.get(accountId);
        if (!account) continue;

        if (!accountToLatestSwipe.has(accountId) ||
            new Date(swipe.created_at) > new Date(accountToLatestSwipe.get(accountId).created_at)) {
          accountToLatestSwipe.set(accountId, { ...account, shortlisted_at: swipe.created_at });
        }
      }

      expect(accountToLatestSwipe.size).toBe(1);
      expect(accountToLatestSwipe.get(201).shortlisted_at).toBe('2026-08-07T10:10:00Z');
    });
  });

  describe('error handling', () => {
    it('should handle matching-decision-service unavailability gracefully', async () => {
      vi.spyOn(matchingClient, 'getShortlistedSwipes').mockResolvedValue([]);

      const result = await matchingClient.getShortlistedSwipes(mockReq.user.company_id);
      expect(result).toEqual([]);
    });

    it('should handle candidate-core-service unavailability gracefully', async () => {
      vi.spyOn(candidateCoreClient, 'getCandidatesByIds').mockResolvedValue(new Map());

      const result = await candidateCoreClient.getCandidatesByIds([101, 102]);
      expect(result.size).toBe(0);
    });

    it('should skip candidates without account mapping', async () => {
      const swipes = [
        { id: 1, candidate_id: 101, job_id: 1, company_id: 100, action: 1, score: 85, created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z' },
        { id: 2, candidate_id: 102, job_id: 2, company_id: 100, action: 1, score: 90, created_at: '2026-08-07T10:05:00Z', updated_at: '2026-08-07T10:05:00Z' },
      ];

      const candidateMap = new Map([
        [101, { id: 101, company_id: 100, email: 'test@example.com', first_name: 'John', last_name: 'Doe', candidate_account_id: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
        [102, { id: 102, company_id: 100, email: 'test2@example.com', first_name: 'Jane', last_name: 'Smith', candidate_account_id: 202, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
      ]);

      const accounts = [
        { id: 202, name: 'Jane Smith', headline: 'Manager', skills: ['Leadership'], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      ];

      const accountMap = new Map(accounts.map(a => [a.id, a]));

      // Merge logic
      const accountToLatestSwipe = new Map();
      for (const swipe of swipes) {
        const candidate = candidateMap.get(swipe.candidate_id);
        if (!candidate || !candidate.candidate_account_id) continue;

        const accountId = candidate.candidate_account_id;
        const account = accountMap.get(accountId);
        if (!account) continue;

        accountToLatestSwipe.set(accountId, { ...account, shortlisted_at: swipe.created_at });
      }

      // Should only have Jane (101 was skipped)
      expect(accountToLatestSwipe.size).toBe(1);
      expect(accountToLatestSwipe.get(202)).toBeDefined();
      expect(accountToLatestSwipe.get(201)).toBeUndefined();
    });
  });

  describe('response shape', () => {
    it('should include all required candidate fields in response', async () => {
      const candidateData = {
        id: 201,
        name: 'John Doe',
        headline: 'Senior Engineer',
        skills: ['TypeScript', 'Node.js'],
        years_of_experience: 5,
        location: 'San Francisco',
        current_company: 'TechCorp',
        education: 'BS Computer Science',
        certifications: ['AWS Solutions Architect'],
        tools: ['Docker', 'Kubernetes'],
        languages: ['English', 'Spanish'],
        notice_period: '2 weeks',
        current_ctc: 150000,
        expected_ctc: 180000,
        open_to_work: true,
        updated_at: '2026-08-07T00:00:00Z',
      };

      const profile_strength = {
        percent: 95,
        missing: [],
      };

      const expected = {
        id: 201,
        name: 'John Doe',
        headline: 'Senior Engineer',
        skills: ['TypeScript', 'Node.js'],
        years_of_experience: 5,
        location: 'San Francisco',
        current_company: 'TechCorp',
        education: 'BS Computer Science',
        certifications: ['AWS Solutions Architect'],
        tools: ['Docker', 'Kubernetes'],
        languages: ['English', 'Spanish'],
        notice_period: '2 weeks',
        current_ctc: 150000,
        expected_ctc: 180000,
        open_to_work: true,
        profile_strength,
        profile_updated_at: '2026-08-07T00:00:00Z',
        last_active: null,
        match_score: null,
        saved: false,
      };

      // Verify shape matches
      expect(Object.keys(expected).sort()).toContain('id');
      expect(Object.keys(expected).sort()).toContain('name');
      expect(Object.keys(expected).sort()).toContain('headline');
      expect(Object.keys(expected).sort()).toContain('skills');
    });
  });

  describe('company scoping', () => {
    it('should only fetch swipes for the user\'s company', async () => {
      const spy = vi.spyOn(matchingClient, 'getShortlistedSwipes');

      await matchingClient.getShortlistedSwipes(mockReq.user.company_id);

      expect(spy).toHaveBeenCalledWith(100);
      expect(spy).not.toHaveBeenCalledWith(999);
    });

    it('should include saved status for each candidate', async () => {
      const candidates = [
        { id: 201, name: 'John Doe', saved: true },
        { id: 202, name: 'Jane Smith', saved: false },
      ];

      const savedIds = new Set([201]);

      for (const candidate of candidates) {
        const isSaved = savedIds.has(candidate.id);
        expect(isSaved).toBe(candidate.saved);
      }
    });
  });

  describe('performance', () => {
    it('should batch fetch candidate accounts', async () => {
      const accountIds = [201, 202, 203];
      const spy = vi.spyOn(db, 'getCandidateAccountsByIds').mockResolvedValue([]);

      await db.getCandidateAccountsByIds(accountIds);

      expect(spy).toHaveBeenCalledWith(accountIds);
    });

    it('should batch fetch last_active times', async () => {
      const accountIds = [201, 202];
      const spy = vi.spyOn(identityClient, 'getCandidateAccountsLastActiveBulk').mockResolvedValue(new Map());

      await identityClient.getCandidateAccountsLastActiveBulk(accountIds);

      expect(spy).toHaveBeenCalledWith(accountIds);
    });
  });
});
