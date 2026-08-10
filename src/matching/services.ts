import { GoogleGenAI } from '@google/genai';
import { db } from '../db.js';
import { Candidate, Job, MatchBreakdown } from '../types.js';
import { logger } from '../utils/logger.js';

import { jaccardSimilarity } from '../algorithms/jaccard.js';
import { cosineSimilarity as textCosineSimilarity } from '../algorithms/cosine.js';
import { euclideanDistance } from '../algorithms/euclidean.js';
import { levenshteinSimilarity } from '../algorithms/levenshtein.js';
import { predictBatch, trainEnsemble, getEnsembleHealth, TrainSample, EnsemblePrediction } from '../algorithms/ml-models.js';
import { cosineSimilarity as vectorCosineSimilarity } from '../utils/embeddings.js';
import { computeLocationDistance } from './similarity/locationDistance.js';
import { parseExperienceYears, resolveCandidateSalaryExpectation } from './parseCandidateFields.js';
import { resolveSkillTiers, computeSeniorityAdjustedWeights, computeDynamicSkillScore } from './dynamicWeighting.js';
import { buildMatchExplanation } from './explainability.js';
import type { ConfidenceProfile } from './confidenceService.js';
import { resolveTrainingSamples } from './feedbackSignals.js';
import { shadowCompareCandidatesBatch, shadowCompareJobsBatch } from '../matchingScoringServiceShadow.js';

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not defined. Using local matching heuristics.');
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

export let isModelTrained = false;
export let activeModelType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted' = 'random_forest';
export let isRetrainingInProgress = false;
export let lastTrainingTimestamp = new Date().toISOString();

// Microservices Migration, Batch 23 (Matching Service extraction prep) - activeModelType now
// persists to matching_model_config (db.ts) so its value survives a process restart and is
// readable by any process, not just this one - the same in-memory-only problem already fixed for
// ml.routes.ts's other state (isRetrainingInProgress/lastTrainingTimestamp remain process-local
// operational status, not scoring-affecting config, so they're left as-is). The exported
// `activeModelType` binding above stays the single thing every hot-path read in this file (and
// matchingApi.ts) uses directly - zero added latency on the scoring path itself. This only
// changes what happens on module load (load the persisted value once, fire-and-forget - a
// negligible startup race against the very first request, resolving to the same 'random_forest'
// default that was ALWAYS used before this batch) and on an explicit change (setActiveModelType
// now also persists, not just mutates the binding).
async function loadActiveModelTypeFromDb(): Promise<void> {
  try {
    activeModelType = await db.getMatchingModelConfig();
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to load persisted active model type - keeping in-memory default');
  }
}
void loadActiveModelTypeFromDb();

// Confidence-blending schedule: with very little swipe history, a "trained" ensemble is really
// just overfit to a handful of examples, so the heuristic (deterministic, explainable) score
// should dominate. As real swipe volume accumulates, trust shifts toward the trained ensemble.
// Thresholds and weights are deliberately conservative - agreed with the user given this
// database currently has under 20 swipes total.
function getMlBlendWeight(trainedSampleCount: number): number {
  if (trainedSampleCount < 30) return 0.15;
  if (trainedSampleCount < 150) return 0.5;
  return 0.85;
}

// ==================== DETERMINISTIC FEATURE COMPUTATION (sync, fast, no network) ====================

export interface MatchFeatures {
  jaccardSkillScore: number; // 0-100
  matchedSkills: string[];
  missingSkills: string[];
  cosineTextScore: number; // 0-100, bag-of-words resume-vs-description similarity
  euclideanFeatureScore: number; // 0-100
  levenshteinTitleScore: number; // 0-100
  candidateExp: number;
  jobExp: number;
  expScore: number; // 0-100
  locDist: number; // km, real Haversine distance (was: a 4-city hardcoded lookup table)
  locScore: number; // 0-100
  candidateCity: string | null;
  jobCity: string | null;
  candidateSalary: number | null; // parsed from expected_ctc/current_ctc (was: a phantom `salary_expectation` field that never existed)
  jobSalMin: number;
  jobSalMax: number;
  salScore: number; // 0-100
}

