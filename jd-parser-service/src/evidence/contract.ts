/**
 * TEJOMA Phase 6 - Evidence Intelligence contract.
 *
 * THE QUESTION THIS LAYER ANSWERS
 * Not "does the candidate mention the same word", but "what would prove this requirement, what did
 * the candidate actually show, and what is still missing". A requirement and a skill token matching
 * is the beginning of the analysis, never the end of it.
 *
 * WHY EVIDENCE STATES ARE NOT SCORES
 * A percentage collapses everything a recruiter needs to see. "PARTIALLY_SUPPORTED because Python
 * backend work is proven but only 2 of the required 5 years are datable" and "PARTIALLY_SUPPORTED
 * because the skill is listed but never demonstrated" are the same number and completely different
 * hiring situations. The state, the supporting evidence, and the gap list travel together; Phase 7
 * is where they become a judgement.
 *
 * THE FOUR CONVERSIONS THAT MUST NEVER HAPPEN
 *   a skill-list entry      -> demonstrated production capability
 *   an academic project     -> professional experience
 *   a certification         -> hands-on experience
 *   a graph relationship    -> candidate evidence
 * Each is enforced by an explicit guard, counted by a metric, and asserted by the benchmark. They
 * are the failures that would make this engine actively harmful rather than merely imprecise.
 *
 * NO LLM. Consistent with Phases 3-5, and the reasoning is strongest here: a generative model asked
 * "is this candidate qualified" produces fluent justification for whatever it already concluded,
 * which is indistinguishable from evidence until someone checks the source. Every unit below cites
 * a span that a reviewer can read.
 */

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_ENGINE_VERSION = 1;

// ==================== EVIDENCE STATES ====================

/**
 * Semantic outcomes, ordered strongest to weakest. Deliberately NOT a scale - the absence family at
 * the end are different KINDS of "no", and collapsing them into a low number is what makes a
 * matching system unable to explain itself.
 */
