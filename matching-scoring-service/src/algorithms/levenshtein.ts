/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Levenshtein Distance Algorithm - Production Code
 */

/**
 * Levenshtein Distance - String similarity matching
 * Measures minimum edit distance between two strings
 * Perfect for: job titles, company names, handling typos
 * 
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Score 0-100 (0 = very different, 100 = identical)
 */
export function levenshteinSimilarity(str1: string, str2: string): number {
  try {
    if (!str1 || !str2 || typeof str1 !== 'string' || typeof str2 !== 'string') {
      return 0;
    }

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) {
      return 100;
    }

    if (s1.length === 0 || s2.length === 0) {
      return 0;
    }

    const maxLen = Math.max(s1.length, s2.length);
    const distance = levenshteinDistance(s1, s2);
    
    // Convert distance to similarity score (0-100)
    const similarity = ((maxLen - distance) / maxLen) * 100;

    return Math.max(0, Math.min(100, Math.round(similarity)));
  } catch (error) {
    console.error('Error in levenshteinSimilarity:', error);
    return 0;
  }
}

/**
 * Calculate Levenshtein Distance
 * Uses dynamic programming to compute minimum edit distance
 * 
 * @param s1 - First string
 * @param s2 - Second string
 * @returns Minimum edit distance
 */
function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;

  // Create matrix for dynamic programming
  const dp: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    dp[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // Deletion
        dp[i][j - 1] + 1,      // Insertion
        dp[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return dp[len1][len2];
}