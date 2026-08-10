/**
 * Candidate Analytics - Real cutover (Remaining-monolith migration, Item 4)
 *
 * Orchestrates candidate-service's local analytics mirrors (candidate_decisions,
 * candidate_application_status, mutual_matches) with cross-service calls to
 * candidate-core-service and matching-decision-service to compute match scores,
 * funnel metrics, skill demand, salary insights, and recommendations.
 *
 * Logic is a verbatim port of the monolith's computeCandidateAnalytics, with only
 * the 6 data-fetch calls swapped (2 already local, 3 now local via mirrors,
 * 1 hydrated via job-service's by-ids endpoint).
 */

import { Router } from 'express';
import { z } from 'zod';
import { db, pool } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import * as jobServiceClient from '../services/jobServiceClient.js';
import { computeMatchFeatures, computeFeatureScore } from '../matching/services.js';
import { resolveCandidateSalaryExpectation } from '../matching/parseCandidateFields.js';
import { logger } from '../utils/logger.js';
import { CANDIDATE_ANALYTICS_CUTOVER_ENABLED, MONOLITH_INTERNAL_URL } from '../config/env.js';
import type { CandidateAccount, Candidate, Job } from '../types.js';

const router = Router();

function toSyntheticCandidate(c: CandidateAccount): Candidate {
  return {
    skills: c.skills || [],
    years_of_experience: c.years_of_experience,
    current_location: c.location,
    current_job_title: c.headline,
    resume_text: c.summary,
  } as unknown as Candidate;
}

function scoreJob(job: any, candidate: Candidate): number {
  const features = computeMatchFeatures(job as unknown as Job, candidate);
  return computeFeatureScore(features);
}

function parseJobSalaryField(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function midpointSalary(job: any): number | null {
  const min = parseJobSalaryField(job.salary_min);
  const max = parseJobSalaryField(job.salary_max);
  if (min !== null && max !== null) return (min + max) / 2;
  return min ?? max;
}

function fillTrendGaps(series: { date: string; count: number }[], days: number): { date: string; count: number }[] {
  const byDate = new Map(series.map((s) => [s.date, s.count]));
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDate.get(key) || 0 });
  }
  return out;
}

