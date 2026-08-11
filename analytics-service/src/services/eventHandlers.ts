/**
 * Event Handlers for Analytics CQRS
 * Process business events and update analytics aggregations
 *
 * NOTE: Events are processed asynchronously with eventual consistency.
 * The actual analytics aggregations in dashboard/job/recruiter tables are
 * computed on-demand from the underlying business data via fallback queries.
 * This handler just marks key events for logging/monitoring purposes.
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

    // Events mark key business activities for monitoring
    // Actual analytics are computed on-demand from underlying data
    logger.debug({ job_id, title }, 'Analytics: job created event received');
  } catch (err: any) {
    logger.warn({ err: err.message, job_id: data?.job_id }, 'Failed to handle job-created event');
  }
}

/**
 * Handle swipe-completed events
 * Events mark key business activities for future event-driven features
 */
export async function handleSwiped(data: any): Promise<void> {
  try {
    const { job_id, candidate_id, recruiter_id, company_id, decision, match_score } = data;
    if (!job_id || !candidate_id || !company_id) return;

    // Event marker for monitoring and future features
    // Actual analytics aggregations are computed on-demand
    logger.debug({ job_id, candidate_id, decision }, 'Analytics: swipe event received');
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
    logger.debug({ job_id: data?.job_id }, 'Analytics: decision changed event received');
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

    // Event marker for monitoring
    logger.debug({ candidate_id, company_id }, 'Analytics: candidate updated event received');
  } catch (err: any) {
    logger.warn({ err: err.message, candidate_id: data?.candidate_id }, 'Failed to handle candidate-updated event');
  }
}
