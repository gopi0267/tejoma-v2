import { describe, it, expect } from 'vitest';
import { computeVolumeSummary, computeSenioritySpread, computeCareerTrackSpread, computeRecencyRoleExpectationSpread, DECIDED_MATCH_THRESHOLD } from '../../src/matching/shadowDataHealth.js';
import type { ProficiencyShadowScore } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 12D - Shadow Data Health Check. Pure functions
// only - computeShadowDataHealth needs the DB and is covered by the integration test pass
// instead. This is purely an on-demand read of real shadow data; nothing here writes anything
// or affects a live score.

function makeRow(overrides: Partial<ProficiencyShadowScore> = {}): ProficiencyShadowScore {
  return {
    id: 1, company_id: 1, candidate_id: 1, job_id: 1, base_match_score: 60,
    proficiency_adjusted_score: 60, overall_multiplier: 1, skill_multipliers: [],
    computed_at: new Date().toISOString(), decision_action: null, career_multiplier: null,
    career_progression_signal: null, career_stability_signal: null, career_domain_signal: null,
    career_adjusted_score: null, career_progression_type: null,
    recency_multiplier: null, recency_adjusted_score: null, recency_role_expectation: null,
    recency_skill_multipliers: null,
    ...overrides,
  };
}

describe('computeVolumeSummary', () => {
  it('handles zero rows without fabricating a percentage', () => {
    const summary = computeVolumeSummary([]);
    expect(summary.totalRows).toBe(0);
    expect(summary.pctWithDecision).toBeNull();
    expect(summary.earliestRow).toBeNull();
    expect(summary.thresholdReached).toBe(false);
  });

  it('counts decided matches and reports the real threshold status', () => {
    const rows = [makeRow({ decision_action: 1 }), makeRow({ decision_action: 0 }), makeRow({ decision_action: null })];
    const summary = computeVolumeSummary(rows);
    expect(summary.totalRows).toBe(3);
    expect(summary.rowsWithDecision).toBe(2);
    expect(summary.decidedMatchThreshold).toBe(DECIDED_MATCH_THRESHOLD);
    expect(summary.thresholdReached).toBe(false); // 2 << 200
  });

  it('reports threshold reached once decided rows meet it', () => {
    const rows = Array.from({ length: DECIDED_MATCH_THRESHOLD }, () => makeRow({ decision_action: 1 }));
    expect(computeVolumeSummary(rows).thresholdReached).toBe(true);
  });

  it('counts distinct candidates and jobs, not raw row count', () => {
    const rows = [makeRow({ candidate_id: 1, job_id: 1 }), makeRow({ candidate_id: 1, job_id: 2 }), makeRow({ candidate_id: 2, job_id: 1 })];
    const summary = computeVolumeSummary(rows);
    expect(summary.distinctCandidates).toBe(2);
    expect(summary.distinctJobs).toBe(2);
  });

  it('computes null rates for proficiency and career independently', () => {
    const rows = [
      makeRow({ overall_multiplier: 1, career_multiplier: 1.1 }),
      makeRow({ overall_multiplier: 1, career_multiplier: null }),
    ];
    const summary = computeVolumeSummary(rows);
    expect(summary.pctNullProficiency).toBe(0); // overall_multiplier is never actually null in practice
    expect(summary.pctNullCareer).toBe(50);
  });
});

describe('computeSenioritySpread', () => {
  it('only counts rows with a real decision, matching the threshold semantics', () => {
    const rows = [makeRow({ job_id: 1, decision_action: null })];
    const spread = computeSenioritySpread(rows, new Map([[1, 'senior']]));
    expect(spread).toHaveLength(0);
  });

  it('falls back to "unknown" for a job with no resolvable seniority', () => {
    const rows = [makeRow({ job_id: 99, decision_action: 1 })];
    const spread = computeSenioritySpread(rows, new Map());
    expect(spread[0]).toEqual({ segment: 'unknown', count: 1 });
  });

  it('aggregates and sorts by count descending', () => {
    const rows = [
      makeRow({ job_id: 1, decision_action: 1 }),
      makeRow({ job_id: 1, decision_action: 1 }),
      makeRow({ job_id: 2, decision_action: 1 }),
    ];
    const spread = computeSenioritySpread(rows, new Map([[1, 'senior'], [2, 'entry']]));
    expect(spread[0]).toEqual({ segment: 'senior', count: 2 });
    expect(spread[1]).toEqual({ segment: 'entry', count: 1 });
  });
});

describe('computeCareerTrackSpread', () => {
  it('skips rows with no decision or no career track snapshot', () => {
    const rows = [
      makeRow({ decision_action: null, career_progression_type: 'ic_track' }),
      makeRow({ decision_action: 1, career_progression_type: null }),
    ];
    expect(computeCareerTrackSpread(rows)).toHaveLength(0);
  });

  it('aggregates real career track counts', () => {
    const rows = [
      makeRow({ decision_action: 1, career_progression_type: 'ic_track' }),
      makeRow({ decision_action: 1, career_progression_type: 'ic_track' }),
      makeRow({ decision_action: 0, career_progression_type: 'mixed' }),
    ];
    const spread = computeCareerTrackSpread(rows);
    expect(spread[0]).toEqual({ segment: 'ic_track', count: 2 });
    expect(spread[1]).toEqual({ segment: 'mixed', count: 1 });
  });
});

describe('computeRecencyRoleExpectationSpread', () => {
  it('skips rows with no decision or no recency_role_expectation snapshot', () => {
    const rows = [makeRow({ decision_action: null, recency_role_expectation: 'high' })];
    expect(computeRecencyRoleExpectationSpread(rows)).toHaveLength(0);
  });

  it('aggregates real role-expectation counts', () => {
    const rows = [
      makeRow({ decision_action: 1, recency_role_expectation: 'high' }),
      makeRow({ decision_action: 1, recency_role_expectation: 'high' }),
      makeRow({ decision_action: 0, recency_role_expectation: 'low' }),
    ];
    const spread = computeRecencyRoleExpectationSpread(rows);
    expect(spread[0]).toEqual({ segment: 'high', count: 2 });
    expect(spread[1]).toEqual({ segment: 'low', count: 1 });
  });
});
