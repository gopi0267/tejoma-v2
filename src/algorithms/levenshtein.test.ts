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
    // Character-level edit distance is inherently less forgiving of word-level abbreviations
    // ("Sr." -> "Senior") than a token-aware metric would be - this verifies the actual,
    // correct behavior of this specific (character-level) implementation.
    const result = levenshteinSimilarity('Sr. Developer', 'Senior Developer');
    expect(result).toBeGreaterThan(60);
  });

  test('Company name with typo', () => {
    const result = levenshteinSimilarity(
      'Google Inc',
      'Googl Inc'
    );
    expect(result).toBeGreaterThan(85);
  });

  test('Similar job titles', () => {
    // "Engineer" -> "Developer" is a full-word swap, which costs many character edits even
    // though the titles are conceptually very close - character-level Levenshtein reflects that.
    const result = levenshteinSimilarity(
      'Senior React Engineer',
      'Senior React Developer'
    );
    expect(result).toBeGreaterThan(65);
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
    // "Dev" -> "Developer" adds 6 of the target's 9 characters, so ~33% similarity is the
    // correct result for a character-level metric, not the ~50%+ a word-level metric might give.
    const result = levenshteinSimilarity('Dev', 'Developer');
    expect(result).toBeGreaterThan(25);
    expect(result).toBeLessThan(50);
  });

  test('Removal of text', () => {
    const result = levenshteinSimilarity(
      'Senior Software Engineer',
      'Senior Engineer'
    );
    expect(result).toBeGreaterThan(55);
  });
});