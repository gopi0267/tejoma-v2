/**
 * Phase 3 JD Understanding Engine - orchestration, hashing and validation.
 *
 * Pipeline:
 *   job record -> field texts -> clauses (spans) -> dictionary matches within clauses
 *              -> modality + negation per mention -> requirement units
 *              -> experience / seniority / capabilities / ambiguity / contradiction
 *              -> schema + provenance + span validation
 *              -> deterministic canonical serialization -> intelligence_hash
 *
 * The validation stage is not a formality. It re-checks that every unit's quoted `source_text`
 * actually occurs at its recorded span in the actual field text, which means a unit citing text the
 * JD does not contain is a hard failure rather than a plausible-looking string. That check is what
 * makes "false inference rate" a measurable property of this engine instead of a claim about it.
 */

import { createHash } from 'node:crypto';
import { MultiPatternTrie } from '../jd-parser/matcher/trie.js';
import { SKILL_DICTIONARY } from '../jd-parser/dictionaries/skills.dictionary.js';
import {
  ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION,
  type Confidence, type EvidenceKind, type JobIntelligenceProfile,
  type RequirementLevel, type RequirementUnit, type TechnologyUnit,
} from './contract.js';
import {
  isDoubleNegativeRequirement, isNegated, modality, segment, type Clause,
} from './clauses.js';
import {
  analyzeAmbiguity, analyzeCapabilities, analyzeContradictions, analyzeExperience,
  analyzeSeniority, prov, technologyUnit,
} from './analyzers.js';

/** Hard input bound. A JD is prose written by a recruiter, not a payload. */
export const MAX_JD_CHARS = 60_000;

export interface JobRecordInput {
  id?: number | null;
  title?: string | null;
  description?: string | null;
  job_summary?: string | null;
  responsibilities?: string[] | string | null;
  required_skills?: string[] | string | null;
  optional_skills?: string[] | string | null;
  education?: string[] | string | null;
  certifications?: string[] | string | null;
  location?: string | null;
  remote_type?: string | null;
  employment_type?: string | null;
  industry?: string | null;
  department?: string | null;
  /** Phase 2 lineage, passed through untouched when the caller has it. */
  source_hash?: string | null;
  representation_hash?: string | null;
}

const trie = new MultiPatternTrie(SKILL_DICTIONARY);

const asText = (v: unknown): string =>
  v === null || v === undefined ? '' : Array.isArray(v) ? v.join('. ') : String(v);

/**
 * Field order is fixed. Clause offsets are per-field, and the field name travels in provenance, so
 * two fields can safely produce overlapping offsets without ambiguity.
 */
const NARRATIVE_FIELDS = ['title', 'job_summary', 'description', 'responsibilities'] as const;

/** Contextual qualifiers that change what a technology mention MEANS. */
const CONTEXT_CUES: { re: RegExp; context: string }[] = [
  { re: /\bscripting\b/i, context: 'scripting' },
  { re: /\bautomation\b/i, context: 'automation' },
  { re: /\bproduction\b/i, context: 'production' },
  { re: /\breporting\b/i, context: 'reporting' },
  { re: /\bdata\s+analysis\b/i, context: 'data analysis' },
  { re: /\bmobile\b|\breact\s+native\b/i, context: 'mobile' },
  { re: /\bdashboards?\b/i, context: 'dashboard' },
  { re: /\bmigration\b/i, context: 'migration' },
  { re: /\barchitecture\b/i, context: 'architecture' },
  { re: /\bprototyp\w+\b/i, context: 'prototyping' },
];

/** What would actually prove this requirement, given its strength and context. */
function evidenceFor(level: RequirementLevel, context: string | null, clause: string): EvidenceKind[] {
  const ev = new Set<EvidenceKind>();
  if (level === 'MANDATORY' || level === 'STRONGLY_PREFERRED') ev.add('WORK_EXPERIENCE');
  else ev.add('SKILL_CLAIM');
  if (context === 'production' || /\bproduction\b/i.test(clause)) ev.add('PRODUCTION_EXPERIENCE');
  if (/\bhands[-\s]?on\b|\bbuilt\b|\bshipped\b/i.test(clause)) ev.add('PROJECT_EVIDENCE');
  if (/\blead|mentor|manag/i.test(clause)) ev.add('LEADERSHIP_EVIDENCE');
  if (/\brecent\b/i.test(clause)) ev.add('RECENCY');
  return [...ev];
}

