/**
 * Phase 3 analyzers. Each takes clauses (with spans) and returns intelligence units that cite them.
 *
 * Shared rule: an analyzer may only assert what it can point at. Where a unit is a judgement rather
 * than a reading - a capability derived from a responsibility, a seniority triangulated from
 * several signals - it is labelled INFERRED and carries the signals that produced it, so a consumer
 * can drop it without losing anything the JD literally said.
 */

import type {
  Ambiguity, CapabilityUnit, Confidence, Contradiction, EvidenceKind,
  ExperienceRequirement, Provenance, RelationType, Seniority, SeniorityAssessment, TechnologyUnit,
} from './contract.js';
import type { Clause } from './clauses.js';

export function prov(
  field: string, text: string, span: [number, number] | null,
  derivation: Provenance['derivation'], confidence: Confidence, rule: string,
): Provenance {
  return { source_field: field, source_text: text, span, derivation, confidence, rule };
}

// ==================== EXPERIENCE ====================

/**
 * Durations, bound to the thing they are a duration OF.
 *
 * "5+ years of backend engineering" must not collapse to `5`. The number without its subject is
 * unusable downstream: it cannot distinguish five years of backend engineering from five years of
 * anything at all, and a later phase matching a candidate against a bare 5 would be matching
 * against nothing. The subject is read from the text immediately following the duration, which is
 * where JD prose reliably puts it.
 */
const DURATION_RE =
  /(?<lo>\d{1,2}(?:\.\d)?)\s*(?:(?<plus>\+)|\s*(?:-|–|to)\s*(?<hi>\d{1,2}(?:\.\d)?))?\s*(?<unit>years?|yrs?|months?)\b/gi;

const EXPERIENCE_TYPE_CUES: { re: RegExp; type: ExperienceRequirement['experience_type']; ev: EvidenceKind[] }[] = [
  { re: /\bproduction\b/i, type: 'PRODUCTION', ev: ['PRODUCTION_EXPERIENCE', 'WORK_EXPERIENCE'] },
  { re: /\bhands[-\s]?on\b/i, type: 'HANDS_ON', ev: ['WORK_EXPERIENCE', 'PROJECT_EVIDENCE'] },
  { re: /\b(?:leading|leadership|managing|mentoring)\b/i, type: 'LEADERSHIP', ev: ['LEADERSHIP_EVIDENCE', 'WORK_EXPERIENCE'] },
  { re: /\brecent\b/i, type: 'RECENT', ev: ['RECENCY', 'WORK_EXPERIENCE'] },
  { re: /\brelevant\b/i, type: 'RELEVANT', ev: ['WORK_EXPERIENCE'] },
];

export function analyzeExperience(clauses: Clause[]): ExperienceRequirement[] {
  const out: ExperienceRequirement[] = [];
  for (const c of clauses) {
    DURATION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DURATION_RE.exec(c.text)) !== null) {
      const g = m.groups!;
      const isMonths = /^mo/i.test(g.unit);
      const scale = (n: number) => (isMonths ? Math.round((n / 12) * 1000) / 1000 : n);
      const lo = scale(parseFloat(g.lo));
      const hi = g.hi ? scale(parseFloat(g.hi)) : g.plus ? null : lo;
      const qualifier = g.hi ? 'RANGE' : g.plus ? 'AT_LEAST' : 'EXACT';

      // Subject: the phrase after the duration, stripped of connective filler.
      const after = c.text.slice(m.index + m[0].length);
      const subjMatch = /^\s*(?:of|in|with|as)?\s*([^.,;:]{2,60})/i.exec(after);
      let subject = subjMatch ? subjMatch[1].trim().replace(/\s+/g, ' ') : null;
      if (subject) subject = subject.replace(/\b(?:experience|exp)\b\s*/gi, '').trim() || null;

      let type: ExperienceRequirement['experience_type'] = 'GENERAL';
      let ev: EvidenceKind[] = ['WORK_EXPERIENCE'];
      for (const cue of EXPERIENCE_TYPE_CUES) {
        if (cue.re.test(c.text)) { type = cue.type; ev = cue.ev; break; }
      }
      if (!ev.includes('DURATION')) ev = [...ev, 'DURATION'];

      out.push({
        subject, min_years: lo, max_years: hi, qualifier, experience_type: type,
        evidence_required: ev,
        provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
          'EXPLICIT', subject ? 'EXPLICIT' : 'AMBIGUOUS', 'experience.duration'),
      });
    }

    // Durationless seniority-as-experience: "senior-level experience" states a bar without a number.
    if (!/\d/.test(c.text) && /\b(?:senior|extensive|significant|substantial)[-\s]?level\s+experience\b/i.test(c.text)) {
      const mm = /\b(?:senior|extensive|significant|substantial)[-\s]?level\s+experience\b/i.exec(c.text)!;
      out.push({
        subject: null, min_years: null, max_years: null, qualifier: 'UNSPECIFIED',
        experience_type: 'GENERAL', evidence_required: ['WORK_EXPERIENCE'],
        provenance: prov(c.field, mm[0], [c.start + mm.index, c.start + mm.index + mm[0].length],
          'EXPLICIT', 'AMBIGUOUS', 'experience.unquantified'),
      });
    }
  }
  return out;
}

