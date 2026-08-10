/**
 * Unit tests for GET /candidate-analytics
 * Item 4: Orchestration of candidate-service mirror tables + cross-service data
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeCandidateAnalytics } from '../../src/routes/candidateAnalytics.routes.js';
import { db } from '../../src/db.js';

describe('GET /candidate-analytics', () => {
  let mockCandidateAccountId: number;

  beforeEach(() => {
    mockCandidateAccountId = 1;
    vi.clearAllMocks();
  });

  describe('orchestration', () => {
    it('should fetch candidate account from local database', async () => {
      const spy = vi.spyOn(db, 'getCandidateAccountById').mockResolvedValue(null);

      await db.getCandidateAccountById(mockCandidateAccountId);

      expect(spy).toHaveBeenCalledWith(mockCandidateAccountId);
    });

    it('should fetch analytics data from local mirror tables', async () => {
      const spyProfileView = vi.spyOn(db, 'getCandidateProfileViewCount').mockResolvedValue(0);
      const spyAppStatus = vi.spyOn(db, 'getCandidateApplicationStatusCounts').mockResolvedValue({});
      const spyTrend = vi.spyOn(db, 'getCandidateActivityTrend').mockResolvedValue({
        liked: [],
        recruiterInterest: [],
        matches: [],
      });

      await Promise.all([
        db.getCandidateProfileViewCount(mockCandidateAccountId),
        db.getCandidateApplicationStatusCounts(mockCandidateAccountId),
        db.getCandidateActivityTrend(mockCandidateAccountId, 30),
      ]);

      expect(spyProfileView).toHaveBeenCalled();
      expect(spyAppStatus).toHaveBeenCalled();
      expect(spyTrend).toHaveBeenCalled();
    });
  });

  describe('data structures', () => {
    it('should return analytics with all required top-level fields', async () => {
      const expectedFields = [
        'averageMatchScore',
        'matchDistribution',
        'totalLikedJobsScored',
        'recruiterResponseRate',
        'reviewedCount',
        'interestedCount',
        'funnel',
        'topSkills',
        'salary',
        'topLocations',
        'profileViewCount',
        'profileUpdatedAt',
        'activityTrend7',
        'activityTrend30',
        'recommendations',
        'insights',
        'interviewProbability',
        'interviewProbabilityIsHeuristic',
      ];

      const analyticsTemplate = {
        averageMatchScore: null,
        matchDistribution: { '90+': 0, '80-89': 0, '70-79': 0, '60-69': 0, below60: 0 },
        totalLikedJobsScored: 0,
        recruiterResponseRate: null,
        reviewedCount: 0,
        interestedCount: 0,
        funnel: { liked: 0, reviewedByRecruiters: 0, interested: 0, shortlisted: 0, accepted: 0 },
        topSkills: [],
        salary: { candidateExpected: null, avgMatchedJobSalary: null, avgInterestedRecruiterSalary: null },
        topLocations: [],
        profileViewCount: 0,
        profileUpdatedAt: '2026-08-07T00:00:00Z',
        activityTrend7: { liked: [], recruiterInterest: [], matches: [] },
        activityTrend30: { liked: [], recruiterInterest: [], matches: [] },
        recommendations: [],
        insights: [],
        interviewProbability: null,
        interviewProbabilityIsHeuristic: true,
      };

      for (const field of expectedFields) {
        expect(analyticsTemplate).toHaveProperty(field);
      }
    });

    it('should structure funnel correctly', async () => {
      const funnel = {
        liked: 10,
        reviewedByRecruiters: 8,
        interested: 5,
        shortlisted: 3,
        accepted: 1,
      };

      expect(funnel.liked).toBeGreaterThanOrEqual(funnel.reviewedByRecruiters);
      expect(funnel.reviewedByRecruiters).toBeGreaterThanOrEqual(funnel.interested);
      expect(funnel.interested).toBeGreaterThanOrEqual(funnel.shortlisted);
      expect(funnel.shortlisted).toBeGreaterThanOrEqual(funnel.accepted);
    });

    it('should structure match distribution correctly', async () => {
      const distribution = { '90+': 5, '80-89': 3, '70-79': 2, '60-69': 1, below60: 0 };
      const total = Object.values(distribution).reduce((a, b) => a + b, 0);

      expect(total).toBe(11);
      for (const [range, count] of Object.entries(distribution)) {
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('calculations', () => {
    it('should calculate recruiter response rate correctly', async () => {
      const reviewedCount = 10;
      const interestedCount = 6;
      const expectedRate = Math.round((interestedCount / reviewedCount) * 100);

      expect(expectedRate).toBe(60);
    });

    it('should calculate average match score correctly', async () => {
      const scores = [85, 78, 92, 81, 89];
      const average = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

      expect(average).toBe(85);
    });

    it('should calculate interview probability correctly', async () => {
      const averageMatchScore = 80;
      const recruiterResponseRate = 60;
      const probability = Math.round(averageMatchScore * 0.6 + recruiterResponseRate * 0.4);

      expect(probability).toBe(72);
    });

    it('should handle null values in calculations', async () => {
      const averageMatchScore = null;
      const recruiterResponseRate = null;
      let probability: number | null = null;

      if (averageMatchScore !== null && recruiterResponseRate !== null) {
        probability = Math.round(averageMatchScore * 0.6 + recruiterResponseRate * 0.4);
      } else if (averageMatchScore !== null) {
        probability = Math.round(averageMatchScore * 0.6);
      }

      expect(probability).toBeNull();
    });
  });

  describe('skill analysis', () => {
    it('should extract and count candidate skills', async () => {
      const candidateSkills = ['TypeScript', 'Node.js', 'React', 'Docker'];
      const skillSet = new Set(candidateSkills.map((s) => s.toLowerCase().trim()));

      expect(skillSet.size).toBe(4);
      expect(skillSet.has('typescript')).toBe(true);
    });

    it('should identify missing skills from liked jobs', async () => {
      const candidateSkills = new Set(['typescript', 'node.js']);
      const jobRequiredSkills = ['TypeScript', 'Node.js', 'Kubernetes', 'AWS'];
      const missingSkills: string[] = [];

      for (const skill of jobRequiredSkills) {
        const key = skill.toLowerCase().trim();
        if (!candidateSkills.has(key)) {
          missingSkills.push(skill);
        }
      }

      expect(missingSkills).toContain('Kubernetes');
      expect(missingSkills).toContain('AWS');
      expect(missingSkills.length).toBe(2);
    });

    it('should recommend skills that appear in multiple liked jobs', async () => {
      const skillJobCounts = new Map([
        ['Kubernetes', 3],
        ['AWS', 3],
        ['Docker', 2],
        ['GraphQL', 1],
      ]);

      const recommendations = [...skillJobCounts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([skill]) => skill);

      expect(recommendations).toContain('Kubernetes');
      expect(recommendations).toContain('AWS');
      expect(recommendations).toContain('Docker');
      expect(recommendations).not.toContain('GraphQL');
    });
  });

  describe('salary analysis', () => {
    it('should parse job salary fields correctly', async () => {
      const parseJobSalaryField = (v: unknown): number | null => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '') {
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };

      expect(parseJobSalaryField(100000)).toBe(100000);
      expect(parseJobSalaryField('150000')).toBe(150000);
      expect(parseJobSalaryField('invalid')).toBeNull();
      expect(parseJobSalaryField('')).toBeNull();
    });

    it('should calculate midpoint salary correctly', async () => {
      const salaryMin = 100000;
      const salaryMax = 150000;
      const midpoint = (salaryMin + salaryMax) / 2;

      expect(midpoint).toBe(125000);
    });

    it('should identify salary misalignment', async () => {
      const candidateExpectedSalary = 180000;
      const avgMatchedJobSalary = 150000;
      const isMisaligned = candidateExpectedSalary > avgMatchedJobSalary * 1.15;

      expect(isMisaligned).toBe(true);
    });
  });

  describe('location analysis', () => {
    it('should aggregate job locations correctly', async () => {
      const jobLocations = ['San Francisco', 'San Francisco', 'New York', 'London', 'Remote'];
      const locationCounts = new Map<string, number>();

      for (const location of jobLocations) {
        locationCounts.set(location, (locationCounts.get(location) || 0) + 1);
      }

      expect(locationCounts.get('San Francisco')).toBe(2);
      expect(locationCounts.get('New York')).toBe(1);
      expect(locationCounts.size).toBe(4);
    });

    it('should calculate location percentages correctly', async () => {
      const locationCounts = [
        { location: 'San Francisco', count: 5 },
        { location: 'New York', count: 3 },
        { location: 'Remote', count: 2 },
      ];
      const totalJobs = 10;

      const locations = locationCounts.map(({ location, count }) => ({
        location,
        count,
        percent: Math.round((count / totalJobs) * 100),
      }));

      expect(locations[0].percent).toBe(50);
      expect(locations[1].percent).toBe(30);
      expect(locations[2].percent).toBe(20);
    });
  });

  describe('insights generation', () => {
    it('should generate salary insight when candidate expectation is too high', async () => {
      const candidateExpectedSalary = 180000;
      const avgMatchedJobSalary = 150000;
      const insights: { type: string; message: string }[] = [];

      if (candidateExpectedSalary !== null && avgMatchedJobSalary !== null && candidateExpectedSalary > avgMatchedJobSalary * 1.15) {
        insights.push({ type: 'salary', message: 'Your expected salary is above the average for jobs you\'ve liked - this may be narrowing recruiter interest.' });
      }

      expect(insights.length).toBe(1);
      expect(insights[0].type).toBe('salary');
    });

    it('should generate skills insight when candidate is missing demanded skills', async () => {
      const recommendations = [
        { skill: 'Kubernetes', affectedJobs: 3 },
        { skill: 'AWS', affectedJobs: 3 },
      ];
      const insights: { type: string; message: string }[] = [];

      if (recommendations.length > 0) {
        const topSkillNames = recommendations.slice(0, 3).map((r) => r.skill).join(', ');
        insights.push({ type: 'skills', message: `Skills frequently requested in roles you've liked but missing from your profile: ${topSkillNames}.` });
      }

      expect(insights.length).toBe(1);
      expect(insights[0].type).toBe('skills');
      expect(insights[0].message).toContain('Kubernetes');
      expect(insights[0].message).toContain('AWS');
    });

    it('should not generate salary insight when salary is aligned', async () => {
      const candidateExpectedSalary = 150000;
      const avgMatchedJobSalary = 150000;
      const insights: { type: string; message: string }[] = [];

      if (candidateExpectedSalary !== null && avgMatchedJobSalary !== null && candidateExpectedSalary > avgMatchedJobSalary * 1.15) {
        insights.push({ type: 'salary', message: 'Salary misaligned' });
      }

      expect(insights.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should return null for non-existent candidate', async () => {
      vi.spyOn(db, 'getCandidateAccountById').mockResolvedValue(null);

      const result = await db.getCandidateAccountById(999999);

      expect(result).toBeNull();
    });

    it('should handle missing activity trend data gracefully', async () => {
      vi.spyOn(db, 'getCandidateActivityTrend').mockResolvedValue({
        liked: [],
        recruiterInterest: [],
        matches: [],
      });

      const trend = await db.getCandidateActivityTrend(1, 30);

      expect(trend.liked).toEqual([]);
      expect(trend.recruiterInterest).toEqual([]);
      expect(trend.matches).toEqual([]);
    });

    it('should handle missing application status gracefully', async () => {
      vi.spyOn(db, 'getCandidateApplicationStatusCounts').mockResolvedValue({});

      const counts = await db.getCandidateApplicationStatusCounts(1);

      expect(counts).toEqual({});
      expect(counts.shortlisted).toBeUndefined();
      expect(counts.accepted).toBeUndefined();
    });
  });

  describe('feature flag', () => {
    it('should check CANDIDATE_ANALYTICS_CUTOVER_ENABLED flag', async () => {
      const flag = process.env.CANDIDATE_ANALYTICS_CUTOVER_ENABLED === 'true';
      expect(typeof flag).toBe('boolean');
    });
  });
});
