// Enterprise AI Matching Architecture, §2.4 Career Intelligence Platform - Module 6: Main
// Pipeline.
//
// Orchestrates Modules 1-5 into one computed, stored CareerTrajectory row per candidate. Same
// fire-and-forget-after-creation background pattern already used by embeddingIndex.ts,
// unknownSkillDiscovery.ts, and projectIntelligence.ts - never blocks or fails the request that
// triggered it. Upsert-on-conflict (candidates.id is UNIQUE on career_trajectories) means calling
// this again after a work_history update simply recomputes and overwrites, with no separate
// "update" code path needed.
//
// SCOPE BOUNDARY, SAME AS §2.1 SKILL PROFICIENCY: this phase computes and stores real,
// queryable career intelligence. It does NOT wire any of it into live Dynamic Weighting (§3) or
// any other scoring path - that would be a live-behavior change to already-production (if
// currently opt-in) matching, which this phase is not authorized to make unprompted. Querying
// career_trajectories directly (getCareerTrajectory, queryCareerTrajectoriesByProgressionType,
// querySimilarTrajectories below) is available today; using it to influence a match SCORE is
// deliberately left for a future, explicit integration phase.

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
  if (jobs.length === 0) return null; // nothing to analyze - never fabricate a trajectory from no data

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
// trajectories (pgvector remains uninstalled; same bounded-in-memory pattern already used by
// src/matching/retrieval.ts's InMemoryCosineVectorSearchProvider). Bounded to one company as a
// natural, cheap scope limit - cross-company trajectory comparison isn't a real product need.
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
