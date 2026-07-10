/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Central Export Point for All Similarity Algorithms
 */

// Jaccard Similarity - Skill set matching
export { jaccardSimilarity } from './jaccard';

// Cosine Similarity - Text/resume matching
export { cosineSimilarity } from './cosine';

// Euclidean Distance - Feature vector matching
export { euclideanDistance, euclideanMatchScore } from './euclidean';

// Levenshtein Distance - String similarity (typos, job titles)
export { levenshteinSimilarity } from './levenshtein';