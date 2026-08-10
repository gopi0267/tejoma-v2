import { describe, it, expect } from 'vitest';
import {
  buildSkillsNarrative,
  buildSeniorityNarrative,
  buildCareerProgressionNarrative,
  buildTechnologyCoherenceNarrative,
  buildExecutiveSummary,
} from '../../../src/matching/explainability/narrativeGeneration.js';
import type { MatchBreakdown, CareerTrajectory, ReasoningConclusion, NormalizedJob } from '../../../src/types.js';
import type { SkillProficiency } from '../../../src/matching/skillProficiency.js';

// Enterprise AI Matching Architecture, Phase 10 - Explainability Layer, Module 1: Narrative
// Generation. Pure functions only - computeMatchExplanation needs the DB and is covered by the
// integration test pass instead.

function makeBreakdown(overrides: Partial<MatchBreakdown['skills']> = {}): MatchBreakdown {
  return {
    skills: { score: 66.7, matched: ['Python', 'FastAPI'], missing: ['Terraform'], ...overrides },
    experience: { score: 100, candidate: 5, required: 3 },
    location: { score: 100, candidate: 'Remote', required: 'Remote', distance: 0 },
    salary: { score: 100, expectation: 0, min: 0, max: 0 },
  };
}

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    roleProfileId: null, title: 'Backend Engineer', company: 'Acme', startDate: '2020-01', endDate: '2021-01',
    isCurrent: false, durationMonths: 12, inferredSeniority: 'senior', inferredSeniorityConfidence: 0.7, domain: 'backend_engineer',
    ...overrides,
  };
}

function makeTrajectory(overrides: Partial<CareerTrajectory> = {}): CareerTrajectory {
  return {
    id: 1, candidate_id: 1, company_id: 1, job_sequence: [makeJob()], total_career_months: 12, role_count: 1,
    progression_type: 'ic_track', seniority_level: 'senior', seniority_trend: 'ascending', transitions: [],
    avg_tenure_months: 12, median_tenure_months: 12, tenure_pattern: 'stable', gaps: [], domain_concentration: 1,
    domains: [], trajectory_embedding: [], predicted_next_roles: [], created_at: '', updated_at: '',
    ...overrides,
  };
}

function makeReasoningConclusion(overrides: Partial<ReasoningConclusion> = {}): ReasoningConclusion {
  return {
    id: 1, subject_type: 'candidate', subject_id: 1, conclusion_text: 'stack is coherent', conclusion_type: 'stack_coherence',
    reasoning_type: 'technology_relationship', evidence_chain: [], conclusion_confidence: 0.8, confidence_derivation: '',
    derived_from: 'skill_intelligence_graph', created_at: '',
    ...overrides,
  };
}

describe('buildSkillsNarrative', () => {
  it('returns a null-score placeholder when no breakdown is available - never fabricates a score', () => {
    const narrative = buildSkillsNarrative(null, []);
    expect(narrative.score).toBeNull();
    expect(narrative.matched).toHaveLength(0);
  });

  it('reports matched and missing skills from the real breakdown', () => {
    const narrative = buildSkillsNarrative(makeBreakdown(), []);
    expect(narrative.matched).toEqual(['Python', 'FastAPI']);
    expect(narrative.missing).toEqual(['Terraform']);
    expect(narrative.explanation).toContain('2 of 3');
    expect(narrative.explanation).toContain('Terraform');
  });

  it('attaches proficiency only for matched skills with real evidence (confidence > 0)', () => {
    const proficiency: SkillProficiency[] = [
      { skillName: 'Python', tier: 'expert', confidence: 0.9, evidence: ['mentored the team on Python'] },
      { skillName: 'FastAPI', tier: 'beginner', confidence: 0, evidence: [] },
    ];
    const narrative = buildSkillsNarrative(makeBreakdown(), proficiency);
    expect(narrative.proficiency).toHaveLength(1);
    expect(narrative.proficiency[0].skill).toBe('Python');
  });
});

describe('buildSeniorityNarrative', () => {
  it('resolves exact_match when candidate and job land on the same inferred level', () => {
    const narrative = buildSeniorityNarrative('senior', 0.7, 'Senior Backend Engineer');
    expect(narrative.alignment).toBe('exact_match');
  });

  it('resolves candidate_more_senior when the candidate outranks the job', () => {
    const narrative = buildSeniorityNarrative('staff', 0.7, 'Junior Developer');
    expect(narrative.alignment).toBe('candidate_more_senior');
  });

  it('resolves candidate_less_senior when the job outranks the candidate', () => {
    const narrative = buildSeniorityNarrative('entry', 0.7, 'Director of Engineering');
    expect(narrative.alignment).toBe('candidate_less_senior');
  });

  it('is "unknown" (never guessed) when either side has no resolvable level', () => {
    expect(buildSeniorityNarrative(null, null, 'Backend Engineer').alignment).toBe('unknown');
    expect(buildSeniorityNarrative('senior', 0.7, null).alignment).toBe('unknown');
    expect(buildSeniorityNarrative('unknown', null, 'Senior Engineer').alignment).toBe('unknown');
  });
});

describe('buildCareerProgressionNarrative', () => {
  it('returns null when there is no trajectory - never fabricates one', () => {
    expect(buildCareerProgressionNarrative(null)).toBeNull();
  });

  it('summarizes progression type and trend from the real trajectory row', () => {
    const narrative = buildCareerProgressionNarrative(makeTrajectory());
    expect(narrative!.progressionType).toBe('ic_track');
    expect(narrative!.explanation).toContain('ic track');
    expect(narrative!.explanation).toContain('ascending');
  });

  it('omits an "unclear" trend from the sentence rather than stating a non-fact', () => {
    const narrative = buildCareerProgressionNarrative(makeTrajectory({ seniority_trend: 'unclear' }));
    expect(narrative!.explanation).not.toContain('unclear');
  });
});

describe('buildTechnologyCoherenceNarrative', () => {
  it('returns null when no technology_relationship conclusion exists', () => {
    expect(buildTechnologyCoherenceNarrative(null)).toBeNull();
  });

  it('surfaces the real Phase 9 conclusion text verbatim rather than recomputing coherence', () => {
    const conclusion = makeReasoningConclusion({ conclusion_text: 'Candidate stack shows a tightly connected ecosystem (coherence score 1.00)' });
    const narrative = buildTechnologyCoherenceNarrative(conclusion);
    expect(narrative!.explanation).toBe(conclusion.conclusion_text);
    expect(narrative!.reasoningConclusionId).toBe(conclusion.id);
  });
});

describe('buildExecutiveSummary', () => {
  it('produces a level-aware summary when seniority is known', () => {
    const skills = buildSkillsNarrative(makeBreakdown(), []);
    const seniority = buildSeniorityNarrative('senior', 0.7, 'Senior Backend Engineer');
    const summary = buildExecutiveSummary('Jane Doe', skills, seniority, buildCareerProgressionNarrative(makeTrajectory()));
    expect(summary).toContain('Jane Doe');
    expect(summary).toContain('senior-level');
    expect(summary).toContain('trending ascending');
  });

  it('falls back to a name-only summary when seniority is unknown', () => {
    const skills = buildSkillsNarrative(makeBreakdown(), []);
    const seniority = buildSeniorityNarrative(null, null, null);
    const summary = buildExecutiveSummary('Jane Doe', skills, seniority, null);
    expect(summary).not.toContain('level candidate');
    expect(summary).toContain('Jane Doe');
  });
});
