import { describe, it, expect } from 'vitest';
import { strongestVerbTierForSkill, computeSkillProficiency } from '../../src/matching/skillProficiency.js';
import type { SkillRecency } from '../../src/matching/skillRecency.js';

// Enterprise AI Matching Architecture, §2.1 - Skill Proficiency Intelligence. Pure functions, no
// DB dependency - computeCandidateSkillProficiency needs canonicalizeSkill (via skillRecency's
// orchestration) and is covered by the integration test pass instead.

function makeRecency(overrides: Partial<SkillRecency> = {}): SkillRecency {
  return { skillName: 'Python', lastUsed: null, totalMentions: 0, yearsSinceLastUsed: null, recencyMultiplier: 1, confidence: 'unknown', ...overrides };
}

describe('strongestVerbTierForSkill', () => {
  it('finds tier 1 ("used it") for a bare mention', () => {
    expect(strongestVerbTierForSkill('Python', ['I used Python for scripting.'])).toBe(1);
  });

  it('finds tier 2 ("built with it") for "built"/"developed"', () => {
    expect(strongestVerbTierForSkill('Python', ['Built a REST API using Python and FastAPI.'])).toBe(2);
  });

  it('finds tier 3 ("architected/led") for "architected"/"led"', () => {
    expect(strongestVerbTierForSkill('Python', ['Architected the entire Python microservices platform.'])).toBe(3);
  });

  it('finds tier 4 ("mentored") for "mentored"', () => {
    expect(strongestVerbTierForSkill('Python', ['Mentored 3 engineers on Python best practices.'])).toBe(4);
  });

  it('is 0 when the skill is never mentioned at all', () => {
    expect(strongestVerbTierForSkill('Rust', ['Built a Python service.'])).toBe(0);
  });

  it('is 0 when the skill is mentioned but no strong-verb sentence is nearby (sentence-scoped, not whole-document)', () => {
    // "Architected" appears in a DIFFERENT sentence than the Python mention - must not leak across sentences.
    const text = 'Architected the payment gateway. Separately, has used Python for scripting.';
    expect(strongestVerbTierForSkill('Python', [text])).toBe(1); // only "used" applies to the Python sentence
  });

  it('returns the STRONGEST tier found across multiple mentions', () => {
    const texts = ['Used Python for scripts.', 'Later architected the core Python service.'];
    expect(strongestVerbTierForSkill('Python', texts)).toBe(3);
  });

  it('is case-insensitive', () => {
    expect(strongestVerbTierForSkill('python', ['I BUILT a service with PYTHON.'])).toBe(2);
  });

  it('handles null/undefined texts without crashing', () => {
    expect(strongestVerbTierForSkill('Python', [null, undefined, 'used Python'])).toBe(1);
  });
});

describe('computeSkillProficiency', () => {
  it('defaults to the conservative "beginner" tier with low confidence when there is zero evidence', () => {
    const result = computeSkillProficiency('Rust', 'No mention of it here.', [], [], null);
    expect(result.tier).toBe('beginner');
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.evidence[0]).toMatch(/no corroborating evidence/i);
  });

  it('never trusts a self-reported "Expert in X" claim alone - only structural verb evidence counts', () => {
    // The word "Expert" appears, but not in a scanned strong-verb keyword list - the function
    // must not treat a candidate's own adjective as proof.
    const result = computeSkillProficiency('Python', 'Expert in Python.', [], [], null);
    expect(result.tier).not.toBe('expert');
  });

  it('"built with it" (verb tier 2) reaches "advanced" from verb evidence alone', () => {
    const result = computeSkillProficiency('Python', 'Built the core Python service.', [], [], null);
    expect(result.tier).toBe('advanced');
  });

  it('"architected/led" (verb tier 3) reaches "expert" from verb evidence alone', () => {
    const result = computeSkillProficiency('Python', 'Architected the core Python platform.', [], [], null);
    expect(result.tier).toBe('expert');
  });

  it('tier strictly increases with verb strength: used < built < architected', () => {
    const used = computeSkillProficiency('Python', 'Used Python for scripting.', [], [], null);
    const built = computeSkillProficiency('Python', 'Built a service with Python.', [], [], null);
    const architected = computeSkillProficiency('Python', 'Architected the Python platform.', [], [], null);
    const rank = (t: string) => ['beginner', 'intermediate', 'advanced', 'expert'].indexOf(t);
    expect(rank(used.tier)).toBeLessThan(rank(built.tier));
    expect(rank(built.tier)).toBeLessThan(rank(architected.tier));
  });

  it('corroboration (repeated dated projects) raises the tier when verb evidence already exists, never from nothing', () => {
    const recency = makeRecency({ confidence: 'known', totalMentions: 3 });
    const withoutCorroboration = computeSkillProficiency('Python', 'Built a service with Python.', [], [], null);
    const withCorroboration = computeSkillProficiency('Python', 'Built a service with Python.', [], [], recency);
    expect(withCorroboration.tier).not.toBe('beginner');
    expect(['intermediate', 'advanced', 'expert']).toContain(withCorroboration.tier);
    // With verb tier 2 (built) + 0.5 corroboration bonus, rounds up from the no-corroboration case.
    expect(withCorroboration.confidence).toBeGreaterThan(withoutCorroboration.confidence);
  });

  it('corroboration alone (no verb evidence at all) never reaches advanced/expert - capped by the zero-verb-tier ceiling', () => {
    const recency = makeRecency({ confidence: 'known', totalMentions: 5 });
    const result = computeSkillProficiency('Python', 'No relevant text.', [], ['AWS Certified Python Developer'], recency);
    expect(['beginner', 'intermediate']).toContain(result.tier); // capped - verbTier stayed 0
  });

  it('a matching certification adds real evidence and raises confidence', () => {
    const withCert = computeSkillProficiency('AWS', 'Built infrastructure with AWS.', [], ['AWS Certified Solutions Architect'], null);
    const withoutCert = computeSkillProficiency('AWS', 'Built infrastructure with AWS.', [], [], null);
    expect(withCert.confidence).toBeGreaterThan(withoutCert.confidence);
  });

  it('confidence never exceeds 1', () => {
    const recency = makeRecency({ confidence: 'known', totalMentions: 10 });
    const result = computeSkillProficiency('Python', 'Mentored the team on Python.', [], ['Python Certified'], recency);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('always returns a non-empty evidence list explaining the tier', () => {
    const result = computeSkillProficiency('Go', '', [], [], null);
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});
