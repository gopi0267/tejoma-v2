/**
 * Matching Scoring Service - ported scoring core (Batch 39/full-migration continuation).
 *
 * Ports the pure-computation slice of the monolith's src/matching/services.ts:
 * computeMatchFeatures, computeBertCosineScore, buildFeatureVector, computeFeatureScore,
 * calculateMatchScoresBatch, calculateMatchScoresForJobsBatch. Deliberately NOT ported:
 *   - Gemini summary generation (generateGeminiSummary/buildFallbackSummary) - `summary` is never
 *     a scoring-correctness signal the shadow comparison cares about, and calling Gemini twice per
 *     real request would double live API cost/quota for zero benefit. Callers here always get
 *     summary: ''.
 *   - calculateDynamicMatchScoresBatch - the monolith's own module doc states this path is "NOT
 *     called by any existing surface by default" (opt-in only, zero live traffic) and it needs
 *     role_profiles + skill_nodes/skill_edges graph reads (dynamicWeighting.ts) that would require
 *     this service to either own or reach into three other services' data. Out of scope until that
 *     path has a real caller.
 *   - trainModelOnStartup - a batch job, not the scoring hot path; training stays in the monolith
 *     for now (reads db.getAllSwipesUnscoped/getAllCandidatesUnscoped/getAllJobsUnscoped directly).
 *
 * ONE real deviation from the monolith's copy: activeModelType is a MODULE-LEVEL mutable `let` in
 * the original (safe there because it's set by an explicit admin action, not per-request). Here,
 * every call is a shadow-comparison request from the monolith that must reproduce the EXACT model
 * type the monolith used for that specific request, and concurrent requests could otherwise race
 * on a shared mutable binding. So modelType is threaded through as an explicit parameter instead -
 * the only shape change from the original; every formula, threshold, and code path below is
 * otherwise identical.
 */
import type { Candidate, Job, MatchBreakdown } from '../types.js';

import { jaccardSimilarity } from '../algorithms/jaccard.js';
import { cosineSimilarity as textCosineSimilarity } from '../algorithms/cosine.js';
import { euclideanDistance } from '../algorithms/euclidean.js';
import { levenshteinSimilarity } from '../algorithms/levenshtein.js';
import { predictBatch, getEnsembleHealth, EnsemblePrediction } from '../algorithms/ml-models.js';
import { cosineSimilarity as vectorCosineSimilarity } from '../utils/embeddings.js';
import { computeLocationDistance } from './similarity/locationDistance.js';
import { parseExperienceYears, resolveCandidateSalaryExpectation } from './parseCandidateFields.js';
import { loadMlState, updateMlState, type ActiveModelType as DbActiveModelType } from '../db.js';

export type ActiveModelType = 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted';

// Item 3: ML admin state (final monolith migration item).
// These are now persisted to matching-scoring-service's own database and restored on startup.
export let activeModelType: ActiveModelType = 'random_forest';
export let isRetrainingInProgress = false;
export let lastTrainingTimestamp = new Date().toISOString();

export async function initializeMlState(): Promise<void> {
  try {
    const state = await loadMlState();
    if (state) {
      activeModelType = state.active_model_type as ActiveModelType;
      isRetrainingInProgress = state.is_retraining_in_progress;
      lastTrainingTimestamp = state.last_training_timestamp;
    }
  } catch (err) {
    console.warn('Failed to initialize ml_state from database, using defaults', err);
  }
}

export async function setActiveModelType(newType: ActiveModelType): Promise<void> {
  activeModelType = newType;
  await updateMlState({ active_model_type: newType as DbActiveModelType });
}

export async function setRetrainingStatus(status: boolean): Promise<void> {
  isRetrainingInProgress = status;
  await updateMlState({ is_retraining_in_progress: status });
}

export async function updateLastTrainingTimestamp(): Promise<void> {
  const now = new Date().toISOString();
  lastTrainingTimestamp = now;
  await updateMlState({ last_training_timestamp: now });
}

// Identical schedule to the monolith's getMlBlendWeight - see that file's comment for the
// conservative-thresholds rationale (agreed with the user given low real swipe volume).
function getMlBlendWeight(trainedSampleCount: number): number {
  if (trainedSampleCount < 30) return 0.15;
  if (trainedSampleCount < 150) return 0.5;
  return 0.85;
}

// ==================== DETERMINISTIC FEATURE COMPUTATION (sync, fast, no network) ====================

export interface MatchFeatures {
  jaccardSkillScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  cosineTextScore: number;
  euclideanFeatureScore: number;
  levenshteinTitleScore: number;
  candidateExp: number;
  jobExp: number;
  expScore: number;
  locDist: number;
  locScore: number;
  candidateCity: string | null;
  jobCity: string | null;
  candidateSalary: number | null;
  jobSalMin: number;
  jobSalMax: number;
  salScore: number;
}