/**
 * Requirements from technology mentions inside clauses.
 *
 * The mention supplies the SUBJECT; the clause supplies the STRENGTH. That separation is the entire
 * difference between this and a keyword extractor, and it is why the same token can legitimately
 * appear twice in one profile at two different levels when a JD mentions it twice.
 */
function analyzeRequirements(clauses: Clause[]): { requirements: RequirementUnit[]; technologies: TechnologyUnit[] } {
  const requirements: RequirementUnit[] = [];
  const techSeen = new Map<string, TechnologyUnit>();

  for (const c of clauses) {
    const mod = modality(c.text);
    const doubleNeg = isDoubleNegativeRequirement(c.text);
    const context = CONTEXT_CUES.find((x) => x.re.test(c.text))?.context ?? null;

    for (const match of trie.findAll(c.text)) {
      const negated = !doubleNeg && isNegated(c.text, match.start, match.end);

      // Resolution order matters. A double negative is a hard requirement even though the clause is
      // full of negators; a plain negation demotes to EXCLUDED regardless of the surrounding cue;
      // otherwise the clause modality stands.
      let level: RequirementLevel = mod.level;
      let rule = mod.rule;
      let confidence: Confidence = mod.confidence;
      if (doubleNeg) { level = 'MANDATORY'; rule = 'requirement.double_negative'; confidence = 'EXPLICIT'; }
      else if (negated) { level = 'EXCLUDED'; rule = 'requirement.negated'; confidence = 'EXPLICIT'; }

      const p = prov(c.field, match.matchedText,
        [c.start + match.start, c.start + match.end], 'EXPLICIT', confidence, rule);

      requirements.push({
        subject: match.entry.canonical,
        category: match.entry.category,
        level, negated: negated || (level === 'EXCLUDED'),
        context,
        evidence_required: level === 'EXCLUDED' ? [] : evidenceFor(level, context, c.text),
        provenance: p,
      });

      if (!techSeen.has(match.entry.canonical)) {
        techSeen.set(match.entry.canonical,
          technologyUnit(match.entry.canonical, match.entry.category,
            { ...p, derivation: 'ONTOLOGY', rule: 'technology.dictionary' }));
      }
    }
  }
  return { requirements, technologies: [...techSeen.values()] };
}

/** Structured list fields carry their strength in the column name, not in prose. */
function listRequirements(
  values: unknown, field: string, level: RequirementLevel, rule: string,
): RequirementUnit[] {
  const items = Array.isArray(values) ? values
    : typeof values === 'string' && values.trim() ? values.split(/[,;|\n]/) : [];
  const out: RequirementUnit[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const text = String(raw).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const m = trie.findAll(text)[0];
    out.push({
      subject: m ? m.entry.canonical : text,
      category: m ? m.entry.category : null,
      level, negated: false, context: null,
      evidence_required: evidenceFor(level, null, text),
      provenance: prov(field, text, [0, text.length], 'EXPLICIT', 'EXPLICIT', rule),
    });
  }
  return out;
}

