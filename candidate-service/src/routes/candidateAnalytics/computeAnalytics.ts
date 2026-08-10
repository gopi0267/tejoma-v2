/**
 * Compute Candidate Analytics (Local Implementation)
 *
 * Previously: Proxied to monolith's computeCandidateAnalytics()
 * Now: Implemented locally using:
 * 1. Candidate account data (local DB - this service owns candidate_accounts)
 * 2. Liked jobs (via job-service's /internal/jobs/by-ids)
 * 3. Recruiter review stats (from local candidate_decisions table - mirrored)
 * 4. Profile view counts (from candidate_profile_views - local)
 * 5. Application status (from candidate_application_status - mirrored)
 * 6. Activity trends (from mutual_matches and decision history - mirrored)
 * 7. Pure scoring/recommendation logic (ported from monolith)
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { getJobsByIds } from '../../services/jobServiceClient.js';
import {
  scoreJob,
  toSyntheticCandidate,
  resolveCandidateSalaryExpectation,
  midpointSalary,
  fillTrendGaps,
} from '../../utils/scoring.js';

export async function computeCandidateAnalytics(
  candidateId: number
): Promise<Record<string, unknown> | null> {
  try {
    // Step 1: Get candidate account from local DB
    const account = await db.getCandidateAccountById(candidateId);
    if (!account) {
      logger.debug({ candidateId }, 'Candidate account not found');
      return null;
    }

    // Step 2: Get liked jobs (from local saved_candidates table)
    const likedJobIds = await db.query(
      `
      SELECT DISTINCT job_id FROM saved_candidates
      WHERE candidate_account_id = $1 AND deleted_at IS NULL
      `,
      [account.candidate_account_id]
    );

    if (likedJobIds.rows.length === 0) {
      // No liked jobs - return analytics with empty sets
      return buildEmptyAnalytics(account);
    }

    const jobIdList = likedJobIds.rows.map((r) => r.job_id);
    const likedJobsResponse = await getJobsByIds(jobIdList);
    const likedJobs = likedJobsResponse || [];

    // Step 3: Get recruiter review stats from local candidate_decisions
    const reviewStats = await db.query(
      `
      SELECT
        COUNT(DISTINCT job_id) as reviewed_count,
        COUNT(CASE WHEN decision_type = 'offer' THEN 1 END) as interested_count
      FROM candidate_decisions
      WHERE candidate_id = $1
      `,
      [candidateId]
    );

    const reviewedCount = parseInt(reviewStats.rows[0]?.reviewed_count || '0');
    const interestedCount = parseInt(reviewStats.rows[0]?.interested_count || '0');
    const recruiterResponseRate =
      reviewedCount > 0
        ? Math.round((interestedCount / reviewedCount) * 100)
        : null;

    // Step 4: Get profile view count (from local candidate_profile_views)
    const viewCountResult = await db.query(
      `SELECT COUNT(*) as count FROM candidate_profile_views WHERE candidate_account_id = $1`,
      [account.candidate_account_id]
    );
    const profileViewCount = parseInt(viewCountResult.rows[0]?.count || '0');

    // Step 5: Get application status counts (from candidate_application_status)
    const statusCountsResult = await db.query(
      `
      SELECT
        SUM(CASE WHEN status = 'shortlisted' THEN 1 ELSE 0 END) as shortlisted,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
      FROM candidate_application_status
      WHERE candidate_id = $1
      `,
      [candidateId]
    );

    const shortlistedCount = parseInt(statusCountsResult.rows[0]?.shortlisted || '0');
    const acceptedCount = parseInt(statusCountsResult.rows[0]?.accepted || '0');

    // Step 6: Get activity trends (from mutual_matches and candidate_decisions)
    const trend30 = await getActivityTrend(candidateId, 30);

    // ---- Compute analytics (pure functions ported from monolith) ----
    const syntheticCandidate = toSyntheticCandidate(account);

    // Match score stats
    const scoredJobs = likedJobs.map((job) => ({
      job,
      score: scoreJob(job, syntheticCandidate),
    }));
    const averageMatchScore =
      scoredJobs.length
        ? Math.round(
            scoredJobs.reduce((sum, s) => sum + s.score, 0) / scoredJobs.length
          )
        : null;

    const matchDistribution = {
      '90+': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      below60: 0,
    };
    for (const { score } of scoredJobs) {
      if (score >= 90) matchDistribution['90+']++;
      else if (score >= 80) matchDistribution['80-89']++;
      else if (score >= 70) matchDistribution['70-79']++;
      else if (score >= 60) matchDistribution['60-69']++;
      else matchDistribution.below60++;
    }

    // Application funnel
    const shortlistedOrBetter = shortlistedCount + acceptedCount;
    const funnel = {
      liked: likedJobs.length,
      reviewedByRecruiters: reviewedCount,
      interested: interestedCount,
      shortlisted: shortlistedOrBetter,
      accepted: acceptedCount,
    };

    // Skill demand
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
      .map(([skill, count]) => ({
        skill,
        count,
        percentOfLikedJobs: likedJobs.length
          ? Math.round((count / likedJobs.length) * 100)
          : 0,
      }));

    // Salary insights
    const candidateExpectedSalary = resolveCandidateSalaryExpectation(account);
    const likedJobSalaries = likedJobs
      .map(midpointSalary)
      .filter((v): v is number => v !== null);
    const avgMatchedJobSalary =
      likedJobSalaries.length
        ? Math.round(
            likedJobSalaries.reduce((a, b) => a + b, 0) /
              likedJobSalaries.length
          )
        : null;

    const interestedJobIdSet = new Set<number>();
    // TODO: Query for interested job IDs from candidate_decisions
    const interestedJobSalaries = likedJobs
      .filter((j) => interestedJobIdSet.has(j.job_id))
      .map(midpointSalary)
      .filter((v): v is number => v !== null);
    const avgInterestedRecruiterSalary =
      interestedJobSalaries.length
        ? Math.round(
            interestedJobSalaries.reduce((a, b) => a + b, 0) /
              interestedJobSalaries.length
          )
        : null;

    // Location insights
    const locationCounts = new Map<string, number>();
    for (const job of likedJobs) {
      if (!job.location) continue;
      locationCounts.set(job.location, (locationCounts.get(job.location) || 0) + 1);
    }
    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([location, count]) => ({
        location,
        count,
        percent: likedJobs.length
          ? Math.round((count / likedJobs.length) * 100)
          : 0,
      }));

    // Activity trends
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

    // AI recommendations
    const candidateSkillSet = new Set(
      (syntheticCandidate.skills || []).map((s) => s.toLowerCase().trim())
    );
    const missingSkillJobs = new Map<
      string,
      { displayName: string; jobs: any[] }
    >();
    for (const job of likedJobs) {
      for (const raw of job.required_skills || []) {
        const key = raw.toLowerCase().trim();
        if (!key || candidateSkillSet.has(key)) continue;
        if (!missingSkillJobs.has(key))
          missingSkillJobs.set(key, { displayName: raw.trim(), jobs: [] });
        missingSkillJobs.get(key)!.jobs.push(job);
      }
    }
    const recommendations = [...missingSkillJobs.entries()]
      .filter(([, v]) => v.jobs.length >= 2)
      .map(([skillKey, { displayName, jobs }]) => {
        const withSkillCandidate = {
          ...syntheticCandidate,
          skills: [...(syntheticCandidate.skills || []), skillKey],
        };
        const beforeAvg =
          jobs.reduce((sum, j) => sum + scoreJob(j, syntheticCandidate), 0) /
          jobs.length;
        const afterAvg =
          jobs.reduce(
            (sum, j) => sum + scoreJob(j, withSkillCandidate),
            0
          ) / jobs.length;
        return {
          skill: displayName,
          affectedJobs: jobs.length,
          expectedMatchIncrease: Math.round(afterAvg - beforeAvg),
        };
      })
      .filter((r) => r.expectedMatchIncrease > 0)
      .sort((a, b) => b.expectedMatchIncrease - a.expectedMatchIncrease)
      .slice(0, 5);

    // Insights
    const insights: { type: string; message: string }[] = [];
    if (
      candidateExpectedSalary !== null &&
      avgMatchedJobSalary !== null &&
      candidateExpectedSalary > avgMatchedJobSalary * 1.15
    ) {
      insights.push({
        type: 'salary',
        message:
          "Your expected salary is above the average for jobs you've liked - this may be narrowing recruiter interest.",
      });
    }
    if (recommendations.length > 0) {
      const topSkillNames = recommendations
        .slice(0, 3)
        .map((r) => r.skill)
        .join(', ');
      insights.push({
        type: 'skills',
        message: `Skills frequently requested in roles you've liked but missing from your profile: ${topSkillNames}.`,
      });
    }

    // Interview probability
    let interviewProbability: number | null = null;
    if (averageMatchScore !== null && recruiterResponseRate !== null) {
      interviewProbability = Math.round(
        averageMatchScore * 0.6 + recruiterResponseRate * 0.4
      );
    } else if (averageMatchScore !== null) {
      interviewProbability = Math.round(averageMatchScore * 0.6);
    }

    logger.debug({ candidateId }, 'Computed candidate analytics');

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
    logger.error(
      { err: (error as Error).message, candidateId },
      'Failed to compute candidate analytics'
    );
    throw error;
  }
}

function buildEmptyAnalytics(account: any): Record<string, unknown> {
  return {
    averageMatchScore: null,
    matchDistribution: {
      '90+': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      below60: 0,
    },
    totalLikedJobsScored: 0,
    recruiterResponseRate: null,
    reviewedCount: 0,
    interestedCount: 0,
    funnel: {
      liked: 0,
      reviewedByRecruiters: 0,
      interested: 0,
      shortlisted: 0,
      accepted: 0,
    },
    topSkills: [],
    salary: {
      candidateExpected: null,
      avgMatchedJobSalary: null,
      avgInterestedRecruiterSalary: null,
    },
    topLocations: [],
    profileViewCount: 0,
    profileUpdatedAt: account.updated_at,
    activityTrend7: {
      liked: [],
      recruiterInterest: [],
      matches: [],
    },
    activityTrend30: {
      liked: [],
      recruiterInterest: [],
      matches: [],
    },
    recommendations: [],
    insights: [],
    interviewProbability: null,
    interviewProbabilityIsHeuristic: true,
  };
}

async function getActivityTrend(
  candidateId: number,
  days: number
): Promise<{
  liked: Array<{ date: string; count: number }>;
  recruiterInterest: Array<{ date: string; count: number }>;
  matches: Array<{ date: string; count: number }>;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Liked (from saved_candidates)
  const likedResult = await db.query(
    `
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM saved_candidates
    WHERE candidate_account_id = (
      SELECT candidate_account_id FROM candidate_accounts WHERE id = $1
    )
    AND created_at >= $2
    GROUP BY DATE(created_at)
    ORDER BY date
    `,
    [candidateId, startDate]
  );

  // Recruiter interest (from candidate_decisions with decision_type = 'offer')
  const interestResult = await db.query(
    `
    SELECT DATE(decision_date) as date, COUNT(*) as count
    FROM candidate_decisions
    WHERE candidate_id = $1 AND decision_type = 'offer' AND decision_date >= $2
    GROUP BY DATE(decision_date)
    ORDER BY date
    `,
    [candidateId, startDate]
  );

  // Matches (from mutual_matches where both interested)
  const matchesResult = await db.query(
    `
    SELECT DATE(matched_at) as date, COUNT(*) as count
    FROM mutual_matches
    WHERE candidate_id = $1 AND candidate_interested = true AND job_interested = true AND matched_at >= $2
    GROUP BY DATE(matched_at)
    ORDER BY date
    `,
    [candidateId, startDate]
  );

  return {
    liked: likedResult.rows.map((r) => ({
      date: r.date,
      count: parseInt(r.count),
    })),
    recruiterInterest: interestResult.rows.map((r) => ({
      date: r.date,
      count: parseInt(r.count),
    })),
    matches: matchesResult.rows.map((r) => ({
      date: r.date,
      count: parseInt(r.count),
    })),
  };
}
