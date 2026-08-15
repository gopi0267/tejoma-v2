/**
 * TEJOMA Phase 4 - Candidate Understanding Engine contract.
 *
 * WHAT THIS LAYER IS
 * Phase 2 says what a candidate record contains. This layer says what the candidate has actually
 * DEMONSTRATED: which skills are backed by work rather than a list, how deeply each was used, in
 * what context, over what period, and with what strength of evidence.
 *
 * THE ONE DISTINCTION EVERYTHING ELSE RESTS ON
 * A skill in a Skills section is a CLAIM. A skill inside "designed production FastAPI services" is
 * EVIDENCE. Collapsing those two is how a matching system ends up ranking a candidate who typed a
 * word above one who did the work, and it is the single most consequential thing this engine must
 * refuse to do. Every skill unit therefore carries an assertion type and an evidence class, and the
 * two are computed from different places in the record.
 *
 * WHY IT LIVES BESIDE THE JD ENGINE
 * Both engines need the same curated 174-entry skills dictionary, the same clause segmentation, and
 * the same negation-scope logic. A second copy of that dictionary in another service would drift
 * within one release and the two sides of a match would silently stop speaking the same language.
 * The engine itself is stateless - it takes a candidate record as an argument exactly as the JD
 * engine takes a job record - so nothing about hosting it here couples it to JD parsing. Renaming
 * the service to reflect that it now hosts both engines is a worthwhile follow-up.
 *
 * NO LLM. Same reasoning as Phase 3, and it binds harder here: the failure mode of a generative
 * model on a resume is inventing employment. Every unit below is traceable to a span.
 */

export const CANDIDATE_INTELLIGENCE_SCHEMA_VERSION = 1;
export const CANDIDATE_ENGINE_VERSION = 1;

// ==================== ASSERTION TYPE ====================

/**
 * WHERE the claim comes from - the §6 requirement, kept separate from how strong the evidence is.
 *   DECLARED     - a Skills/tools column. The candidate asserted it; nothing corroborates it.
 *   MENTIONED    - appears in prose with no action attached ("familiar with Redis").
 *   DEMONSTRATED - appears attached to work the candidate did.
 *   VERIFIED     - corroborated by a structured record (a certification column, a stated employer).
 *   INFERRED     - the engine concluded it from several signals; never presented as a claim.
 *   NEGATED      - the candidate explicitly said they have NOT done it.
 */
export const ASSERTIONS = ['DECLARED', 'MENTIONED', 'DEMONSTRATED', 'VERIFIED', 'INFERRED', 'NEGATED'] as const;
export type Assertion = (typeof ASSERTIONS)[number];

// ==================== SKILL DEPTH ====================

/**
 * Ordered weakest to strongest. Depth is read from the clause the mention sits in, never from the
 * technology itself. "Python" in a skills list and "architected production Python services" differ
 * by five rungs of this ladder and no amount of embedding similarity recovers that difference.
 */
export const SKILL_DEPTHS = [
  'MENTIONED',                  // named, no usage attached
  'USED',                       // some usage stated, context unclear
  'PROJECT_USED',               // used in a named project
  'PROFESSIONAL_USED',          // used in employment
  'PRODUCTION_USED',            // ran in production / deployed / live
  'ADVANCED_ARCHITECTURAL_USE', // designed or architected systems with it
  'LEADERSHIP_LEVEL_USE',       // led or owned work with it
] as const;
export type SkillDepth = (typeof SKILL_DEPTHS)[number];
export const depthRank = (d: SkillDepth): number => SKILL_DEPTHS.indexOf(d);

// ==================== EVIDENCE STRENGTH ====================

export const EVIDENCE_STRENGTHS = [
  'DIRECT',        // the candidate describes doing it, in employment
  'STRONG',        // described in a concrete project
  'MODERATE',      // usage stated without context
  'WEAK',          // adjacent mention
  'DECLARED_ONLY', // a list entry and nothing else
  'INFERRED',      // engine-derived
  'NEGATIVE',      // explicitly denied
  'UNRESOLVED',
] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

// ==================== CONTEXT ====================

/**
 * ACADEMIC and PROFESSIONAL are kept rigidly apart. A college project using Python is not three
 * years of backend engineering, and the brief is explicit that academic work must not leak into
 * professional evidence.
 */
export const CONTEXT_TYPES = [
  'PROFESSIONAL', 'ACADEMIC', 'PERSONAL', 'INTERNSHIP', 'FREELANCE',
  'PRODUCTION', 'RESEARCH', 'VOLUNTEER', 'UNKNOWN',
] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const RECENCIES = ['ACTIVE', 'RECENT', 'HISTORICAL', 'STALE', 'UNKNOWN'] as const;
export type Recency = (typeof RECENCIES)[number];

