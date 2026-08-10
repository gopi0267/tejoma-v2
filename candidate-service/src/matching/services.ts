/**
 * Matching scoring functions for candidate analytics (Item 4)
 *
 * Simplified version that includes only computeMatchFeatures and computeFeatureScore,
 * which are needed for the analytics dashboard's skill demand, location, and salary
 * insights calculations. Ported from monolith src/matching/services.ts with algorithm
 * imports inlined for simplicity.
 */

import type { Job, Candidate } from '../types.js';
import { parseExperienceYears, resolveCandidateSalaryExpectation } from './parseCandidateFields.js';

// Minimal algorithm implementations needed for analytics
function jaccardSimilarity(arr1: string[], arr2: string[]): number {
  const set1 = new Set(arr1.map((s) => s.toLowerCase().trim()).filter(Boolean));
  const set2 = new Set(arr2.map((s) => s.toLowerCase().trim()).filter(Boolean));
  if (set1.size === 0 && set2.size === 0) return 100;
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return Math.round((intersection.size / union.size) * 100);
}

function textCosineSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(Boolean));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(Boolean));
  if (words1.size === 0 || words2.size === 0) return 50;
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const denominator = Math.sqrt(words1.size * words2.size);
  return Math.round((intersection.size / denominator) * 100);
}

function euclideanDistance(v1: number[], v2: number[]): number {
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    const diff = v1[i] - v2[i];
    sum += diff * diff;
  }
  const distance = Math.sqrt(sum);
  const decayConstant = 300000; // tuned for salary-scale numbers
  return Math.round(Math.max(0, Math.min(100, 100 - (distance / decayConstant) * 100)));
}

function levenshteinSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 100;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = Array.from({ length: s2.length + 1 }, () => Array(s1.length + 1).fill(0));
  for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
  for (let i = 0; i <= s2.length; i++) matrix[i][0] = i;

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      const cost = s1[j - 1] === s2[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }

  const distance = matrix[s2.length][s1.length];
  const maxLength = Math.max(s1.length, s2.length);
  return Math.round(Math.max(0, 100 - (distance / maxLength) * 100));
}

function computeLocationDistance(candidateLoc: string | undefined, jobLoc: string | undefined): { distanceKm: number; isRemoteMatch: boolean; candidateCity: string | null; jobCity: string | null } {
  // Simplified version - just check for "remote" keyword, assume 0km if matched
  const candLocLower = (candidateLoc || '').toLowerCase();
  const jobLocLower = (jobLoc || '').toLowerCase();
  const isRemote = /remote|anywhere|virtual/.test(jobLocLower);
  if (isRemote) {
    return { distanceKm: 0, isRemoteMatch: true, candidateCity: null, jobCity: null };
  }
  // For now, assume 0km (no distance penalty for analytics purposes - this is a simplified version)
  return { distanceKm: 0, isRemoteMatch: false, candidateCity: candidateLoc || null, jobCity: jobLoc || null };
}

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
    jaccardSkillScore,
    matchedSkills,
    missingSkills,
    cosineTextScore,
    euclideanFeatureScore,
    levenshteinTitleScore,
    candidateExp,
    jobExp,
    expScore,
    locDist: locResult.distanceKm,
    locScore,
    candidateCity: locResult.candidateCity,
    jobCity: locResult.jobCity,
    candidateSalary,
    jobSalMin,
    jobSalMax,
    salScore,
  };
}

export function computeFeatureScore(f: MatchFeatures): number {
  return Math.round(f.jaccardSkillScore * 0.4 + f.expScore * 0.35 + f.locScore * 0.15 + f.salScore * 0.1);
}
