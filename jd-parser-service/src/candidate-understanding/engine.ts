/**
 * Phase 4 Candidate Understanding Engine.
 *
 * Pipeline:
 *   candidate record -> field texts -> clauses (spans)
 *                    -> dictionary matches inside clauses
 *                    -> assertion type + depth + context + evidence strength per mention
 *                    -> multi-source reconciliation (strongest evidence wins, all sources kept)
 *                    -> chronology, recency, leadership, role, seniority, projects, credentials
 *                    -> ambiguity + contradiction
 *                    -> schema/provenance/span validation
 *                    -> deterministic serialization -> intelligence_hash
 *
 * The reconciliation step is what stops the same skill appearing four times because it was written
 * in four columns, while still keeping all four citations.
 */

import { createHash } from 'node:crypto';
import { MultiPatternTrie } from '../jd-parser/matcher/trie.js';
import { SKILL_DICTIONARY } from '../jd-parser/dictionaries/skills.dictionary.js';
import { segment, isNegated, type Clause } from '../jd-understanding/clauses.js';
import { relationsFor } from '../jd-understanding/analyzers.js';
import {
  CANDIDATE_ENGINE_VERSION, CANDIDATE_INTELLIGENCE_SCHEMA_VERSION, depthRank,
  type Ambiguity, type Assertion, type CandidateIntelligenceProfile, type CapabilityUnit,
  type CareerEvent, type Confidence, type Contradiction, type ContextType, type CredentialUnit,
  type EducationUnit, type EvidenceStrength, type ExperienceEntry, type LeadershipEvidence,
  type LeadershipKind, type ProjectUnit, type Provenance, type Recency, type Seniority,
  type SeniorityAssessment, type SkillDepth, type SkillUnit, type TechnologyUsage,
} from './contract.js';
import {
  extractRanges, findImpossible, findOverlaps, inferReferenceDate, recencyFor, unionMonths,
} from './chronology.js';

export const MAX_RESUME_CHARS = 120_000;
/** Deterministic default. Overridable per call; never read from the system clock. */
export const DEFAULT_REFERENCE = '2026-08';

const trie = new MultiPatternTrie(SKILL_DICTIONARY);

export interface CandidateRecordInput {
  id?: number | null;
  current_job_title?: string | null;
  years_of_experience?: string | null;
  primary_skills?: string | null;
  secondary_skills?: string | null;
  skills?: string | null;
  skills_array?: string[] | null;
  technical_tools?: string | null;
  certifications?: string | null;
  languages_known?: string | null;
  projects?: string | null;
  industry_domain?: string | null;
  education?: string | null;
  highest_qualification?: string | null;
  university?: string | null;
  graduation_year?: string | null;
  current_company?: string | null;
  previous_companies?: string | null;
  resume_summary?: string | null;
  resume_text?: string | null;
  source_hash?: string | null;
  representation_hash?: string | null;
  /** Deterministic "today". Defaults to the newest year in the resume, else DEFAULT_REFERENCE. */
  reference_date?: string;
}

const asText = (v: unknown): string =>
  v === null || v === undefined ? '' : Array.isArray(v) ? v.join('. ') : String(v);

const prov = (
  field: string, text: string, span: [number, number] | null,
  derivation: Provenance['derivation'], confidence: Confidence, rule: string,
): Provenance => ({ source_field: field, source_text: text, span, derivation, confidence, rule });

/** Free-text fields, in fixed order. Spans are per-field; the field name travels in provenance. */
const NARRATIVE_FIELDS = ['resume_summary', 'resume_text', 'projects'] as const;
/** Columns that are lists of claims. A value here is DECLARED and nothing more. */
const DECLARED_FIELDS = ['primary_skills', 'secondary_skills', 'skills', 'technical_tools'] as const;

// ==================== CONTEXT / DEPTH / EVIDENCE ====================

/**
 * Context is read from the clause, in priority order. PRODUCTION outranks PROFESSIONAL because a
 * clause can say both and production is the stronger statement; ACADEMIC is checked before
 * PROFESSIONAL so "college project at university" cannot be read as employment.
 */
const CONTEXT_RULES: { re: RegExp; ctx: ContextType }[] = [
  // SETTING BEFORE QUALIFIER. Academic and internship are tested first because they describe WHERE
  // the work happened, while "production" describes a property of it. "For my college final year
  // project I deployed a Python service to production" is academic work that happened to reach
  // production; classifying it as PRODUCTION promoted a student project to DIRECT professional
  // evidence - exactly the academic-to-professional leakage this engine exists to prevent.
  { re: /\b(?:college|university|academic|coursework|semester|final\s+year|b\.?tech|m\.?tech|thesis|dissertation)\b/i, ctx: 'ACADEMIC' },
  { re: /\b(?:intern(?:ship)?|trainee)\b/i, ctx: 'INTERNSHIP' },
  { re: /\b(?:production|deployed|live\s+system|in\s+prod|customer[-\s]facing)\b/i, ctx: 'PRODUCTION' },
  { re: /\b(?:freelance|contract(?:or)?|consulting)\b/i, ctx: 'FREELANCE' },
  { re: /\b(?:research|published|paper)\b/i, ctx: 'RESEARCH' },
  { re: /\b(?:volunteer|ngo|non[-\s]profit)\b/i, ctx: 'VOLUNTEER' },
  { re: /\b(?:hobby|personal\s+project|side\s+project)\b/i, ctx: 'PERSONAL' },
  { re: /\b(?:worked|working|employed|professional|client|team|company|role|responsib)\w*\b/i, ctx: 'PROFESSIONAL' },
];

const contextOf = (clause: string): ContextType =>
  CONTEXT_RULES.find((r) => r.re.test(clause))?.ctx ?? 'UNKNOWN';

/**
 * Depth ladder, strongest rule first. Each rung requires the clause to say something the rung below
 * does not - an unqualified mention can never climb past MENTIONED, which is the whole point.
 */