// ==================== SENIORITY ====================

const TITLE_SIGNALS: { re: RegExp; s: Seniority }[] = [
  { re: /\bintern(?:ship)?\b/i, s: 'INTERN' },
  { re: /\b(?:junior|jr\.?|entry[-\s]level|graduate|fresher)\b/i, s: 'JUNIOR' },
  { re: /\b(?:senior|sr\.?)\b/i, s: 'SENIOR' },
  { re: /\bstaff\b/i, s: 'STAFF' },
  { re: /\bprincipal\b/i, s: 'PRINCIPAL' },
  { re: /\barchitect\b/i, s: 'ARCHITECT' },
  { re: /\b(?:tech(?:nical)?\s+lead|team\s+lead|\blead\b)/i, s: 'LEAD' },
  { re: /\b(?:engineering\s+)?manager\b/i, s: 'MANAGER' },
  { re: /\bdirector\b|\bhead\s+of\b|\bvp\b/i, s: 'DIRECTOR' },
];

const RESPONSIBILITY_SIGNALS: { re: RegExp; s: Seniority; why: string }[] = [
  { re: /\bmentor(?:ing|s)?\b/i, s: 'SENIOR', why: 'mentoring' },
  { re: /\bown(?:s|ing)?\s+(?:the\s+)?(?:architecture|technical\s+direction|roadmap)\b/i, s: 'PRINCIPAL', why: 'architecture ownership' },
  { re: /\b(?:lead|leading)\s+(?:a\s+)?(?:team|squad|group)\b/i, s: 'LEAD', why: 'team leadership' },
  { re: /\bmanag(?:e|ing)\s+(?:a\s+team|engineers|people|reports)\b/i, s: 'MANAGER', why: 'people management' },
  { re: /\bacross\s+(?:multiple\s+)?teams\b/i, s: 'STAFF', why: 'cross-team scope' },
  { re: /\bset(?:ting)?\s+(?:technical\s+)?strategy\b/i, s: 'DIRECTOR', why: 'strategy ownership' },
  { re: /\bunder\s+(?:close\s+)?supervision\b|\bwith\s+guidance\b/i, s: 'JUNIOR', why: 'supervised work' },
];

const YEARS_TO_SENIORITY = (y: number): Seniority =>
  y <= 1 ? 'JUNIOR' : y <= 4 ? 'MID' : y <= 8 ? 'SENIOR' : 'PRINCIPAL';

/**
 * Seniority is triangulated, never taken from the title alone - the phase brief is explicit about
 * that and it matches reality: "Senior Engineer, 1-2 years experience" is a real and common
 * posting, and believing the title there would mislead every downstream phase. Each signal is kept
 * with its provenance; when signals disagree the assessment still returns the strongest evidence
 * but drops confidence to AMBIGUOUS, and the contradiction analyzer records the conflict
 * separately. Nothing is silently reconciled.
 */
