/**
 * TEJOMA Phase 8 - Learning Foundation contract.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * This file defines the data contract, label policy and output shape that a future learned ranking
 * layer MUST satisfy. It contains no model, no training, no inference and no ranking. Phase 8
 * learning is blocked on a data-sufficiency gate (see sufficiency.ts) that the current corpus does
 * not pass; the foundation exists so that when data does arrive, the rules were written BEFORE
 * anyone had a metric to protect.
 *
 * THE BOUNDARY WITH PHASE 7
 *   Phase 7:  ONE job + ONE candidate  -> deterministic, explainable semantic profile
 *   Phase 8:  MANY candidates + historical feedback -> learned calibration / ordering
 * Phase 8 may never re-derive requirement satisfaction, evidence, ontology relationships,
 * experience relevance or any other Phase 3-7 conclusion. It consumes them as features.
 *
 * THE TWO THINGS THAT MUST NEVER BE CONFLATED
 * A recruiter swipe is a DECISION about a candidate they were shown. It is not evidence that the
 * candidate would have been hired, or that the ones they rejected would not. Treating a swipe as a
 * hiring outcome bakes the incumbent matcher's selection bias into the labels and calls it truth -
 * the candidates a recruiter never saw cannot be in the data at all. DECISION_LABELS and
 * BUSINESS_OUTCOMES are therefore kept in separate vocabularies with separate versioning, and no
 * function in this codebase maps one onto the other.
 */

// ==================== VERSIONS ====================

export const LEARNING_CONTRACT_VERSION = 1;
/** Bump whenever the meaning of a relevance grade changes. Models record the policy they trained under. */
export const LABEL_POLICY_VERSION = 1;
export const PHASE8_SCHEMA_VERSION = 1;
export const PHASE8_ENGINE_VERSION = 1;

// ==================== IDENTITY ====================

/**
 * Every training row must be identifiable and attributable. A row missing ANY of these is dropped,
 * never defaulted - a synthesised tenant_id is how one customer's decisions end up training
 * another customer's model.
 */
export interface TrainingRowIdentity {
  tenant_id: string;
  job_id: number;
  candidate_id: number;
  /** Stable id of the source event. Required for deduplication and replay detection. */
  event_id: string;
  /** ISO 8601. Required for ordering, temporal splitting and late-event detection. */
  event_timestamp: string;
}

export const IDENTITY_FIELDS: readonly (keyof TrainingRowIdentity)[] =
  ['tenant_id', 'job_id', 'candidate_id', 'event_id', 'event_timestamp'] as const;

// ==================== LABELS ====================

/**
 * DECISION LABELS - what a recruiter did with a candidate they were shown.
 *
 * Ordinal, and deliberately the same ordering the existing LTR already uses
 * (matching-evaluation-service/src/matching/learningToRank.ts maps 0 -> 0, 0.5 -> 1, 1 -> 2) so
 * the two cannot silently disagree about what "save" means.
 */
export const DECISION_LABELS = ['REJECT', 'SAVE', 'ACCEPT'] as const;
export type DecisionLabel = (typeof DECISION_LABELS)[number];

/** Ordinal relevance grade. Integers: LightGBM's lambdarank rejects a fractional label. */
export const DECISION_RELEVANCE: Record<DecisionLabel, number> = {
  REJECT: 0,
  SAVE: 1,
  ACCEPT: 2,
};

/**
 * Normalise the raw `swipes.action` value to a decision label.
 *
 * The column is postgres `numeric`, which node-postgres returns as a STRING to preserve precision -
 * the real values arrive as "0.0", "0.5", "1.0", not 0, 0.5, 1. An exact string map keyed on
 * '0'/'0.5'/'1' silently discarded 102 of 120 events when this was first run, which is precisely
 * the kind of quiet mislabel the contract exists to prevent: the pipeline reported a clean run and
 * a corpus 85% smaller than reality.
 *
 * Parsing numerically and matching on value is therefore deliberate, and unrecognised values return
 * null so they are dropped and counted rather than coerced into the nearest grade.
 */
export function normaliseDecisionAction(raw: unknown): DecisionLabel | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'REJECT';
  if (n === 0.5) return 'SAVE';
  if (n === 1) return 'ACCEPT';
  return null;
}

/**
 * BUSINESS OUTCOMES - what actually happened to the candidate.
 *
 * A SEPARATE vocabulary on purpose. These are the labels that would justify a claim about hiring
 * quality; decision labels are not. None of these is currently captured (see labelSources.ts), so
 * every value here is a documented gap rather than a column that exists.
 */
export const BUSINESS_OUTCOMES = [
  'APPLICATION_SUBMITTED', 'SCREENED', 'INTERVIEWED', 'OFFERED', 'HIRED',
  'REJECTED_BY_EMPLOYER', 'WITHDRAWN_BY_CANDIDATE', 'UNKNOWN',
] as const;
export type BusinessOutcome = (typeof BUSINESS_OUTCOMES)[number];

/**
 * Guard against the single most dangerous shortcut available here. Kept as an explicit exported
 * constant rather than a comment so a test can assert the two vocabularies stay disjoint.
 */
export const DECISION_IS_NOT_OUTCOME =
  'A recruiter decision is evidence of recruiter behaviour, not of hiring success. '
  + 'Decision labels may train an ordering; they may never be reported as hiring quality.';

// ==================== DATA RULES ====================

export const CONFLICT_POLICIES = ['LATEST_WINS', 'REJECT_ROW', 'MAJORITY'] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