const DEPTH_RULES: { re: RegExp; depth: SkillDepth }[] = [
  { re: /\b(?:led|leading|mentor(?:ed|ing)?|owned|managing|managed)\b/i, depth: 'LEADERSHIP_LEVEL_USE' },
  { re: /\b(?:architect(?:ed|ure)?|designed\s+(?:the\s+)?(?:system|architecture)|system\s+design)\b/i, depth: 'ADVANCED_ARCHITECTURAL_USE' },
  { re: /\b(?:production|deployed|shipped|live|scaled|on[-\s]call)\b/i, depth: 'PRODUCTION_USED' },
  { re: /\b(?:project|built|developed|implemented|created)\b/i, depth: 'PROJECT_USED' },
  { re: /\b(?:worked|working|used|using|experience\s+(?:with|in))\b/i, depth: 'USED' },
];

function depthOf(clause: string, ctx: ContextType): SkillDepth {
  const hit = DEPTH_RULES.find((r) => r.re.test(clause));
  let depth: SkillDepth = hit ? hit.depth : 'MENTIONED';
  // A professional employment context lifts a bare PROJECT_USED to PROFESSIONAL_USED; an ACADEMIC
  // context can NEVER exceed PROJECT_USED, which is the academic->professional leakage guard.
  if (ctx === 'PROFESSIONAL' && depth === 'PROJECT_USED') depth = 'PROFESSIONAL_USED';
  if ((ctx === 'ACADEMIC' || ctx === 'PERSONAL') && depthRank(depth) > depthRank('PROJECT_USED')) {
    depth = 'PROJECT_USED';
  }
  return depth;
}

function evidenceOf(assertion: Assertion, depth: SkillDepth, ctx: ContextType): EvidenceStrength {
  if (assertion === 'NEGATED') return 'NEGATIVE';
  if (assertion === 'DECLARED') return 'DECLARED_ONLY';
  if (assertion === 'INFERRED') return 'INFERRED';
  if (depthRank(depth) >= depthRank('PRODUCTION_USED')) return 'DIRECT';
  if (depth === 'PROFESSIONAL_USED') return ctx === 'PROFESSIONAL' ? 'DIRECT' : 'STRONG';
  if (depth === 'PROJECT_USED') return 'STRONG';
  if (depth === 'USED') return 'MODERATE';
  return 'WEAK';
}

// ==================== SKILLS ====================

interface Mention {
  skill: string; category: string | null; assertion: Assertion; depth: SkillDepth;
  ctx: ContextType; strength: EvidenceStrength; prov: Provenance; clauseEnd: number; field: string;
}

function collectDeclared(rec: CandidateRecordInput): Mention[] {
  const out: Mention[] = [];
  for (const field of DECLARED_FIELDS) {
    const raw = (rec as Record<string, unknown>)[field];
    const text = asText(raw);
    if (!text) continue;
    for (const part of text.split(/[,;|\n]/)) {
      const item = part.trim();
      if (!item) continue;
      const at = text.indexOf(item);
      const m = trie.findAll(item)[0];
      const skill = m ? m.entry.canonical : item;
      const category = m ? m.entry.category : null;
      // Only dictionary-known tokens become skill units from a list. An arbitrary phrase in a
      // Skills column ("Providing Onsite/Online Training") is not a technology and inventing a
      // canonical skill from it would pollute every later phase.
      if (!m) continue;
      out.push({
        skill, category, assertion: 'DECLARED', depth: 'MENTIONED', ctx: 'UNKNOWN',
        strength: 'DECLARED_ONLY', clauseEnd: 0, field,
        prov: prov(field, item, at >= 0 ? [at, at + item.length] : null, 'EXPLICIT', 'EXPLICIT', 'skill.declared_column'),
      });
    }
  }
  return out;
}

function collectFromProse(clauses: Clause[]): Mention[] {
  const out: Mention[] = [];
  for (const c of clauses) {
    const ctx = contextOf(c.text);
    const depth = depthOf(c.text, ctx);
    for (const match of trie.findAll(c.text)) {
      const negated = isNegated(c.text, match.start, match.end);
      const assertion: Assertion = negated ? 'NEGATED'
        : depth === 'MENTIONED' ? 'MENTIONED' : 'DEMONSTRATED';
      const effDepth: SkillDepth = negated ? 'MENTIONED' : depth;
      out.push({
        skill: match.entry.canonical, category: match.entry.category,
        assertion, depth: effDepth, ctx: negated ? 'UNKNOWN' : ctx,
        strength: evidenceOf(assertion, effDepth, ctx),
        clauseEnd: c.end, field: c.field,
        prov: prov(c.field, match.matchedText, [c.start + match.start, c.start + match.end],
          'EXPLICIT', negated ? 'EXPLICIT' : 'HIGH',
          negated ? 'skill.negated' : `skill.prose.${effDepth.toLowerCase()}`),
      });
    }
  }
  return out;
}

const ASSERTION_RANK: Record<Assertion, number> = {
  NEGATED: 0, DECLARED: 1, MENTIONED: 2, INFERRED: 3, DEMONSTRATED: 4, VERIFIED: 5,
};

/**
 * MULTI-SOURCE RECONCILIATION.
 *
 * One unit per skill. The winning depth/assertion is the STRONGEST evidence found anywhere, and
 * every other sighting is retained in supporting_evidence so nothing is lost. Negation is handled
 * separately below rather than by ranking, because "I have not used Kubernetes" must not simply
 * lose to a Skills-section entry - that disagreement is a contradiction, not a tie-break.
 */
