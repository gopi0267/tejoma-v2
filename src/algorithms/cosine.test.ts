/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Cosine Similarity Test Suite
 */

import { cosineSimilarity } from './cosine';

describe('Cosine Similarity', () => {

  test('Identical texts return 100', () => {
    const result = cosineSimilarity(
      'Python developer with React experience',
      'Python developer with React experience'
    );
    expect(result).toBe(100);
  });

  test('No shared meaningful words returns 0', () => {
    const result = cosineSimilarity('Python developer role', 'Java architect musician');
    expect(result).toBe(0);
  });

  test('Partial word overlap returns a mid-range score', () => {
    const result = cosineSimilarity(
      'Python React TypeScript developer',
      'Python React JavaScript developer'
    );
    expect(result).toBeGreaterThan(60);
    expect(result).toBeLessThan(90);
  });

  test('Stop words are ignored and do not inflate the score', () => {
    const result = cosineSimilarity(
      'We are looking for a developer with the following skills',
      'This is an unrelated document about gardening and cooking'
    );
    expect(result).toBe(0);
  });

  test('Case insensitive matching', () => {
    const result = cosineSimilarity('PYTHON DEVELOPER', 'python developer');
    expect(result).toBe(100);
  });

  test('Empty strings return 0', () => {
    expect(cosineSimilarity('', 'some text')).toBe(0);
    expect(cosineSimilarity('some text', '')).toBe(0);
  });

  test('Invalid input returns 0', () => {
    expect(cosineSimilarity(null as any, 'text')).toBe(0);
    expect(cosineSimilarity(undefined as any, undefined as any)).toBe(0);
  });

  test('Real-world resume vs job description overlap', () => {
    const resume = 'Experienced backend engineer skilled in Node.js, PostgreSQL, and AWS with a focus on scalable microservices architecture';
    const jobDescription = 'Looking for a backend engineer with Node.js and PostgreSQL experience to build scalable microservices on AWS';
    const result = cosineSimilarity(resume, jobDescription);
    expect(result).toBeGreaterThan(50);
  });
});
