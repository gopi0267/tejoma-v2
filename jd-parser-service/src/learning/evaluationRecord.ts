/**
 * Phase 8 model-evaluation record - the fix for the ltr_model_versions.ndcg_at_10 = NULL defect.
 *
 * ROOT CAUSE, ESTABLISHED FROM SOURCE (not inferred)
 * Two independent code paths exist and neither knows about the other:
 *
 *   TRAINING   matching-evaluation-service/src/matching/learningToRank.ts:96-104
 *              calls db.saveLtrModelVersion({ ..., ndcg_at_10: null, is_active: false })
 *              - `null` is a HARDCODED LITERAL. The trainer never evaluates what it trained, so the
 *                column was never going to be populated by this path.
 *
 *   EVALUATION matching-evaluation-service/src/matching/evaluation.ts
 *              computes ndcgAtK/MAP/MRR/precision/recall and writes match_evaluation_runs.
 *              That table has NO model_version column and no foreign key to ltr_model_versions,
 *              so its metrics describe "the scorer, at some moment", not a specific model.
 *
 * Consequently all 8 recorded model versions have ndcg_at_10 NULL while match_evaluation_runs
 * reports ndcg@10 = 0.7751 - and those numbers CANNOT BE CONNECTED. The 0.7751 is not evidence
 * about any model version, and must not be quoted as if it were.
 *
 * A second, quieter defect makes the association impossible even in principle: the Python ranker
 * writes fixed artifact paths (xgb_ranker.joblib / lgbm_ranker.joblib / ranker_meta.joblib) and
 * overwrites them on every run, so the artifact for version N is destroyed by version N+1. A
 * version row therefore cannot be reproduced from disk.
 *
 * THIS FILE DEFINES THE RECORD AND VALIDATES IT. It performs no schema migration and writes
 * nothing - the required schema change is documented in REQUIRED_SCHEMA_CHANGE for separate,
 * explicit authorisation, and is deliberately isolated from production ranking behaviour.
 *
 * NO BACKFILL. The existing 8 rows keep their NULLs. Inventing a metric for a model whose artifact
 * no longer exists would be fabricating evidence.
 */

import type { TenantScopeDeclaration } from './contract.js';
import type { LearningValidationIssue } from './contract.js';

export const EVALUATION_RECORD_VERSION = 1;

/**
 * A metric set that is attributable. Every field answers "of what, on what data, by which model".
 */
export interface ModelEvaluationRecord {
  evaluation_record_version: number;
  /** MUST match a ltr_model_versions.version exactly. The association that is missing today. */
  model_version: string;
  /** Content hash of the exact training set - see dataset.ts datasetVersion(). */
  dataset_version: string;
  evaluation_run_id: string;

  /** Metrics. Null means NOT MEASURED; it never means zero and is never defaulted. */
  ndcg_at_10: number | null;
  map_at_10: number | null;
  mrr: number | null;
  precision_at_10: number | null;
  recall_at_10: number | null;

  training_examples: number;
  training_groups: number;
  evaluation_groups: number;

  /** Which tenants the model saw. A global model must name its authorisation. */
  tenant_scope: TenantScopeDeclaration;

  evaluation_timestamp: string;
  feature_schema_version: number | null;

  /** Upstream semantic-engine versions, so a metric can be tied to the intelligence that fed it. */
  upstream: {
    jd_intelligence_version: number | null;
    candidate_intelligence_version: number | null;
    graph_fingerprint: string | null;
    evidence_engine_version: number | null;
    match_engine_version: number | null;
  };

  /** Artifact identity. Without this the model cannot be reloaded and the metric cannot be reproduced. */
  artifact: {
    /** Content hash of the serialised model. Fixed-path artifacts cannot supply this. */
    artifact_hash: string | null;
    /** Immutable, version-qualified path. The current fixed paths are NOT immutable. */
    artifact_path: string | null;
    immutable: boolean;
  };
}

/**
 * Validate a record before it may be persisted or quoted. Fail-closed: a record that cannot prove
 * what it measured is rejected rather than stored with gaps that later read as facts.
 */
