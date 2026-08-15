/**
 * TEJOMA Phase 3 - JD Understanding Engine contract.
 *
 * WHAT THIS LAYER IS
 * Phase 2 answers "what does this JD say?" as canonical semantic units. This layer answers "what is
 * the employer actually asking for?" - requirement strength read from sentence modality, negation
 * scope, experience bound to its subject, seniority triangulated from several signals, capabilities
 * derived from responsibilities, and the ambiguities and contradictions that make a JD hard to
 * satisfy. The output is the authoritative JD-side input for later phases.
 *
 * WHY THERE IS NO LLM IN THIS ENGINE
 * A deliberate architectural decision, not an omission. Phase 3's two hardest gates are determinism
 * (identical input must yield an identical profile) and false-inference control (the engine must
 * never invent a requirement the JD does not contain). A generative model is by construction
 * non-deterministic and its failure mode is fluent invention - the exact failure this phase must
 * bound. Every rule here is instead traceable to a text span a reviewer can read, which is what
 * makes the false-inference rate measurable at all rather than merely asserted. The pipeline keeps
 * a validation boundary that an LLM interpretation stage could later be inserted behind: it would
 * have to survive the same schema, provenance and span checks every unit already passes.
 *
 * THE RULE EVERY ANALYZER OBEYS
 * No intelligence unit exists without a span in the source text. `derivation` says how far the
 * engine travelled from that span - EXPLICIT (the text says it), DERIVED (deterministic transform
 * of the text), ONTOLOGY (a relationship from the curated dictionary), INFERRED (a judgement from
 * several signals). Callers can therefore discard everything above EXPLICIT if they want only what
 * the JD literally states.
 */

// ==================== VERSIONS ====================

/** Bumped when the OUTPUT SHAPE changes. Consumers key compatibility off this. */
export const INTELLIGENCE_SCHEMA_VERSION = 1;

/**
 * Bumped when ANALYSIS BEHAVIOUR changes without the shape changing - a new cue phrase, a changed
 * seniority threshold. Separate from the schema version for the same reason Phase 2 separated
 * source_hash from representation_hash: "the JD changed" and "we got better at reading JDs" are
 * different events, and a consumer needs to tell them apart to decide whether to recompute.
 */
export const ENGINE_VERSION = 1;

// ==================== ENUMS ====================

/**
 * Requirement strength, read from the modality of the clause the requirement sits in - never from
 * the presence of a keyword. "Kubernetes" in "Kubernetes is a plus" and in "must have Kubernetes"
 * is the same token and two entirely different hiring requirements.
 */
export const REQUIREMENT_LEVELS = [
  'MANDATORY',            // must / required / essential / will not be considered without
  'STRONGLY_PREFERRED',   // strongly preferred / highly desirable
  'PREFERRED',            // preferred / desirable / ideally
  'OPTIONAL',             // a plus / bonus / nice to have
  'CONTEXTUAL',           // stated as context of the work, not as a bar to clear
  'INFORMATIONAL',        // mentioned; no requirement force detectable
  'EXCLUDED',             // explicitly negated: "X is not required"
] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

