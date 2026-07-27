// Enterprise AI Matching Architecture, Phase 3 - Feedback Learning Engine.
//
// Widens the RandomForest/XGBoost/LightGBM ensemble's training-label taxonomy to use every real
// signal already tracked for a (candidate, job) pair - not just a bare swipe accept/reject. Two
// widenings, both grounded in data that already exists; nothing fabricated:
//
//   1. swipes.action = 0.5 ("saved/shortlisted, not yet decided") was previously DISCARDED
//      entirely by trainModelOnStartup (`swipe.action !== 0 && swipe.action !== 1` filtered it
//      out - see services.ts before this phase). It's real recruiter interest, weaker than a
//      full accept - now included as a positive-leaning label at reduced confidence (a per-
//      sample weight), instead of thrown away.
//   2. candidate_application_status - when a swipe's (candidate, job) pair was later
//      corroborated by a real downstream status change (shortlisted/accepted strengthens "good
//      match"; rejected strengthens/overrides toward "bad match"), that swipe's sample weight is
//      boosted, and a status that contradicts an earlier positive swipe/save overrides the label
//      to trust the more recent, more concrete signal. This reuses the SAME (candidate, job)
//      pair already labeled by the swipe - not a second, independent label source - so the
//      classifier's target concept ("will this pairing succeed") stays well-defined.
//
// Deliberately NOT merged into this signal set: candidate_decisions (the candidate's OWN
// swipe-right/apply on a job). That measures candidate preference - a different construct from
// "is this candidate a good fit for this job" (the question this recruiter-facing ensemble
// answers). Blending the two label sources without a validated modeling decision is exactly the
// kind of choice this project's standing "stop and ask on architectural ambiguity" rule exists
// for - left out rather than merged silently. WeightedTrainingSample's `sources` field is
// already evidence-list-shaped so a future phase can add it as its own explicit, deliberately
// decided label source without restructuring this module.
//
// Fabricated funnel stages (interview, offer, joined, withdrawn, viewed, etc.) do NOT exist
// anywhere in this schema - confirmed absent from every table, not even as inert columns - and
// are not represented here at all, per explicit instruction.

import type { Swipe } from '../types.js';

export type SignalSource = 'swipe' | 'application_status_corroboration';

export interface WeightedTrainingSample {
  candidateId: number;
  jobId: number;
  features: number[];
  label: 0 | 1;
  weight: number; // 0-1, confidence in this label - fed to the ensemble as a per-sample weight
  sources: SignalSource[];
}

// A bare, real recruiter decision (accept/reject) is always trusted fully. A save is real
// interest but genuinely less certain than a decision, so it starts lower. Bounded, documented,
// conservative.
export const FULL_DECISION_WEIGHT = 1.0;
export const SAVE_WEIGHT = 0.5;
export const STATUS_CORROBORATION_BOOST = 0.25;

const REAL_APPLICATION_STATUSES_INDICATING_POSITIVE = new Set(['shortlisted', 'accepted']);
const REAL_APPLICATION_STATUSES_INDICATING_NEGATIVE = new Set(['rejected']);

export interface ApplicationStatusLookupKey {
  candidateId: number;
  jobId: number;
}

// Pure function: takes already-fetched swipes + a candidate/job-keyed status map (both real DB
// reads, done by the caller) and a per-swipe feature-vector resolver, and returns the widened,
// weighted training set. No DB/network access itself - fully unit-testable.
export function resolveTrainingSamples(
  swipes: Swipe[],
  applicationStatusByCandidateJob: Map<string, string>,
  featureVectorFor: (swipe: Swipe) => number[] | null
): WeightedTrainingSample[] {
  const samples: WeightedTrainingSample[] = [];

  for (const swipe of swipes) {
    let label: 0 | 1;
    let weight: number;
    const sources: SignalSource[] = ['swipe'];

    if (swipe.action === 1) {
      label = 1;
      weight = FULL_DECISION_WEIGHT;
    } else if (swipe.action === 0) {
      label = 0;
      weight = FULL_DECISION_WEIGHT;
    } else if (swipe.action === 0.5) {
      // A save leans positive - the recruiter chose not to reject - but is genuinely less
      // certain than a real decision, hence the reduced weight rather than a full-confidence 1.
      label = 1;
      weight = SAVE_WEIGHT;
    } else {
      continue; // unknown/invalid action value - never guess a label
    }

    const status = applicationStatusByCandidateJob.get(`${swipe.candidate_id}:${swipe.job_id}`);
    if (status && REAL_APPLICATION_STATUSES_INDICATING_POSITIVE.has(status)) {
      weight = Math.min(1, weight + STATUS_CORROBORATION_BOOST);
      sources.push('application_status_corroboration');
    } else if (status && REAL_APPLICATION_STATUSES_INDICATING_NEGATIVE.has(status) && label === 1) {
      label = 0;
      weight = Math.min(1, weight + STATUS_CORROBORATION_BOOST);
      sources.push('application_status_corroboration');
    }

    const features = featureVectorFor(swipe);
    if (!features) continue; // no matching candidate/job data to build features from - skip, never fabricate

    samples.push({ candidateId: swipe.candidate_id, jobId: swipe.job_id, features, label, weight, sources });
  }

  return samples;
}
