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

// BERT (Sentence-Transformer) embeddings - semantic resume/JD similarity
export { generateEmbedding, generateEmbeddingsBatch } from './bert-embeddings';

// RandomForest + XGBoost + LightGBM ensemble - trained on recruiter swipe history
export { trainEnsemble, predictBatch, getEnsembleHealth } from './ml-models';
export type { TrainSample, TrainResult, EnsemblePrediction } from './ml-models';