/**
 * TEJOMA Phase 7 - Semantic Matching & Reasoning contract.
 *
 * THE QUESTION THIS LAYER ANSWERS
 * Not "are the JD and the resume similar", but "which of this job's stated requirements does this
 * candidate actually satisfy, how strongly, on what evidence, and what is missing". Similarity is a
 * property of two texts; satisfaction is a property of a requirement and a proof.
 *
 * WHAT THIS REPLACES - NOTHING.
 * The production matcher (matching-scoring-service) computes
 *   feature_score = jaccard*0.40 + expScore*0.35 + locScore*0.15 + salScore*0.10
 * blended with an ML ensemble. That path is untouched by this engine. Phase 7 runs in shadow and
 * emits its own profile; no production score, ranking or candidate ordering is read or written here.
 *
 * WHY THE PRODUCTION MATCHER IS NOT ENOUGH (the thing this phase exists to fix)
 * `expScore = candidateExp >= jobExp ? 100 : ratio` gives a candidate with 7 years of data analysis
 * a perfect 100 against "5 years backend engineering". Jaccard gives full skill credit for the token
 * "Kubernetes" in a skills column whether or not the candidate has ever run a cluster. Both are
 * exactly the conversions Phases 4 and 6 exist to refuse, so Phase 7 consumes those phases rather
 * than recomputing over raw text.
 *
 * AUTHORITY ORDER. Phase 6 is authoritative for evidence; Phase 5 for semantic relationships;
 * Phase 3 for what the job demands; Phase 4 for what the candidate has. Phase 7 reasons OVER them
 * and may weaken a conclusion, never strengthen one past its evidence.
 *
 * NO LLM, consistent with Phases 3-6, and no embedding similarity in the authoritative path. A
 * cosine score is not a proof; it cannot cite a span, and §30 of the brief forbids treating it as
 * requirement satisfaction. Embeddings remain what they are upstream: a retrieval aid.
 */

import type { EvidenceState } from '../evidence/contract.js';

export const MATCH_SCHEMA_VERSION = 1;
export const MATCH_ENGINE_VERSION = 1;

// ==================== REQUIREMENT SATISFACTION ====================

/**
 * What the engine concluded about ONE requirement. Deliberately a different vocabulary from Phase 6's
 * evidence states: Phase 6 answers "what evidence exists", Phase 7 answers "is the demand met".
 * A requirement can be WEAKLY_SATISFIED on DIRECTLY_SUPPORTED evidence if the evidence proves a
 * neighbouring concept rather than the demanded one.
 */
export const SATISFACTION_STATES = [
  'SATISFIED',            // the demand is met on evidence of the right kind
  'PARTIALLY_SATISFIED',  // core concept proven, a material element (usually duration) unmet
  'TRANSFERABLE',         // met only through a validated semantic route, never asserted directly
  'WEAKLY_SATISFIED',     // present as a claim, not demonstrated in the required context
  'NOT_SATISFIED',        // the record is rich and the requirement is not met by it
  'CONTRADICTED',         // the candidate explicitly denies it
  'UNKNOWN',              // the record is too thin to conclude - NOT the same as NOT_SATISFIED
  'WAIVED',               // the JD negated or excluded this; there is no demand to meet
  'NOT_APPLICABLE',       // the "requirement" carries no requirement force
] as const;
export type SatisfactionState = (typeof SATISFACTION_STATES)[number];

/**
 * §24. MISSING and UNKNOWN must never collapse.
 * NOT_SATISFIED is a statement about the CANDIDATE. UNKNOWN is a statement about OUR DATA. Scoring
 * policy below excludes UNKNOWN from both sides of the coverage ratio rather than scoring it zero,
 * so a candidate is never penalised for our parsing gaps.
 */
export const UNKNOWN_STATES: ReadonlySet<SatisfactionState> = new Set(['UNKNOWN']);
export const NO_DEMAND_STATES: ReadonlySet<SatisfactionState> = new Set(['WAIVED', 'NOT_APPLICABLE']);

// ==================== SEMANTIC ROUTE ====================

/**
 * HOW the candidate's capability reached the requirement. This is the §9/§15 distinction between
 * equivalence, family membership and mere relatedness, and it is graph-typed rather than guessed.
 *
 * The ordering matters: only EXACT and EQUIVALENT may produce SATISFIED. ENABLING and SAME_FAMILY
 * cap at TRANSFERABLE. RELATED can never satisfy anything - "React" and "React Native" are RELATED_TO
 * and are different jobs.
 */
