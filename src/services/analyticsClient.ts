// Item 4: Analytics CQRS - client for mirroring activity to the analytics-service's read model
import { logger } from '../utils/logger.js';

const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:4022';

async function mirrorToAnalytics(path: string, data: any): Promise<void> {
  try {
    const res = await fetch(`${ANALYTICS_SERVICE_URL}/internal/analytics${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, 'Failed to mirror to analytics (fail-open)');
    }
  } catch (error: any) {
    logger.warn({ err: error.message, path }, 'Failed to mirror to analytics (fail-open)');
  }
}

export async function mirrorRecentActivity(companyId: number, activity: {
  swipeId: number;
  recruiterName?: string;
  candidateName?: string;
  jobTitle?: string;
  action: string;
  matchScore?: number;
  timestamp?: string;
}): Promise<void> {
  await mirrorToAnalytics('/recent-activity', { companyId, activity });
}

export async function mirrorDashboardStats(companyId: number, stats: {
  totalReviewed: number;
  matchesMade: number;
  avgScore: number;
  acceptanceRate: number;
  totalSwipesToday: number;
  swipesYesterday: number;
  pendingCandidates: number;
  modelAccuracy?: number;
}): Promise<void> {
  await mirrorToAnalytics('/dashboard-cache', { companyId, stats });
}

export async function mirrorJobStats(companyId: number, jobId: number, stats: {
  totalReviewed: number;
  acceptanceRate: number;
}): Promise<void> {
  await mirrorToAnalytics('/job-stats', { companyId, jobId, stats });
}

export async function mirrorSkillDistribution(companyId: number, skill: string, count: number): Promise<void> {
  await mirrorToAnalytics('/skill', { companyId, skill, count });
}

export async function mirrorRecruiterProfile(companyId: number, profile: {
  userId: number;
  name?: string;
  email?: string;
  swipesCount: number;
  accepted: number;
  rejected: number;
  saved: number;
  acceptanceRate: number;
  averageMatchScore?: number;
  avgDecisionTimeSeconds?: number;
  lastLoginAt?: string;
  isActive: boolean;
}): Promise<void> {
  await mirrorToAnalytics('/recruiter-profile', { companyId, profile });
}
