/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Euclidean Distance Algorithm - Production Code
 */

/**
 * Euclidean Distance - Feature vector matching
 * Measures distance between numeric feature vectors
 * 
 * @param vector1 - First feature vector
 * @param vector2 - Second feature vector
 * @returns Score 0-100
 */
export function euclideanDistance(vector1: number[], vector2: number[]): number {
  try {
    if (!vector1 || !vector2 || !Array.isArray(vector1) || !Array.isArray(vector2)) {
      return 0;
    }

    if (vector1.length === 0 && vector2.length === 0) {
      return 100;
    }

    if (vector1.length === 0 || vector2.length === 0) {
      return 0;
    }

    const maxLen = Math.max(vector1.length, vector2.length);
    
    const padded1 = [...vector1];
    const padded2 = [...vector2];
    
    while (padded1.length < maxLen) padded1.push(0);
    while (padded2.length < maxLen) padded2.push(0);

    let sumSquares = 0;
    for (let i = 0; i < maxLen; i++) {
      const val1 = isNaN(padded1[i]) ? 0 : padded1[i];
      const val2 = isNaN(padded2[i]) ? 0 : padded2[i];
      const diff = val1 - val2;
      sumSquares += diff * diff;
    }

    const distance = Math.sqrt(sumSquares);
    const scalingFactor = 0.00001;
    const similarity = Math.exp(-distance * scalingFactor) * 100;

    return Math.max(0, Math.min(100, Math.round(similarity)));
  } catch (error) {
    console.error('Error in euclideanDistance:', error);
    return 0;
  }
}

/**
 * Euclidean Match Score - Specialized for job-candidate matching
 * Combines experience, salary, location, and industry features
 * 
 * @param candidateData - Candidate features
 * @param jobData - Job features
 * @returns Score 0-100
 */
export function euclideanMatchScore(
  candidateData: {
    experience: number;
    salary: number;
    location_code: number;
    industry?: string;
  },
  jobData: {
    experience: number;
    salary_min: number;
    salary_max: number;
    location_code: number;
    industry?: string;
  }
): number {
  try {
    if (!candidateData || !jobData) {
      return 0;
    }

    const expDiff = Math.abs(candidateData.experience - jobData.experience);
    const expFeature = Math.max(0, 50 - expDiff * 5);

    let salaryFeature = 0;
    const candidateSal = candidateData.salary;
    const jobSalMin = jobData.salary_min;
    const jobSalMax = jobData.salary_max;

    if (candidateSal >= jobSalMin && candidateSal <= jobSalMax) {
      salaryFeature = 50;
    } else if (candidateSal < jobSalMin) {
      const diff = jobSalMin - candidateSal;
      salaryFeature = Math.max(0, 50 - (diff / 10000));
    } else {
      const diff = candidateSal - jobSalMax;
      salaryFeature = Math.max(0, 50 - (diff / 10000));
    }

    const locDiff = Math.abs(candidateData.location_code - jobData.location_code);
    const locationFeature = Math.max(0, 30 - locDiff * 10);

    const industryMatch = (candidateData.industry || '').toLowerCase() === (jobData.industry || '').toLowerCase() ? 1 : 0;
    const industryFeature = industryMatch * 20;

    const totalScore = (expFeature + salaryFeature + locationFeature + industryFeature) / 1.5;

    return Math.max(0, Math.min(100, Math.round(totalScore)));
  } catch (error) {
    console.error('Error in euclideanMatchScore:', error);
    return 0;
  }
}