function reconcile(mentions: Mention[], recency: (skill: string) => Recency): SkillUnit[] {
  const bySkill = new Map<string, Mention[]>();
  for (const m of mentions) {
    const k = m.skill.toLowerCase();
    if (!bySkill.has(k)) bySkill.set(k, []);
    bySkill.get(k)!.push(m);
  }
  const out: SkillUnit[] = [];
  for (const [, group] of [...bySkill.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const positives = group.filter((m) => m.assertion !== 'NEGATED');
    const best = (positives.length ? positives : group).slice().sort((a, b) =>
      depthRank(b.depth) - depthRank(a.depth) ||
      ASSERTION_RANK[b.assertion] - ASSERTION_RANK[a.assertion])[0];
    const negated = positives.length === 0;
    out.push({
      skill: best.skill,
      category: best.category,
      assertion: negated ? 'NEGATED' : best.assertion,
      depth: best.depth,
      evidence_strength: negated ? 'NEGATIVE' : best.strength,
      context_type: best.ctx,
      recency: negated ? 'UNKNOWN' : recency(best.skill),
      supporting_evidence: group.map((m) => m.prov),
      provenance: best.prov,
    });
  }
  return out;
}

// ==================== TECHNOLOGY USAGE ====================

const USAGE_VERBS = /\b(built|designed|developed|implemented|deployed|architected|migrated|optimi[sz]ed|integrated|automated|maintained|scaled|tested|configured)\b/gi;

/** Usage verbs are taken from the clause the technology appears in - never from its name. */
function technologyUsage(clauses: Clause[], skills: SkillUnit[]): TechnologyUsage[] {
  const known = new Map(skills.map((s) => [s.skill.toLowerCase(), s]));
  const usage = new Map<string, Set<string>>();
  for (const c of clauses) {
    const verbs = [...c.text.matchAll(USAGE_VERBS)].map((m) => m[0].toLowerCase());
    if (verbs.length === 0) continue;
    for (const match of trie.findAll(c.text)) {
      const k = match.entry.canonical.toLowerCase();
      if (!known.has(k)) continue;
      if (!usage.has(k)) usage.set(k, new Set());
      for (const v of verbs) usage.get(k)!.add(v);
    }
  }
  return skills
    .filter((s) => s.assertion !== 'NEGATED' && s.category !== null)
    .map((s) => ({
      name: s.skill,
      category: s.category,
      relationships: relationsFor(s.category),
      usage: [...(usage.get(s.skill.toLowerCase()) ?? [])].sort(),
      provenance: { ...s.provenance, derivation: 'ONTOLOGY' as const, rule: 'technology.dictionary' },
    }));
}

// ==================== CAPABILITIES ====================

const CAPABILITY_PATTERNS: { re: RegExp; caps: string[] }[] = [
  { re: /\b(?:design|architect)\w*\b[^.;]*\b(?:distributed|microservice|service)\w*\b/i, caps: ['distributed systems', 'service design', 'backend architecture'] },
  { re: /\b(?:rest|restful|graphql)\s*api/i, caps: ['API engineering'] },
  { re: /\bfault[-\s]toleran\w+|\bresilien\w+|\bhigh\s+availability\b/i, caps: ['fault tolerance'] },
  { re: /\bscalab\w+\b/i, caps: ['scalability engineering'] },
  { re: /\b(?:kubernetes|k8s|docker|container)\w*\b/i, caps: ['container orchestration'] },
  { re: /\bci\/?cd\b|\bpipeline\w*\b/i, caps: ['build and release engineering'] },
  { re: /\b(?:etl|data\s+pipeline|ingest)\w*\b/i, caps: ['data engineering'] },
  { re: /\b(?:machine\s+learning|deep\s+learning|model\s+(?:training|deployment)|feature\s+engineering)\b/i, caps: ['machine learning engineering'] },
  { re: /\b(?:query|schema)\s*(?:optimi|design|tuning)\w*\b/i, caps: ['database engineering'] },
  { re: /\b(?:automat\w+|selenium|test\s+cases?|qa\b)/i, caps: ['test engineering'] },
  { re: /\b(?:security|authenticat\w+|authoriz\w+)\b/i, caps: ['security engineering'] },
  { re: /\b(?:monitor\w+|observab\w+|incident|on[-\s]call)\b/i, caps: ['production engineering'] },
];

function analyzeCapabilities(clauses: Clause[]): CapabilityUnit[] {
  const out: CapabilityUnit[] = [];
  const seen = new Set<string>();
  for (const c of clauses) {
    const ctx = contextOf(c.text);
    for (const p of CAPABILITY_PATTERNS) {
      const m = p.re.exec(c.text);
      if (!m) continue;
      for (const cap of p.caps) {
        if (seen.has(cap)) continue;
        seen.add(cap);
        out.push({
          capability: cap,
          // Always INFERRED: the resume does not contain the words "backend architecture", so
          // presenting it as a candidate claim would be putting words in their mouth.
          assertion: 'INFERRED', context_type: ctx,
          provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
            'INFERRED', 'MEDIUM', 'capability.pattern'),
        });
      }
    }
  }
  return out;
}

// ==================== LEADERSHIP ====================

const LEADERSHIP_RULES: { re: RegExp; kind: LeadershipKind; scope?: RegExp }[] = [
  { re: /\bled\s+(?:a\s+)?team\s+of\s+(\d+)/i, kind: 'TEAM_LEADERSHIP', scope: /\d+\s*(?:engineers?|developers?|people|members)?/i },
  { re: /\b(?:managed|managing)\s+(?:a\s+)?team\b|\bpeople\s+management\b|\bdirect\s+reports?\b/i, kind: 'PEOPLE_MANAGEMENT' },
  { re: /\bmentor(?:ed|ing|s)?\b|\bcoach(?:ed|ing)?\b/i, kind: 'MENTORING' },
  { re: /\bown(?:ed|ing|s)?\s+(?:the\s+)?architect\w*|\barchitecture\s+decisions?\b/i, kind: 'ARCHITECTURE_OWNERSHIP' },
  { re: /\bown(?:ed|ing|s)?\s+(?:the\s+)?(?:project|delivery|module|service)\b/i, kind: 'PROJECT_OWNERSHIP' },
  { re: /\bstakeholder\w*\b|\bclient\s+(?:facing|management)\b/i, kind: 'STAKEHOLDER_MANAGEMENT' },
  { re: /\b(?:decision\s+authority|final\s+say|technical\s+direction)\b/i, kind: 'DECISION_AUTHORITY' },
];

