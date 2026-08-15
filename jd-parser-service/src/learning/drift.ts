/**
 * Phase 8 drift and bias MEASUREMENT definitions.
 *
 * Measurement only. Nothing here adapts a model, adjusts a weight or promotes anything - the point
 * is to be able to SEE degradation before a learned model is ever allowed to influence a ranking.
 * A system that can promote a model but cannot detect that the model has decayed is not safer than
 * having no model.
 *
 * Each definition states what it compares, how it is computed, and the threshold at which promotion
 * must be blocked. Thresholds are conservative defaults with reasons, not tuned values.
 */

export const DRIFT_KINDS = [
  'LABEL_DISTRIBUTION', 'SCORE_DISTRIBUTION', 'RANKING', 'TENANT_DISTRIBUTION',
  'JOB_FAMILY_DISTRIBUTION', 'CANDIDATE_DISTRIBUTION', 'ACCEPTANCE_RATE',
  'COLD_START_RATE', 'INSUFFICIENT_DATA_RATE', 'MODEL_VS_PHASE7_DISAGREEMENT',
  'NDCG_DEGRADATION',
] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

export interface DriftDefinition {
  kind: DriftKind;
  compares: string;
  statistic: string;
  /** Value at or beyond which promotion must be blocked. */
  blockThreshold: number;
  unit: string;
  rationale: string;
}

/**
 * Population Stability Index is used for the distribution comparisons because it is the standard
 * for exactly this job in credit/risk scoring, is bounded and interpretable, and needs no
 * distributional assumption. The conventional reading is: < 0.10 stable, 0.10-0.25 moderate shift,
 * > 0.25 significant shift. The block thresholds below sit at the conventional boundaries rather
 * than at values chosen to be easy to pass.
 */
export const DRIFT_DEFINITIONS: DriftDefinition[] = [
  {
    kind: 'LABEL_DISTRIBUTION',
    compares: 'training-set label mix vs the most recent production decision window',
    statistic: 'Population Stability Index over {REJECT, SAVE, ACCEPT}',
    blockThreshold: 0.25, unit: 'PSI',
    rationale: 'If recruiters are now accepting at a materially different rate, a model fitted to '
      + 'the old mix is calibrated to a population that no longer exists.',
  },
  {
    kind: 'SCORE_DISTRIBUTION',
    compares: 'learned score distribution at training vs in production',
    statistic: 'PSI over decile buckets',
    blockThreshold: 0.25, unit: 'PSI',
    rationale: 'A shifted score distribution invalidates any threshold set on the original one.',
  },
  {
    kind: 'RANKING',
    compares: 'ordering produced now vs ordering produced at evaluation, same inputs',
    statistic: 'mean Kendall tau over shared groups',
    blockThreshold: 0.80, unit: 'tau (block BELOW this)',
    rationale: 'Identical inputs must yield a near-identical ordering; a lower tau means something '
      + 'other than the inputs is moving the result.',
  },
  {
    kind: 'TENANT_DISTRIBUTION',
    compares: 'share of training rows per tenant',
    statistic: 'max single-tenant share',
    blockThreshold: 0.80, unit: 'share',
    rationale: 'Directly measures the contamination risk that is real today: 118 of 120 swipes '
      + 'belong to one company, so a global model is that company\'s model.',
  },
  {
    kind: 'JOB_FAMILY_DISTRIBUTION',
    compares: 'Phase 3 role_family mix in training vs production traffic',
    statistic: 'PSI over role families',
    blockThreshold: 0.25, unit: 'PSI',
    rationale: 'A model trained mostly on backend roles should not silently rank nursing roles.',
  },
  {
    kind: 'CANDIDATE_DISTRIBUTION',
    compares: 'Phase 4 seniority and timeline distribution, training vs production',
    statistic: 'PSI over seniority bands',
    blockThreshold: 0.25, unit: 'PSI',
    rationale: 'Detects a change in applicant population that the model has never seen.',
  },
  {
    kind: 'ACCEPTANCE_RATE',
    compares: 'rolling acceptance rate vs the training-window rate',
    statistic: 'absolute difference in proportion',
    blockThreshold: 0.15, unit: 'proportion',
    rationale: 'A feedback loop shows up here first: a model that promotes what recruiters already '
      + 'accept will drive acceptance up regardless of match quality.',
  },
  {
    kind: 'COLD_START_RATE',
    compares: 'share of requests where the job or candidate has no history',
    statistic: 'proportion of requests',
    blockThreshold: 0.50, unit: 'proportion',
    rationale: 'Above this, most traffic is outside the learned regime and the deterministic path '
      + 'is doing the real work; a learned score would be decoration.',
  },
  {
    kind: 'INSUFFICIENT_DATA_RATE',
    compares: 'share of results flagged insufficient_data',
    statistic: 'proportion of results',
    blockThreshold: 0.30, unit: 'proportion',
    rationale: 'A high rate means the gate is firing constantly, which is information about the '
      + 'corpus, not a reason to lower the gate.',
  },
  {
    kind: 'MODEL_VS_PHASE7_DISAGREEMENT',
    compares: 'learned ordering vs Phase 7 deterministic ordering',
    statistic: 'share of pairs whose relative order is inverted',
    blockThreshold: 0.40, unit: 'proportion',
    rationale: 'Some disagreement is the point - that is what learning adds. Wholesale disagreement '
      + 'means the learned layer has stopped being a calibration of Phase 7 and become an '
      + 'unexplained second opinion, which cannot be justified to a recruiter.',
  },
  {
    kind: 'NDCG_DEGRADATION',
    compares: 'candidate model NDCG@10 vs the currently promoted model on the same held-out fold',
    statistic: 'absolute NDCG@10 difference',
    blockThreshold: 0.02, unit: 'NDCG',
    rationale: 'A candidate model that does not beat the incumbent on the SAME fold must not be '
      + 'promoted; 0.02 is a margin wide enough not to be fold noise.',
  },
];

