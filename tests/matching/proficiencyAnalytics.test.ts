import { describe, it, expect } from 'vitest';
import {
  bucketForMultiplier,
  computeAcceptanceRateByBucket,
  computeScoreMovementSummary,
  latestPerJobCandidate,
  computeRankingImpact,
  computeAcceptanceRateByProgressionType,
  computeCareerScoreMovementSummary,
  computeCareerRankingImpact,
  computeAcceptanceRateByRoleExpectation,
  computeRecencyScoreMovementSummary,
  computeRecencyRankingImpact,
} from '../../src/matching/proficiencyAnalytics.js';

// Enterprise AI Matching Architecture, Phase 11B - Proficiency Analytics. Pure functions only -
// computeProficiencyAnalyticsSummary needs the DB and is covered by the integration test pass
// instead. All of this analyzes real shadow data already collected by Phase 11 - none of it
// affects a live score (see the module's own doc comment).

describe('bucketForMultiplier', () => {
  it('buckets below/neutral/above around the neutral band', () => {
    expect(bucketForMultiplier(0.85)).toBe('below');
    expect(bucketForMultiplier(1.0)).toBe('neutral');
    expect(bucketForMultiplier(1.2)).toBe('above');
  });
});

describe('computeAcceptanceRateByBucket', () => {
  it('skips rows with no recorded decision - never treats missing data as a rejection', () => {
    const result = computeAcceptanceRateByBucket([{ overall_multiplier: 1.2, decision_action: null }]);
    const above = result.find((b) => b.bucket === 'above')!;
    expect(above.sampleSize).toBe(0);
    expect(above.acceptanceRate).toBeNull();
  });

  it('computes real acceptance rate per bucket', () => {
    const rows = [
      { overall_multiplier: 1.2, decision_action: 1 },
      { overall_multiplier: 1.15, decision_action: 0 },
      { overall_multiplier: 0.8, decision_action: 0 },
      { overall_multiplier: 0.85, decision_action: 0 },
    ];
    const result = computeAcceptanceRateByBucket(rows);
    const above = result.find((b) => b.bucket === 'above')!;
    const below = result.find((b) => b.bucket === 'below')!;
    expect(above.sampleSize).toBe(2);
    expect(above.acceptanceRate).toBeCloseTo(0.5, 4);
    expect(below.sampleSize).toBe(2);
    expect(below.acceptanceRate).toBe(0);
  });

  it('treats a "save" decision (0.5) as not-accepted, only action=1 counts', () => {
    const result = computeAcceptanceRateByBucket([{ overall_multiplier: 1.0, decision_action: 0.5 }]);
    const neutral = result.find((b) => b.bucket === 'neutral')!;
    expect(neutral.acceptedCount).toBe(0);
    expect(neutral.sampleSize).toBe(1);
  });
});

describe('computeScoreMovementSummary', () => {
  it('handles an empty dataset without fabricating a number', () => {
    const summary = computeScoreMovementSummary([]);
    expect(summary.sampleSize).toBe(0);
    expect(summary.meanDelta).toBeNull();
  });

  it('computes real mean/median delta and direction counts', () => {
    const rows = [
      { base_match_score: 50, proficiency_adjusted_score: 60 }, // +10
      { base_match_score: 50, proficiency_adjusted_score: 40 }, // -10
      { base_match_score: 50, proficiency_adjusted_score: 50 }, // 0
    ];
    const summary = computeScoreMovementSummary(rows);
    expect(summary.sampleSize).toBe(3);
    expect(summary.meanDelta).toBeCloseTo(0, 4);
    expect(summary.increasedCount).toBe(1);
    expect(summary.decreasedCount).toBe(1);
    expect(summary.unchangedCount).toBe(1);
  });
});

describe('latestPerJobCandidate', () => {
  it('keeps only the first (most recent) row per job+candidate pair', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 60, proficiency_adjusted_score: 65, computed_at: 't2' },
      { job_id: 1, candidate_id: 1, base_match_score: 60, proficiency_adjusted_score: 55, computed_at: 't1' },
      { job_id: 1, candidate_id: 2, base_match_score: 70, proficiency_adjusted_score: 70, computed_at: 't1' },
    ];
    const result = latestPerJobCandidate(rows);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.candidate_id === 1)!.proficiency_adjusted_score).toBe(65);
  });
});

describe('computeRankingImpact', () => {
  it('ignores jobs with fewer than 2 candidates - no ranking to compare', () => {
    const rows = [{ job_id: 1, candidate_id: 1, base_match_score: 60, proficiency_adjusted_score: 70, computed_at: 't1' }];
    const summary = computeRankingImpact(rows);
    expect(summary.jobsEvaluated).toBe(0);
    expect(summary.percentChanged).toBeNull();
  });

  it('detects when the top-ranked candidate changes under the adjusted score', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 80, proficiency_adjusted_score: 75, computed_at: 't1' }, // was #1, now #2
      { job_id: 1, candidate_id: 2, base_match_score: 70, proficiency_adjusted_score: 90, computed_at: 't1' }, // was #2, now #1
    ];
    const summary = computeRankingImpact(rows);
    expect(summary.jobsEvaluated).toBe(1);
    expect(summary.jobsWhereTopCandidateChanged).toBe(1);
    expect(summary.percentChanged).toBe(100);
  });

  it('reports no change when the top candidate stays the same under both scores', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 80, proficiency_adjusted_score: 85, computed_at: 't1' },
      { job_id: 1, candidate_id: 2, base_match_score: 70, proficiency_adjusted_score: 72, computed_at: 't1' },
    ];
    const summary = computeRankingImpact(rows);
    expect(summary.jobsWhereTopCandidateChanged).toBe(0);
    expect(summary.percentChanged).toBe(0);
  });
});