/**
 * "Helped the team" is not leadership. Only the constructions above count, and the team-size scope
 * is captured verbatim so a reviewer can see the difference between leading 2 and leading 20.
 */
function analyzeLeadership(clauses: Clause[]): LeadershipEvidence[] {
  const out: LeadershipEvidence[] = [];
  const seen = new Set<LeadershipKind>();
  for (const c of clauses) {
    for (const r of LEADERSHIP_RULES) {
      const m = r.re.exec(c.text);
      if (!m || seen.has(r.kind)) continue;
      seen.add(r.kind);
      out.push({
        kind: r.kind,
        scope: m[1] ? `${m[1]} people` : null,
        provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
          'EXPLICIT', 'HIGH', `leadership.${r.kind.toLowerCase()}`),
      });
    }
  }
  return out;
}

// ==================== ROLE / SENIORITY ====================

const ROLE_FAMILY_RULES: { re: RegExp; family: string }[] = [
  { re: /\b(?:machine\s+learning|deep\s+learning|pytorch|tensorflow|model\s+deployment|feature\s+engineering)\b/i, family: 'Machine Learning' },
  { re: /\b(?:etl|data\s+pipeline|spark|warehouse|airflow)\b/i, family: 'Data Engineering' },
  { re: /\b(?:kubernetes|terraform|ci\/?cd|sre|infrastructure|devops)\b/i, family: 'Platform Engineering' },
  { re: /\b(?:selenium|test\s+automation|qa\b|sdet)\b/i, family: 'Quality Engineering' },
  { re: /\b(?:react|angular|vue|frontend|css)\b/i, family: 'Frontend Engineering' },
  { re: /\b(?:rest\s*api|backend|server[-\s]side|microservice)\w*\b/i, family: 'Backend Engineering' },
  { re: /\b(?:penetration|appsec|security\s+engineer)\b/i, family: 'Security' },
];

/** Role family from EVIDENCE (responsibilities/technologies), reported beside the title's family. */
function evidenceRoleFamily(clauses: Clause[]): { family: string | null; prov: Provenance | null } {
  const counts = new Map<string, { n: number; p: Provenance }>();
  for (const c of clauses) {
    for (const r of ROLE_FAMILY_RULES) {
      const m = r.re.exec(c.text);
      if (!m) continue;
      const cur = counts.get(r.family);
      const p = prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
        'INFERRED', 'MEDIUM', 'role.evidence');
      counts.set(r.family, { n: (cur?.n ?? 0) + 1, p: cur?.p ?? p });
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
  return top ? { family: top[0], prov: top[1].p } : { family: null, prov: null };
}

const titleFamily = (title: string | null): string | null => {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\bbackend|server[-\s]side\b/.test(t)) return 'Backend Engineering';
  if (/\bfrontend|ui\b/.test(t)) return 'Frontend Engineering';
  if (/\bfull[-\s]?stack\b/.test(t)) return 'Full Stack Engineering';
  if (/\bdevops|sre|platform|infrastructure\b/.test(t)) return 'Platform Engineering';
  if (/\bdata\b/.test(t)) return 'Data Engineering';
  if (/\bml|machine\s+learning|ai\b/.test(t)) return 'Machine Learning';
  if (/\bqa|test|sdet\b/.test(t)) return 'Quality Engineering';
  if (/\bsecurity\b/.test(t)) return 'Security';
  if (/\bsupport|service\s+analyst\b/.test(t)) return 'Support Engineering';
  return null;
};

const TITLE_SENIORITY: { re: RegExp; s: Seniority }[] = [
  { re: /\bintern(?:ship)?\b/i, s: 'INTERN' },
  { re: /\b(?:junior|jr\.?|trainee|fresher|associate)\b/i, s: 'JUNIOR' },
  { re: /\b(?:senior|sr\.?)\b/i, s: 'SENIOR' },
  { re: /\bstaff\b/i, s: 'STAFF' },
  { re: /\bprincipal\b/i, s: 'PRINCIPAL' },
  { re: /\barchitect\b/i, s: 'ARCHITECT' },
  { re: /\b(?:tech(?:nical)?\s+lead|team\s+lead|\blead\b)/i, s: 'LEAD' },
  { re: /\bmanager\b/i, s: 'MANAGER' },
  { re: /\bdirector\b|\bhead\s+of\b|\bvp\b/i, s: 'DIRECTOR' },
];

const monthsToSeniority = (m: number): Seniority =>
  m <= 18 ? 'JUNIOR' : m <= 60 ? 'MID' : m <= 108 ? 'SENIOR' : 'PRINCIPAL';

function analyzeSeniority(
  title: string | null, leadership: LeadershipEvidence[], timelineMonths: number | null,
  statedMonths: number | null,
): SeniorityAssessment {
  const signals: SeniorityAssessment['signals'] = [];
  if (title) {
    for (const t of TITLE_SENIORITY) {
      const m = t.re.exec(title);
      if (m) {
        signals.push({ signal: `title:${m[0]}`, suggests: t.s,
          provenance: prov('current_job_title', m[0], [m.index, m.index + m[0].length], 'EXPLICIT', 'HIGH', 'seniority.title') });
      }
    }
  }
  for (const l of leadership) {
    const s: Seniority = l.kind === 'PEOPLE_MANAGEMENT' ? 'MANAGER'
      : l.kind === 'TEAM_LEADERSHIP' ? 'LEAD'
        : l.kind === 'ARCHITECTURE_OWNERSHIP' ? 'PRINCIPAL' : 'SENIOR';
    signals.push({ signal: `leadership:${l.kind}`, suggests: s,
      provenance: { ...l.provenance, derivation: 'INFERRED', rule: 'seniority.leadership' } });
  }
  const months = timelineMonths ?? statedMonths;
  if (months !== null) {
    signals.push({ signal: `months:${months}`, suggests: monthsToSeniority(months),
      provenance: prov(timelineMonths !== null ? 'resume_text' : 'years_of_experience',
        `${months} months`, null, 'DERIVED', timelineMonths !== null ? 'HIGH' : 'MEDIUM', 'seniority.duration') });
    }

  if (signals.length === 0) return { seniority: null, signals: [], confidence: 'UNRESOLVED' };
  const distinct = new Set(signals.map((s) => s.suggests));
  const titleSignal = signals.find((s) => s.signal.startsWith('title:'));
  const chosen = titleSignal ? titleSignal.suggests : signals[0].suggests;
  const confidence: Confidence = distinct.size === 1 ? (titleSignal ? 'EXPLICIT' : 'HIGH')
    : distinct.size === 2 ? 'MEDIUM' : 'AMBIGUOUS';
  return { seniority: chosen, signals, confidence };
}

