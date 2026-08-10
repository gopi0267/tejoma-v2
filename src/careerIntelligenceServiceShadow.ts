/**
 * Shadow-validation for Career Intelligence Service (Batch 30), same discipline as
 * src/reasoningServiceShadow.ts (Batch 26) / src/skillDiscoveryServiceShadow.ts (Batch 27).
 * computeCareerTrajectoryInBackground already runs in the background (fire-and-forget from
 * candidate.routes.ts) - no user-facing response to piggyback a shadow call onto. This module is a
 * drop-in replacement for it - same name, same signature, same real local computation (the
 * unchanged, ported original in matching/careerIntelligence/computeCareerTrajectory.ts), with an
 * ADDITIONAL shadow comparison against career-intelligence-service bolted on only when enabled.
 * The monolith's own local computation and storage is completely unaffected either way.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_CAREER_INTELLIGENCE_ENABLED must be exactly 'true').
 *   2. Never affects real behavior - the monolith's own computeCareerTrajectory call and its
 *      db.upsertCareerTrajectory write happen exactly as they always have, whether or not the
 *      shadow comparison runs afterward.
 *   3. Never throws. A shadow-call failure is logged at warn, not error - it says nothing about
 *      correctness, only that the comparison itself was incomplete.
 */
import { logger } from './utils/logger.js';
import { computeCareerTrajectory } from './matching/careerIntelligence/computeCareerTrajectory.js';
import type { CareerTrajectory, WorkHistoryEntry } from './types.js';

export const SHADOW_CAREER_INTELLIGENCE_ENABLED = process.env.SHADOW_CAREER_INTELLIGENCE_ENABLED === 'true';

const CAREER_INTELLIGENCE_SERVICE_URL = process.env.CAREER_INTELLIGENCE_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 10000;

// id/candidate_id/company_id/created_at/updated_at legitimately differ between the two databases
// (different auto-increment ids, different insert timestamps) - only these content fields are a
// real correctness signal.
const COMPARABLE_FIELDS = [
  'job_sequence', 'total_career_months', 'role_count', 'progression_type', 'seniority_level',
  'seniority_trend', 'transitions', 'avg_tenure_months', 'median_tenure_months', 'tenure_pattern',
  'gaps', 'domain_concentration', 'domains', 'trajectory_embedding', 'predicted_next_roles',
] as const;

function canonicalize(trajectory: Record<string, unknown> | null): string {
  if (!trajectory) return 'null';
  return JSON.stringify(COMPARABLE_FIELDS.map((f) => trajectory[f]));
}

async function shadowCompare(
  candidateId: number,
  companyId: number,
  workHistory: WorkHistoryEntry[] | null | undefined,
  monolithTrajectory: CareerTrajectory | null
): Promise<void> {
  if (!CAREER_INTELLIGENCE_SERVICE_URL) {
    logger.warn('SHADOW_CAREER_INTELLIGENCE_ENABLED is true but CAREER_INTELLIGENCE_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${CAREER_INTELLIGENCE_SERVICE_URL}/internal/compute-for-candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, companyId, workHistory }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, candidateId }, 'Shadow-validation call to career-intelligence-service returned a non-OK status - comparison skipped');
      return;
    }

    const responseBody = (await response.json()) as { trajectory: CareerTrajectory | null };
    const monolithCanonical = canonicalize(monolithTrajectory as unknown as Record<string, unknown> | null);
    const serviceCanonical = canonicalize(responseBody.trajectory as unknown as Record<string, unknown> | null);

    if (monolithCanonical !== serviceCanonical) {
      logger.error(
        { candidateId, monolith: monolithCanonical, careerIntelligenceService: serviceCanonical },
        'SHADOW-VALIDATION DIVERGENCE: monolith and career-intelligence-service computed different career trajectories'
      );
      return;
    }

    logger.debug({ candidateId }, 'Shadow-validation agreement: career-intelligence-service matched the monolith for this candidate');
  } catch (error: any) {
    logger.warn({ err: error?.message, candidateId }, 'Shadow-validation call to career-intelligence-service failed - comparison skipped');
  }
}

/** Drop-in replacement for matching/careerIntelligence/computeCareerTrajectory.ts's own computeCareerTrajectoryInBackground - same signature, same real local computation, plus an optional shadow comparison. */
export function computeCareerTrajectoryInBackground(
  candidateId: number,
  companyId: number,
  workHistory: WorkHistoryEntry[] | null | undefined
): void {
  computeCareerTrajectory(candidateId, companyId, workHistory)
    .then((trajectory) => {
      if (SHADOW_CAREER_INTELLIGENCE_ENABLED) {
        shadowCompare(candidateId, companyId, workHistory, trajectory);
      }
    })
    .catch((err) => logger.warn({ err: err.message, candidateId }, 'Career trajectory computation failed'));
}
