/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Cosine Similarity Algorithm - Production Code
 */

function isStopWord(word: string): boolean {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'was', 'are', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'could', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'as', 'if', 'no', 'not'
  ]);
  return stopWords.has(word);
}

/**
 * Cosine Similarity - Text/Resume matching
 * Measures similarity between two text documents
 * 
 * @param text1 - First text (e.g., resume)
 * @param text2 - Second text (e.g., job description)
 * @returns Score 0-100
 */
export function cosineSimilarity(text1: string, text2: string): number {
  try {
    if (!text1 || !text2 || typeof text1 !== 'string' || typeof text2 !== 'string') {
      return 0;
    }

    if (text1.trim().length === 0 && text2.trim().length === 0) {
      return 100;
    }

    if (text1.trim().length === 0 || text2.trim().length === 0) {
      return 0;
    }

    const normalize = (text: string): string[] => {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 2)
        .filter(word => !isStopWord(word));
    };

    const words1 = normalize(text1);
    const words2 = normalize(text2);

    if (words1.length === 0 && words2.length === 0) {
      return 100;
    }

    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }

    const allWords = new Set([...words1, ...words2]);

    const vector1: number[] = [];
    const vector2: number[] = [];

    allWords.forEach(word => {
      const count1 = words1.filter(w => w === word).length;
      const count2 = words2.filter(w => w === word).length;
      vector1.push(count1);
      vector2.push(count2);
    });

    const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);

    const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    const cosineSim = dotProduct / (magnitude1 * magnitude2);
    const score = Math.round(cosineSim * 100);

    return Math.max(0, Math.min(100, score));
  } catch (error) {
    console.error('Error in cosineSimilarity:', error);
    return 0;
  }
}