/**
 * HTTP client for matching-decision-service's existing GET /internal/swipes endpoint.
 *
 * Replaces monolithClient.getSwipesForEvaluation, which proxied to the monolith on the premise
 * that "swipes remain monolith-owned" (evaluation.ts's header comment). That premise is obsolete:
 * Step 6 moved the swipes table to matching-decision-service, which already exposes the
 * company-scoped read at GET /internal/swipes?companyId=. No new endpoint was added and no swipe
 * data is duplicated into this service.
 *
 * `action IS NOT NULL` filtering is applied here rather than upstream so the shared
 * /internal/swipes endpoint keeps its existing contract for its other callers; evaluateFromSwipes
 * already skips rows without a numeric match_score, so this only drops rows it would discard.
 */
import { MATCHING_DECISION_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 15000;

export async function getSwipesForEvaluation(companyId: number): Promise<{ swipes: any[] }> {
  try {
    const res = await fetch(
      `${MATCHING_DECISION_SERVICE_URL}/internal/swipes?companyId=${companyId}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      logger.warn({ status: res.status }, 'matching-decision-service returned non-ok status for swipes');
      return { swipes: [] };
    }
    const body: any = await res.json().catch(() => ({}));
    const swipes = ((body.swipes ?? []) as any[]).filter((s) => s?.action !== null && s?.action !== undefined);
    return { swipes };
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Failed to fetch swipes from matching-decision-service');
    return { swipes: [] };
  }
}
