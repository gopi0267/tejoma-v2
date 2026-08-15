/**
 * Phase 8 label-source register.
 *
 * Every table that could plausibly supply a learning label, classified from a READ-ONLY audit of
 * the live databases rather than from documentation. A source is ELIGIBLE only if it can prove
 * tenant ownership, identify the pair, and carry an ordering timestamp; anything else is REJECTED
 * with the specific reason, so the gap is visible instead of being quietly worked around.
 *
 * Row counts recorded here are the audited values at the time of writing. They are documentation of
 * a measurement, not a runtime dependency - sufficiency is always recomputed live by the audit
 * harness (run-data-audit.ts), never read from this file.
 */

export const ELIGIBILITY = ['ELIGIBLE', 'REJECTED', 'OUTCOME_GAP'] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

export interface LabelSource {
  database: string;
  table: string;
  /** Column proving tenant ownership, or null when the table cannot attribute a row to a tenant. */
  tenantColumn: string | null;
  primaryKey: string | null;
  timestampColumn: string | null;
  jobColumn: string | null;
  candidateColumn: string | null;
  /** What a row MEANS. Never assumed to be a hiring outcome. */
  labelSemantics: string;
  auditedRows: number;
  duplicateRisk: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  replayRisk: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  orderingRisk: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  eligibility: Eligibility;
  reason: string;
}

export const LABEL_SOURCES: LabelSource[] = [
  {
    database: 'tejoma_matching_decision', table: 'swipes',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: 'timestamp',
    jobColumn: 'job_id', candidateColumn: 'candidate_id',
    labelSemantics: 'Recruiter DECISION on a candidate they were shown: action 0=reject, 0.5=save, '
      + '1=accept. NOT a hiring outcome - it says nothing about candidates never surfaced.',
    auditedRows: 120,
    // 120 rows collapse to 87 distinct (job,candidate) pairs: 33 rows are repeat decisions.
    duplicateRisk: 'HIGH',
    // `id` is a serial, not an idempotency key derived from the event, so a re-POST inserts again.
    replayRisk: 'HIGH',
    orderingRisk: 'LOW',
    eligibility: 'ELIGIBLE',
    reason: 'Only source with tenant ownership, pair identity and a timestamp. Usable ONLY after '
      + 'deduplication under the conflict policy; the 33 duplicate rows must not become 33 samples.',
  },
  {
    database: 'tejoma_recruiting', table: 'candidate_decisions',
    tenantColumn: null, primaryKey: 'id', timestampColumn: 'created_at',
    jobColumn: 'job_id', candidateColumn: 'candidate_id',
    labelSemantics: 'Candidate-side decision (action, decision_type).',
    auditedRows: 36,
    duplicateRisk: 'MEDIUM', replayRisk: 'HIGH', orderingRisk: 'LOW',
    eligibility: 'REJECTED',
    reason: 'NO TENANT COLUMN. A row cannot be attributed to a company, so including it would mix '
      + 'unknown-owner labels into a tenant-scoped training set. Excluded until tenant ownership '
      + 'is proven by schema, not inferred by join.',
  },
  {
    database: 'tejoma_recruiting', table: 'candidate_application_status',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: 'created_at',
    jobColumn: 'job_id', candidateColumn: 'candidate_id',
    labelSemantics: 'Application lifecycle status - the closest thing to a BUSINESS OUTCOME.',
    auditedRows: 2,
    duplicateRisk: 'LOW', replayRisk: 'LOW', orderingRisk: 'LOW',
    eligibility: 'OUTCOME_GAP',
    reason: '2 rows, 1 distinct status. Structurally the right source for outcome labels and '
      + 'effectively empty. This is the gap that blocks any claim about hiring quality.',
  },
  {
    database: 'tejoma_recruiting', table: 'saved_candidates',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: null,
    jobColumn: null, candidateColumn: 'candidate_id',
    labelSemantics: 'Recruiter saved a candidate (weak positive interest).',
    auditedRows: 0,
    duplicateRisk: 'LOW', replayRisk: 'LOW', orderingRisk: 'HIGH',
    eligibility: 'OUTCOME_GAP',
    reason: 'Empty, and carries no job column - a save without a job cannot form a ranking group.',
  },
  {
    database: 'tejoma_recruiting', table: 'mutual_matches',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: 'created_at',
    jobColumn: 'job_id', candidateColumn: 'candidate_id',
    labelSemantics: 'Both sides expressed interest - a stronger signal than a one-sided swipe.',
    auditedRows: 10,
    duplicateRisk: 'LOW', replayRisk: 'MEDIUM', orderingRisk: 'LOW',
    eligibility: 'OUTCOME_GAP',
    reason: '10 rows. Correct semantics for a positive label but far too few to train on; usable '
      + 'later as a secondary label once volume exists.',
  },
  {
    database: 'tejoma_matching_scoring', table: 'match_features',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: 'computed_at',
    jobColumn: 'job_id', candidateColumn: 'candidate_id',
    labelSemantics: 'FEATURES, not labels - the incumbent matcher\'s feature vector for a pair.',
    auditedRows: 1562,
    duplicateRisk: 'HIGH', replayRisk: 'LOW', orderingRisk: 'LOW',
    eligibility: 'REJECTED',
    reason: 'Not a label source. Carries feature_schema_version and is the right FEATURE join, but '
      + '1562 rows collapse to 372 distinct pairs across a single tenant.',
  },
  {
    database: 'tejoma_matching_scoring', table: 'match_scores',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: 'computed_at',
    jobColumn: 'job_id', candidateColumn: 'candidate_id',
    labelSemantics: 'The incumbent matcher\'s own output.',
    auditedRows: 1562,
    duplicateRisk: 'HIGH', replayRisk: 'LOW', orderingRisk: 'LOW',
    eligibility: 'REJECTED',
    reason: 'Training on the incumbent\'s scores teaches a model to imitate the system being '
      + 'replaced, including its 60-point floor. This is model output, not ground truth.',
  },
  {
    database: 'tejoma_analytics', table: 'analytics_recent_activity',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: 'created_at',
    jobColumn: null, candidateColumn: null,
    labelSemantics: 'Derived analytics view over swipe events.',
    auditedRows: 60,
    duplicateRisk: 'HIGH', replayRisk: 'HIGH', orderingRisk: 'LOW',
    eligibility: 'REJECTED',
    reason: 'A derived projection of swipes. Using both would double-count the same underlying '
      + 'decision, and it carries no job/candidate identity of its own.',
  },
  {
    database: 'tejoma_recruiting', table: 'career_trajectories',
    tenantColumn: 'company_id', primaryKey: 'id', timestampColumn: null,
    jobColumn: null, candidateColumn: 'candidate_id',
    labelSemantics: 'Intended to hold candidate career progression.',
    auditedRows: 0,
    duplicateRisk: 'NONE', replayRisk: 'NONE', orderingRisk: 'HIGH',
    eligibility: 'OUTCOME_GAP',
    reason: 'Empty.',
  },
];

