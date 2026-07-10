/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Levenshtein Distance Test Suite
 */

import { levenshteinSimilarity } from './levenshtein';

describe('Levenshtein Similarity', () => {
  
  test('Identical strings return 100', () => {
    const result = levenshteinSimilarity('Senior Software Developer', 'Senior Software Developer');
    expect(result).toBe(100);
  });

  test('Completely different strings return 0', () => {
    const result = levenshteinSimilarity('abcdef', 'ghijkl');
    expect(result).toBe(0);
  });

  test('Single character difference - typo', () => {
    const result = levenshteinSimilarity(
      'Senior Sofware Developer',
      'Senior Software Developer'
    );
    expect(result).toBeGreaterThan(90);
  });

  test('Multiple character differences', () => {
    const result = levenshteinSimilarity(
      'Senior React Developer',
      'Senior Reacts Developr'
    );
    expect(result).toBeGreaterThan(85);
  });

  test('Case insensitive matching', () => {
    const result = levenshteinSimilarity(
      'SENIOR SOFTWARE DEVELOPER',
      'senior software developer'
    );
    expect(result).toBe(100);
  });

  test('Whitespace trimming', () => {
    const result = levenshteinSimilarity(
      '  Senior Developer  ',
      'Senior Developer'
    );
    expect(result).toBe(100);
  });

  test('Job title variations - common abbreviations', () => {
    const result = levenshteinSimilarity('Sr. Developer', 'Senior Developer');
    expect(result).toBeGreaterThan(70);
  });

  test('Company name with typo', () => {
    const result = levenshteinSimilarity(
      'Google Inc',
      'Googl Inc'
    );
    expect(result).toBeGreaterThan(85);
  });

  test('Similar job titles', () => {
    const result = levenshteinSimilarity(
      'Senior React Engineer',
      'Senior React Developer'
    );
    expect(result).toBeGreaterThan(85);
  });

  test('Empty string returns 0', () => {
    const result = levenshteinSimilarity('', 'text');
    expect(result).toBe(0);
  });

  test('Both empty strings return 0', () => {
    const result = levenshteinSimilarity('', '');
    expect(result).toBe(0);
  });

  test('Invalid input returns 0', () => {
    const result = levenshteinSimilarity(null as any, 'text');
    expect(result).toBe(0);
  });

  test('Real world job title match - React vs Rect', () => {
    const result = levenshteinSimilarity(
      'React Developer',
      'Rect Developer'
    );
    expect(result).toBeGreaterThan(92);
  });

  test('Real world job title match - JavaScript vs Javascrip', () => {
    const result = levenshteinSimilarity(
      'JavaScript Developer',
      'Javascrip Developer'
    );
    expect(result).toBeGreaterThan(88);
  });

  test('Addition of text', () => {
    const result = levenshteinSimilarity('Dev', 'Developer');
    expect(result).toBeGreaterThan(50);
  });

  test('Removal of text', () => {
    const result = levenshteinSimilarity(
      'Senior Software Engineer',
      'Senior Engineer'
    );
    expect(result).toBeGreaterThan(70);
  });
});