// ==================== PROJECTS / EDUCATION / CREDENTIALS / DOMAINS ====================

function analyzeProjects(rec: CandidateRecordInput, clauses: Clause[]): ProjectUnit[] {
  const text = asText(rec.projects);
  if (!text) return [];
  let items: string[];
  const trimmed = text.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try { const p = JSON.parse(trimmed); items = Array.isArray(p) ? p.map(String) : [trimmed]; }
    catch { items = trimmed.split(/[;|\n]/); }
  } else if (/\b(?:using|with|built|developed|implemented|based\s+on)\b/i.test(trimmed)) {
    // A DESCRIPTION of one project, not a list of several. Both shapes occur in the live corpus:
    // candidate #100 stores '["Lucid DOT", "POS-APP", "CPQ"]' while #102 stores
    // 'InEight, NTC(NationWide Title Clearing), WV(WorldVision)'. Splitting a described project on
    // its commas shattered "Recruitment platform using Python, FastAPI, PostgreSQL and Docker" into
    // four fragments and attributed one technology to each invented "project".
    items = trimmed.split(/[;|\n]/);
  } else items = trimmed.split(/[,;|\n]/);

  const out: ProjectUnit[] = [];
  for (const raw of items) {
    const name = raw.trim();
    if (!name) continue;
    const at = text.indexOf(name);
    // Technologies are attributed to a project only when the project's own text names them.
    const techs = [...new Set(trie.findAll(name).map((m) => m.entry.canonical))].sort();
    const relatedClause = clauses.find((c) => c.text.toLowerCase().includes(name.toLowerCase()));
    out.push({
      name, technologies: techs, capabilities: [],
      context_type: relatedClause ? contextOf(relatedClause.text) : 'UNKNOWN',
      provenance: prov('projects', name, at >= 0 ? [at, at + name.length] : null,
        'EXPLICIT', 'EXPLICIT', 'project.column'),
    });
  }
  return out;
}

function analyzeEducation(rec: CandidateRecordInput): EducationUnit[] {
  const qualification = asText(rec.highest_qualification).trim() || null;
  const institution = asText(rec.university).trim() || null;
  const eduText = asText(rec.education).trim() || null;
  const yearRaw = asText(rec.graduation_year).trim();
  const yearMatch = /(?:19|20)\d{2}/.exec(yearRaw);
  if (!qualification && !institution && !eduText) return [];
  const field = eduText ? (/\bin\s+([A-Za-z .&]+)/i.exec(eduText)?.[1]?.trim() ?? null) : null;
  const src = qualification ? 'highest_qualification' : institution ? 'university' : 'education';
  const srcText = qualification ?? institution ?? eduText ?? '';
  return [{
    qualification: qualification ?? eduText,
    field,
    institution,
    graduation_year: yearMatch ? Number(yearMatch[0]) : null,
    provenance: prov(src, srcText, [0, srcText.length], 'EXPLICIT', 'EXPLICIT', 'education.column'),
  }];
}

/**
 * A course is not a certification. The brief is explicit and the distinction matters to a
 * recruiter: "completed AWS training" and "AWS Certified Solutions Architect" are different claims.
 */
const CREDENTIAL_RULES: { re: RegExp; kind: CredentialUnit['kind'] }[] = [
  { re: /\bcertified\b|\bcertification\b|\bcertificate\b/i, kind: 'CERTIFICATION' },
  { re: /\btraining\b|\bbootcamp\b/i, kind: 'TRAINING' },
  { re: /\bcourse\b|\bmooc\b|\bcoursera\b|\budemy\b/i, kind: 'COURSE' },
  { re: /\bcoursework\b|\bsubjects?\b/i, kind: 'COURSEWORK' },
  { re: /\bself[-\s]?(?:taught|learn\w*)\b/i, kind: 'SELF_LEARNING' },
];

function analyzeCredentials(rec: CandidateRecordInput): CredentialUnit[] {
  const text = asText(rec.certifications);
  if (!text) return [];
  const out: CredentialUnit[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;|\n]/)) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const at = text.indexOf(name);
    const rule = CREDENTIAL_RULES.find((r) => r.re.test(name));
    out.push({
      name,
      // Defaults to COURSE, not CERTIFICATION. An unqualified line in a certifications column is
      // not proof of an industry certification, and defaulting upward would manufacture credentials.
      kind: rule ? rule.kind : 'COURSE',
      issuer: /\b(aws|amazon|microsoft|azure|google|oracle|cisco|red\s*hat|salesforce|pmi|scrum)\b/i.exec(name)?.[0] ?? null,
      provenance: prov('certifications', name, at >= 0 ? [at, at + name.length] : null,
        'EXPLICIT', rule ? 'EXPLICIT' : 'LOW', 'credential.column'),
    });
  }
  return out;
}