export const SEMANTIC_ROUTES = [
  'EXACT',        // the candidate has the demanded concept itself
  'EQUIVALENT',   // ALTERNATIVE_TO - a genuine substitute (AWS <-> Azure for "cloud platform")
  'SAME_FAMILY',  // both IS_A the same parent class
  'ENABLING',     // USED_FOR / ENABLES - FastAPI enables REST API development
  'RELATED',      // RELATED_TO - adjacency only, never satisfaction
  'NONE',
] as const;
export type SemanticRoute = (typeof SEMANTIC_ROUTES)[number];

/** Routes that may yield SATISFIED. Everything else caps lower. */
export const SATISFYING_ROUTES: ReadonlySet<SemanticRoute> = new Set(['EXACT', 'EQUIVALENT']);
/** Routes that may yield at most TRANSFERABLE. */
export const TRANSFERABLE_ROUTES: ReadonlySet<SemanticRoute> = new Set(['SAME_FAMILY', 'ENABLING']);

// ==================== ALIGNMENT ====================

export const ALIGNMENTS = ['ALIGNED', 'UNDER', 'OVER', 'UNKNOWN'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const COMPATIBILITIES = ['MATCHED', 'ADJACENT', 'MISMATCHED', 'UNKNOWN', 'NOT_APPLICABLE'] as const;
export type Compatibility = (typeof COMPATIBILITIES)[number];

export const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type MatchConfidence = (typeof CONFIDENCES)[number];

// ==================== SCORING POLICY ====================

/**
 * Requirement weight comes from the JD'S OWN STATED LEVEL, not from an invented importance model.
 * Phase 3 already read the modality of the clause ("must have" vs "is a plus"); re-deriving priority
 * here would mean overruling the employer about their own posting.
 */
export const LEVEL_WEIGHT: Record<string, number> = {
  MANDATORY: 1.0,
  STRONGLY_PREFERRED: 0.6,
  PREFERRED: 0.4,
  OPTIONAL: 0.2,
  CONTEXTUAL: 0,
  INFORMATIONAL: 0,
  EXCLUDED: 0,
};

/**
 * Credit a satisfaction state earns toward coverage. Monotonic with the state ladder and nothing
 * else - there is no tuned constant here, each value is the midpoint of the band the state names.
 */
export const SATISFACTION_CREDIT: Record<SatisfactionState, number> = {
  SATISFIED: 1.0,
  PARTIALLY_SATISFIED: 0.6,
  TRANSFERABLE: 0.4,
  WEAKLY_SATISFIED: 0.25,
  NOT_SATISFIED: 0,
  CONTRADICTED: 0,
  UNKNOWN: 0,          // excluded from the denominator too - see UNKNOWN_STATES
  WAIVED: 0,
  NOT_APPLICABLE: 0,
};

/**
 * Component weights INHERITED FROM THE PRODUCTION CONTRACT rather than invented.
 *
 * matching-scoring-service uses jaccard 0.40 / experience 0.35 / location 0.15 / salary 0.10. Phase 7
 * keeps that emphasis so a shadow comparison is meaningful, mapping each production term to its
 * evidence-aware successor: jaccard -> requirement coverage, expScore -> experience RELEVANCE,
 * location -> location. Salary is dropped because it is a commercial constraint, not a semantic fit
 * signal, and neither Phase 3 nor Phase 4 models it; its 0.10 moves to seniority alignment, which
 * those phases DO model. Every one of these four is reported separately in the decomposition, so a
 * reviewer can recompute the total by hand.
 */
export const COMPONENT_WEIGHT = {
  requirement_coverage: 0.40,
  experience_relevance: 0.35,
  location_fit: 0.15,
  seniority_alignment: 0.10,
} as const;

/** Penalties, applied after the weighted base and reported explicitly as negative contributions. */
export const PENALTY = {
  /** Per unmet MANDATORY requirement, capped by MAX_CRITICAL_PENALTY. */
  critical_gap: 6,
  max_critical_gap: 30,
  /** Per detected JD-vs-candidate contradiction. */
  contradiction: 5,
  max_contradiction: 15,
} as const;

// ==================== UNITS ====================

export interface MatchProvenance {
  /** Which upstream phase asserted this. Phase 7 asserts nothing about the candidate itself. */
  source: 'PHASE_3_JD' | 'PHASE_4_CANDIDATE' | 'PHASE_5_GRAPH' | 'PHASE_6_EVIDENCE' | 'PHASE_7_DERIVED';
  rule: string;
  detail: string;
}

/** One graph hop that justified a non-EXACT route, kept so the reasoning can be audited. */
export interface SemanticLink {
  from: string;
  to: string;
  relationship: string;
  route: SemanticRoute;
  confidence: MatchConfidence;
}

export interface RequirementResult {
  requirement_id: string;
  subject: string;
  level: string;
  negated: boolean;
  state: SatisfactionState;
  /** The Phase 6 verdict this was derived from - never recomputed here. */
  evidence_state: EvidenceState | null;
  route: SemanticRoute;
  /** Populated only when route !== EXACT. */
  semantic_links: SemanticLink[];
  /** The concept the candidate actually has, when it differs from the demanded subject. */
  matched_concept: string | null;
  /** Phase 6 gap kinds carried through, plus any Phase 7 adds. */
  gaps: { kind: string; detail: string }[];
  /** Human-readable justification; every entry cites its source phase. */
  reasoning: string[];
  confidence: MatchConfidence;
  /** Weight this requirement carried in coverage (LEVEL_WEIGHT), and the credit it earned. */
  weight: number;
  credit: number;
  /**
   * Set when this requirement's supporting evidence is the SAME underlying fact as another
   * requirement's. Such a requirement still reports its own state but contributes to the evidence
   * -strength component only once - the §26 anti-double-count rule.
   */
  derivative_of: string | null;
  provenance: MatchProvenance[];
}

/** An OR-group: alternatives the graph says are genuine substitutes for one another. */
export interface CompositeGroup {
  kind: 'OR';
  members: string[];
  state: SatisfactionState;
  satisfied_by: string | null;
  reasoning: string;
}

export interface ExperienceFit {
  required_months: number | null;
  /** Months the timeline supports IN RELEVANT ROLES - never the candidate's career total. */
  relevant_months: number | null;
  /** Total datable months, reported alongside so the gap between them is visible. */
  total_months: number | null;
  alignment: Alignment;
  relevance_basis: string[];
  confidence: MatchConfidence;
  reasoning: string[];
}

export interface TransferableSkill {
  source_capability: string;
  target_capability: string;
  relationship: string;
  route: SemanticRoute;
  reason: string;
  confidence: MatchConfidence;
}

export interface ScoreComponent {
  name: string;
  /** 0-100 before weighting. */
  value: number;
  weight: number;
  /** value * weight, or the raw negative for penalties. */
  contribution: number;
  basis: string;
}

/**
 * The score, always shipped WITH its decomposition (§25). `overall_fit` alone is not a valid output
 * of this engine - the components must sum to it, and a reviewer must be able to recompute it.
 */
export interface OverallFit {
  score: number;
  components: ScoreComponent[];
  penalties: ScoreComponent[];
  confidence: MatchConfidence;
  /** True when too much was UNKNOWN for the score to mean anything. */
  insufficient_data: boolean;
}

export interface MatchIntelligenceProfile {
  match_schema_version: number;
  match_engine_version: number;

  job_id: number | null;
  candidate_id: number | null;
  tenant_id: string;

  overall_fit: OverallFit;

  requirement_results: RequirementResult[];
  composite_groups: CompositeGroup[];

  experience_fit: ExperienceFit;
  seniority_fit: { job: string | null; candidate: string | null; alignment: Alignment; reasoning: string[] };
  domain_fit: { required: string[]; candidate: string[]; compatibility: Compatibility; reasoning: string[] };
  location_fit: { constraints: string[]; compatibility: Compatibility; reasoning: string[] };

  transferable_skills: TransferableSkill[];
  strengths: { subject: string; why: string }[];
  gaps: { subject: string; kind: string; detail: string; critical: boolean }[];
  contradictions: { kind: string; detail: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }[];

  evidence_summary: Record<string, number>;
  reasoning: string[];
  confidence: MatchConfidence;

  /** Lineage from every upstream phase - pins exactly what this was reasoned from. */
  source_hashes: {
    job_intelligence_hash: string | null;
    candidate_intelligence_hash: string | null;
    evidence_assessment_hash: string | null;
    graph_fingerprint: string | null;
    ontology_version: number | null;
    evidence_engine_version: number;
  };
  match_hash: string;
}

export interface MatchValidationIssue { path: string; problem: string }
