import { describe, it, expect } from 'vitest';
import { resolveTrainingSamples, FULL_DECISION_WEIGHT, SAVE_WEIGHT, STATUS_CORROBORATION_BOOST } from '../../src/matching/feedbackSignals.js';
import type { Swipe } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 3 - Feedback Learning Engine. Pure function, no DB
// dependency - resolveTrainingSamples only consumes already-fetched swipes + a status map + an
// injected feature-vector resolver.

function makeSwipe(overrides: Partial<Swipe> = {}): Swipe {
  return {
    id: 1, company_id: 1, recruiter_id: 1, candidate_id: 10, job_id: 100,
    action: 1, match_score: 80, timestamp: new Date().toISOString(), used_for_training: false,
    ...overrides,
  } as Swipe;
}

const dummyFeatures = () => [1, 2, 3, 4, 5, 6, 7, 8];

describe('resolveTrainingSamples - basic label/weight resolution', () => {
  it('a full accept (action=1) gets label 1 at full confidence', () => {
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 1 })], new Map(), dummyFeatures);
    expect(sample.label).toBe(1);
    expect(sample.weight).toBe(FULL_DECISION_WEIGHT);
    expect(sample.sources).toEqual(['swipe']);
  });

  it('a full reject (action=0) gets label 0 at full confidence', () => {
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 0 })], new Map(), dummyFeatures);
    expect(sample.label).toBe(0);
    expect(sample.weight).toBe(FULL_DECISION_WEIGHT);
  });

  it('a save (action=0.5) - previously discarded entirely - is now included as a lower-weight positive', () => {
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 0.5 })], new Map(), dummyFeatures);
    expect(sample.label).toBe(1);
    expect(sample.weight).toBe(SAVE_WEIGHT);
    expect(sample.weight).toBeLessThan(FULL_DECISION_WEIGHT);
  });

  it('skips a swipe with an invalid/unknown action value rather than guessing a label', () => {
    const samples = resolveTrainingSamples([makeSwipe({ action: 99 as any })], new Map(), dummyFeatures);
    expect(samples).toHaveLength(0);
  });

  it('skips a swipe when no feature vector can be resolved (missing candidate/job data)', () => {
    const samples = resolveTrainingSamples([makeSwipe({ action: 1 })], new Map(), () => null);
    expect(samples).toHaveLength(0);
  });
});

describe('resolveTrainingSamples - application_status corroboration', () => {
  it('boosts weight when a real "shortlisted" status corroborates a positive swipe', () => {
    const statusMap = new Map([['10:100', 'shortlisted']]);
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 1, candidate_id: 10, job_id: 100 })], statusMap, dummyFeatures);
    expect(sample.weight).toBeCloseTo(Math.min(1, FULL_DECISION_WEIGHT + STATUS_CORROBORATION_BOOST), 6);
    expect(sample.sources).toContain('application_status_corroboration');
  });

  it('boosts weight when a real "accepted" status corroborates a save', () => {
    const statusMap = new Map([['10:100', 'accepted']]);
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 0.5, candidate_id: 10, job_id: 100 })], statusMap, dummyFeatures);
    expect(sample.weight).toBeCloseTo(Math.min(1, SAVE_WEIGHT + STATUS_CORROBORATION_BOOST), 6);
    expect(sample.label).toBe(1);
  });

  it('flips a positive swipe/save label to negative when later contradicted by a real "rejected" status', () => {
    const statusMap = new Map([['10:100', 'rejected']]);
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 1, candidate_id: 10, job_id: 100 })], statusMap, dummyFeatures);
    expect(sample.label).toBe(0);
    expect(sample.sources).toContain('application_status_corroboration');
  });

  it('does not flip an already-negative swipe (a "rejected" status is consistent, not contradictory)', () => {
    const statusMap = new Map([['10:100', 'rejected']]);
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 0, candidate_id: 10, job_id: 100 })], statusMap, dummyFeatures);
    expect(sample.label).toBe(0);
    expect(sample.weight).toBe(FULL_DECISION_WEIGHT); // unchanged - already fully confident, no corroboration needed
  });

  it('never exceeds a weight of 1 even when a full decision is corroborated', () => {
    const statusMap = new Map([['10:100', 'shortlisted']]);
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 1, candidate_id: 10, job_id: 100 })], statusMap, dummyFeatures);
    expect(sample.weight).toBeLessThanOrEqual(1);
  });

  it('leaves weight untouched when no application_status row exists for this pair (the common case - most candidates have no linked portal account)', () => {
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 1, candidate_id: 10, job_id: 100 })], new Map(), dummyFeatures);
    expect(sample.weight).toBe(FULL_DECISION_WEIGHT);
    expect(sample.sources).toEqual(['swipe']);
  });

  it('an application_status row for a DIFFERENT (candidate,job) pair is never applied (map key must match exactly)', () => {
    const statusMap = new Map([['999:999', 'shortlisted']]);
    const [sample] = resolveTrainingSamples([makeSwipe({ action: 1, candidate_id: 10, job_id: 100 })], statusMap, dummyFeatures);
    expect(sample.weight).toBe(FULL_DECISION_WEIGHT);
  });
});

describe('resolveTrainingSamples - never fabricates interview/offer/joined/withdrawn/viewed stages', () => {
  it('only ever produces label 0 or 1, and only ever these two documented signal sources', () => {
    const statusMap = new Map([['10:100', 'shortlisted']]);
    const samples = resolveTrainingSamples(
      [makeSwipe({ action: 1, candidate_id: 10, job_id: 100 }), makeSwipe({ id: 2, action: 0.5, candidate_id: 20, job_id: 200 })],
      statusMap,
      dummyFeatures
    );
    for (const s of samples) {
      expect([0, 1]).toContain(s.label);
      for (const source of s.sources) {
        expect(['swipe', 'application_status_corroboration']).toContain(source);
      }
    }
  });
});
