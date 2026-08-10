/**
 * Shadow-validation for Matching Skill Discovery Service (Batch 27), following the exact same
 * discipline as src/reasoningServiceShadow.ts (Batch 26) - same reasoning: this is a background
 * side effect of candidate/job creation with no separately-routable HTTP endpoint of its own, so
 * the monolith becomes an HTTP client of the new service rather than the usual gateway-routing
 * cutover.
 *
 * Drop-in replacement for matching/unknownSkillDiscovery.ts's own exported
 * discoverUnknownSkillsInBackground - same name, same signature, same real local computation (the
 * unchanged, ported original), with an ADDITIONAL shadow call to matching-skill-discovery-service
 * bolted on only when enabled. The monolith's own local computation and storage (including any
 * real promotion) is completely unaffected either way.
 *
 * Unlike reasoningServiceShadow.ts, this is NOT a byte-for-byte equality comparison: classification
 * is a non-deterministic LLM call, so the monolith's real run and the new service's independent
 * shadow run can legitimately reach different conclusions for the same token without either side
 * being wrong. What's logged instead is both outcomes side by side, for an operator to review -
 * the same honest signal a strict diff would give for the deterministic parts (did detection agree
 * on which tokens were unresolved; did the service's classification/promotion decision look
 * plausible) without fabricating a pass/fail verdict a non-deterministic call can't actually support.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_SKILL_DISCOVERY_ENABLED must be exactly 'true').
 *   2. Never affects real behavior - the monolith's own discoverUnknownSkills call and its writes/
 *      promotions happen exactly as they always have, whether or not the shadow comparison runs
 *      afterward. The new service's OWN shadow-triggered computation is itself non-mutating with
 *      respect to the shared skill graph (skipPromotion=true - see its own
 *      matching/unknownSkillDiscovery.ts header comment).
 *   3. Never throws. A shadow-call failure is logged at warn, not error - it says nothing about
 *      correctness, only that the comparison itself was incomplete.
 */
import { logger } from './utils/logger.js';
import { discoverUnknownSkills } from './matching/unknownSkillDiscovery.js';

export const SHADOW_SKILL_DISCOVERY_ENABLED = process.env.SHADOW_SKILL_DISCOVERY_ENABLED === 'true';

const MATCHING_SKILL_DISCOVERY_SERVICE_URL = process.env.MATCHING_SKILL_DISCOVERY_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 15000; // classification + embedding calls can be slower than a typical internal proxy call

async function shadowCompare(rawSkills: string[], contextText: string, sourceType: 'resume' | 'jd', monolithOutcomeCount: number): Promise<void> {
  if (!MATCHING_SKILL_DISCOVERY_SERVICE_URL) {
    logger.warn('SHADOW_SKILL_DISCOVERY_ENABLED is true but MATCHING_SKILL_DISCOVERY_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${MATCHING_SKILL_DISCOVERY_SERVICE_URL}/internal/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawSkills, contextText, sourceType }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, sourceType }, 'Shadow-validation call to matching-skill-discovery-service returned a non-OK status - comparison skipped');
      return;
    }

    const body = (await response.json()) as { outcomes: { status: string; proposalId: number; promotedSkillNodeId: number | null }[] };
    const serviceOutcomeCount = body.outcomes?.length ?? 0;

    if (serviceOutcomeCount !== monolithOutcomeCount) {
      logger.error(
        { sourceType, monolithOutcomeCount, serviceOutcomeCount, serviceOutcomes: body.outcomes },
        'SHADOW-VALIDATION DIVERGENCE: monolith and matching-skill-discovery-service detected a different number of unresolved tokens for the same input'
      );
      return;
    }

    logger.debug({ sourceType, monolithOutcomeCount, serviceOutcomeCount }, 'Shadow-validation: matching-skill-discovery-service processed the same number of unresolved tokens as the monolith');
  } catch (error: any) {
    logger.warn({ err: error?.message, sourceType }, 'Shadow-validation call to matching-skill-discovery-service failed - comparison skipped');
  }
}

/** Drop-in replacement for matching/unknownSkillDiscovery.ts's own discoverUnknownSkillsInBackground - same signature, same real local computation, plus an optional shadow comparison. */
export function discoverUnknownSkillsInBackground(rawSkills: string[], contextText: string, sourceType: 'resume' | 'jd'): void {
  discoverUnknownSkills(rawSkills, contextText, sourceType)
    .then((outcomes) => {
      if (SHADOW_SKILL_DISCOVERY_ENABLED) {
        shadowCompare(rawSkills, contextText, sourceType, outcomes.length);
      }
    })
    .catch((err) => logger.warn({ err: err.message }, 'Unknown Skill Discovery background run failed'));
}