/** Sources a training query may draw from. Currently exactly one, and only after deduplication. */
export const ELIGIBLE_SOURCES = LABEL_SOURCES.filter((s) => s.eligibility === 'ELIGIBLE');

/**
 * Business outcomes that Tejoma cannot currently observe at all. Documented as gaps rather than
 * approximated from decisions - substituting a swipe for a hire is the failure this register exists
 * to prevent.
 */
export const OUTCOME_CAPTURE_GAPS: { outcome: string; status: string; nearestExisting: string }[] = [
  { outcome: 'APPLICATION_SUBMITTED', status: 'NEARLY EMPTY',
    nearestExisting: 'candidate_application_status (2 rows, 1 distinct status)' },
  { outcome: 'SCREENED', status: 'NOT CAPTURED', nearestExisting: 'none' },
  { outcome: 'INTERVIEWED', status: 'NOT CAPTURED', nearestExisting: 'none' },
  { outcome: 'OFFERED', status: 'NOT CAPTURED', nearestExisting: 'none' },
  { outcome: 'HIRED', status: 'NOT CAPTURED', nearestExisting: 'none - no hire event exists anywhere' },
  { outcome: 'REJECTED_BY_EMPLOYER', status: 'PARTIAL',
    nearestExisting: 'swipes.action=0 and swipes.reason, which is a screening decision, not a rejection after assessment' },
  { outcome: 'WITHDRAWN_BY_CANDIDATE', status: 'NOT CAPTURED', nearestExisting: 'none' },
  { outcome: 'RECRUITER_OVERRIDE', status: 'NOT CAPTURED',
    nearestExisting: 'recruiter_notes (1 row), free text, not a structured override event' },
];
