/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SIMILARITY METRICS FOR JOB-CANDIDATE MATCHING
 * Production-grade implementation with all 3 algorithms
 * 
 * Algorithms:
 * 1. Jaccard Similarity - Skill set matching
 * 2. Cosine Similarity - Text/resume matching
 * 3. Euclidean Distance - Feature vector matching
 */

// ==================== 1. JACCARD SIMILARITY ====================
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

export function testJaccardSimilarity(): void {
  console.log('\n========== JACCARD SIMILARITY TESTS ==========\n');

  const testCases = [
    {
      name: 'Perfect match',
      skills1: ['Python', 'React', 'TypeScript'],
      skills2: ['Python', 'React', 'TypeScript'],
      expected: 100
    },
    {
      name: 'No overlap',
      skills1: ['Python', 'Java'],
      skills2: ['C++', 'Rust'],
      expected: 0
    },
    {
      name: 'Partial overlap',
      skills1: ['Python', 'React', 'TypeScript'],
      skills2: ['Python', 'React', 'Node.js'],
      expected: 66
    }
  ];

  testCases.forEach(test => {
    const result = jaccardSimilarity(test.skills1, test.skills2);
    console.log(`${test.name}: ${result}%`);
  });
}

// ==================== 2. COSINE SIMILARITY ====================

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

export function testCosineSimilarity(): void {
  console.log('\n========== COSINE SIMILARITY TESTS ==========\n');

  const testCases = [
    {
      name: 'Identical texts',
      text1: 'Python developer with React experience',
      text2: 'Python developer with React experience',
      expected: 100
    },
    {
      name: 'No similarity',
      text1: 'Python developer',
      text2: 'Java architect musician',
      expected: 0
    },
    {
      name: 'High similarity',
      text1: 'Python React TypeScript developer',
      text2: 'Python React JavaScript developer',
      expected: 75
    }
  ];

  testCases.forEach(test => {
    const result = cosineSimilarity(test.text1, test.text2);
    console.log(`${test.name}: ${result}%`);
  });
}

// ==================== 3. EUCLIDEAN DISTANCE ====================

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

export function testEuclideanDistance(): void {
  console.log('\n========== EUCLIDEAN DISTANCE TESTS ==========\n');

  const testCases = [
    {
      name: 'Identical vectors',
      vector1: [5, 100, 120000],
      vector2: [5, 100, 120000],
      expected: 100
    },
    {
      name: 'Slightly different',
      vector1: [5, 100, 120000],
      vector2: [6, 100, 115000],
      expected: 98
    },
    {
      name: 'Very different',
      vector1: [0, 0, 0],
      vector2: [20, 500, 500000],
      expected: 0
    }
  ];

  testCases.forEach(test => {
    const result = euclideanDistance(test.vector1, test.vector2);
    console.log(`${test.name}: ${result}%`);
  });
}

export function testEuclideanMatchScore(): void {
  console.log('\n========== EUCLIDEAN MATCH SCORE TESTS ==========\n');

  const testCases = [
    {
      name: 'Perfect match',
      candidate: { experience: 5, salary: 110000, location_code: 1, industry: 'Tech' },
      job: { experience: 5, salary_min: 100000, salary_max: 120000, location_code: 1, industry: 'Tech' },
      expected: 95
    },
    {
      name: 'Good match',
      candidate: { experience: 5, salary: 100000, location_code: 1, industry: 'Tech' },
      job: { experience: 4, salary_min: 90000, salary_max: 110000, location_code: 1, industry: 'Tech' },
      expected: 85
    }
  ];

  testCases.forEach(test => {
    const result = euclideanMatchScore(test.candidate, test.job);
    console.log(`${test.name}: ${result}%`);
  });
}