export const CONFIDENCES = ['EXPLICIT', 'HIGH', 'MEDIUM', 'LOW', 'AMBIGUOUS', 'UNRESOLVED'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const SENIORITIES = [
  'INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL',
  'ARCHITECT', 'MANAGER', 'DIRECTOR',
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const DERIVATIONS = ['EXPLICIT', 'DERIVED', 'ONTOLOGY', 'INFERRED'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

export const LEADERSHIP_KINDS = [
  'MENTORING', 'TEAM_LEADERSHIP', 'PEOPLE_MANAGEMENT', 'ARCHITECTURE_OWNERSHIP',
  'PROJECT_OWNERSHIP', 'STAKEHOLDER_MANAGEMENT', 'DECISION_AUTHORITY',
] as const;
export type LeadershipKind = (typeof LEADERSHIP_KINDS)[number];

export const CREDENTIAL_KINDS = ['CERTIFICATION', 'TRAINING', 'COURSE', 'COURSEWORK', 'SELF_LEARNING'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const AMBIGUITY_TYPES = [
  'UNSPECIFIED_TECHNOLOGY', 'VAGUE_PROFICIENCY', 'UNSPECIFIED_DURATION',
  'UNDATED_EXPERIENCE', 'UNSPECIFIED_ROLE', 'UNSPECIFIED_CONTEXT',
] as const;
export type AmbiguityType = (typeof AMBIGUITY_TYPES)[number];

export const CONTRADICTION_TYPES = [
  'DECLARED_WITHOUT_EVIDENCE',   // claimed expert, nothing demonstrates it
  'SENIORITY_VS_EXPERIENCE',
  'CHRONOLOGY_OVERLAP',          // two full-time roles at once
  'CHRONOLOGY_IMPOSSIBLE',       // end before start, or future dates
  'NEGATED_BUT_DECLARED',        // listed in skills AND explicitly denied in prose
  'DURATION_CONFLICT',           // stated total disagrees with the timeline
] as const;
export type ContradictionType = (typeof CONTRADICTION_TYPES)[number];

// ==================== PROVENANCE ====================

/**
 * Answers "why does Tejoma believe this?" with an exact source trail. The validator re-reads the
 * recorded span in the original field and requires the quoted text to be there, so a fabricated
 * citation is a hard failure rather than a convincing string.
 */
export interface Provenance {
  source_field: string;
  source_text: string;
  span: [number, number] | null;
  derivation: Derivation;
  confidence: Confidence;
  rule: string;
}

// ==================== UNITS ====================

export interface SkillUnit {
  skill: string;
  category: string | null;
  assertion: Assertion;
  depth: SkillDepth;
  evidence_strength: EvidenceStrength;
  context_type: ContextType;
  recency: Recency;
  /** Every place this skill was found, after multi-source reconciliation. */
  supporting_evidence: Provenance[];
  provenance: Provenance;
}

export interface TechnologyUsage {
  name: string;
  category: string | null;
  relationships: { type: string; target: string }[];
  /** Usage verbs actually attached to this technology in the text - never inferred from the name. */
  usage: string[];
  provenance: Provenance;
}

export interface CapabilityUnit {
  capability: string;
  assertion: Assertion;
  context_type: ContextType;
  provenance: Provenance;
}

export interface ExperienceEntry {
  organization: string | null;
  role: string | null;
  start: string | null;          // ISO yyyy-MM
  end: string | null;            // ISO yyyy-MM, or null for ongoing
  ongoing: boolean;
  months: number | null;
  context_type: ContextType;
  provenance: Provenance;
}

export interface ProjectUnit {
  name: string;
  technologies: string[];
  capabilities: string[];
  context_type: ContextType;
  provenance: Provenance;
}

export interface EducationUnit {
  qualification: string | null;
  field: string | null;
  institution: string | null;
  graduation_year: number | null;
  provenance: Provenance;
}

export interface CredentialUnit {
  name: string;
  kind: CredentialKind;
  issuer: string | null;
  provenance: Provenance;
}

export interface LeadershipEvidence {
  kind: LeadershipKind;
  scope: string | null;          // "8 engineers", "multiple services"
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
  detail: string;
  provenance: Provenance;
}

export interface Contradiction {
  type: ContradictionType;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  resolution_status: 'UNRESOLVED';   // Phase 4 records; it never picks a winner.
  left: { claim: string; provenance: Provenance };
  right: { claim: string; provenance: Provenance };
}

export interface CareerEvent {
  order: number;
  kind: 'EDUCATION' | 'EMPLOYMENT' | 'PROJECT';
  label: string;
  start: string | null;
  end: string | null;
  provenance: Provenance;
}

// ==================== PROFILE ====================

export interface CandidateIntelligenceProfile {
  intelligence_schema_version: number;
  engine_version: number;
  candidate_id: number | null;

  current_role: string | null;
  role_family: string | null;
  /** Role family read from evidence rather than title, with its own confidence. */
  evidence_role_family: string | null;
  seniority: SeniorityAssessment;

  skills: SkillUnit[];
  technologies: TechnologyUsage[];
  capabilities: CapabilityUnit[];
  experience: ExperienceEntry[];
  projects: ProjectUnit[];
  education: EducationUnit[];
  credentials: CredentialUnit[];
  leadership: LeadershipEvidence[];
  domains: { domain: string; provenance: Provenance }[];
  career_chronology: CareerEvent[];

  /** Total months of professional experience the TIMELINE supports; null when undatable. */
  timeline_months: number | null;
  /** What the candidate states, kept separate from what the timeline proves. */
  stated_experience: string | null;

  ambiguities: Ambiguity[];
  contradictions: Contradiction[];
  confidence: Confidence;

  source_hash: string | null;
  representation_hash: string | null;
  intelligence_hash: string;
}