/** How far the engine travelled from the source span. Ordered weakest-claim-first. */
export const DERIVATIONS = ['EXPLICIT', 'DERIVED', 'ONTOLOGY', 'INFERRED'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

/**
 * Confidence is an ordinal evidence class, not a probability. Phase 3 forbids arbitrary numeric
 * confidence, and rightly: a 0.83 that nothing calibrated would be a fabricated statistic. These
 * levels are defined by WHICH EVIDENCE EXISTS, so every value is reproducible and auditable.
 */
export const CONFIDENCES = ['EXPLICIT', 'HIGH', 'MEDIUM', 'LOW', 'AMBIGUOUS', 'UNRESOLVED'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const SENIORITIES = [
  'INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL',
  'ARCHITECT', 'MANAGER', 'DIRECTOR',
] as const;
export type Seniority = (typeof SENIORITIES)[number];

/** Relationship types, shaped for the Phase 5 knowledge graph to consume without translation. */
export const RELATION_TYPES = [
  'IS_A', 'PART_OF', 'USED_FOR', 'REQUIRES', 'RELATED_TO',
  'SUBSKILL_OF', 'SPECIALIZATION_OF', 'ALTERNATIVE_TO', 'DEPENDS_ON', 'ENABLES',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** What a candidate would have to show to actually satisfy a requirement. */
export const EVIDENCE_KINDS = [
  'SKILL_CLAIM',            // appears in a skills list - the weakest possible proof
  'WORK_EXPERIENCE',        // held a role using it
  'PRODUCTION_EXPERIENCE',  // ran it in production, not just touched it
  'PROJECT_EVIDENCE',       // a concrete project
  'DURATION',               // sustained over a stated period
  'RECENCY',                // used recently rather than years ago
  'LEADERSHIP_EVIDENCE',    // led people or owned a decision
  'CREDENTIAL',             // degree or certification
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const AMBIGUITY_TYPES = [
  'UNSPECIFIED_TECHNOLOGY',  // "cloud platforms" - which one?
  'UNSPECIFIED_QUANTITY',    // "strong experience" - how much?
  'UNSPECIFIED_SUBJECT',     // a duration with nothing attached to it
  'VAGUE_QUALIFIER',         // "strong", "solid", "good understanding"
  'MULTIPLE_ROLES',          // one posting, several jobs
  'CONFLICTING_MODALITY',    // required and optional asserted for the same thing
] as const;
export type AmbiguityType = (typeof AMBIGUITY_TYPES)[number];

export const CONTRADICTION_TYPES = [
  'SENIORITY_VS_EXPERIENCE',    // "Senior" with 1-2 years
  'EXPERIENCE_RANGE_CONFLICT',  // 5+ years here, 2 years there
  'MODALITY_CONFLICT',          // required in one clause, optional in another
  'RESPONSIBILITY_VS_SENIORITY',// junior title, org-wide architecture ownership
  'NEGATION_CONFLICT',          // required and explicitly not required
] as const;
export type ContradictionType = (typeof CONTRADICTION_TYPES)[number];

// ==================== PROVENANCE ====================

/**
 * Every unit carries one of these. `span` is a character offset pair into `source_text`, so a
 * reviewer can highlight the exact words that produced the claim. Nothing in this engine may be
 * emitted without it - the validator rejects units whose quoted text is not actually present at
 * the recorded span, which makes a fabricated citation a hard failure rather than a plausible
 * string.
 */
export interface Provenance {
  source_field: string;
  source_text: string;
  span: [number, number] | null;
  derivation: Derivation;
  confidence: Confidence;
  /** Which analyzer produced it - lets a regression bisect to one rule. */
  rule: string;
}

// ==================== UNITS ====================

export interface RequirementUnit {
  /** Canonical subject: a normalized technology, or the literal phrase when not in the dictionary. */
  subject: string;
  /** Dictionary category when known, else null. Never guessed from the token's shape. */
  category: string | null;
  level: RequirementLevel;
  negated: boolean;
  /** Contextual qualifier that changes meaning: "scripting", "production", "reporting". */
  context: string | null;
  evidence_required: EvidenceKind[];
  provenance: Provenance;
}

export interface CapabilityUnit {
  capability: string;
  /** The responsibility phrase this was derived from. */
  from_responsibility: string;
  provenance: Provenance;
}

export interface TechnologyUnit {
  name: string;
  category: string | null;
  relationships: { type: RelationType; target: string }[];
  provenance: Provenance;
}

export interface ExperienceRequirement {
  subject: string | null;
  min_years: number | null;
  max_years: number | null;
  qualifier: 'AT_LEAST' | 'RANGE' | 'EXACT' | 'UNSPECIFIED';
  experience_type: 'GENERAL' | 'PRODUCTION' | 'HANDS_ON' | 'LEADERSHIP' | 'RECENT' | 'RELEVANT';
  evidence_required: EvidenceKind[];
  provenance: Provenance;
}

export interface SeniorityAssessment {
  seniority: Seniority | null;
  signals: { signal: string; suggests: Seniority; provenance: Provenance }[];
  confidence: Confidence;
}

export interface Ambiguity {
  type: AmbiguityType;
  text_span: string;
  possible_interpretations: string[];
  provenance: Provenance;
}

export interface Contradiction {
  type: ContradictionType;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  left: { claim: string; provenance: Provenance };
  right: { claim: string; provenance: Provenance };
}

// ==================== PROFILE ====================

export interface JobIntelligenceProfile {
  intelligence_schema_version: number;
  engine_version: number;
  job_id: number | null;

  role_title: string | null;
  role_family: string | null;
  seniority: SeniorityAssessment;
  hiring_intent: string | null;

  requirements: RequirementUnit[];
  capabilities: CapabilityUnit[];
  technologies: TechnologyUnit[];
  experience_requirements: ExperienceRequirement[];
  education_requirements: RequirementUnit[];
  certification_requirements: RequirementUnit[];
  domain_requirements: RequirementUnit[];
  location_constraints: RequirementUnit[];
  work_constraints: RequirementUnit[];

  ambiguities: Ambiguity[];
  contradictions: Contradiction[];

  /** Whole-profile confidence, derived from unit confidences and conflict count. */
  confidence: Confidence;

  /** Phase 2 lineage. Lets a consumer prove which representation this was computed from. */
  source_hash: string | null;
  representation_hash: string | null;
  /** Over the canonical serialization of this profile, including both version numbers. */
  intelligence_hash: string;
}