export function computeMatchFeatures(job: Job, candidate: Candidate): MatchFeatures {
  const candidateSkills = Array.isArray(candidate?.skills) ? candidate.skills : [];
  const jobSkills = Array.isArray(job?.required_skills) ? job.required_skills : [];

  const jaccardSkillScore = jaccardSimilarity(candidateSkills, jobSkills);
  const matchedSkills = candidateSkills.filter((s) => s && jobSkills.some((rs) => rs && rs.toLowerCase().trim() === s.toLowerCase().trim()));
  const missingSkills = jobSkills.filter((rs) => rs && !candidateSkills.some((s) => s && s.toLowerCase().trim() === rs.toLowerCase().trim()));

  const cosineTextScore = textCosineSimilarity(candidate?.resume_text || '', job?.description || '');

  const candidateExp = parseExperienceYears(candidate?.years_of_experience);
  const jobExp = typeof job?.experience_years === 'number' ? job.experience_years : 0;
  const expScore = candidateExp >= jobExp ? 100 : (jobExp > 0 ? (candidateExp / jobExp) * 100 : 100);

  const locResult = computeLocationDistance(candidate?.current_location, job?.location);
  const locScore = locResult.isRemoteMatch ? 100 : Math.max(0, 100 - locResult.distanceKm * 0.05);

  const candidateSalary = resolveCandidateSalaryExpectation(candidate);
  const jobSalMin = typeof job?.salary_min === 'number' ? job.salary_min : 0;
  const jobSalMax = typeof job?.salary_max === 'number' ? job.salary_max : 0;

  let salScore = 100;
  if (candidateSalary !== null && (jobSalMin > 0 || jobSalMax > 0)) {
    if (candidateSalary >= jobSalMin && candidateSalary <= jobSalMax) {
      salScore = 100;
    } else if (candidateSalary < jobSalMin) {
      salScore = Math.max(0, 100 - ((jobSalMin - candidateSalary) / 100000) * 30);
    } else {
      salScore = Math.max(0, 100 - ((candidateSalary - jobSalMax) / 100000) * 50);
    }
  }

  const euclideanFeatureScore = euclideanDistance(
    [candidateExp * 10000, candidateSalary ?? jobSalMax],
    [jobExp * 10000, jobSalMin > 0 && jobSalMax > 0 ? (jobSalMin + jobSalMax) / 2 : (candidateSalary ?? jobSalMax)]
  );

  const levenshteinTitleScore = levenshteinSimilarity(candidate?.current_job_title || '', job?.title || '');

  return {
    jaccardSkillScore, matchedSkills, missingSkills, cosineTextScore, euclideanFeatureScore, levenshteinTitleScore,
    candidateExp, jobExp, expScore,
    locDist: locResult.distanceKm, locScore, candidateCity: locResult.candidateCity, jobCity: locResult.jobCity,
    candidateSalary, jobSalMin, jobSalMax, salScore,
  };
}

function computeBertCosineScore(candidate: Candidate, job: Job): number | null {
  if (!candidate.resume_embedding?.length || !job.description_embedding?.length) return null;
  const sim = vectorCosineSimilarity(candidate.resume_embedding, job.description_embedding);
  return Math.max(0, Math.min(100, Math.round(sim * 100)));
}

// Order MUST match FEATURE_NAMES in python-services/matching-ml-service/ensemble.py exactly -
// identical requirement to the monolith's own copy.
function buildFeatureVector(features: MatchFeatures, cosineBertScore: number | null): number[] {
  return [
    features.jaccardSkillScore / 100,
    features.cosineTextScore / 100,
    (cosineBertScore ?? features.cosineTextScore) / 100,
    features.euclideanFeatureScore / 100,
    features.expScore / 100,
    features.locScore / 100,
    features.salScore / 100,
    features.levenshteinTitleScore / 100,
  ];
}

export function computeFeatureScore(f: MatchFeatures): number {
  return Math.round(f.jaccardSkillScore * 0.40 + f.expScore * 0.35 + f.locScore * 0.15 + f.salScore * 0.10);
}

// ==================== BATCHED SCORING (the real entry point) ====================

export interface MatchScoreResult {
  feature_score: number;
  embedding_score: number;
  ml_score: number;
  final_score: number;
  breakdown: MatchBreakdown;
  summary: string;
  feature_vector?: number[];
}

