import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { computeMatchFeatures, computeFeatureScore } from '../matching/services.js';
import { resolveCandidateSalaryExpectation } from '../matching/parseCandidateFields.js';
import type { Job, Candidate, CandidateAccount } from '../types.js';

const router = Router();

// One read-only aggregation endpoint for the whole Candidate Analytics dashboard. Every number
// below is either a direct query result or computed via the EXISTING, unmodified matching engine
// (computeMatchFeatures/computeFeatureScore, services.ts) - nothing here changes matching logic,
// it only calls it, the same way candidate-jobs.routes.ts already does for the Explore deck.
// No schema change, no existing function touched (db.ts's new getters this route calls are all
// additive), no other candidate/recruiter route affected.

// Mirrors candidate-jobs.routes.ts's toSyntheticCandidate exactly - kept as its own local copy
// (not imported) since that's the existing convention every candidate-facing route already
// follows for this small pure mapper, rather than introducing a new shared-utility dependency.
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

// jobs.salary_min/salary_max are NUMERIC(10,2) columns - node-postgres returns NUMERIC as a
// string (to avoid float-precision loss), never a JS number, so this is a plain numeric parse,
// NOT parseSalaryValue (that one's for candidates' free-text "12 LPA"/"$80K" CTC fields via the
// JD-parser's regex tier, which doesn't understand a bare decimal string like "120000.00").
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

// Extracted so Candidate Service's internal write/read proxy
// (src/api/candidate-internal.routes.ts's new /analytics endpoint, remaining-monolith migration
// Step 3c) can call the exact same computation without duplicating it - this handler below is now
// a thin wrapper, unchanged behavior.
export async function computeCandidateAnalytics(candidateId: number): Promise<Record<string, unknown> | null> {
    const [account, likedJobs, reviewStats, profileViewCount, applicationStatusCounts, trend30] = await Promise.all([
      db.getCandidateAccountById(candidateId),
      db.getCandidateLikedJobsForAnalytics(candidateId),
      db.getCandidateRecruiterReviewStats(candidateId),
      db.getCandidateProfileViewCount(candidateId),
      db.getCandidateApplicationStatusCounts(candidateId),
      db.getCandidateActivityTrend(candidateId, 30),
    ]);

    if (!account) {
      return null;
    }

    const syntheticCandidate = toSyntheticCandidate(account);

    // ---- Match Score stats + distribution (over liked jobs - the candidate's actual engaged set) ----
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

    // ---- Recruiter response rate ----
    const reviewedCount = reviewStats.reviewedJobIds.length;
    const interestedCount = reviewStats.interestedJobIds.length;
    const recruiterResponseRate = reviewedCount > 0 ? Math.round((interestedCount / reviewedCount) * 100) : null;

    // ---- Application funnel (real statuses only - "Interview"/"Offers" don't exist as tracked
    // stages, see candidate_application_status's CHECK constraint; 'accepted' is the closest
    // analog to an offer and is labeled as such, not invented as a separate stage) ----
    const shortlistedOrBetter = (applicationStatusCounts.shortlisted || 0) + (applicationStatusCounts.accepted || 0);
    const funnel = {
      liked: likedJobs.length,
      reviewedByRecruiters: reviewedCount,
      interested: interestedCount,
      shortlisted: shortlistedOrBetter,
      accepted: applicationStatusCounts.accepted || 0,
    };

    // ---- Skill demand: candidate's own skills, ranked by how often they appear in required_skills
    // across the candidate's liked jobs (real overlap, not invented) ----
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

    // ---- Salary insights (reuses the exact parser the live matching engine uses - returns null,
    // never a guess, when a free-text CTC field can't be confidently parsed) ----
    const candidateExpectedSalary = resolveCandidateSalaryExpectation(account);
    const likedJobSalaries = likedJobs.map(midpointSalary).filter((v): v is number => v !== null);
    const avgMatchedJobSalary = likedJobSalaries.length ? Math.round(likedJobSalaries.reduce((a, b) => a + b, 0) / likedJobSalaries.length) : null;

    const interestedJobIdSet = new Set(reviewStats.interestedJobIds);
    const interestedJobSalaries = likedJobs
      .filter((j) => interestedJobIdSet.has(j.job_id))
      .map(midpointSalary)
      .filter((v): v is number => v !== null);
    const avgInterestedRecruiterSalary = interestedJobSalaries.length
      ? Math.round(interestedJobSalaries.reduce((a, b) => a + b, 0) / interestedJobSalaries.length)
      : null;

    // ---- Location insights ----
    const locationCounts = new Map<string, number>();
    for (const job of likedJobs) {
      if (!job.location) continue;
      locationCounts.set(job.location, (locationCounts.get(job.location) || 0) + 1);
    }
    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([location, count]) => ({ location, count, percent: likedJobs.length ? Math.round((count / likedJobs.length) * 100) : 0 }));

    // ---- Activity trend (30-day, gap-filled to zero; 7-day is just the tail slice) ----
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

    // ---- AI recommendations: real counterfactual re-scoring, not hardcoded percentages.
    // For each skill missing from the candidate's profile but required by >=2 of their liked
    // jobs, re-run the SAME scoring function with that one skill added and measure the actual
    // average score delta across those jobs. ----
    const candidateSkillSet = new Set((syntheticCandidate.skills || []).map((s) => s.toLowerCase().trim()));
    // Keyed by lowercase for case-insensitive dedup/matching, but keeps the first-seen original
    // casing (e.g. "SQL", "Tableau") for display - lowercasing everything made recommendations
    // read as "Add Sql" instead of "Add SQL".
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

    // ---- "Why am I not getting responses?" - only surfaced when actual data supports it ----
    const insights: { type: string; message: string }[] = [];
    if (candidateExpectedSalary !== null && avgMatchedJobSalary !== null && candidateExpectedSalary > avgMatchedJobSalary * 1.15) {
      insights.push({ type: 'salary', message: 'Your expected salary is above the average for jobs you\'ve liked - this may be narrowing recruiter interest.' });
    }
    if (recommendations.length > 0) {
      const topSkillNames = recommendations.slice(0, 3).map((r) => r.skill).join(', ');
      insights.push({ type: 'skills', message: `Skills frequently requested in roles you've liked but missing from your profile: ${topSkillNames}.` });
    }
    // Profile completeness is read from the candidate-profile endpoint's own computation
    // client-side (see CandidateAnalytics.tsx) rather than duplicated here, since that logic
    // also needs the candidate_experiences table this route doesn't otherwise query.

    // ---- Interview probability: a disclosed heuristic blended from the two real inputs above,
    // never presented as a trained model - there is no historical interview/outcome data in this
    // schema to honestly train or predict from. Null (not a guess) when there isn't enough
    // underlying data to blend. ----
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
}

router.get('/candidate-analytics', requireCandidateAuth, async (req, res) => {
  try {
    const candidateId = req.candidate!.candidate_id;
    const analytics = await computeCandidateAnalytics(candidateId);
    if (!analytics) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    res.json(analytics);
  } catch (error) {
    console.error('Candidate analytics error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

export default router;