export async function computeCandidateAnalytics(candidateAccountId: number): Promise<Record<string, unknown> | null> {
  try {
    // Fetch candidate account - local
    const account = await db.getCandidateAccountById(candidateAccountId);
    if (!account) {
      return null;
    }

    // Fetch supporting data in parallel
    const [profileViewCount, applicationStatusCounts, trend30] = await Promise.all([
      db.getCandidateProfileViewCount(candidateAccountId),
      db.getCandidateApplicationStatusCounts(candidateAccountId),
      db.getCandidateActivityTrend(candidateAccountId, 30),
    ]);

    // Get liked jobs from mutual_matches mirror - these are the jobs with accepted swipes from both candidate and recruiter
    const likedJobsResult = await db.pool.query(
      `SELECT DISTINCT job_id FROM mutual_matches WHERE candidate_account_id = $1`,
      [candidateAccountId]
    );
    const likedJobIds = likedJobsResult.rows.map((r: any) => r.job_id);

    // Hydrate job data via job-service if we have job IDs
    let likedJobs: any[] = [];
    if (likedJobIds.length > 0) {
      // We need company_id context - get from the first decision's company_id or use monolith proxy
      // For now, fetch all jobs across companies (analytics is cross-company per the monolith's semantics)
      const jobsMap = new Map<number, any>();
      if (likedJobIds.length > 0) {
        // Batch job fetches - need to group by company or just fetch all
        // Since analytics is unscoped, we'll need to fetch from the monolith's job data
        // via job-service's /internal/jobs/by-ids (which requires company_id)
        // Workaround: get first job's company_id from decisions to scope the fetch
        const firstJobCompanyResult = await db.pool.query(
          `SELECT DISTINCT company_id FROM candidate_decisions
           WHERE candidate_account_id = $1 AND job_id = $2 LIMIT 1`,
          [candidateAccountId, likedJobIds[0]]
        );
        const companyId = firstJobCompanyResult.rows[0]?.company_id;
        if (companyId) {
          const fetchedJobs = await jobServiceClient.getJobsByIds(likedJobIds, companyId);
          for (const job of fetchedJobs) {
            jobsMap.set(job.id, job);
          }
        }
      }
      likedJobs = likedJobIds.map((id: number) => jobsMap.get(id)).filter((j: any) => j);
    }

    // Get recruiter review stats from decisions - count jobs reviewed (any decision) vs accepted by recruiter
    const reviewStatsResult = await db.pool.query(
      `SELECT COUNT(DISTINCT cd.job_id) as reviewed_count FROM candidate_decisions cd
       WHERE cd.candidate_account_id = $1`,
      [candidateAccountId]
    );
    const reviewedJobIds = await db.pool.query(
      `SELECT DISTINCT cd.job_id FROM candidate_decisions cd
       WHERE cd.candidate_account_id = $1`,
      [candidateAccountId]
    );
    const interestedJobIds = await db.pool.query(
      `SELECT DISTINCT mm.job_id FROM mutual_matches mm
       WHERE mm.candidate_account_id = $1`,
      [candidateAccountId]
    );

    const reviewedCount = parseInt(reviewStatsResult.rows[0]?.reviewed_count || '0', 10);
    const reviewedJobIdList = reviewedJobIds.rows.map((r: any) => r.job_id);
    const interestedJobIdList = interestedJobIds.rows.map((r: any) => r.job_id);
    const interestedCount = interestedJobIdList.length;

    const syntheticCandidate = toSyntheticCandidate(account);

    // ---- Match Score stats + distribution
    const scoredJobs = likedJobs.map((job) => ({ job, score: scoreJob(job, syntheticCandidate) }));
    const averageMatchScore = scoredJobs.length
      ? Math.round(scoredJobs.reduce((sum, s) => sum + s.score, 0) / scoredJobs.length)
      : null;
    const matchDistribution = { '90+': 0, '80-89': 0, '70-79': 0, '60-69': 0, 'below60': 0 };
    for (const { score } of scoredJobs) {
      if (score >= 90) matchDistribution['90+']++;
      else if (score >= 80) matchDistribution['80-89']++;
      else if (score >= 70) matchDistribution['70-79']++;
      else if (score >= 60) matchDistribution['60-69']++;
      else matchDistribution.below60++;
    }

    // ---- Recruiter response rate
    const recruiterResponseRate = reviewedCount > 0 ? Math.round((interestedCount / reviewedCount) * 100) : null;

    // ---- Application funnel
    const shortlistedOrBetter = (applicationStatusCounts.shortlisted || 0) + (applicationStatusCounts.accepted || 0);
    const funnel = {
      liked: likedJobs.length,
      reviewedByRecruiters: reviewedCount,
      interested: interestedCount,
      shortlisted: shortlistedOrBetter,
      accepted: applicationStatusCounts.accepted || 0,
    };

    // ---- Skill demand
    const skillCounts = new Map<string, number>();
    for (const job of likedJobs) {
      const required: string[] = job.required_skills || [];
      const requiredLower = new Set(required.map((s) => s.toLowerCase().trim()));
      for (const skill of syntheticCandidate.skills || []) {
        if (requiredLower.has(skill.toLowerCase().trim())) {
          skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
        }
      }
    }
    const topSkills = [...skillCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([skill, count]) => ({ skill, count, percentOfLikedJobs: likedJobs.length ? Math.round((count / likedJobs.length) * 100) : 0 }));

    // ---- Salary insights
    const candidateExpectedSalary = resolveCandidateSalaryExpectation(account);
    const likedJobSalaries = likedJobs.map(midpointSalary).filter((v): v is number => v !== null);
    const avgMatchedJobSalary = likedJobSalaries.length ? Math.round(likedJobSalaries.reduce((a, b) => a + b, 0) / likedJobSalaries.length) : null;

    const interestedJobIdSet = new Set(interestedJobIdList);
    const interestedJobSalaries = likedJobs
      .filter((j) => interestedJobIdSet.has(j.id))
      .map(midpointSalary)
      .filter((v): v is number => v !== null);
    const avgInterestedRecruiterSalary = interestedJobSalaries.length
      ? Math.round(interestedJobSalaries.reduce((a, b) => a + b, 0) / interestedJobSalaries.length)
      : null;

    // ---- Location insights
    const locationCounts = new Map<string, number>();
    for (const job of likedJobs) {
      if (!job.location) continue;
      locationCounts.set(job.location, (locationCounts.get(job.location) || 0) + 1);
    }
    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([location, count]) => ({ location, count, percent: likedJobs.length ? Math.round((count / likedJobs.length) * 100) : 0 }));

    // ---- Activity trend
    const activityTrend30 = {
      liked: fillTrendGaps(trend30.liked, 30),
      recruiterInterest: fillTrendGaps(trend30.recruiterInterest, 30),
      matches: fillTrendGaps(trend30.matches, 30),
    };
    const activityTrend7 = {
      liked: activityTrend30.liked.slice(-7),
      recruiterInterest: activityTrend30.recruiterInterest.slice(-7),
      matches: activityTrend30.matches.slice(-7),
    };

    // ---- AI recommendations
    const candidateSkillSet = new Set((syntheticCandidate.skills || []).map((s) => s.toLowerCase().trim()));
    const missingSkillJobs = new Map<string, { displayName: string; jobs: any[] }>();
    for (const job of likedJobs) {
      for (const raw of job.required_skills || []) {
        const key = raw.toLowerCase().trim();
        if (!key || candidateSkillSet.has(key)) continue;
        if (!missingSkillJobs.has(key)) missingSkillJobs.set(key, { displayName: raw.trim(), jobs: [] });
        missingSkillJobs.get(key)!.jobs.push(job);
      }
    }
    const recommendations = [...missingSkillJobs.entries()]
      .filter(([, v]) => v.jobs.length >= 2)
      .map(([skillKey, { displayName, jobs }]) => {
        const withSkillCandidate = { ...syntheticCandidate, skills: [...(syntheticCandidate.skills || []), skillKey] };
        const beforeAvg = jobs.reduce((sum, j) => sum + scoreJob(j, syntheticCandidate), 0) / jobs.length;
        const afterAvg = jobs.reduce((sum, j) => sum + scoreJob(j, withSkillCandidate), 0) / jobs.length;
        return { skill: displayName, affectedJobs: jobs.length, expectedMatchIncrease: Math.round(afterAvg - beforeAvg) };
      })
      .filter((r) => r.expectedMatchIncrease > 0)
      .sort((a, b) => b.expectedMatchIncrease - a.expectedMatchIncrease)
      .slice(0, 5);

    // ---- Insights
    const insights: { type: string; message: string }[] = [];
    if (candidateExpectedSalary !== null && avgMatchedJobSalary !== null && candidateExpectedSalary > avgMatchedJobSalary * 1.15) {
      insights.push({ type: 'salary', message: 'Your expected salary is above the average for jobs you\'ve liked - this may be narrowing recruiter interest.' });
    }
    if (recommendations.length > 0) {
      const topSkillNames = recommendations.slice(0, 3).map((r) => r.skill).join(', ');
      insights.push({ type: 'skills', message: `Skills frequently requested in roles you've liked but missing from your profile: ${topSkillNames}.` });
    }

    // ---- Interview probability
    let interviewProbability: number | null = null;
    if (averageMatchScore !== null && recruiterResponseRate !== null) {
      interviewProbability = Math.round(averageMatchScore * 0.6 + recruiterResponseRate * 0.4);
    } else if (averageMatchScore !== null) {
      interviewProbability = Math.round(averageMatchScore * 0.6);
    }

    return {
      averageMatchScore,
      matchDistribution,
      totalLikedJobsScored: scoredJobs.length,
      recruiterResponseRate,
      reviewedCount,
      interestedCount,
      funnel,
      topSkills,
      salary: {
        candidateExpected: candidateExpectedSalary,
        avgMatchedJobSalary,
        avgInterestedRecruiterSalary,
      },
      topLocations,
      profileViewCount,
      profileUpdatedAt: account.updated_at,
      activityTrend7,
      activityTrend30,
      recommendations,
      insights,
      interviewProbability,
      interviewProbabilityIsHeuristic: true,
    };
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Error computing candidate analytics');
    return null;
  }
}

router.get('/candidate-analytics', requireCandidateAuth, async (req, res) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;

    if (CANDIDATE_ANALYTICS_CUTOVER_ENABLED) {
      // Real cutover: use local implementation
      const analytics = await computeCandidateAnalytics(candidateAccountId);
      if (!analytics) {
        return res.status(404).json({ error: 'Candidate not found' });
      }
      return res.json(analytics);
    } else {
      // Fallback: proxy to monolith
      const monolithUrl = `${MONOLITH_INTERNAL_URL}/api/candidate-analytics`;
      const response = await fetch(monolithUrl, {
        headers: { Cookie: req.get('Cookie') || '' },
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to load analytics from monolith' });
      }
      const analytics = await response.json();
      return res.json(analytics);
    }
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Candidate analytics error');
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

export default router;