export function computeMatchFeatures(job: Job, candidate: Candidate): MatchFeatures {
  const candidateSkills = Array.isArray(candidate?.skills) ? candidate.skills : [];
  const jobSkills = Array.isArray(job?.required_skills) ? job.required_skills : [];

  const jaccardSkillScore = jaccardSimilarity(candidateSkills, jobSkills);
  const matchedSkills = candidateSkills.filter((s) => s && jobSkills.some((rs) => rs && rs.toLowerCase().trim() === s.toLowerCase().trim()));
  const missingSkills = jobSkills.filter((rs) => rs && !candidateSkills.some((s) => s && s.toLowerCase().trim() === rs.toLowerCase().trim()));

  const cosineTextScore = textCosineSimilarity(candidate?.resume_text || '', job?.description || '');

  // Fix #1: years_of_experience is free text ("6+ years", "5-8 years"), not a number - the old
  // `typeof candidate.years_of_experience === 'number'` check silently always failed.
  const candidateExp = parseExperienceYears(candidate?.years_of_experience);
  const jobExp = typeof job?.experience_years === 'number' ? job.experience_years : 0;
  const expScore = candidateExp >= jobExp ? 100 : (jobExp > 0 ? (candidateExp / jobExp) * 100 : 100);

  // Fix #2: replaced the 4-city (Austin/SF/NYC/Chicago) hardcoded distance matrix with real
  // Haversine great-circle distance over a much broader city table, with string normalization
  // for messy stored locations (see src/matching/similarity/locationDistance.ts).
  const locResult = computeLocationDistance(candidate?.current_location, job?.location);
  const locScore = locResult.isRemoteMatch ? 100 : Math.max(0, 100 - locResult.distanceKm * 0.05);

  // Fix #3: there is no `salary_expectation` field on Candidate - it never existed, so the old
  // code always fell back to a hardcoded default of 100000. Parses the real expected_ctc/
  // current_ctc free-text fields instead (reuses the JD parser's tested salary regex).
  const candidateSalary = resolveCandidateSalaryExpectation(candidate);
  const jobSalMin = typeof job?.salary_min === 'number' ? job.salary_min : 0;
  const jobSalMax = typeof job?.salary_max === 'number' ? job.salary_max : 0;

  let salScore = 100; // neutral (not penalized) when we genuinely don't know the candidate's expectation
  if (candidateSalary !== null && (jobSalMin > 0 || jobSalMax > 0)) {
    if (candidateSalary >= jobSalMin && candidateSalary <= jobSalMax) {
      salScore = 100;
    } else if (candidateSalary < jobSalMin) {
      salScore = Math.max(0, 100 - ((jobSalMin - candidateSalary) / 100000) * 30);
    } else {
      salScore = Math.max(0, 100 - ((candidateSalary - jobSalMax) / 100000) * 50);
    }
  }

  // Experience scaled up ~10000x so a multi-year gap and a moderate salary gap contribute
  // comparably to the combined distance (euclideanDistance's decay constant is tuned for
  // salary-scale numbers - see src/algorithms/euclidean.ts).
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

// Order MUST match FEATURE_NAMES in python-services/matching-ml-service/ensemble.py exactly.
function buildFeatureVector(features: MatchFeatures, cosineBertScore: number | null): number[] {
  return [
    features.jaccardSkillScore / 100,
    features.cosineTextScore / 100,
    (cosineBertScore ?? features.cosineTextScore) / 100, // fall back to text cosine, not a magic sentinel, when no BERT embedding is stored yet
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

// ==================== GEMINI SUMMARY (unchanged behavior, extracted for reuse) ====================

async function generateGeminiSummary(job: Job, candidate: Candidate): Promise<string> {
  const ai = getGeminiClient();
  if (!ai) return '';
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Analyze the fit between this Job and Candidate. Job Title: ${job?.title || 'Job Opening'}. Job Description: ${job?.description || ''}. Required Skills: ${(job?.required_skills || []).join(', ')}. Candidate Name: ${candidate?.name || 'Applicant'}. Candidate Job Title: ${candidate?.current_job_title || ''}. Candidate Experience: ${candidate?.years_of_experience || 0}. Candidate Skills: ${(candidate?.skills || []).join(', ')}. Generate a concise ONE-SENTENCE recruiter summary explaining the match fit.`,
      config: { temperature: 0.3 },
    });
    return response.text ? response.text.trim() : '';
  } catch (e: any) {
    console.error('Gemini API error, using fallback summary');
    return '';
  }
}

function buildFallbackSummary(candidate: Candidate, f: MatchFeatures): string {
  const matchedStr = f.matchedSkills.length > 0 ? `strong overlap in ${f.matchedSkills.slice(0, 3).join(', ')}` : 'moderate background overlap';
  const locationStr = f.locDist === 0 ? 'perfectly local' : `located in ${candidate?.current_location || 'Remote'} (${Math.round(f.locDist)}km away)`;
  return `Excellent alignment based on ${(candidate?.name || 'candidate')}'s ${(candidate?.years_of_experience || 'unspecified')} experience and ${matchedStr}. Candidate is ${locationStr} with salary expectations matching our parameters.`;
}

// ==================== BATCHED SCORING (the real entry point) ====================

export interface MatchScoreResult {
  feature_score: number;
  embedding_score: number;
  ml_score: number;
  final_score: number;
  breakdown: MatchBreakdown;
  summary: string;
  // Enterprise AI Matching Architecture, Phase 3 - Feature Store. The EXACT 8-dimensional vector
  // (see FEATURE_NAMES in python-services/matching-ml-service/ensemble.py) this result was
  // computed from - additive, optional so nothing reading MatchScoreResult before this phase
  // breaks. matchingApi.ts's persist path writes this into match_features for point-in-time-
  // correct training/serving reuse; not populated when there's no feature vector to report (there
  // never isn't, in practice, but kept optional for forward compatibility).
  feature_vector?: number[];
}

// Scores N candidates against 1 job in a SINGLE round-trip to the ML service (not N separate
// calls) - this is what makes scoring a whole candidate pool for "Match Candidates" fast even
// with the ensemble in the loop. Deterministic features (Jaccard/cosine/Euclidean/Levenshtein/
// location) are computed synchronously in Node; only the trained-ensemble prediction needs the
// Python service, and it's batched.
export async function calculateMatchScoresBatch(
  job: Job,
  candidates: Candidate[],
  options?: { skipGeminiSummary?: boolean }
): Promise<MatchScoreResult[]> {
  if (candidates.length === 0) return [];

  const allFeatures = candidates.map((c) => computeMatchFeatures(job, c));
  const bertScores = candidates.map((c, i) => computeBertCosineScore(c, job));
  const featureVectors = allFeatures.map((f, i) => buildFeatureVector(f, bertScores[i]));
  const featureScores = allFeatures.map(computeFeatureScore);

  let ensemblePredictions: EnsemblePrediction[] | null = null;
  let trainedSampleCount = 0;

  if (activeModelType !== 'heuristic') {
    const health = await getEnsembleHealth();
    if (health?.ensembleTrained) {
      trainedSampleCount = health.trainedSampleCount;
      ensemblePredictions = await predictBatch(featureVectors);
    }
  }

  const blendWeight = getMlBlendWeight(trainedSampleCount);

  const results: MatchScoreResult[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const f = allFeatures[i];
    const featureScore = featureScores[i];
    const bertScore = bertScores[i];
    const pred = ensemblePredictions?.[i] ?? null;

    const mlScore = pred ? Math.round(pred.ensemble * 100) : featureScore;
    const effectiveBlend = pred && activeModelType !== 'heuristic' ? blendWeight : 0;
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
        ? {
            randomForest: Math.round(pred.randomForest * 100),
            xgboost: Math.round(pred.xgboost * 100),
            lightgbm: Math.round(pred.lightgbm * 100),
            blendWeight: effectiveBlend,
            trainedSampleCount,
          }
        : null,
    };

    let summary = '';
    if (!options?.skipGeminiSummary) {
      summary = await generateGeminiSummary(job, candidate);
    }
    if (!summary) summary = buildFallbackSummary(candidate, f);

    results.push({ feature_score: featureScore, embedding_score, ml_score: mlScore, final_score, breakdown, summary, feature_vector: featureVectors[i] });
  }

  shadowCompareCandidatesBatch(job, candidates, activeModelType, results);

  return results;
}

// Single-candidate convenience wrapper - preserves the existing call signature used across
// swipe.routes.ts / ml.routes.ts for one-off scoring (re-scoring after a swipe, scoring the next
// queued candidate). Internally still benefits from the fixed features; just isn't batched since
// there's only one candidate to score.
export async function calculateMatchScore(job: Job, candidate: Candidate, options?: { skipGeminiSummary?: boolean }): Promise<MatchScoreResult> {
  const [result] = await calculateMatchScoresBatch(job, [candidate], options);
  return result;
}

// Enterprise AI Matching Architecture, Phase 0 - "Unified Matching API across all four surfaces".
// The mirror image of calculateMatchScoresBatch above: scores N jobs against 1 fixed candidate,
// in a single round-trip to the ML ensemble, for the "rank jobs for a candidate" direction
// (candidate job discovery) instead of "rank candidates for a job" (recruiter swipe queue /
// job-detail). calculateMatchScoresBatch itself is NOT modified by this addition - every helper
// it calls (computeMatchFeatures, computeBertCosineScore, buildFeatureVector, computeFeatureScore,
// predictBatch, generateGeminiSummary, buildFallbackSummary) already takes a single (job,
// candidate) pair or values derived from one, so this reuses every one of them unchanged rather
// than duplicating the scoring math.
export async function calculateMatchScoresForJobsBatch(
  candidate: Candidate,
  jobs: Job[],
  options?: { skipGeminiSummary?: boolean }
): Promise<MatchScoreResult[]> {
  if (jobs.length === 0) return [];

  const allFeatures = jobs.map((job) => computeMatchFeatures(job, candidate));
  const bertScores = jobs.map((job) => computeBertCosineScore(candidate, job));
  const featureVectors = allFeatures.map((f, i) => buildFeatureVector(f, bertScores[i]));
  const featureScores = allFeatures.map(computeFeatureScore);

  let ensemblePredictions: EnsemblePrediction[] | null = null;
  let trainedSampleCount = 0;

  if (activeModelType !== 'heuristic') {
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
    const effectiveBlend = pred && activeModelType !== 'heuristic' ? blendWeight : 0;
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
        ? {
            randomForest: Math.round(pred.randomForest * 100),
            xgboost: Math.round(pred.xgboost * 100),
            lightgbm: Math.round(pred.lightgbm * 100),
            blendWeight: effectiveBlend,
            trainedSampleCount,
          }
        : null,
    };

    let summary = '';
    if (!options?.skipGeminiSummary) {
      summary = await generateGeminiSummary(job, candidate);
    }
    if (!summary) summary = buildFallbackSummary(candidate, f);

    results.push({ feature_score: featureScore, embedding_score, ml_score: mlScore, final_score, breakdown, summary, feature_vector: featureVectors[i] });
  }

  shadowCompareJobsBatch(candidate, jobs, activeModelType, results);

  return results;
}

// ==================== DYNAMIC WEIGHTING (Phase 2, opt-in only) ====================
// Not called by any existing surface by default - see src/matching/dynamicWeighting.ts's module
// doc for the validation-safe rollback path this enables. Reuses computeMatchFeatures'
// experience/location/salary sub-scores unchanged (only the skill component and the top-level
// weights differ from the static formula above) and this file's own computeBertCosineScore, so
// nothing about experience/location/salary/embedding scoring is duplicated.
export async function calculateDynamicMatchScoresBatch(job: Job, candidates: Candidate[]): Promise<MatchScoreResult[]> {
  if (candidates.length === 0) return [];

  // Resolved ONCE per job (role match + tier resolution), not once per candidate - the role
  // lookup and its embedding-similarity call are the only network-ish cost in this whole path,
  // and it's identical for every candidate being scored against this same job.
  const tiers = await resolveSkillTiers(job);
  const weights = computeSeniorityAdjustedWeights(job);

  const results: MatchScoreResult[] = [];
  for (const candidate of candidates) {
    const features = computeMatchFeatures(job, candidate);
    const skillResult = await computeDynamicSkillScore(candidate.skills, tiers);
    const bertScore = computeBertCosineScore(candidate, job);

    const final_score = Math.round(
      skillResult.score * weights.skillWeight +
      features.expScore * weights.experienceWeight +
      features.locScore * weights.locationWeight +
      features.salScore * weights.salaryWeight
    );
    const embedding_score = Math.round(bertScore ?? features.cosineTextScore);

    const explanation = buildMatchExplanation({
      skillResult,
      weights,
      confidenceProfile: (candidate.confidence_profile as ConfidenceProfile | null | undefined) ?? null,
    });

    const breakdown: MatchBreakdown = {
      skills: {
        score: skillResult.score,
        matched: skillResult.matched.map((m) => m.matchedCandidateSkill),
        missing: [...skillResult.missingMandatory, ...skillResult.missingOther],
      },
      experience: { score: Math.round(features.expScore), candidate: features.candidateExp, required: features.jobExp },
      location: {
        score: Math.round(features.locScore),
        candidate: features.candidateCity || candidate?.current_location || 'Unknown',
        required: features.jobCity || job?.location || 'Remote',
        distance: Math.round(features.locDist),
      },
      salary: { score: Math.round(features.salScore), expectation: features.candidateSalary ?? 0, min: features.jobSalMin, max: features.jobSalMax },
      explanation,
    };

    // Not fed to the ML ensemble on this path (calculateDynamicMatchScoresBatch never calls
    // predictBatch - dynamic weighting is a heuristic-formula alternative, not an ensemble
    // input), but still the same standard 8-dim vector the Feature Store expects, built from the
    // same computeMatchFeatures() output every other scoring path uses.
    results.push({ feature_score: final_score, embedding_score, ml_score: final_score, final_score, breakdown, summary: explanation.reasoning, feature_vector: buildFeatureVector(features, bertScore) });
  }

  return results;
}

// ==================== TRAINING ====================

export async function trainModelOnStartup(): Promise<void> {
  try {
    // Training is pooled across every company - see db.getAllSwipesUnscoped's comment.
    const swipes = await db.getAllSwipesUnscoped();
    if (swipes.length === 0) {
      logger.warn('No swipes available for ML training.');
      return;
    }

    const candidates = await db.getAllCandidatesUnscoped();
    const jobs = await db.getAllJobsUnscoped();

    // Enterprise AI Matching Architecture, Phase 3 - Feedback Learning Engine
    // (src/matching/feedbackSignals.ts). Widens the label taxonomy beyond bare swipe
    // accept/reject: 0.5 ("save") is now a real, weighted-down positive instead of being
    // discarded, and a real downstream candidate_application_status change corroborates or
    // overrides a swipe's label. featureVectorFor below is the same computeMatchFeatures +
    // buildFeatureVector pipeline this function always used - only the label/weight resolution
    // changed, not how features themselves are computed.
    const applicationStatusRows = await db.getAllApplicationStatusLinkedToCandidatesUnscoped();
    const applicationStatusByCandidateJob = new Map<string, string>(
      applicationStatusRows.map((r) => [`${r.candidate_id}:${r.job_id}`, r.status])
    );

    const weightedSamples = resolveTrainingSamples(swipes, applicationStatusByCandidateJob, (swipe) => {
      const candidate = candidates.find((c) => c.id === swipe.candidate_id);
      const job = jobs.find((j) => j.id === swipe.job_id);
      if (!candidate || !job) return null;
      const features = computeMatchFeatures(job, candidate);
      const bertScore = computeBertCosineScore(candidate, job);
      return buildFeatureVector(features, bertScore);
    });

    if (weightedSamples.length === 0) {
      logger.warn('No valid labeled samples (accept/reject/save swipes) available for ML training.');
      return;
    }

    const samples: TrainSample[] = weightedSamples.map((s) => ({ features: s.features, label: s.label, weight: s.weight }));
    const statusCorroboratedCount = weightedSamples.filter((s) => s.sources.includes('application_status_corroboration')).length;

    const result = await trainEnsemble(samples);
    if (result?.trained) {
      isModelTrained = true;
      logger.info(
        { sampleCount: result.sampleCount, cvAccuracy: result.cvAccuracy, statusCorroboratedSamples: statusCorroboratedCount },
        'Matching ensemble (RandomForest + XGBoost + LightGBM) trained successfully'
      );
    } else {
      logger.warn({ reason: result?.reason ?? 'ML service unavailable' }, 'Matching ensemble training skipped');
    }
    updateLastTrainingTimestamp();
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to train matching ensemble on startup');
  }
}

// Now persists to matching_model_config (Batch 23), not just an in-memory mutation - see this
// file's header comment on activeModelType. Callers (ml.routes.ts) now need to await this.
export async function setActiveModelType(newType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted'): Promise<void> {
  activeModelType = newType;
  await db.setMatchingModelConfig(newType);
}

export function setRetrainingStatus(status: boolean) {
  isRetrainingInProgress = status;
}

export function updateLastTrainingTimestamp() {
  lastTrainingTimestamp = new Date().toISOString();
}