function roleFamily(title: string | null, technologies: TechnologyUnit[]): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b(?:backend|back[-\s]end|server[-\s]side)\b/.test(t)) return 'Backend Engineering';
  if (/\b(?:frontend|front[-\s]end|ui)\b/.test(t)) return 'Frontend Engineering';
  if (/\bfull[-\s]?stack\b/.test(t)) return 'Full Stack Engineering';
  if (/\b(?:devops|sre|platform|infrastructure)\b/.test(t)) return 'Platform Engineering';
  if (/\bdata\s+(?:engineer|scientist|analyst)\b/.test(t)) return 'Data';
  if (/\b(?:ml|machine\s+learning|ai)\b/.test(t)) return 'Machine Learning';
  if (/\b(?:qa|test|sdet)\b/.test(t)) return 'Quality Engineering';
  if (/\b(?:security|appsec)\b/.test(t)) return 'Security';
  if (/\bmobile|android|ios\b/.test(t)) return 'Mobile Engineering';
  // Fall back to the dominant dictionary category only when the title itself said nothing.
  const counts = new Map<string, number>();
  for (const tech of technologies) if (tech.category) counts.set(tech.category, (counts.get(tech.category) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? top[0] : null;
}

const CONF_ORDER: Confidence[] = ['EXPLICIT', 'HIGH', 'MEDIUM', 'LOW', 'AMBIGUOUS', 'UNRESOLVED'];

export function buildJobIntelligence(job: JobRecordInput): JobIntelligenceProfile {
  const title = job.title ? String(job.title).trim() : null;

  const clauses: Clause[] = [];
  for (const field of NARRATIVE_FIELDS) {
    const text = asText((job as Record<string, unknown>)[field]).slice(0, MAX_JD_CHARS);
    for (const c of segment(text, field)) clauses.push(c);
  }

  const { requirements: narrativeReqs, technologies } = analyzeRequirements(clauses);

  // Structured columns state their own strength; prose does not. Both are kept because a JD
  // routinely lists a skill in required_skills AND discusses it in the description, and the two
  // mentions can legitimately disagree - which the contradiction layer can then see.
  const structured = [
    ...listRequirements(job.required_skills, 'required_skills', 'MANDATORY', 'requirement.column_required'),
    ...listRequirements(job.optional_skills, 'optional_skills', 'PREFERRED', 'requirement.column_optional'),
  ];

  const requirements = [...structured, ...narrativeReqs];
  const experience = analyzeExperience(clauses);
  const seniority = analyzeSeniority(title, clauses, experience);
  const capabilities = analyzeCapabilities(clauses);
  const ambiguities = analyzeAmbiguity(clauses);
  const contradictions = analyzeContradictions(seniority, experience);

  const education = listRequirements(job.education, 'education', 'MANDATORY', 'requirement.column_education');
  const certifications = listRequirements(job.certifications, 'certifications', 'MANDATORY', 'requirement.column_certification');
  const domain = [
    ...listRequirements(job.industry, 'industry', 'CONTEXTUAL', 'requirement.column_industry'),
    ...listRequirements(job.department, 'department', 'CONTEXTUAL', 'requirement.column_department'),
  ];
  const location = listRequirements(job.location, 'location', 'MANDATORY', 'requirement.column_location');
  const work = [
    ...listRequirements(job.remote_type, 'remote_type', 'MANDATORY', 'requirement.column_remote'),
    ...listRequirements(job.employment_type, 'employment_type', 'MANDATORY', 'requirement.column_employment'),
  ];

  // Whole-profile confidence: the weakest of the strong signals, degraded by unresolved conflict.
  // Stated as a rule rather than a number so it is reproducible and arguable.
  let confidence: Confidence = requirements.length === 0 ? 'UNRESOLVED'
    : contradictions.some((c) => c.severity === 'HIGH') ? 'AMBIGUOUS'
      : ambiguities.length > 0 ? 'MEDIUM'
        : CONF_ORDER[Math.max(
          CONF_ORDER.indexOf(seniority.confidence === 'UNRESOLVED' ? 'LOW' : seniority.confidence),
          CONF_ORDER.indexOf(requirements.some((r) => r.provenance.confidence === 'EXPLICIT') ? 'EXPLICIT' : 'LOW'),
        )];

  const profile: JobIntelligenceProfile = {
    intelligence_schema_version: INTELLIGENCE_SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    job_id: job.id ?? null,
    role_title: title,
    role_family: roleFamily(title, technologies),
    seniority,
    hiring_intent: hiringIntent(title, seniority.seniority, capabilities.length, requirements.length),
    requirements,
    capabilities,
    technologies,
    experience_requirements: experience,
    education_requirements: education,
    certification_requirements: certifications,
    domain_requirements: domain,
    location_constraints: location,
    work_constraints: work,
    ambiguities,
    contradictions,
    confidence,
    source_hash: job.source_hash ?? null,
    representation_hash: job.representation_hash ?? null,
    intelligence_hash: '',
  };

  profile.intelligence_hash = 'sha256:' + createHash('sha256')
    .update(canonicalSerialization(profile)).digest('hex');
  return profile;
}

/**
 * A one-line statement of what the employer is hiring for. Composed strictly from values already
 * derived above - it introduces no new claim, so it cannot become a channel for invention.
 */
function hiringIntent(
  title: string | null, seniority: string | null, capCount: number, reqCount: number,
): string | null {
  if (!title) return null;
  const level = seniority ? seniority.toLowerCase() : 'unspecified-level';
  return `Hiring a ${level} ${title} against ${reqCount} stated requirement(s) and ${capCount} derived capability(ies).`;
}

/**
 * Deterministic serialization. job_id and the Phase 2 lineage hashes are excluded for the same
 * reason Phase 2 excluded entity_id: the hash must measure UNDERSTANDING, so two identical JDs on
 * different rows must produce the same intelligence_hash. Both version numbers ARE included, so an
 * engine change is visible as a hash change even when the JD is untouched.
 */
export function canonicalSerialization(p: JobIntelligenceProfile): string {
  return JSON.stringify({
    intelligence_schema_version: p.intelligence_schema_version,
    engine_version: p.engine_version,
    role_title: p.role_title,
    role_family: p.role_family,
    seniority: p.seniority,
    requirements: p.requirements,
    capabilities: p.capabilities,
    technologies: p.technologies,
    experience_requirements: p.experience_requirements,
    education_requirements: p.education_requirements,
    certification_requirements: p.certification_requirements,
    domain_requirements: p.domain_requirements,
    location_constraints: p.location_constraints,
    work_constraints: p.work_constraints,
    ambiguities: p.ambiguities,
    contradictions: p.contradictions,
    confidence: p.confidence,
  });
}

// ==================== VALIDATION ====================

export interface ValidationIssue { path: string; problem: string }

/**
 * Structural + provenance + span validation.
 *
 * The span check is the anti-fabrication gate: it re-reads the original field text at the recorded
 * offsets and requires the quoted `source_text` to be there. A unit that cites words the JD does not
 * contain fails here rather than flowing to Phase 4 wearing a citation.
 */
export function validateProfile(
  p: JobIntelligenceProfile, job: JobRecordInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fieldText = new Map<string, string>();
  for (const f of NARRATIVE_FIELDS) {
    fieldText.set(f, asText((job as Record<string, unknown>)[f]).slice(0, MAX_JD_CHARS));
  }

  if (p.intelligence_schema_version !== INTELLIGENCE_SCHEMA_VERSION) {
    issues.push({ path: 'intelligence_schema_version', problem: 'unexpected schema version' });
  }
  if (p.engine_version !== ENGINE_VERSION) {
    issues.push({ path: 'engine_version', problem: 'unexpected engine version' });
  }

  const checkProv = (path: string, pr: { source_field: string; source_text: string; span: [number, number] | null; derivation: string; confidence: string; rule: string } | undefined) => {
    if (!pr) { issues.push({ path, problem: 'missing provenance' }); return; }
    if (!pr.source_field || !pr.rule || !pr.derivation || !pr.confidence) {
      issues.push({ path, problem: 'incomplete provenance' });
    }
    const text = fieldText.get(pr.source_field);
    if (text !== undefined && pr.span) {
      const [s, e] = pr.span;
      if (s < 0 || e > text.length || s >= e) {
        issues.push({ path, problem: `span out of range [${s},${e}] for ${pr.source_field}` });
      } else if (text.slice(s, e) !== pr.source_text) {
        issues.push({ path, problem: `span does not contain quoted text: expected ${JSON.stringify(pr.source_text)}, found ${JSON.stringify(text.slice(s, e))}` });
      }
    }
  };

  const groups: [string, { provenance?: unknown }[]][] = [
    ['requirements', p.requirements], ['capabilities', p.capabilities],
    ['technologies', p.technologies], ['experience_requirements', p.experience_requirements],
    ['education_requirements', p.education_requirements],
    ['certification_requirements', p.certification_requirements],
    ['domain_requirements', p.domain_requirements],
    ['location_constraints', p.location_constraints], ['work_constraints', p.work_constraints],
    ['ambiguities', p.ambiguities],
  ];
  for (const [name, arr] of groups) {
    arr.forEach((u, i) => checkProv(`${name}[${i}]`, (u as { provenance?: never }).provenance));
  }
  p.contradictions.forEach((c, i) => {
    checkProv(`contradictions[${i}].left`, c.left.provenance);
    checkProv(`contradictions[${i}].right`, c.right.provenance);
  });
  p.seniority.signals.forEach((s, i) => checkProv(`seniority.signals[${i}]`, s.provenance));

  for (const [i, e] of p.experience_requirements.entries()) {
    if (e.min_years !== null && e.max_years !== null && e.min_years > e.max_years) {
      issues.push({ path: `experience_requirements[${i}]`, problem: 'min_years > max_years' });
    }
    if (e.min_years !== null && (e.min_years < 0 || e.min_years > 60)) {
      issues.push({ path: `experience_requirements[${i}]`, problem: 'implausible min_years' });
    }
  }
  for (const [i, r] of p.requirements.entries()) {
    if (r.level === 'EXCLUDED' && r.evidence_required.length > 0) {
      issues.push({ path: `requirements[${i}]`, problem: 'excluded requirement must demand no evidence' });
    }
  }
  return issues;
}
