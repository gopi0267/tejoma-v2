/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Jaccard Similarity Test Suite
 */

import { jaccardSimilarity } from './jaccard';

describe('Jaccard Similarity', () => {
  
  test('Perfect match - identical skills', () => {
    const result = jaccardSimilarity(
      ['Python', 'React', 'TypeScript'],
      ['Python', 'React', 'TypeScript']
    );
    expect(result).toBe(100);
  });

  test('No overlap - completely different skills', () => {
    const result = jaccardSimilarity(
      ['Python', 'Java'],
      ['C++', 'Rust']
    );
    expect(result).toBe(0);
  });

  test('Partial overlap - intersection 2 / union 4 = 50%', () => {
    // {Python, React} intersect / {Python, React, TypeScript, Node.js} union = 2/4 = 50%,
    // not 66% - 66% would be intersection-over-skills1-size, which is a different (and less
    // standard) metric than Jaccard's intersection-over-union.
    const result = jaccardSimilarity(
      ['Python', 'React', 'TypeScript'],
      ['Python', 'React', 'Node.js']
    );
    expect(result).toBe(50);
  });

  test('Case insensitive matching', () => {
    const result = jaccardSimilarity(
      ['PYTHON', 'react', 'TYPESCRIPT'],
      ['python', 'REACT', 'typescript']
    );
    expect(result).toBe(100);
  });

  test('Whitespace trimming', () => {
    const result = jaccardSimilarity(
      [' Python ', ' React '],
      ['Python', 'React']
    );
    expect(result).toBe(100);
  });

  test('Empty arrays', () => {
    const result = jaccardSimilarity([], []);
    expect(result).toBe(100);
  });

  test('One empty array', () => {
    const result = jaccardSimilarity(['Python'], []);
    expect(result).toBe(0);
  });

  test('Invalid input - null', () => {
    const result = jaccardSimilarity(null as any, null as any);
    expect(result).toBe(0);
  });

  test('Invalid input - not arrays', () => {
    const result = jaccardSimilarity('not array' as any, 'also not' as any);
    expect(result).toBe(0);
  });

  test('Real world candidate-job match', () => {
    const candidateSkills = ['JavaScript', 'React', 'Node.js', 'MongoDB', 'Git'];
    const jobSkills = ['JavaScript', 'React', 'Express', 'PostgreSQL', 'Git', 'Docker'];
    
    const result = jaccardSimilarity(candidateSkills, jobSkills);
    expect(result).toBeGreaterThan(30);
    expect(result).toBeLessThan(40);
  });
});