export const EVIDENCE_STATES = [
  'DIRECTLY_SUPPORTED',     // the candidate states doing exactly what the requirement demands
  'STRONGLY_SUPPORTED',     // demonstrated in the right context, one contract element short
  'PARTIALLY_SUPPORTED',    // core concept proven, a material element unmet (usually duration)
  'WEAKLY_SUPPORTED',       // present but only as a claim, or in a weaker context than required
  'INDIRECTLY_SUPPORTED',   // reached through a validated graph relationship, never asserted directly
  'UNSUPPORTED',            // the candidate has rich sources and this simply is not in them
  'CONTRADICTED',           // the candidate explicitly denies it
  'AMBIGUOUS',              // evidence exists but conflicts with itself
  'INSUFFICIENT_EVIDENCE',  // the candidate record is too thin to conclude anything
  'NOT_APPLICABLE',         // the "requirement" carries no requirement force
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/**
 * WHY THE ABSENCE FAMILY IS SPLIT
 * UNSUPPORTED means "we looked at a well-populated profile and it is not there".
 * INSUFFICIENT_EVIDENCE means "the profile is too thin to have told us either way".
 * Phase 7 must be able to tell those apart: the first is weak evidence about the candidate, the
 * second is weak evidence about our data, and treating them alike would penalise candidates for
 * our own parsing gaps.
 */
export const ABSENCE_STATES: ReadonlySet<EvidenceState> =
  new Set(['UNSUPPORTED', 'INSUFFICIENT_EVIDENCE']);

// ==================== EVIDENCE TYPES ====================

export const EVIDENCE_TYPES = [
  'EXPLICIT_SKILL',           // named in a skills column
  'EXPLICIT_TECHNOLOGY',      // named in prose without an action
  'WORK_EXPERIENCE',          // used inside employment
  'PROFESSIONAL_EXPERIENCE',  // employment with a stated professional context
  'PROJECT_EXPERIENCE',       // used in a named project
  'ACADEMIC_PROJECT',         // used in coursework or a degree project
  'PRODUCTION_EVIDENCE',      // ran in production
  'DEPLOYMENT_EVIDENCE',      // shipped or deployed
  'LEADERSHIP_EVIDENCE',      // led, owned, mentored
  'DURATION_EVIDENCE',        // a datable period
  'RECENCY_EVIDENCE',         // recently used
  'DOMAIN_EVIDENCE',          // industry context
  'ROLE_EVIDENCE',            // role family alignment
  'EDUCATION',                // degree
  'CERTIFICATION',            // credential
  'RESPONSIBILITY',           // stated duty
  'CONTEXTUAL_EVIDENCE',      // surrounding context, weaker
  'INDIRECT_EVIDENCE',        // reached via the knowledge graph
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * The hierarchy, derived from Phase 4's own depth ladder rather than invented.
 * Higher rank = stronger proof. Every value is anchored to something Phase 4 already measured, so a
 * reviewer can trace why one type outranks another instead of taking a weight on faith.
 */
export const EVIDENCE_RANK: Record<EvidenceType, number> = {
  EXPLICIT_SKILL: 1,           // Phase 4 DECLARED / DECLARED_ONLY - the weakest possible claim
  EXPLICIT_TECHNOLOGY: 2,      // Phase 4 MENTIONED
  CONTEXTUAL_EVIDENCE: 2,
  INDIRECT_EVIDENCE: 2,        // graph-reached; never outranks a direct statement
  CERTIFICATION: 3,            // a credential is not hands-on work
  EDUCATION: 3,
  ACADEMIC_PROJECT: 3,         // capped here on purpose - see the professional guard
  PROJECT_EXPERIENCE: 4,       // Phase 4 PROJECT_USED
  RESPONSIBILITY: 4,
  DOMAIN_EVIDENCE: 4,
  ROLE_EVIDENCE: 4,
  RECENCY_EVIDENCE: 4,
  DURATION_EVIDENCE: 5,
  WORK_EXPERIENCE: 5,
  PROFESSIONAL_EXPERIENCE: 6,  // Phase 4 PROFESSIONAL_USED
  DEPLOYMENT_EVIDENCE: 6,
  PRODUCTION_EVIDENCE: 7,      // Phase 4 PRODUCTION_USED
  LEADERSHIP_EVIDENCE: 7,      // Phase 4 LEADERSHIP_LEVEL_USE
};

/** Types that may NEVER be presented as professional experience, however many of them exist. */
export const NON_PROFESSIONAL_TYPES: ReadonlySet<EvidenceType> = new Set([
  'EXPLICIT_SKILL', 'EXPLICIT_TECHNOLOGY', 'ACADEMIC_PROJECT',
  'CERTIFICATION', 'EDUCATION', 'INDIRECT_EVIDENCE', 'CONTEXTUAL_EVIDENCE',
]);

/** Types that may NEVER be presented as production experience. */
export const NON_PRODUCTION_TYPES: ReadonlySet<EvidenceType> = new Set([
  ...NON_PROFESSIONAL_TYPES, 'PROJECT_EXPERIENCE', 'WORK_EXPERIENCE',
  'PROFESSIONAL_EXPERIENCE', 'DURATION_EVIDENCE', 'RESPONSIBILITY',
]);

// ==================== SOURCE INDEPENDENCE ====================

/**
 * Independence classes. Several sightings inside ONE class are one underlying claim.
 *
 * A candidate who writes "Python" in primary_skills, secondary_skills and skills has made a single
 * assertion three times, not produced three proofs. Counting them separately is how a matching
 * system rewards resume padding, so aggregation counts CLASSES, never sightings.
 */
export const INDEPENDENCE_CLASSES = ['DECLARATION', 'NARRATIVE', 'PROJECT', 'CREDENTIAL', 'STRUCTURED'] as const;
export type IndependenceClass = (typeof INDEPENDENCE_CLASSES)[number];

export const FIELD_INDEPENDENCE: Record<string, IndependenceClass> = {
  primary_skills: 'DECLARATION', secondary_skills: 'DECLARATION',
  skills: 'DECLARATION', technical_tools: 'DECLARATION',
  resume_text: 'NARRATIVE', resume_summary: 'NARRATIVE',
  projects: 'PROJECT',
  certifications: 'CREDENTIAL',
  education: 'STRUCTURED', highest_qualification: 'STRUCTURED', university: 'STRUCTURED',
  industry_domain: 'STRUCTURED', current_job_title: 'STRUCTURED',
  years_of_experience: 'STRUCTURED', current_company: 'STRUCTURED',
};

// ==================== PROJECT CLASSIFICATION ====================

export const PROJECT_KINDS = [
  'ACADEMIC_PROJECT', 'PERSONAL_PROJECT', 'PROFESSIONAL_PROJECT',
  'OPEN_SOURCE_PROJECT', 'CLIENT_PROJECT', 'PRODUCTION_PROJECT', 'UNKNOWN_PROJECT',
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

// ==================== CONFIDENCE ====================

/** Ordinal, as in every prior phase. No invented probabilities. */
export const CONFIDENCES = ['EXPLICIT', 'HIGH', 'MEDIUM', 'LOW', 'AMBIGUOUS', 'UNRESOLVED'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const DERIVATIONS = ['DIRECT', 'DERIVED', 'INFERRED'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

// ==================== UNITS ====================

export interface EvidenceProvenance {
  source_type: 'CANDIDATE_INTELLIGENCE' | 'KNOWLEDGE_GRAPH';
  source_field: string;
  source_text: string;
  span: [number, number] | null;
  derivation: Derivation;
  confidence: Confidence;
  rule: string;
  /** Phase 4 lineage, so an assessment can be traced to the exact profile it was computed from. */
  candidate_intelligence_hash?: string | null;
}

export interface EvidenceUnit {
  evidence_id: string;
  requirement_id: string;
  concept: string;
  evidence_type: EvidenceType;
  independence_class: IndependenceClass;
  professional: boolean;
  production: boolean;
  academic: boolean;
  context: string | null;
  /** Present only where Phase 4 could date it. Never fabricated. */
  temporal: { months: number | null; recency: string } | null;
  strength: number;              // EVIDENCE_RANK of the type; a rank, not a probability
  provenance: EvidenceProvenance;
}

/**
 * What a requirement demands, derived from the Phase 3 requirement rather than assumed. This is the
 * "what would prove it" step; everything after it is checking the candidate against this contract.
 */
export interface EvidenceContract {
  requirement_id: string;
  concept: string;
  level: string;
  /** Contextual qualifier the requirement carries: production, scripting, mobile, ... */
  required_context: string | null;
  /** Phase 3's own evidence_required list, consumed rather than re-derived. */
  required_evidence: string[];
  requires_professional: boolean;
  requires_production: boolean;
  requires_leadership: boolean;
  minimum_months: number | null;
  requires_recent: boolean;
  /** Conversions explicitly disallowed for this requirement. */
  prohibited_shortcuts: string[];
}

export interface EvidenceGap {
  kind: 'CONTEXT' | 'PROFESSIONAL' | 'PRODUCTION' | 'DURATION' | 'RECENCY' | 'LEADERSHIP' | 'CONCEPT';
  detail: string;
}

export interface RequirementAssessment {
  requirement_id: string;
  concept: string;
  requirement_level: string;
  state: EvidenceState;
  contract: EvidenceContract;
  evidence: EvidenceUnit[];
  /** Contract elements that ARE met, in the requirement's own words. */
  supported: string[];
  gaps: EvidenceGap[];
  /** Honest statements about what the data could not establish. */
  limitations: string[];
  conflicts: { kind: string; detail: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  confidence: Confidence;
  /** Distinct independence classes backing this - the anti-double-count number. */
  independent_sources: number;
}

export interface EvidenceAssessment {
  evidence_schema_version: number;
  evidence_engine_version: number;
  job_id: number | null;
  candidate_id: number | null;
  tenant_id: string;
  assessments: RequirementAssessment[];
  summary: Record<EvidenceState, number>;
  /** Lineage from every upstream phase, so an assessment pins exactly what produced it. */
  lineage: {
    job_intelligence_hash: string | null;
    candidate_intelligence_hash: string | null;
    graph_fingerprint: string | null;
  };
  assessment_hash: string;
}

export interface ValidationIssue { path: string; problem: string }