const DOMAIN_TERMS: { re: RegExp; domain: string }[] = [
  { re: /\bfintech|banking|payments?|trading\b/i, domain: 'FinTech' },
  { re: /\bhealthcare|medical|clinical|patient\b/i, domain: 'Healthcare' },
  { re: /\brecruit\w*|hiring|talent\s+acquisition\b/i, domain: 'Recruitment' },
  { re: /\be[-\s]?commerce|retail|marketplace\b/i, domain: 'E-commerce' },
  { re: /\btelecom\w*\b/i, domain: 'Telecommunications' },
  { re: /\bcyber\s*security|infosec\b/i, domain: 'Cybersecurity' },
  { re: /\bhospitality|hotel\b/i, domain: 'Hospitality' },
  { re: /\binsurance\b/i, domain: 'Insurance' },
  { re: /\blogistics|supply\s+chain\b/i, domain: 'Logistics' },
];

/** Domains come from stated context only - never inferred from a technology's typical industry. */
function analyzeDomains(rec: CandidateRecordInput, clauses: Clause[]): { domain: string; provenance: Provenance }[] {
  const out: { domain: string; provenance: Provenance }[] = [];
  const seen = new Set<string>();
  const industry = asText(rec.industry_domain);
  for (const d of DOMAIN_TERMS) {
    const m = d.re.exec(industry);
    if (m && !seen.has(d.domain)) {
      seen.add(d.domain);
      out.push({ domain: d.domain, provenance: prov('industry_domain', m[0], [m.index, m.index + m[0].length], 'EXPLICIT', 'EXPLICIT', 'domain.column') });
    }
  }
  for (const c of clauses) {
    for (const d of DOMAIN_TERMS) {
      const m = d.re.exec(c.text);
      if (m && !seen.has(d.domain)) {
        seen.add(d.domain);
        out.push({ domain: d.domain, provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length], 'EXPLICIT', 'HIGH', 'domain.prose') });
      }
    }
  }
  return out;
}

// ==================== AMBIGUITY ====================

const VAGUE = /\b(?:strong|solid|good|excellent|deep|sound|working|basic|vast)\s+(?:knowledge|understanding|experience|command|grasp)\b/i;
const UNSPEC_TECH: { re: RegExp; detail: string }[] = [
  { re: /\bcloud\s+(?:platforms?|technolog\w+)\b/i, detail: 'which cloud provider is unstated' },
  { re: /\bdatabases?\b(?!\s*(?:like|such as|:))/i, detail: 'which database is unstated' },
  { re: /\bprogramming\s+languages?\b(?!\s*(?:like|such as|:))/i, detail: 'which language is unstated' },
  { re: /\bfull[-\s]?stack\b/i, detail: 'which stack is unstated' },
  { re: /\bai\s+experience\b|\bai\/ml\b/i, detail: 'which AI/ML work is unstated' },
];

function analyzeAmbiguity(clauses: Clause[], hasDates: boolean, statedExp: string | null): Ambiguity[] {
  const out: Ambiguity[] = [];
  for (const c of clauses) {
    for (const u of UNSPEC_TECH) {
      const m = u.re.exec(c.text);
      if (m) out.push({ type: 'UNSPECIFIED_TECHNOLOGY', text_span: m[0], detail: u.detail,
        provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length], 'EXPLICIT', 'HIGH', 'ambiguity.unspecified_technology') });
    }
    const v = VAGUE.exec(c.text);
    if (v) out.push({ type: 'VAGUE_PROFICIENCY', text_span: v[0], detail: 'no measurable proficiency stated',
      provenance: prov(c.field, v[0], [c.start + v.index, c.start + v.index + v[0].length], 'EXPLICIT', 'HIGH', 'ambiguity.vague_proficiency') });
  }
  // The dominant real-corpus case: a stated total with no timeline to corroborate it.
  if (!hasDates && statedExp) {
    out.push({ type: 'UNDATED_EXPERIENCE', text_span: statedExp,
      detail: 'experience is stated but no date range exists to corroborate it',
      provenance: prov('years_of_experience', statedExp, [0, statedExp.length], 'DERIVED', 'HIGH', 'ambiguity.undated_experience') });
  }
  return out;
}

// ==================== CONTRADICTION ====================

const SENIORITY_MIN_MONTHS: Partial<Record<Seniority, number>> = {
  SENIOR: 48, LEAD: 60, STAFF: 84, PRINCIPAL: 96, ARCHITECT: 96, DIRECTOR: 120,
};

