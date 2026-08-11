/**
 * Event Handlers for Analytics CQRS
 * Process business events and update analytics aggregations
 */
import { db } from '../db.js';
import { logger } from '../utils/logger.js';

/**
 * Handle job-created events
 * Updates active_jobs count and initializes job analytics
 */
export async function handleJobCreated(data: any): Promise<void> {
  try {
    const { job_id, title } = data;
    if (!job_id) return;

    // Job created - will be counted in dashboard_metrics via JOIN query
    // This is just a marker; actual stats are computed on demand from underlying data
    logger.debug({ job_id, title }, 'Job created event processed');
  } catch (err: any) {
    logger.warn({ err: err.message, job_id: data?.job_id }, 'Failed to handle job-created event');
  }
}

/**
 * Handle swipe-completed events
 * Updates total_swipes, acceptance_rate, recruiter stats, job stats
 */
export async function handleSwiped(data: any): Promise<void> {
  try {
    const { job_id, candidate_id, recruiter_id, company_id, decision, match_score } = data;
    if (!job_id || !candidate_id || !company_id) return;

    // Increment swipe count for the job
    if (job_id) {
      const currentStats = await db.pool.query(
        'SELECT total_reviewed, acceptance_rate FROM analytics_job_stats WHERE job_id = $1 AND company_id = $2',
        [job_id, company_id]
      );

      const stats = currentStats.rows[0];
      const newTotal = (stats?.total_reviewed || 0) + 1;
      const acceptances = decision === 'accept' ? (parseInt(stats?.acceptance_rate || 0) * (stats?.total_reviewed || 0) / 100 + 1) : (parseInt(stats?.acceptance_rate || 0) * (stats?.total_reviewed || 0) / 100);
      const newRate = newTotal > 0 ? (acceptances / newTotal) * 100 : 0;

      await db.upsertJobStats(company_id, job_id, {
        total_reviewed: newTotal,
        acceptance_rate: parseFloat(newRate.toFixed(2)),
      });
    }

    // Update recruiter profile
    if (recruiter_id) {
      const currentProfile = await db.pool.query(
        'SELECT swipes_count, accepted, rejected FROM analytics_recruiter_profile WHERE user_id = $1 AND company_id = $2',
        [recruiter_id, company_id]
      );

      const profile = currentProfile.rows[0];
      const newSwipesCount = (profile?.swipes_count || 0) + 1;
      const newAccepted = decision === 'accept' ? (profile?.accepted || 0) + 1 : (profile?.accepted || 0);
      const newRejected = decision === 'reject' ? (profile?.rejected || 0) + 1 : (profile?.rejected || 0);
      const newRate = newSwipesCount > 0 ? (newAccepted / newSwipesCount) * 100 : 0;

      await db.upsertRecruiterProfile(company_id, {
        user_id: recruiter_id,
        swipes_count: newSwipesCount,
        accepted: newAccepted,
        rejected: newRejected,
        acceptance_rate: parseFloat(newRate.toFixed(2)),
        average_match_score: match_score || 0,
      });
    }

    // Update dashboard metrics
    const currentDashboard = await db.pool.query(
      'SELECT total_swipes_today FROM analytics_dashboard_cache WHERE company_id = $1',
      [company_id]
    );

    const dashboard = currentDashboard.rows[0];
    await db.upsertDashboardStats(company_id, {
      total_swipes_today: (dashboard?.total_swipes_today || 0) + 1,
    });

    logger.debug({ job_id, candidate_id, decision }, 'Swipe event processed');
  } catch (err: any) {
    logger.warn({ err: err.message, job_id: data?.job_id }, 'Failed to handle swipe-completed event');
  }
}

/**
 * Handle recruiter-review-decision-changed events
 * Updates decision counts and recruiter stats
 */
export async function handleDecisionChanged(data: any): Promise<void> {
  try {
    // Similar to swipe-completed but for decision changes
    await handleSwiped(data);
    logger.debug({ job_id: data?.job_id }, 'Decision changed event processed');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to handle decision-changed event');
  }
}

/**
 * Handle candidate-updated events
 * Updates candidate count in dashboard, updates skill distribution
 */
export async function handleCandidateUpdated(data: any): Promise<void> {
  try {
    const { candidate_id, company_id, skills } = data;
    if (!candidate_id || !company_id) return;

    // Update skill distribution if skills provided
    if (Array.isArray(skills) && skills.length > 0) {
      for (const skill of skills) {
        if (typeof skill === 'string') {
          const current = await db.pool.query(
            'SELECT count FROM analytics_skill_distribution WHERE skill_name = $1 AND company_id = $2',
            [skill, company_id]
          );

          const count = current.rows[0]?.count || 0;
          await db.upsertSkillDistribution(company_id, skill, count + 1);
        }
      }
    }

    logger.debug({ candidate_id, company_id }, 'Candidate updated event processed');
  } catch (err: any) {
    logger.warn({ err: err.message, candidate_id: data?.candidate_id }, 'Failed to handle candidate-updated event');
  }
}