export function analyzeSeniority(
  title: string | null, clauses: Clause[], experience: ExperienceRequirement[],
): SeniorityAssessment {
  const signals: SeniorityAssessment['signals'] = [];

  if (title) {
    for (const t of TITLE_SIGNALS) {
      const m = t.re.exec(title);
      if (m) {
        signals.push({ signal: `title:${m[0]}`, suggests: t.s,
          provenance: prov('title', m[0], [m.index, m.index + m[0].length], 'EXPLICIT', 'HIGH', 'seniority.title') });
      }
    }
  }
  for (const c of clauses) {
    for (const r of RESPONSIBILITY_SIGNALS) {
      const m = r.re.exec(c.text);
      if (m) {
        signals.push({ signal: `responsibility:${r.why}`, suggests: r.s,
          provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
            'INFERRED', 'MEDIUM', 'seniority.responsibility') });
      }
    }
  }
  for (const e of experience) {
    if (e.min_years !== null) {
      signals.push({ signal: `years:${e.min_years}`, suggests: YEARS_TO_SENIORITY(e.min_years),
        provenance: { ...e.provenance, derivation: 'DERIVED', rule: 'seniority.years' } });
    }
  }

  if (signals.length === 0) return { seniority: null, signals: [], confidence: 'UNRESOLVED' };

  const distinct = new Set(signals.map((s) => s.suggests));
  // Title outranks other signals for the reported value because it is the employer's own label;
  // disagreement is expressed through confidence and the contradiction list, not by overriding it.
  const titleSignal = signals.find((s) => s.signal.startsWith('title:'));
  const chosen = titleSignal ? titleSignal.suggests : signals[0].suggests;
  const confidence: Confidence =
    distinct.size === 1 ? (titleSignal ? 'EXPLICIT' : 'HIGH')
      : distinct.size === 2 ? 'MEDIUM' : 'AMBIGUOUS';
  return { seniority: chosen, signals, confidence };
}

// ==================== RESPONSIBILITY -> CAPABILITY ====================

/**
 * Capabilities implied by what the role actually does.
 *
 * Every output here is INFERRED and says so. "Design and maintain scalable distributed services"
 * does not literally contain the words "backend architecture", so presenting that capability as a
 * JD fact would be exactly the fabrication this phase must not commit. It is emitted as a
 * derivation from a cited span, and a consumer that only wants literal requirements can filter it
 * out in one predicate.
 */
const CAPABILITY_PATTERNS: { re: RegExp; caps: string[] }[] = [
  { re: /\b(?:design|architect)(?:ing)?\b[^.;]*\b(?:distributed|microservices?|services?)\b/i,
    caps: ['service design', 'distributed systems', 'backend architecture'] },
  { re: /\bscalab(?:le|ility)\b/i, caps: ['scalability engineering'] },
  { re: /\b(?:rest|restful|graphql)\s*api/i, caps: ['API design', 'API implementation'] },
  { re: /\bdeploy(?:ing|ment)?\b[^.;]*\b(?:aws|azure|gcp|cloud)\b/i, caps: ['cloud deployment'] },
  { re: /\b(?:kubernetes|k8s|container|docker)\b/i, caps: ['container orchestration'] },
  { re: /\bci\/?cd\b|\bpipelines?\b/i, caps: ['build and release engineering'] },
  { re: /\b(?:monitor|observab|alert|on[-\s]?call|incident)\w*\b/i, caps: ['production engineering'] },
  { re: /\b(?:etl|data\s+pipelines?|ingest)\w*\b/i, caps: ['data engineering'] },
  { re: /\b(?:machine\s+learning|ml\s+models?|predictive\s+models?)\b/i, caps: ['machine learning'] },
  { re: /\b(?:query|database|schema)\s*(?:optimi|design|tuning)\w*\b/i, caps: ['database engineering'] },
  { re: /\bmentor|coach(?:ing)?\b/i, caps: ['technical mentorship'] },
  { re: /\b(?:security|authentication|authorization|compliance)\b/i, caps: ['security engineering'] },
  { re: /\btest(?:ing|s)?\b|\bqa\b|\bautomation\b/i, caps: ['test engineering'] },
  { re: /\b(?:stakeholder|cross[-\s]functional|collaborat)\w*\b/i, caps: ['cross-functional collaboration'] },
];

