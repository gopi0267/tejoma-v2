import { describe, it, expect } from 'vitest';
import { MultiPatternTrie } from '../src/jd-parser/matcher/trie.js';

const entries = [
  { canonical: 'Java', category: 'programming_language' as const, aliases: ['Java', 'Core Java'] },
  { canonical: 'JavaScript', category: 'programming_language' as const, aliases: ['JavaScript', 'JS'] },
  { canonical: 'Spring', category: 'backend_framework' as const, aliases: ['Spring', 'Spring Framework'] },
  { canonical: 'Spring Boot', category: 'backend_framework' as const, aliases: ['Spring Boot'] },
  { canonical: 'Go', category: 'programming_language' as const, aliases: ['Go', 'Golang'] },
];

describe('MultiPatternTrie', () => {
  it('matches an exact canonical term', () => {
    const trie = new MultiPatternTrie(entries);
    const matches = trie.findAll('We use Java extensively.');
    expect(matches.map((m) => m.entry.canonical)).toContain('Java');
  });

  it('normalizes a known synonym to its canonical form while keeping the matched text verbatim', () => {
    const trie = new MultiPatternTrie(entries);
    const matches = trie.findAll('5 years of Core Java experience required.');
    const match = matches.find((m) => m.entry.canonical === 'Java');
    expect(match).toBeDefined();
    expect(match!.matchedText).toBe('Core Java');
  });

  it('does not match "Java" as a substring of "JavaScript"', () => {
    const trie = new MultiPatternTrie(entries);
    const matches = trie.findAll('Experience with JavaScript required.');
    const canonicals = matches.map((m) => m.entry.canonical);
    expect(canonicals).toContain('JavaScript');
    expect(canonicals).not.toContain('Java');
  });

  it('prefers the longest match when a shorter pattern is a prefix of a longer one', () => {
    const trie = new MultiPatternTrie(entries);
    const matches = trie.findAll('Experience with Spring Boot required.');
    const canonicals = matches.map((m) => m.entry.canonical);
    expect(canonicals).toContain('Spring Boot');
    expect(canonicals).not.toContain('Spring');
  });

  it('falls back to the shorter match when the longest match fails the word-boundary check', () => {
    const trie = new MultiPatternTrie(entries);
    // "Spring Boots" is not a registered pattern, but "Spring" alone should still match since
    // "Boots" doesn't extend "Spring Boot" as a valid trie path and "Spring" is boundary-safe.
    const matches = trie.findAll('We use the Spring container.');
    expect(matches.map((m) => m.entry.canonical)).toContain('Spring');
  });

  it('respects word boundaries (does not match "Go" inside "Google" or "going")', () => {
    const trie = new MultiPatternTrie(entries);
    const matches = trie.findAll('We use Google Analytics and are going forward with the plan.');
    expect(matches.map((m) => m.entry.canonical)).not.toContain('Go');
  });

  it('is case-insensitive', () => {
    const trie = new MultiPatternTrie(entries);
    const matches = trie.findAll('experience with SPRING BOOT');
    expect(matches.map((m) => m.entry.canonical)).toContain('Spring Boot');
  });
});