export interface DriftObservation {
  kind: DriftKind;
  value: number;
  window: string;
  observed_at: string;
}

export interface DriftVerdict {
  kind: DriftKind;
  value: number;
  threshold: number;
  blocked: boolean;
  reason: string;
}

/**
 * Compare observations against the definitions. RANKING is the one metric where a LOW value is bad
 * (it is a similarity, not a divergence), which is why the direction is handled explicitly rather
 * than assumed uniform.
 */
export function evaluateDrift(observations: DriftObservation[]): {
  blocked: boolean; verdicts: DriftVerdict[];
} {
  const byKind = new Map(DRIFT_DEFINITIONS.map((d) => [d.kind, d]));
  const verdicts: DriftVerdict[] = [];

  for (const o of observations) {
    const def = byKind.get(o.kind);
    if (!def) continue;
    const lowerIsWorse = def.kind === 'RANKING';
    const blocked = lowerIsWorse ? o.value < def.blockThreshold : o.value >= def.blockThreshold;
    verdicts.push({
      kind: o.kind, value: o.value, threshold: def.blockThreshold, blocked,
      reason: blocked
        ? `${o.kind} at ${o.value} ${lowerIsWorse ? 'below' : 'at or beyond'} `
          + `${def.blockThreshold} ${def.unit} - ${def.rationale}`
        : 'within tolerance',
    });
  }
  return { blocked: verdicts.some((v) => v.blocked), verdicts };
}

/** Population Stability Index. Exported so drift can be computed consistently wherever it is measured. */
export function populationStabilityIndex(
  expected: number[], actual: number[], epsilon = 1e-6,
): number {
  if (expected.length !== actual.length || expected.length === 0) return Number.NaN;
  const se = expected.reduce((a, b) => a + b, 0) || 1;
  const sa = actual.reduce((a, b) => a + b, 0) || 1;
  let psi = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = Math.max(expected[i] / se, epsilon);
    const a = Math.max(actual[i] / sa, epsilon);
    psi += (a - e) * Math.log(a / e);
  }
  return psi;
}