function analyzeContradictions(
  skills: SkillUnit[], seniority: SeniorityAssessment, timelineMonths: number | null,
  statedMonths: number | null, overlaps: [{ matchedText: string }, { matchedText: string }][],
  impossible: { matchedText: string }[], field: string,
): Contradiction[] {
  const out: Contradiction[] = [];
  const mk = (text: string, rule: string): Provenance =>
    prov(field, text, null, 'DERIVED', 'HIGH', rule);

  // Declared in a Skills column AND explicitly denied in prose. Not a tie-break - a real conflict.
  for (const s of skills) {
    const hasDeclared = s.supporting_evidence.some((e) => e.rule === 'skill.declared_column');
    const hasNegation = s.supporting_evidence.some((e) => e.rule === 'skill.negated');
    if (hasDeclared && hasNegation) {
      out.push({
        type: 'NEGATED_BUT_DECLARED', severity: 'HIGH', resolution_status: 'UNRESOLVED',
        left: { claim: `${s.skill} listed as a skill`, provenance: s.supporting_evidence.find((e) => e.rule === 'skill.declared_column')! },
        right: { claim: `${s.skill} explicitly denied in prose`, provenance: s.supporting_evidence.find((e) => e.rule === 'skill.negated')! },
      });
    }
  }

  if (seniority.seniority) {
    const floor = SENIORITY_MIN_MONTHS[seniority.seniority];
    const months = timelineMonths ?? statedMonths;
    const titleSig = seniority.signals.find((s) => s.signal.startsWith('title:'));
    if (floor !== undefined && months !== null && months < floor && titleSig) {
      out.push({
        type: 'SENIORITY_VS_EXPERIENCE', severity: 'HIGH', resolution_status: 'UNRESOLVED',
        left: { claim: `title implies ${seniority.seniority}`, provenance: titleSig.provenance },
        right: { claim: `${months} months of experience`, provenance: mk(`${months} months`, 'contradiction.seniority_months') },
      });
    }
  }

  for (const [a, b] of overlaps) {
    out.push({
      type: 'CHRONOLOGY_OVERLAP', severity: 'MEDIUM', resolution_status: 'UNRESOLVED',
      left: { claim: a.matchedText, provenance: mk(a.matchedText, 'contradiction.overlap') },
      right: { claim: b.matchedText, provenance: mk(b.matchedText, 'contradiction.overlap') },
    });
  }
  for (const r of impossible) {
    out.push({
      type: 'CHRONOLOGY_IMPOSSIBLE', severity: 'HIGH', resolution_status: 'UNRESOLVED',
      left: { claim: `impossible range ${r.matchedText}`, provenance: mk(r.matchedText, 'contradiction.impossible') },
      right: { claim: 'end precedes start or lies in the future', provenance: mk(r.matchedText, 'contradiction.impossible') },
    });
  }
  // A stated total that the timeline cannot support, in either direction, by more than a year.
  if (timelineMonths !== null && statedMonths !== null && Math.abs(timelineMonths - statedMonths) > 12) {
    out.push({
      type: 'DURATION_CONFLICT', severity: 'MEDIUM', resolution_status: 'UNRESOLVED',
      left: { claim: `timeline supports ${timelineMonths} months`, provenance: mk(`${timelineMonths} months`, 'contradiction.duration') },
      right: { claim: `candidate states ${statedMonths} months`, provenance: mk(`${statedMonths} months`, 'contradiction.duration') },
    });
  }
  return out;
}

// ==================== ORCHESTRATION ====================

function statedMonthsOf(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(years?|yrs?|months?)/i.exec(String(v));
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /^mo/i.test(m[2]) ? Math.round(n) : Math.round(n * 12);
}

export function buildCandidateIntelligence(rec: CandidateRecordInput): CandidateIntelligenceProfile {
  const title = rec.current_job_title ? String(rec.current_job_title).trim() : null;

  const clauses: Clause[] = [];
  for (const field of NARRATIVE_FIELDS) {
    const text = asText((rec as Record<string, unknown>)[field]).slice(0, MAX_RESUME_CHARS);
    for (const c of segment(text, field)) clauses.push(c);
  }

  const resumeText = asText(rec.resume_text).slice(0, MAX_RESUME_CHARS);
  const reference = rec.reference_date ?? inferReferenceDate(resumeText, DEFAULT_REFERENCE);
  const ranges = extractRanges(resumeText, reference);
  const timelineMonths = unionMonths(ranges, reference);
  const overlaps = findOverlaps(ranges, reference);
  const impossible = findImpossible(ranges, reference);
  const statedMonths = statedMonthsOf(rec.years_of_experience);

  // Recency is per-skill only where a dated range actually contains the mention. With no ranges,
  // every skill is UNKNOWN - which for most of this corpus is the truthful answer.
  const skillRecency = (skill: string): Recency => {
    if (ranges.length === 0) return 'UNKNOWN';
    const hits = ranges.filter((r) => {
      const window = resumeText.slice(Math.max(0, r.index - 300), r.index + r.length + 300);
      return window.toLowerCase().includes(skill.toLowerCase());
    });
    if (hits.length === 0) return 'UNKNOWN';
    const ongoing = hits.some((h) => h.ongoing);
    const latestEnd = hits.map((h) => h.end).filter(Boolean).sort().pop() ?? null;
    return recencyFor(latestEnd, ongoing, reference);
  };

  const mentions = [...collectDeclared(rec), ...collectFromProse(clauses)];
  const skills = reconcile(mentions, skillRecency);
  const technologies = technologyUsage(clauses, skills);
  const capabilities = analyzeCapabilities(clauses);
  const leadership = analyzeLeadership(clauses);
  const projects = analyzeProjects(rec, clauses);
  const education = analyzeEducation(rec);
  const credentials = analyzeCredentials(rec);
  const domains = analyzeDomains(rec, clauses);
  const seniority = analyzeSeniority(title, leadership, timelineMonths, statedMonths);
  const evRole = evidenceRoleFamily(clauses);

  // An impossible range ("2022 - 2019") is NOT a period of employment. It is reported as a
  // CHRONOLOGY_IMPOSSIBLE contradiction above and deliberately kept OUT of the timeline: leaving it
  // in emitted an entry whose end precedes its start, which any consumer summing durations would
  // either reject or, worse, silently take the absolute value of and credit as real experience.
  const impossibleText = new Set(impossible.map((r) => r.matchedText));
  const experience: ExperienceEntry[] = ranges.filter((r) => !impossibleText.has(r.matchedText)).map((r) => ({
    organization: null, role: null, start: r.start, end: r.end, ongoing: r.ongoing,
    months: r.months, context_type: 'PROFESSIONAL',
    provenance: prov('resume_text', r.matchedText, [r.index, r.index + r.length],
      'EXPLICIT', 'EXPLICIT', 'experience.date_range'),
  }));

  const chronology: CareerEvent[] = [...experience]
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .map((e, i) => ({
      order: i, kind: 'EMPLOYMENT' as const,
      label: e.provenance.source_text, start: e.start, end: e.end, provenance: e.provenance,
    }));

  const ambiguities = analyzeAmbiguity(clauses, ranges.length > 0, asText(rec.years_of_experience) || null);
  const contradictions = analyzeContradictions(
    skills, seniority, timelineMonths, statedMonths, overlaps, impossible, 'resume_text');

  const demonstrated = skills.filter((s) => s.assertion === 'DEMONSTRATED').length;
  const confidence: Confidence =
    skills.length === 0 ? 'UNRESOLVED'
      : contradictions.some((c) => c.severity === 'HIGH') ? 'AMBIGUOUS'
        : demonstrated === 0 ? 'LOW'
          : ambiguities.length > 0 ? 'MEDIUM'
            : timelineMonths !== null ? 'HIGH' : 'MEDIUM';

  const profile: CandidateIntelligenceProfile = {
    intelligence_schema_version: CANDIDATE_INTELLIGENCE_SCHEMA_VERSION,
    engine_version: CANDIDATE_ENGINE_VERSION,
    candidate_id: rec.id ?? null,
    current_role: title,
    role_family: titleFamily(title),
    evidence_role_family: evRole.family,
    seniority,
    skills, technologies, capabilities, experience, projects, education, credentials,
    leadership, domains, career_chronology: chronology,
    timeline_months: timelineMonths,
    stated_experience: asText(rec.years_of_experience) || null,
    ambiguities, contradictions, confidence,
    source_hash: rec.source_hash ?? null,
    representation_hash: rec.representation_hash ?? null,
    intelligence_hash: '',
  };
  profile.intelligence_hash = 'sha256:' + createHash('sha256')
    .update(canonicalSerialization(profile)).digest('hex');
  return profile;
}

