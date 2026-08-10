/**
 * HTTP client for the monolith's /internal/matching-decision/* API. POST /swipes (Phase C) and
 * every Recruiter Review write - notes, decision-change, detailed-score (Phase D) - are real
 * cutovers now (write-cutover completion plan): each mirror function here is called AFTER this
 * service's own real write, mirroring the row into the monolith's own table and, for
 * swipe/decision-change, re-firing the same hook bundle db.recordSwipe always fired
 * (broadcastEvent, the BullMQ retrain queue, shadow proficiency logging, the mutual-match check,
 * and syncApplicationStatusFromRecruiterDecision - none portable to this service yet). Only
 * GET /recruiter-review (list) and GET /recruiter-review/:candidateId/:jobId (detail) still
 * proxy - a cross-database SQL JOIN that can no longer be expressed once its tables live in
 * separate databases (list), and computeMatchExplanation, still fully unextracted (detail).
 *
 * Every read function here is a thin pass-through: same shape in, same shape out as the target
 * endpoint - this module's only job is the network call and basic latency/outcome metrics.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount, monolithProxyDuration } from '../utils/metrics.js';
import type { SwipeRow, RecruiterNoteRow, DetailedScoringReportRow } from '../types.js';

const REQUEST_TIMEOUT_MS = 15000; // recruiter-review's detailed-score can call out to Gemini

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/matching-decision${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      throw new MonolithProxyError(res.status, body);
    }
    monolithProxyCount.inc({ target, outcome: 'success' });
    return body as T;
  } catch (error) {
    if (!(error instanceof MonolithProxyError)) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

// Awaited by the route handler, but never allowed to turn into a user-facing failure - this
// service's own write already succeeded by the time this is called. Mirrors dualWrite.ts's own
// safety bar in the opposite direction (same pattern as candidate-core-service's/job-service's
// own mirror-and-notify functions, write-cutover completion plan, Phases A/B).
//
// `source: 'decision-change'` (write-cutover completion Phase D) is set only by PATCH
// /recruiter-review/:id/decision - the monolith endpoint branches on it: the hook bundle
// db.recordSwipe itself always fires (mutual-match check, syncApplicationStatusFromRecruiterDecision)
// either way, but decision-change broadcasts 'recruiter-review-decision-changed' instead of
// 'swipe-completed' and does NOT enqueue a retrain (changeRecruiterReviewDecision on the monolith
// never called enqueueRetrain - only recordSwipeWithSideEffects, POST /swipes's own flow, did).
export async function mirrorAndNotifySwipe(row: SwipeRow, options: { source?: 'decision-change' } = {}): Promise<void> {
  try {
    await call('mirror-swipe', '/swipes/mirror-and-notify', { method: 'POST', body: JSON.stringify({ swipe: row, source: options.source }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, swipeId: row.id }, 'Failed to mirror new swipe into the monolith - its own copy, and every downstream effect (broadcast, retrain, mutual-match, application-status sync), will be stale/skipped for this row');
  }
}

// Write-cutover completion plan, Phase D - awaited but never fatal, same safety bar as
// mirrorAndNotifySwipe above. No hook bundle to re-fire for notes - the monolith's own
// upsertRecruiterNoteForSwipe never had any background side effects beyond the write itself.
export async function mirrorAndNotifyRecruiterNote(row: RecruiterNoteRow): Promise<void> {
  try {
    await call('mirror-recruiter-note', '/recruiter-review/notes/mirror-and-notify', { method: 'POST', body: JSON.stringify({ note: row }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, noteId: row.id }, 'Failed to mirror new recruiter note into the monolith - its own copy will be stale for this row');
  }
}

// Write-cutover completion plan, Phase D - same shape as mirrorAndNotifyRecruiterNote above; no
// hook bundle either (generateAndSaveDetailedScore never had background side effects, only the
// Gemini call itself, already made before this is called).
export async function mirrorAndNotifyDetailedScore(row: DetailedScoringReportRow): Promise<void> {
  try {
    await call('mirror-detailed-score', '/recruiter-review/detailed-score/mirror-and-notify', { method: 'POST', body: JSON.stringify({ report: row }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, reportId: row.id }, 'Failed to mirror new detailed scoring report into the monolith - its own copy will be stale for this row');
  }
}

export interface RecruiterReviewListFilters {
  page: number;
  pageSize: number;
  search?: string;
  jobId?: number;
  decision?: 'accepted' | 'rejected' | 'saved';
  recruiterId?: number;
  dateFrom?: string;
  dateTo?: string;
  minExperience?: number;
  maxExperience?: number;
  skills?: string;
  minScore?: number;
  maxScore?: number;
  sortBy?: string;
}

export function getRecruiterReviewList(companyId: number, filters: RecruiterReviewListFilters): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ companyId: String(companyId) });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return call('recruiter-review-list', `/recruiter-review?${params.toString()}`);
}

export function getRecruiterReviewDetail(candidateId: number, jobId: number, companyId: number): Promise<Record<string, unknown>> {
  return call('recruiter-review-detail', `/recruiter-review/${candidateId}/${jobId}?companyId=${companyId}`);
}

// Remaining-monolith migration, Item 3 - recruiter-review detail's explainability reads.
// These two methods are called by the ported explainability module to get the monolith's own
// locally-computed enrichment tables (career_trajectories and reasoning_conclusions), which are
// NOT shadow services and never will be - they're computed synchronously when a candidate is
// created/updated, and sit on the monolith to stay there. The ported module only uses them
// for narrative generation and concern detection (computeExplanation, narrativeGeneration,
// concernDetection), which are pure computation - no new writes, no state.
export async function getCareerTrajectory(candidateId: number): Promise<Record<string, unknown> | null> {
  try {
    const result = await call<{ trajectory: any }>('career-trajectory', `?candidateId=${candidateId}`);
    return result.trajectory || null;
  } catch (error) {
    logger.warn({ err: (error as Error).message, candidateId }, 'Failed to fetch career trajectory from monolith - explainability module will complete without it');
    return null;
  }
}

export async function getReasoningConclusions(subjectType: string, subjectId: number): Promise<Record<string, unknown> | null> {
  try {
    const result = await call<{ conclusions: any }>('reasoning-conclusions', `?subjectType=${subjectType}&subjectId=${subjectId}`);
    return result.conclusions || null;
  } catch (error) {
    logger.warn({ err: (error as Error).message, subjectType, subjectId }, 'Failed to fetch reasoning conclusions from monolith - explainability module will complete without it');
    return null;
  }
}
