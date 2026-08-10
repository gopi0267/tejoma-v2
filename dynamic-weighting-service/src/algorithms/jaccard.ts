/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Jaccard Similarity Algorithm - Production Code
 */
// Ported from the monolith's src/algorithms/jaccard.ts - byte-identical.

export function jaccardSimilarity(skills1: string[], skills2: string[]): number {
  try {
    if (!skills1 || !skills2 || !Array.isArray(skills1) || !Array.isArray(skills2)) {
      return 0;
    }

    if (skills1.length === 0 && skills2.length === 0) {
      return 100;
    }

    if (skills1.length === 0 || skills2.length === 0) {
      return 0;
    }

    const normalized1 = new Set(
      skills1
        .map(s => (s || '').toLowerCase().trim())
        .filter(s => s.length > 0)
    );

    const normalized2 = new Set(
      skills2
        .map(s => (s || '').toLowerCase().trim())
        .filter(s => s.length > 0)
    );

    if (normalized1.size === 0 && normalized2.size === 0) {
      return 100;
    }

    if (normalized1.size === 0 || normalized2.size === 0) {
      return 0;
    }

    const intersection = new Set(
      [...normalized1].filter(skill => normalized2.has(skill))
    );

    const union = new Set([...normalized1, ...normalized2]);

    const jaccardScore = (intersection.size / union.size);
    const score = Math.round(jaccardScore * 100);

    return Math.max(0, Math.min(100, score));
  } catch (error) {
    console.error('Error in jaccardSimilarity:', error);
    return 0;
  }
}