// Enterprise AI Matching Architecture, Phase 12 - Career Analytics (same shadow-log, extra
// columns). Pure functions only.

describe('computeAcceptanceRateByProgressionType', () => {
  it('skips rows with no decision or no career_progression_type - never fabricates from missing data', () => {
    const result = computeAcceptanceRateByProgressionType([
      { career_progression_type: null, decision_action: 1 },
      { career_progression_type: 'ic_track', decision_action: null },
    ]);
    expect(result).toHaveLength(0);
  });

  it('computes real acceptance rate per progression type', () => {
    const result = computeAcceptanceRateByProgressionType([
      { career_progression_type: 'ic_track', decision_action: 1 },
      { career_progression_type: 'ic_track', decision_action: 1 },
      { career_progression_type: 'mixed', decision_action: 0 },
    ]);
    const ic = result.find((r) => r.progressionType === 'ic_track')!;
    const mixed = result.find((r) => r.progressionType === 'mixed')!;
    expect(ic.acceptanceRate).toBe(1);
    expect(mixed.acceptanceRate).toBe(0);
  });
});

describe('computeCareerScoreMovementSummary', () => {
  it('only considers rows where a career trajectory existed at decision time', () => {
    const summary = computeCareerScoreMovementSummary([
      { proficiency_adjusted_score: 60, career_adjusted_score: null },
      { proficiency_adjusted_score: 60, career_adjusted_score: 72 },
    ]);
    expect(summary.sampleSize).toBe(1);
    expect(summary.meanDelta).toBeCloseTo(12, 4);
  });
});

describe('computeCareerRankingImpact', () => {
  it('detects a ranking flip caused by the career-adjusted score alone', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 50, proficiency_adjusted_score: 80, career_adjusted_score: 70, computed_at: 't1' },
      { job_id: 1, candidate_id: 2, base_match_score: 50, proficiency_adjusted_score: 70, career_adjusted_score: 90, computed_at: 't1' },
    ];
    const summary = computeCareerRankingImpact(rows);
    expect(summary.jobsEvaluated).toBe(1);
    expect(summary.jobsWhereTopCandidateChanged).toBe(1);
  });

  it('excludes rows with no career_adjusted_score from the comparison entirely', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 50, proficiency_adjusted_score: 80, career_adjusted_score: null, computed_at: 't1' },
      { job_id: 1, candidate_id: 2, base_match_score: 50, proficiency_adjusted_score: 70, career_adjusted_score: null, computed_at: 't1' },
    ];
    const summary = computeCareerRankingImpact(rows);
    expect(summary.jobsEvaluated).toBe(0);
  });
});

// Enterprise AI Matching Architecture, Phase 13 - Recency Analytics (same shadow-log, extra
// columns). Pure functions only.

describe('computeAcceptanceRateByRoleExpectation', () => {
  it('skips rows with no decision or no recency_role_expectation snapshot', () => {
    const result = computeAcceptanceRateByRoleExpectation([
      { recency_role_expectation: null, decision_action: 1 },
      { recency_role_expectation: 'high', decision_action: null },
    ]);
    expect(result).toHaveLength(0);
  });

  it('computes real acceptance rate per role expectation', () => {
    const result = computeAcceptanceRateByRoleExpectation([
      { recency_role_expectation: 'high', decision_action: 1 },
      { recency_role_expectation: 'low', decision_action: 0 },
    ]);
    expect(result.find((r) => r.roleExpectation === 'high')!.acceptanceRate).toBe(1);
    expect(result.find((r) => r.roleExpectation === 'low')!.acceptanceRate).toBe(0);
  });
});

describe('computeRecencyScoreMovementSummary', () => {
  it('measures movement from career_adjusted_score when present, falling back to proficiency_adjusted_score otherwise', () => {
    const summary = computeRecencyScoreMovementSummary([
      { career_adjusted_score: 70, proficiency_adjusted_score: 60, recency_adjusted_score: 77 }, // baseline 70 -> delta 7
      { career_adjusted_score: null, proficiency_adjusted_score: 60, recency_adjusted_score: 54 }, // baseline 60 -> delta -6
      { career_adjusted_score: 50, proficiency_adjusted_score: 50, recency_adjusted_score: null }, // excluded
    ]);
    expect(summary.sampleSize).toBe(2);
    expect(summary.increasedCount).toBe(1);
    expect(summary.decreasedCount).toBe(1);
  });
});

describe('computeRecencyRankingImpact', () => {
  it('detects a ranking flip caused by the recency-adjusted score alone', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 50, proficiency_adjusted_score: 70, career_adjusted_score: 80, recency_adjusted_score: 70, computed_at: 't1' },
      { job_id: 1, candidate_id: 2, base_match_score: 50, proficiency_adjusted_score: 70, career_adjusted_score: 70, recency_adjusted_score: 90, computed_at: 't1' },
    ];
    const summary = computeRecencyRankingImpact(rows);
    expect(summary.jobsEvaluated).toBe(1);
    expect(summary.jobsWhereTopCandidateChanged).toBe(1);
  });

  it('excludes rows with no recency_adjusted_score from the comparison entirely', () => {
    const rows = [
      { job_id: 1, candidate_id: 1, base_match_score: 50, proficiency_adjusted_score: 70, career_adjusted_score: 80, recency_adjusted_score: null, computed_at: 't1' },
      { job_id: 1, candidate_id: 2, base_match_score: 50, proficiency_adjusted_score: 70, career_adjusted_score: 70, recency_adjusted_score: null, computed_at: 't1' },
    ];
    expect(computeRecencyRankingImpact(rows).jobsEvaluated).toBe(0);
  });
});
