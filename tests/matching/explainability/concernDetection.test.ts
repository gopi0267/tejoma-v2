import { describe, it, expect } from 'vitest';
import { detectSkillGapConcern, detectCareerGapConcerns, detectSeniorityMismatchConcern, detectConcerns } from '../../../src/matching/explainability/concernDetection.js';
import { buildSeniorityNarrative } from '../../../src/matching/explainability/narrativeGeneration.js';
import type { EmploymentGap } from '../../../src/types.js';

// Enterprise AI Matching Architecture, Phase 10 - Explainability Layer, Module 2: Concern
// Detection. Pure functions only. Every assertion below also checks that no concern text
// speculates ("may", "likely", "probably", "seems") - see this phase's own Decision 4.
const SPECULATION_PATTERN = /\b(may|might|likely|probably|seems|appears|suggests)\b/i;

describe('detectSkillGapConcern', () => {
  it('returns null when nothing is missing', () => {
    expect(detectSkillGapConcern([])).toBeNull();
  });

  it('describes missing skills factually, with no speculation', () => {
    const concern = detectSkillGapConcern(['Terraform', 'Kubernetes']);
    expect(concern!.concernType).toBe('skill_gap');
    expect(concern!.description).toContain('Terraform');
    expect(concern!.description + concern!.impact).not.toMatch(SPECULATION_PATTERN);
  });
});

describe('detectCareerGapConcerns', () => {
  it('returns nothing for null/empty gaps', () => {
    expect(detectCareerGapConcerns(null)).toHaveLength(0);
    expect(detectCareerGapConcerns([])).toHaveLength(0);
  });

  it('reports each gap using ONLY the fact-only fields (dates + duration) - no cause', () => {
    const gaps: EmploymentGap[] = [{ startDate: '2020-01', endDate: '2020-09', durationMonths: 8 }];
    const concerns = detectCareerGapConcerns(gaps);
    expect(concerns).toHaveLength(1);
    expect(concerns[0].description).toContain('8 month');
    expect(concerns[0].description).toContain('2020-01');
    expect(concerns[0].description + concerns[0].evidence + concerns[0].impact).not.toMatch(SPECULATION_PATTERN);
  });

  it('emits one concern per gap', () => {
    const gaps: EmploymentGap[] = [
      { startDate: '2018-01', endDate: '2018-09', durationMonths: 8 },
      { startDate: '2020-01', endDate: '2020-05', durationMonths: 4 },
    ];
    expect(detectCareerGapConcerns(gaps)).toHaveLength(2);
  });
});

describe('detectSeniorityMismatchConcern', () => {
  it('returns null for an exact match', () => {
    const seniority = buildSeniorityNarrative('senior', 0.7, 'Senior Backend Engineer');
    expect(detectSeniorityMismatchConcern(seniority)).toBeNull();
  });

  it('returns null when alignment is unknown - never guesses a mismatch from missing data', () => {
    const seniority = buildSeniorityNarrative(null, null, null);
    expect(detectSeniorityMismatchConcern(seniority)).toBeNull();
  });

  it('reports a factual level-distance concern when the candidate outranks the job', () => {
    const seniority = buildSeniorityNarrative('staff', 0.7, 'Junior Developer');
    const concern = detectSeniorityMismatchConcern(seniority);
    expect(concern!.concernType).toBe('seniority_mismatch');
    expect(concern!.impact).toMatch(/level seniority gap/);
    expect(concern!.description + concern!.impact).not.toMatch(SPECULATION_PATTERN);
  });
});

describe('detectConcerns', () => {
  it('aggregates skill gap, career gap, and seniority mismatch concerns together', () => {
    const seniority = buildSeniorityNarrative('staff', 0.7, 'Junior Developer');
    const gaps: EmploymentGap[] = [{ startDate: '2020-01', endDate: '2020-09', durationMonths: 8 }];
    const concerns = detectConcerns(['Terraform'], gaps, seniority);
    expect(concerns.map((c) => c.concernType).sort()).toEqual(['career_gap', 'seniority_mismatch', 'skill_gap']);
  });

  it('produces no concerns for a clean match', () => {
    const seniority = buildSeniorityNarrative('senior', 0.7, 'Senior Backend Engineer');
    expect(detectConcerns([], null, seniority)).toHaveLength(0);
  });
});