/**
 * How a (tenant, job, candidate) key with several decisions is resolved.
 *
 * LATEST_WINS by event_timestamp: a recruiter who rejects a candidate and later accepts them has
 * changed their mind, and the most recent decision is the one that reflects their judgement. The
 * superseded events are retained for audit but contribute no training row - counting both would
 * train the model on a contradiction and double the weight of indecisive recruiters.
 *
 * REJECT_ROW is the correct policy when two decisions share a timestamp: the order is genuinely
 * unknown, and guessing is how a silent mislabel enters the set.
 */
export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = 'LATEST_WINS';

export interface DataRules {
  /** Training and evaluation queries must both carry an explicit tenant scope. */
  tenant_scope_required: true;
  /** Rows sharing (tenant, job, candidate) collapse to one under the conflict policy. */
  deduplicate_by: readonly ['tenant_id', 'job_id', 'candidate_id'];
  conflict_policy: ConflictPolicy;
  /** A repeated event_id is a replay and is dropped, not counted twice. */
  replay_protection: 'EVENT_ID_UNIQUE';
  ordering: 'EVENT_TIMESTAMP_ASC';
  /** Any identity field missing => row dropped. Never defaulted, never inferred. */
  missing_identity: 'DROP_ROW';
  /** Ties on event_timestamp cannot be ordered, so the row is dropped rather than guessed. */
  ambiguous_order: 'DROP_ROW';
  /** Splits are temporal, never random - see TEMPORAL_SPLIT_RATIONALE. */
  split_strategy: 'TEMPORAL_BY_GROUP';
}

export const DATA_RULES: DataRules = {
  tenant_scope_required: true,
  deduplicate_by: ['tenant_id', 'job_id', 'candidate_id'],
  conflict_policy: DEFAULT_CONFLICT_POLICY,
  replay_protection: 'EVENT_ID_UNIQUE',
  ordering: 'EVENT_TIMESTAMP_ASC',
  missing_identity: 'DROP_ROW',
  ambiguous_order: 'DROP_ROW',
  split_strategy: 'TEMPORAL_BY_GROUP',
};

/**
 * WHY THE SPLIT IS TEMPORAL AND BY GROUP, NOT RANDOM BY ROW.
 *
 * Two leaks are possible and a random row split causes both. First, the same job appearing in train
 * and test lets the model memorise that job's accepted candidates rather than learn what makes a
 * match - the group is the unit of independent observation in a ranking task, so the split must be
 * by group. Second, a future decision predicting a past one is not a capability the system will
 * have in production; splitting by time is the only split that measures what deployment will
 * actually face.
 */
export const TEMPORAL_SPLIT_RATIONALE =
  'Split by ranking group and by time: random row splits leak the same job into train and test, '
  + 'and non-temporal splits measure a capability production will never have.';

// ==================== TENANT SCOPE ====================

export const TENANT_SCOPES = ['SINGLE_TENANT', 'GLOBAL_AUTHORIZED'] as const;
export type TenantScope = (typeof TENANT_SCOPES)[number];

/**
 * GLOBAL_AUTHORIZED exists so that a global model is possible only as a deliberate, recorded act.
 * The existing LTR trains globally by default (its own trainingDataClient documents the training
 * feeds as "deliberately UNSCOPED"); with 118 of 120 swipes belonging to one company, that global
 * model is that company's preferences served to everyone else. This contract inverts the default:
 * single-tenant unless an authorisation reference is supplied and stored on the model version.
 */
export interface TenantScopeDeclaration {
  scope: TenantScope;
  /** Required and non-empty when scope is SINGLE_TENANT. */
  tenant_id: string | null;
  /** Required when scope is GLOBAL_AUTHORIZED - a reference to the documented approval. */
  authorization_reference: string | null;
}

// ==================== PHASE 8 OUTPUT ====================

/**
 * The shape a future Phase 8 result must take. Every field that could let a result be reproduced,
 * attributed or challenged is mandatory.
 *
 * `deterministic_score` is Phase 7's number and is ALWAYS present. `learned_score` is nullable and
 * is null whenever the sufficiency gate is closed - which, today, is always. A consumer that finds
 * learned_score null must fall back to the deterministic score; that is the whole safety design.
 */
export interface Phase8Result {
  phase8_schema_version: number;
  phase8_engine_version: number;
  label_policy_version: number;

  tenant_scope: TenantScopeDeclaration;
  job_id: number | null;
  candidate_id: number | null;

  /** Phase 7's deterministic output. Authoritative whenever learned_score is null. */
  deterministic_score: number;
  /** Null until the data-sufficiency gate opens. Never fabricated. */
  learned_score: number | null;
  learned_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  /** Position delta this result would apply, or null while shadow-only. */
  ranking_contribution: number | null;

  insufficient_data: boolean;
  /** Which gates failed, in the gate's own words. Empty when sufficient. */
  insufficient_reasons: string[];

  /** Reproducibility: input + model_version + dataset_version + upstream versions. */
  model_version: string | null;
  dataset_version: string | null;
  upstream: {
    jd_intelligence_version: number | null;
    candidate_intelligence_version: number | null;
    graph_fingerprint: string | null;
    evidence_assessment_hash: string | null;
    match_hash: string | null;
    feature_schema_version: number | null;
  };

  explanation: string[];
  computed_at: string;
  result_hash: string;
}

/** Fields a caller may NEVER supply; the engine derives all of them. */
export const CALLER_FORBIDDEN_FIELDS: readonly string[] = [
  'tenant_id', 'tenant_scope', 'label', 'relevance', 'learned_score', 'deterministic_score',
  'model_version', 'dataset_version', 'learned_confidence', 'ranking_contribution',
  'insufficient_data', 'result_hash', 'provenance', 'upstream',
] as const;

export interface LearningValidationIssue { path: string; problem: string }
