import { GoogleGenAI } from '@google/genai';
import { db } from './db.js';
import { Candidate, Job, MatchBreakdown } from './types.js';
import { logger } from './utils/logger.js';

import { jaccardSimilarity } from './algorithms/jaccard.js';
import { cosineSimilarity as textCosineSimilarity } from './algorithms/cosine.js';
import { euclideanDistance } from './algorithms/euclidean.js';
import { levenshteinSimilarity } from './algorithms/levenshtein.js';
import { predictBatch, trainEnsemble, getEnsembleHealth, TrainSample, EnsemblePrediction } from './algorithms/ml-models.js';
import { cosineSimilarity as vectorCosineSimilarity } from './utils/embeddings.js';
import { computeLocationDistance } from './matching/similarity/locationDistance.js';
import { parseExperienceYears, resolveCandidateSalaryExpectation } from './matching/parseCandidateFields.js';

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

function computeFeatureScore(f: MatchFeatures): number {
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

    results.push({ feature_score: featureScore, embedding_score, ml_score: mlScore, final_score, breakdown, summary });
  }

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

// ==================== TRAINING ====================

export async function trainModelOnStartup(): Promise<void> {
  try {
    const swipes = await db.getSwipes();
    if (swipes.length === 0) {
      logger.warn('No swipes available for ML training.');
      return;
    }

    const candidates = await db.getCandidates();
    const jobs = await db.getJobs();

    const samples: TrainSample[] = [];
    for (const swipe of swipes) {
      const candidate = candidates.find((c) => c.id === swipe.candidate_id);
      const job = jobs.find((j) => j.id === swipe.job_id);
      if (!candidate || !job) continue;
      if (swipe.action !== 0 && swipe.action !== 1) continue; // skip "save" (0.5) - not a clean accept/reject label

      const features = computeMatchFeatures(job, candidate);
      const bertScore = computeBertCosineScore(candidate, job);
      samples.push({ features: buildFeatureVector(features, bertScore), label: swipe.action as 0 | 1 });
    }

    if (samples.length === 0) {
      logger.warn('No valid labeled samples (accept/reject swipes) available for ML training.');
      return;
    }

    const result = await trainEnsemble(samples);
    if (result?.trained) {
      isModelTrained = true;
      logger.info({ sampleCount: result.sampleCount, cvAccuracy: result.cvAccuracy }, 'Matching ensemble (RandomForest + XGBoost + LightGBM) trained successfully');
    } else {
      logger.warn({ reason: result?.reason ?? 'ML service unavailable' }, 'Matching ensemble training skipped');
    }
    updateLastTrainingTimestamp();
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to train matching ensemble on startup');
  }
}

export function setActiveModelType(newType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted') {
  activeModelType = newType;
}

export function setRetrainingStatus(status: boolean) {
  isRetrainingInProgress = status;
}

export function updateLastTrainingTimestamp() {
  lastTrainingTimestamp = new Date().toISOString();
}
