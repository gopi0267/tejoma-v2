// Ported from the monolith's src/matching/careerIntelligence/computeCareerTrajectory.ts -
// byte-identical logic. Orchestrates Modules 1-5 into one computed, stored CareerTrajectory row
// per candidate, written directly to this service's own career_trajectories table (owned, not a
// mirror - see db.ts's header comment).

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { cosineSimilarity } from '../../utils/embeddings.js';
import { normalizeJobSequence } from './jobSequence.js';
import { analyzeProgression } from './progression.js';
import { analyzeStability } from './stability.js';
import { computeTrajectoryEmbedding } from './trajectoryEmbedding.js';
import { predictNextRoles } from './futureRolePrediction.js';
import type { CareerTrajectory, WorkHistoryEntry } from '../../types.js';

export async function computeCareerTrajectory(
  candidateId: number,
  companyId: number,
  workHistory: WorkHistoryEntry[] | null | undefined,
  asOf: Date = new Date()
): Promise<CareerTrajectory | null> {
  const jobs = await normalizeJobSequence(workHistory, asOf);
  if (jobs.length === 0) return null;

  const progression = analyzeProgression(jobs);
  const stability = analyzeStability(jobs, asOf);
  const trajectoryEmbedding = computeTrajectoryEmbedding(jobs);
  const predictedNextRoles = await predictNextRoles(jobs, progression);

  const totalCareerMonths = jobs.reduce((sum, j) => sum + (j.durationMonths ?? 0), 0);

  return db.upsertCareerTrajectory({
    candidate_id: candidateId,
    company_id: companyId,
    job_sequence: jobs,
    total_career_months: totalCareerMonths,
    role_count: jobs.length,
    progression_type: progression.progressionType,
    seniority_level: progression.seniorityLevel,
    seniority_trend: progression.seniorityTrend,
    transitions: progression.transitions,
    avg_tenure_months: stability.avgTenureMonths,
    median_tenure_months: stability.medianTenureMonths,
    tenure_pattern: stability.tenurePattern,
    gaps: stability.gaps,
    domain_concentration: stability.domainConcentration,
    domains: stability.domains,
    trajectory_embedding: trajectoryEmbedding,
    predicted_next_roles: predictedNextRoles,
  });
}

export function computeCareerTrajectoryInBackground(
  candidateId: number,
  companyId: number,
  workHistory: WorkHistoryEntry[] | null | undefined
): void {
  computeCareerTrajectory(candidateId, companyId, workHistory).catch((err) =>
    logger.warn({ err: err.message, candidateId }, 'Career trajectory computation failed')
  );
}

// Nearest-neighbor career-path comparison - in-memory cosine similarity over one company's
// trajectories (pgvector remains uninstalled).
export async function querySimilarTrajectories(
  candidateId: number,
  companyId: number,
  limit: number = 5
): Promise<Array<{ trajectory: CareerTrajectory; similarity: number }>> {
  const target = await db.getCareerTrajectory(candidateId, companyId);
  if (!target || !target.trajectory_embedding) return [];

  const all = await db.getAllCareerTrajectoriesForCompany(companyId);
  return all
    .filter((t) => t.candidate_id !== candidateId && t.trajectory_embedding)
    .map((t) => ({ trajectory: t, similarity: cosineSimilarity(target.trajectory_embedding!, t.trajectory_embedding!) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