export async function calculateMatchScoresBatch(job: Job, candidates: Candidate[], modelType: ActiveModelType): Promise<MatchScoreResult[]> {
  if (candidates.length === 0) return [];

  const allFeatures = candidates.map((c) => computeMatchFeatures(job, c));
  const bertScores = candidates.map((c) => computeBertCosineScore(c, job));
  const featureVectors = allFeatures.map((f, i) => buildFeatureVector(f, bertScores[i]));
  const featureScores = allFeatures.map(computeFeatureScore);

  let ensemblePredictions: EnsemblePrediction[] | null = null;
  let trainedSampleCount = 0;

  if (modelType !== 'heuristic') {
    const health = await getEnsembleHealth();
    if (health?.ensembleTrained) {
      trainedSampleCount = health.trainedSampleCount;
      ensemblePredictions = await predictBatch(featureVectors);
    }
  }

  const blendWeight = getMlBlendWeight(trainedSampleCount);

  const results: MatchScoreResult[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const f = allFeatures[i];
    const featureScore = featureScores[i];
    const bertScore = bertScores[i];
    const pred = ensemblePredictions?.[i] ?? null;

    const mlScore = pred ? Math.round(pred.ensemble * 100) : featureScore;
    const effectiveBlend = pred && modelType !== 'heuristic' ? blendWeight : 0;
    const final_score = Math.round(featureScore * (1 - effectiveBlend) + mlScore * effectiveBlend);
    const embedding_score = Math.round(bertScore ?? f.cosineTextScore);

    const breakdown: MatchBreakdown = {
      skills: { score: Math.round(f.jaccardSkillScore), matched: f.matchedSkills, missing: f.missingSkills },
      experience: { score: Math.round(f.expScore), candidate: f.candidateExp, required: f.jobExp },
      location: {
        score: Math.round(f.locScore),
        candidate: f.candidateCity || candidates[i]?.current_location || 'Unknown',
        required: f.jobCity || job?.location || 'Remote',
        distance: Math.round(f.locDist),
      },
      salary: { score: Math.round(f.salScore), expectation: f.candidateSalary ?? 0, min: f.jobSalMin, max: f.jobSalMax },
      similarity: {
        jaccardSkills: Math.round(f.jaccardSkillScore),
        cosineText: Math.round(f.cosineTextScore),
        cosineBert: bertScore,
        euclideanFeatures: Math.round(f.euclideanFeatureScore),
        levenshteinTitle: Math.round(f.levenshteinTitleScore),
      },
      ensemble: pred
        ? { randomForest: Math.round(pred.randomForest * 100), xgboost: Math.round(pred.xgboost * 100), lightgbm: Math.round(pred.lightgbm * 100), blendWeight: effectiveBlend, trainedSampleCount }
        : null,
    };

    results.push({ feature_score: featureScore, embedding_score, ml_score: mlScore, final_score, breakdown, summary: '', feature_vector: featureVectors[i] });
  }

  return results;
}

export async function calculateMatchScoresForJobsBatch(candidate: Candidate, jobs: Job[], modelType: ActiveModelType): Promise<MatchScoreResult[]> {
  if (jobs.length === 0) return [];

  const allFeatures = jobs.map((job) => computeMatchFeatures(job, candidate));
  const bertScores = jobs.map((job) => computeBertCosineScore(candidate, job));
  const featureVectors = allFeatures.map((f, i) => buildFeatureVector(f, bertScores[i]));
  const featureScores = allFeatures.map(computeFeatureScore);

  let ensemblePredictions: EnsemblePrediction[] | null = null;
  let trainedSampleCount = 0;

  if (modelType !== 'heuristic') {
    const health = await getEnsembleHealth();
    if (health?.ensembleTrained) {
      trainedSampleCount = health.trainedSampleCount;
      ensemblePredictions = await predictBatch(featureVectors);
    }
  }

  const blendWeight = getMlBlendWeight(trainedSampleCount);

  const results: MatchScoreResult[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const f = allFeatures[i];
    const featureScore = featureScores[i];
    const bertScore = bertScores[i];
    const pred = ensemblePredictions?.[i] ?? null;

    const mlScore = pred ? Math.round(pred.ensemble * 100) : featureScore;
    const effectiveBlend = pred && modelType !== 'heuristic' ? blendWeight : 0;
    const final_score = Math.round(featureScore * (1 - effectiveBlend) + mlScore * effectiveBlend);
    const embedding_score = Math.round(bertScore ?? f.cosineTextScore);

    const breakdown: MatchBreakdown = {
      skills: { score: Math.round(f.jaccardSkillScore), matched: f.matchedSkills, missing: f.missingSkills },
      experience: { score: Math.round(f.expScore), candidate: f.candidateExp, required: f.jobExp },
      location: {
        score: Math.round(f.locScore),
        candidate: f.candidateCity || candidate?.current_location || 'Unknown',
        required: f.jobCity || job?.location || 'Remote',
        distance: Math.round(f.locDist),
      },
      salary: { score: Math.round(f.salScore), expectation: f.candidateSalary ?? 0, min: f.jobSalMin, max: f.jobSalMax },
      similarity: {
        jaccardSkills: Math.round(f.jaccardSkillScore),
        cosineText: Math.round(f.cosineTextScore),
        cosineBert: bertScore,
        euclideanFeatures: Math.round(f.euclideanFeatureScore),
        levenshteinTitle: Math.round(f.levenshteinTitleScore),
      },
      ensemble: pred
        ? { randomForest: Math.round(pred.randomForest * 100), xgboost: Math.round(pred.xgboost * 100), lightgbm: Math.round(pred.lightgbm * 100), blendWeight: effectiveBlend, trainedSampleCount }
        : null,
    };

    results.push({ feature_score: featureScore, embedding_score, ml_score: mlScore, final_score, breakdown, summary: '', feature_vector: featureVectors[i] });
  }

  return results;
}

