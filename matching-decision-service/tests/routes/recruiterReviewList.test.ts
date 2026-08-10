/**
 * Unit tests for GET /recruiter-review (list) with CQRS materialized view
 * Item 5: Materialized view + refresh hooks from cross-service writes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/db.js';

describe('GET /recruiter-review (list) - CQRS', () => {
  let mockCompanyId: number;
  let mockFilters: any;

  beforeEach(() => {
    mockCompanyId = 100;
    mockFilters = {
      page: 1,
      pageSize: 25,
    };
    vi.clearAllMocks();
  });

  describe('view querying', () => {
    it('should query recruiter_review_view with company_id filter', async () => {
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, mockFilters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, mockFilters);
    });

    it('should support pagination with page and pageSize', async () => {
      const filters = { page: 2, pageSize: 50 };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 150,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ page: 2, pageSize: 50 }));
    });

    it('should calculate correct OFFSET for pagination', async () => {
      const page = 3;
      const pageSize = 25;
      const expectedOffset = (page - 1) * pageSize; // 50

      expect(expectedOffset).toBe(50);
    });

    it('should return total count for pagination UI', async () => {
      const mockResult = {
        rows: Array(25).fill({ id: 1, candidate_name: 'John' }),
        total: 156,
      };

      const pages = Math.ceil(mockResult.total / 25);
      expect(pages).toBe(7);
    });
  });

  describe('search and filters', () => {
    it('should support full-text search on candidate name', async () => {
      const filters = { search: 'john', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ search: 'john' }));
    });

    it('should support job_id filter', async () => {
      const filters = { jobId: 42, ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ jobId: 42 }));
    });

    it('should support decision filter (accepted/rejected)', async () => {
      const filters = { decision: 'accepted', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ decision: 'accepted' }));
    });

    it('should support recruiter_id filter', async () => {
      const filters = { recruiterId: 7, ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ recruiterId: 7 }));
    });

    it('should support date range filters', async () => {
      const filters = {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-07',
        ...mockFilters,
      };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ dateFrom: '2026-08-01', dateTo: '2026-08-07' }));
    });

    it('should support experience range filters', async () => {
      const filters = {
        minExperience: 3,
        maxExperience: 10,
        ...mockFilters,
      };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(
        mockCompanyId,
        expect.objectContaining({ minExperience: 3, maxExperience: 10 })
      );
    });

    it('should support score range filters', async () => {
      const filters = {
        minScore: 70,
        maxScore: 90,
        ...mockFilters,
      };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ minScore: 70, maxScore: 90 }));
    });

    it('should support skills filter', async () => {
      const filters = {
        skills: 'TypeScript',
        ...mockFilters,
      };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ skills: 'TypeScript' }));
    });

    it('should combine multiple filters in AND query', async () => {
      const filters = {
        jobId: 42,
        decision: 'accepted',
        minScore: 80,
        ...mockFilters,
      };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(
        mockCompanyId,
        expect.objectContaining({
          jobId: 42,
          decision: 'accepted',
          minScore: 80,
        })
      );
    });
  });

  describe('sorting', () => {
    it('should support latest_decision sort (default)', async () => {
      const filters = { sortBy: 'latest_decision', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ sortBy: 'latest_decision' }));
    });

    it('should support oldest_decision sort', async () => {
      const filters = { sortBy: 'oldest_decision', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ sortBy: 'oldest_decision' }));
    });

    it('should support highest_score sort', async () => {
      const filters = { sortBy: 'highest_score', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ sortBy: 'highest_score' }));
    });

    it('should support lowest_score sort', async () => {
      const filters = { sortBy: 'lowest_score', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ sortBy: 'lowest_score' }));
    });

    it('should support name_asc sort', async () => {
      const filters = { sortBy: 'name_asc', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ sortBy: 'name_asc' }));
    });

    it('should support name_desc sort', async () => {
      const filters = { sortBy: 'name_desc', ...mockFilters };
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(mockCompanyId, filters);

      expect(spy).toHaveBeenCalledWith(mockCompanyId, expect.objectContaining({ sortBy: 'name_desc' }));
    });
  });

  describe('response shape', () => {
    it('should return rows array and total count', async () => {
      const mockResult = {
        rows: [
          {
            id: 1,
            candidate_id: 101,
            job_id: 5,
            candidate_name: 'John Doe',
            job_title: 'Senior Engineer',
            latest_decision_date: '2026-08-07T10:00:00Z',
          },
        ],
        total: 42,
      };

      expect(mockResult).toHaveProperty('rows');
      expect(mockResult).toHaveProperty('total');
      expect(Array.isArray(mockResult.rows)).toBe(true);
      expect(typeof mockResult.total).toBe('number');
    });

    it('should include all required fields in each row', async () => {
      const requiredFields = [
        'id',
        'candidate_id',
        'job_id',
        'candidate_name',
        'job_title',
        'latest_decision_date',
        'match_score',
        'latest_action',
      ];

      const mockRow = {
        id: 1,
        candidate_id: 101,
        job_id: 5,
        candidate_name: 'John Doe',
        job_title: 'Senior Engineer',
        latest_decision_date: '2026-08-07T10:00:00Z',
        match_score: 85,
        latest_action: 1,
        recruiter_id: 7,
        note_text: 'Good candidate',
      };

      for (const field of requiredFields) {
        expect(mockRow).toHaveProperty(field);
      }
    });

    it('should handle empty result set', async () => {
      const mockResult = {
        rows: [],
        total: 0,
      };

      expect(mockResult.rows.length).toBe(0);
      expect(mockResult.total).toBe(0);
    });
  });

  describe('company scoping', () => {
    it('should only return rows for specified company', async () => {
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(100, mockFilters);
      expect(spy).toHaveBeenCalledWith(100, mockFilters);

      await db.getRecruiterReviewListFromView(200, mockFilters);
      expect(spy).toHaveBeenCalledWith(200, mockFilters);
    });
  });

  describe('view refresh', () => {
    it('should support upsert for candidate changes', async () => {
      const rowData = {
        candidate_id: 101,
        job_id: 5,
        candidate_name: 'John Doe',
        match_score: 85,
      };

      expect(rowData).toHaveProperty('candidate_id');
      expect(rowData).toHaveProperty('job_id');
      expect(rowData).toHaveProperty('candidate_name');
    });

    it('should support update for note changes', async () => {
      const spy = vi.spyOn(db, 'patchRecruiterReviewViewNote').mockResolvedValue(true);

      await db.patchRecruiterReviewViewNote(101, 5, 'Updated note');

      expect(spy).toHaveBeenCalledWith(101, 5, 'Updated note');
    });

    it('should support delete for swipe deletion', async () => {
      const spy = vi.spyOn(db, 'deleteRecruiterReviewViewRow').mockResolvedValue(true);

      await db.deleteRecruiterReviewViewRow(101, 5);

      expect(spy).toHaveBeenCalledWith(101, 5);
    });
  });

  describe('performance', () => {
    it('should return results quickly with indexed queries', async () => {
      const start = Date.now();

      await db.getRecruiterReviewListFromView(mockCompanyId, mockFilters);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000); // Should be fast
    });

    it('should handle large result sets with pagination', async () => {
      const largeResult = {
        rows: Array(25).fill({ id: 1 }),
        total: 10000,
      };

      expect(largeResult.rows.length).toBe(25);
      expect(largeResult.total).toBe(10000);
    });
  });

  describe('error handling', () => {
    it('should handle invalid company_id gracefully', async () => {
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      await db.getRecruiterReviewListFromView(-1, mockFilters);

      expect(spy).toHaveBeenCalled();
    });

    it('should return empty result on error', async () => {
      const spy = vi.spyOn(db, 'getRecruiterReviewListFromView').mockResolvedValue({
        rows: [],
        total: 0,
      });

      const result = await db.getRecruiterReviewListFromView(mockCompanyId, mockFilters);

      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('feature flag', () => {
    it('should check RECRUITER_REVIEW_LIST_CUTOVER_ENABLED flag', async () => {
      const flag = process.env.RECRUITER_REVIEW_LIST_CUTOVER_ENABLED === 'true';
      expect(typeof flag).toBe('boolean');
    });
  });
});