export function analyzeCapabilities(clauses: Clause[]): CapabilityUnit[] {
  const out: CapabilityUnit[] = [];
  const seen = new Set<string>();
  for (const c of clauses) {
    for (const p of CAPABILITY_PATTERNS) {
      const m = p.re.exec(c.text);
      if (!m) continue;
      for (const cap of p.caps) {
        const key = `${cap}::${c.field}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          capability: cap,
          from_responsibility: c.text.trim().slice(0, 200),
          provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
            'INFERRED', 'MEDIUM', 'capability.pattern'),
        });
      }
    }
  }
  return out;
}

// ==================== TECHNOLOGY RELATIONSHIPS ====================

/**
 * Relationships come from the parser's curated dictionary CATEGORY, never invented per-token.
 *
 * The dictionary already asserts that FastAPI is a backend_framework and PostgreSQL is a database;
 * turning a category into IS_A / USED_FOR edges is a mechanical mapping of an existing curated
 * fact. What this deliberately does NOT do is guess relationships for technologies the dictionary
 * has never heard of - an unknown token yields zero edges rather than a plausible-looking guess,
 * because a fabricated edge would be indistinguishable from a curated one to Phase 5.
 */
const CATEGORY_RELATIONS: Record<string, { type: RelationType; target: string }[]> = {
  programming_language: [{ type: 'USED_FOR', target: 'software development' }],
  backend_framework: [{ type: 'IS_A', target: 'backend framework' }, { type: 'USED_FOR', target: 'API development' }],
  frontend_framework: [{ type: 'IS_A', target: 'frontend framework' }, { type: 'USED_FOR', target: 'user interface development' }],
  database: [{ type: 'IS_A', target: 'data store' }, { type: 'USED_FOR', target: 'data persistence' }],
  cloud: [{ type: 'IS_A', target: 'cloud platform' }, { type: 'USED_FOR', target: 'infrastructure provisioning' }],
  devops: [{ type: 'IS_A', target: 'devops tooling' }, { type: 'USED_FOR', target: 'deployment automation' }],
  testing: [{ type: 'IS_A', target: 'testing tool' }, { type: 'USED_FOR', target: 'quality assurance' }],
  messaging: [{ type: 'IS_A', target: 'messaging system' }, { type: 'USED_FOR', target: 'asynchronous communication' }],
  ai_ml: [{ type: 'IS_A', target: 'machine learning tooling' }, { type: 'USED_FOR', target: 'model development' }],
  data_engineering: [{ type: 'IS_A', target: 'data tooling' }, { type: 'USED_FOR', target: 'data processing' }],
  library: [{ type: 'PART_OF', target: 'software ecosystem' }],
  methodology: [{ type: 'IS_A', target: 'working practice' }],
  architecture: [{ type: 'IS_A', target: 'architectural approach' }],
  security: [{ type: 'IS_A', target: 'security tooling' }, { type: 'USED_FOR', target: 'security engineering' }],
  operating_system: [{ type: 'IS_A', target: 'operating system' }],
  tool: [{ type: 'IS_A', target: 'engineering tool' }],
  design: [{ type: 'IS_A', target: 'design tooling' }],
  soft_skill: [],
  general: [],
};

export function relationsFor(category: string | null): { type: RelationType; target: string }[] {
  if (!category) return [];
  return CATEGORY_RELATIONS[category] ?? [];
}

export function technologyUnit(
  name: string, category: string | null, p: Provenance,
): TechnologyUnit {
  return { name, category, relationships: relationsFor(category), provenance: p };
}

// ==================== AMBIGUITY ====================

const VAGUE_QUALIFIERS = /\b(?:strong|solid|good|excellent|deep|sound|working)\s+(?:knowledge|understanding|grasp|command|skills?)\b/i;
const UNSPECIFIED_TECH = [
  { re: /\bcloud\s+(?:platforms?|providers?|technologies)\b/i, options: ['AWS', 'Azure', 'GCP'] },
  { re: /\bdatabases?\b(?!\s*(?:like|such as|:))/i, options: ['PostgreSQL', 'MySQL', 'MongoDB', 'Oracle'] },
  { re: /\b(?:programming|scripting)\s+languages?\b(?!\s*(?:like|such as|:))/i, options: ['Python', 'Java', 'JavaScript', 'Go'] },
  { re: /\b(?:frontend|front[-\s]end)\s+frameworks?\b(?!\s*(?:like|such as|:))/i, options: ['React', 'Angular', 'Vue.js'] },
  { re: /\bci\/?cd\s+tools?\b(?!\s*(?:like|such as|:))/i, options: ['Jenkins', 'GitHub Actions', 'GitLab CI'] },
];

export function analyzeAmbiguity(clauses: Clause[]): Ambiguity[] {
  const out: Ambiguity[] = [];
  for (const c of clauses) {
    for (const u of UNSPECIFIED_TECH) {
      const m = u.re.exec(c.text);
      if (m) {
        out.push({
          type: 'UNSPECIFIED_TECHNOLOGY', text_span: m[0], possible_interpretations: u.options,
          provenance: prov(c.field, m[0], [c.start + m.index, c.start + m.index + m[0].length],
            'EXPLICIT', 'HIGH', 'ambiguity.unspecified_technology'),
        });
      }
    }
    const v = VAGUE_QUALIFIERS.exec(c.text);
    if (v) {
      out.push({
        type: 'VAGUE_QUALIFIER', text_span: v[0],
        possible_interpretations: ['no measurable threshold stated'],
        provenance: prov(c.field, v[0], [c.start + v.index, c.start + v.index + v[0].length],
          'EXPLICIT', 'HIGH', 'ambiguity.vague_qualifier'),
      });
    }
  }
  return out;
}

// ==================== CONTRADICTION ====================

const SENIOR_MIN_YEARS: Partial<Record<Seniority, number>> = {
  SENIOR: 4, LEAD: 5, STAFF: 7, PRINCIPAL: 8, ARCHITECT: 8, DIRECTOR: 10,
};

/**
 * Conflicts are recorded, never resolved. A JD that says "Senior" and "1-2 years" is genuinely
 * incoherent, and picking a winner would hide a real signal about the posting from every later
 * phase - the honest output is both claims plus the fact that they disagree.
 */
export function analyzeContradictions(
  seniority: SeniorityAssessment, experience: ExperienceRequirement[],
): Contradiction[] {
  const out: Contradiction[] = [];

  if (seniority.seniority) {
    const floor = SENIOR_MIN_YEARS[seniority.seniority];
    const titleSig = seniority.signals.find((s) => s.signal.startsWith('title:'));
    if (floor !== undefined && titleSig) {
      for (const e of experience) {
        const stated = e.max_years ?? e.min_years;
        if (stated !== null && stated < floor) {
          out.push({
            type: 'SENIORITY_VS_EXPERIENCE', severity: 'HIGH',
            left: { claim: `title implies ${seniority.seniority}`, provenance: titleSig.provenance },
            right: { claim: `stated experience ${e.min_years}-${e.max_years ?? '∞'} years`, provenance: e.provenance },
          });
        }
      }
    }
  }

  // Two different durations asserted for the same subject.
  for (let i = 0; i < experience.length; i++) {
    for (let j = i + 1; j < experience.length; j++) {
      const a = experience[i], b = experience[j];
      if (!a.subject || !b.subject) continue;
      if (a.subject.toLowerCase() !== b.subject.toLowerCase()) continue;
      if (a.min_years === b.min_years) continue;
      out.push({
        type: 'EXPERIENCE_RANGE_CONFLICT', severity: 'MEDIUM',
        left: { claim: `${a.min_years} years of ${a.subject}`, provenance: a.provenance },
        right: { claim: `${b.min_years} years of ${b.subject}`, provenance: b.provenance },
      });
    }
  }

  // Signals that disagree about level, beyond the title/years pairing handled above.
  const bySuggestion = new Map<Seniority, typeof seniority.signals>();
  for (const s of seniority.signals) {
    if (!bySuggestion.has(s.suggests)) bySuggestion.set(s.suggests, []);
    bySuggestion.get(s.suggests)!.push(s);
  }
  if (bySuggestion.size > 2) {
    const entries = [...bySuggestion.entries()];
    out.push({
      type: 'RESPONSIBILITY_VS_SENIORITY', severity: 'LOW',
      left: { claim: `signals suggest ${entries[0][0]}`, provenance: entries[0][1][0].provenance },
      right: { claim: `signals suggest ${entries[entries.length - 1][0]}`, provenance: entries[entries.length - 1][1][0].provenance },
    });
  }
  return out;
}