/** candidate_id and Phase 2 lineage excluded: the hash must measure understanding, not identity. */
export function canonicalSerialization(p: CandidateIntelligenceProfile): string {
  return JSON.stringify({
    intelligence_schema_version: p.intelligence_schema_version,
    engine_version: p.engine_version,
    current_role: p.current_role, role_family: p.role_family,
    evidence_role_family: p.evidence_role_family, seniority: p.seniority,
    skills: p.skills, technologies: p.technologies, capabilities: p.capabilities,
    experience: p.experience, projects: p.projects, education: p.education,
    credentials: p.credentials, leadership: p.leadership, domains: p.domains,
    career_chronology: p.career_chronology, timeline_months: p.timeline_months,
    stated_experience: p.stated_experience,
    ambiguities: p.ambiguities, contradictions: p.contradictions, confidence: p.confidence,
  });
}

// ==================== VALIDATION ====================

export interface ValidationIssue { path: string; problem: string }

export function validateCandidateProfile(
  p: CandidateIntelligenceProfile, rec: CandidateRecordInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fieldText = new Map<string, string>();
  for (const f of [...NARRATIVE_FIELDS, ...DECLARED_FIELDS,
    'certifications', 'industry_domain', 'highest_qualification', 'university',
    'education', 'current_job_title', 'years_of_experience'] as const) {
    fieldText.set(f, asText((rec as Record<string, unknown>)[f]).slice(0, MAX_RESUME_CHARS));
  }

  if (p.intelligence_schema_version !== CANDIDATE_INTELLIGENCE_SCHEMA_VERSION) {
    issues.push({ path: 'intelligence_schema_version', problem: 'unexpected schema version' });
  }
  if (p.engine_version !== CANDIDATE_ENGINE_VERSION) {
    issues.push({ path: 'engine_version', problem: 'unexpected engine version' });
  }

  const checkProv = (path: string, pr?: Provenance) => {
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
        issues.push({ path, problem: `span does not contain quoted text for ${pr.source_field}` });
      }
    }
  };

  p.skills.forEach((s, i) => {
    checkProv(`skills[${i}]`, s.provenance);
    s.supporting_evidence.forEach((e, j) => checkProv(`skills[${i}].supporting_evidence[${j}]`, e));
    // A DECLARED skill may never carry demonstrated-grade evidence - that is the leakage this
    // engine exists to prevent, so it is a hard validation failure rather than a style issue.
    if (s.assertion === 'DECLARED' && s.evidence_strength !== 'DECLARED_ONLY') {
      issues.push({ path: `skills[${i}]`, problem: 'declared skill carries non-declared evidence' });
    }
    if (s.assertion === 'DECLARED' && depthRank(s.depth) > depthRank('MENTIONED')) {
      issues.push({ path: `skills[${i}]`, problem: 'declared skill claims depth beyond MENTIONED' });
    }
    if (s.assertion === 'NEGATED' && s.evidence_strength !== 'NEGATIVE') {
      issues.push({ path: `skills[${i}]`, problem: 'negated skill must carry NEGATIVE evidence' });
    }
    if (s.context_type === 'ACADEMIC' && depthRank(s.depth) > depthRank('PROJECT_USED')) {
      issues.push({ path: `skills[${i}]`, problem: 'academic context claims professional depth' });
    }
  });

  const groups: [string, { provenance?: Provenance }[]][] = [
    ['technologies', p.technologies], ['capabilities', p.capabilities],
    ['experience', p.experience], ['projects', p.projects], ['education', p.education],
    ['credentials', p.credentials], ['leadership', p.leadership], ['domains', p.domains],
    ['ambiguities', p.ambiguities], ['career_chronology', p.career_chronology],
  ];
  for (const [name, arr] of groups) arr.forEach((u, i) => checkProv(`${name}[${i}]`, u.provenance));
  p.contradictions.forEach((c, i) => {
    checkProv(`contradictions[${i}].left`, c.left.provenance);
    checkProv(`contradictions[${i}].right`, c.right.provenance);
  });
  p.seniority.signals.forEach((s, i) => checkProv(`seniority.signals[${i}]`, s.provenance));

  p.experience.forEach((e, i) => {
    if (e.months !== null && (e.months < 0 || e.months > 720)) {
      issues.push({ path: `experience[${i}]`, problem: 'implausible duration' });
    }
    if (e.start && e.end && e.end < e.start) {
      issues.push({ path: `experience[${i}]`, problem: 'end precedes start' });
    }
  });
  if (p.timeline_months !== null && p.timeline_months < 0) {
    issues.push({ path: 'timeline_months', problem: 'negative timeline' });
  }
  return issues;
}