export function validateEvaluationRecord(r: ModelEvaluationRecord): LearningValidationIssue[] {
  const issues: LearningValidationIssue[] = [];

  if (r.evaluation_record_version !== EVALUATION_RECORD_VERSION) {
    issues.push({ path: 'evaluation_record_version', problem: 'unexpected record version' });
  }
  if (!r.model_version) issues.push({ path: 'model_version', problem: 'missing - metric cannot be attributed to a model' });
  if (!r.dataset_version) issues.push({ path: 'dataset_version', problem: 'missing - metric cannot be attributed to a dataset' });
  if (!r.evaluation_run_id) issues.push({ path: 'evaluation_run_id', problem: 'missing' });

  // Metrics must be in range when present. Absent is legal and means NOT MEASURED.
  for (const k of ['ndcg_at_10', 'map_at_10', 'mrr', 'precision_at_10', 'recall_at_10'] as const) {
    const v = r[k];
    if (v !== null && (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1)) {
      issues.push({ path: k, problem: 'metric must be null (not measured) or within 0..1' });
    }
  }

  if (r.tenant_scope.scope === 'SINGLE_TENANT' && !r.tenant_scope.tenant_id) {
    issues.push({ path: 'tenant_scope.tenant_id', problem: 'SINGLE_TENANT scope without a tenant_id' });
  }
  if (r.tenant_scope.scope === 'GLOBAL_AUTHORIZED' && !r.tenant_scope.authorization_reference) {
    issues.push({
      path: 'tenant_scope.authorization_reference',
      problem: 'a global model requires a recorded authorisation reference',
    });
  }
  if (r.training_groups < 1) issues.push({ path: 'training_groups', problem: 'must be at least 1' });
  if (r.evaluation_groups < 1) issues.push({ path: 'evaluation_groups', problem: 'must be at least 1' });

  // Reproducibility gate: a metric on a non-reproducible artifact is an anecdote.
  if (!r.artifact.immutable) {
    issues.push({
      path: 'artifact.immutable',
      problem: 'artifact is not immutable; the model that produced this metric can be overwritten '
        + 'by the next training run, so the metric is not reproducible',
    });
  }
  if (!r.artifact.artifact_hash) {
    issues.push({ path: 'artifact.artifact_hash', problem: 'missing - model identity unverifiable' });
  }
  return issues;
}

/**
 * A model version may be promoted only when its metrics were actually measured, on a named dataset,
 * from a reproducible artifact, within a declared tenant scope.
 *
 * Promotion here means "eligible to be considered", not "activated". Activation remains a separate
 * authorised act; nothing in this codebase flips is_active.
 */
export function isPromotable(r: ModelEvaluationRecord):
{ promotable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const issues = validateEvaluationRecord(r);
  for (const i of issues) reasons.push(`${i.path}: ${i.problem}`);
  if (r.ndcg_at_10 === null) reasons.push('ndcg_at_10 was never measured for this model version');
  if (r.evaluation_groups < 10) {
    reasons.push(`evaluated on ${r.evaluation_groups} groups; a held-out fold below 10 groups `
      + 'cannot detect a regression');
  }
  return { promotable: reasons.length === 0, reasons };
}

/**
 * The schema change required to make attribution possible. DOCUMENTED ONLY - not applied, and not
 * a migration. It is additive and touches no production ranking path.
 */
export const REQUIRED_SCHEMA_CHANGE = {
  rationale:
    'match_evaluation_runs has no model_version column, so its metrics cannot be attributed to a '
    + 'model. ltr_model_versions.ndcg_at_10 is written as a hardcoded NULL by the trainer. Until '
    + 'both are fixed, no LTR model has a defensible quality figure.',
  isolated_from_production_ranking: true,
  additive_only: true,
  changes: [
    'ALTER TABLE match_evaluation_runs ADD COLUMN model_version TEXT NULL '
      + 'REFERENCES ltr_model_versions(version)',
    'ALTER TABLE match_evaluation_runs ADD COLUMN dataset_version TEXT NULL',
    'ALTER TABLE match_evaluation_runs ADD COLUMN tenant_scope TEXT NULL',
    'ALTER TABLE match_evaluation_runs ADD COLUMN feature_schema_version INTEGER NULL',
    'ALTER TABLE ltr_model_versions ADD COLUMN dataset_version TEXT NULL',
    'ALTER TABLE ltr_model_versions ADD COLUMN artifact_hash TEXT NULL',
    'ALTER TABLE ltr_model_versions ADD COLUMN tenant_scope TEXT NULL',
    'ALTER TABLE ltr_model_versions ADD COLUMN label_policy_version INTEGER NULL',
  ],
  non_schema_changes_required: [
    'matching-ml-service/ranker.py must write version-qualified artifact paths instead of '
      + 'overwriting xgb_ranker.joblib / lgbm_ranker.joblib / ranker_meta.joblib',
    'learningToRank.ts must stop writing ndcg_at_10: null and instead evaluate the model it just '
      + 'trained, on a held-out fold, and persist the measured value',
  ],
  explicitly_not_done: 'No backfill of the 8 existing NULL rows. Their artifacts were overwritten '
    + 'and their metrics are unrecoverable; inventing values would fabricate evidence.',
} as const;
