/**
 * Phase 7 golden matching benchmark.
 *
 * Every expected label was decided by reading the JD requirement and the candidate fragment and
 * asking what a careful recruiter would conclude, then checked against the written policy in
 * contract.ts. None was produced by running the engine and recording its output.
 *
 * The semantic cases are grounded in edges that ACTUALLY EXIST in the Phase 5 ontology, verified by
 * querying the built graph rather than assumed:
 *   AWS        ALTERNATIVE_TO Azure                 -> EQUIVALENT
 *   PostgreSQL ALTERNATIVE_TO MySQL                 -> EQUIVALENT
 *   TensorFlow ALTERNATIVE_TO PyTorch               -> EQUIVALENT
 *   FastAPI    USED_FOR       api development       -> ENABLING
 *   FastAPI / Django  IS_A    python web framework  -> SAME_FAMILY
 *   React / React Native IS_A frontend framework    -> SAME_FAMILY (a near miss, NOT a match)
 *   Docker     RELATED_TO     Kubernetes            -> RELATED  (must never satisfy)
 */

import type {
  Alignment, Compatibility, SatisfactionState, SemanticRoute,
} from './contract.js';
import type { CandidateProfileP7, JobProfileP7 } from './engine.js';

export interface GoldenMatchCase {
  name: string;
  category: string;
  job: JobProfileP7;
  candidate: CandidateProfileP7;
  expect: {
    /** State of the FIRST requirement unless `subject` names another. */
    state?: SatisfactionState;
    subject?: string;
    route?: SemanticRoute;
    /** Assertions on the whole profile. */
    experienceAlignment?: Alignment;
    seniorityAlignment?: Alignment;
    domainCompatibility?: Compatibility;
    locationCompatibility?: Compatibility;
    hasTransferable?: boolean;
    minScore?: number;
    maxScore?: number;
    insufficientData?: boolean;
    compositeState?: SatisfactionState;
    hasContradiction?: boolean;
    derivativeCount?: number;
  };
}

// ---------------------------------------------------------------- fragments
type SkillArg = {
  skill: string; assertion?: string; depth?: string; strength?: string;
  context?: string; recency?: string; fields?: string[];
};
export const skill = (a: SkillArg) => ({
  skill: a.skill,
  assertion: a.assertion ?? 'DEMONSTRATED',
  depth: a.depth ?? 'PROFESSIONAL_USED',
  evidence_strength: a.strength ?? 'DIRECT',
  context_type: a.context ?? 'PROFESSIONAL',
  recency: a.recency ?? 'ACTIVE',
  supporting_evidence: (a.fields ?? ['resume_text']).map((f, i) => ({
    source_field: f, source_text: a.skill, span: [i * 30, i * 30 + a.skill.length] as [number, number],
  })),
  provenance: { source_field: (a.fields ?? ['resume_text'])[0], source_text: a.skill,
    span: [0, a.skill.length] as [number, number] },
});

export const req = (subject: string, level = 'MANDATORY', evidence: string[] = ['WORK_EXPERIENCE'],
  context: string | null = null, negated = false) =>
  ({ subject, level, context, negated, evidence_required: evidence });

export const job = (o: Partial<JobProfileP7> & { requirements: ReturnType<typeof req>[] }): JobProfileP7 => ({
  job_id: 1, intelligence_hash: 'sha256:job',
  role_title: 'Backend Engineer', role_family: 'backend engineering',
  seniority: { seniority: 'SENIOR' },
  experience_requirements: [], domain_requirements: [], location_constraints: [], work_constraints: [],
  ...o,
});

/**
 * `timeline_months` is derived from the employment spans when not stated explicitly, because a real
 * Phase 4 profile always carries it. Omitting it made every fixture look undatable to Phase 6, which
 * attached a spurious DURATION gap to every skill requirement whenever the JD stated any years
 * requirement - a fixture artefact that would otherwise have read as a Phase 7 scoring bug.
 */
export const cand = (o: Partial<CandidateProfileP7>): CandidateProfileP7 => {
  const spans = (o.experience ?? []).filter((e) => e.start)
    .map((e) => ({ start: e.start as string, end: e.end ?? '2026-08' }));
  let derived: number | null = null;
  if (spans.length) {
    const sorted = [...spans].sort((a, b) => a.start.localeCompare(b.start));
    const mb = (a: string, b: string) => {
      const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
      return (by - ay) * 12 + (bm - am);
    };
    let total = 0, cs = sorted[0].start, ce = sorted[0].end;
    for (const s of sorted.slice(1)) {
      if (s.start <= ce) { if (s.end > ce) ce = s.end; }
      else { total += Math.max(0, mb(cs, ce)); cs = s.start; ce = s.end; }
    }
    derived = total + Math.max(0, mb(cs, ce));
  }
  return {
    candidate_id: 1, intelligence_hash: 'sha256:cand',
    seniority: { seniority: 'SENIOR' },
    ...(derived !== null ? { timeline_months: derived } : {}),
    ...o,
  };
};

/** A datable, role-bearing employment span. */
export const emp = (role: string, start: string, end: string | null, context = 'PROFESSIONAL') =>
  ({ role, organization: 'Acme', start, end, ongoing: end === null, months: null, context_type: context });

// ================================================================ EXACT MATCHING
const EXACT: GoldenMatchCase[] = [
  { name: 'exact skill with production evidence is SATISFIED', category: 'exact',
    job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PRODUCTION_USED', context: 'PRODUCTION' })] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },

  { name: 'exact skill with professional evidence is SATISFIED', category: 'exact',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },

  { name: 'exact skill declared only is WEAKLY_SATISFIED', category: 'exact',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python', assertion: 'DECLARED', depth: 'MENTIONED',
      strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['primary_skills'] })] }),
    expect: { state: 'WEAKLY_SATISFIED', route: 'EXACT' } },

  { name: 'exact skill in academic context cannot satisfy a professional requirement', category: 'exact',
    job: job({ requirements: [req('Java')] }),
    candidate: cand({ skills: [skill({ skill: 'Java', depth: 'PROJECT_USED', context: 'ACADEMIC' })] }),
    expect: { state: 'WEAKLY_SATISFIED', route: 'EXACT' } },

  { name: 'exact skill missing entirely is NOT_SATISFIED', category: 'exact',
    job: job({ requirements: [req('Rust')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' }), skill({ skill: 'Go' })] }),
    expect: { state: 'NOT_SATISFIED', route: 'NONE' } },

  { name: 'case-insensitive exact match', category: 'exact',
    job: job({ requirements: [req('python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },

  { name: 'production requirement with only professional evidence is PARTIALLY_SATISFIED', category: 'exact',
    job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL' })] }),
    expect: { state: 'PARTIALLY_SATISFIED', route: 'EXACT' } },
];

// ================================================================ SEMANTIC EQUIVALENCE
const SEMANTIC: GoldenMatchCase[] = [
  { name: 'Azure satisfies an AWS requirement via ALTERNATIVE_TO', category: 'semantic',
    job: job({ requirements: [req('AWS')] }),
    candidate: cand({ skills: [skill({ skill: 'Azure' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT', hasTransferable: true } },

  { name: 'MySQL satisfies a PostgreSQL requirement via ALTERNATIVE_TO', category: 'semantic',
    job: job({ requirements: [req('PostgreSQL')] }),
    candidate: cand({ skills: [skill({ skill: 'MySQL' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT' } },

  { name: 'PyTorch satisfies a TensorFlow requirement via ALTERNATIVE_TO', category: 'semantic',
    job: job({ requirements: [req('TensorFlow')] }),
    candidate: cand({ skills: [skill({ skill: 'PyTorch' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT' } },

  { name: 'an equivalent substitute inherits the WEAKNESS of its own evidence', category: 'semantic',
    job: job({ requirements: [req('AWS')] }),
    candidate: cand({ skills: [skill({ skill: 'Azure', assertion: 'DECLARED', depth: 'MENTIONED',
      strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['skills'] })] }),
    expect: { state: 'WEAKLY_SATISFIED', route: 'EQUIVALENT' } },

  { name: 'FastAPI reaches API development via USED_FOR but only as TRANSFERABLE', category: 'semantic',
    job: job({ requirements: [req('API development')] }),
    candidate: cand({ skills: [skill({ skill: 'FastAPI' })] }),
    expect: { state: 'TRANSFERABLE', route: 'ENABLING', hasTransferable: true } },

  { name: 'Django does not SATISFY a FastAPI requirement despite the shared family', category: 'semantic',
    job: job({ requirements: [req('FastAPI')] }),
    candidate: cand({ skills: [skill({ skill: 'Django' })] }),
    expect: { state: 'TRANSFERABLE', route: 'SAME_FAMILY', hasTransferable: true } },

  { name: 'React does NOT satisfy React Native - a near miss, not a match', category: 'semantic',
    job: job({ requirements: [req('React Native')] }),
    candidate: cand({ skills: [skill({ skill: 'React' })] }),
    // Their only shared parent is "frontend framework" (17 members - Angular, Vue, Svelte, Ember...),
    // a taxonomy bucket rather than a capability family, so no transferable route is claimed at all.
    expect: { state: 'NOT_SATISFIED', route: 'NONE' } },

  { name: 'Docker RELATED_TO Kubernetes never satisfies a Kubernetes requirement', category: 'semantic',
    job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ skills: [skill({ skill: 'Docker', depth: 'PRODUCTION_USED', context: 'PRODUCTION' })] }),
    expect: { state: 'NOT_SATISFIED' } },

  { name: 'MongoDB does not satisfy PostgreSQL (document vs relational)', category: 'semantic',
    job: job({ requirements: [req('PostgreSQL')] }),
    candidate: cand({ skills: [skill({ skill: 'MongoDB' })] }),
    // MongoDB IS_A document database, PostgreSQL IS_A relational database; the only shared parent is
    // "data store" (14 members), too broad to carry transferability.
    expect: { state: 'NOT_SATISFIED' } },

  { name: 'an unrelated technology reaches nothing', category: 'semantic',
    job: job({ requirements: [req('Kubernetes')] }),
    candidate: cand({ skills: [skill({ skill: 'Photoshop' })] }),
    expect: { state: 'NOT_SATISFIED', route: 'NONE' } },

  { name: 'exact evidence is preferred over an available substitute', category: 'semantic',
    job: job({ requirements: [req('AWS')] }),
    candidate: cand({ skills: [skill({ skill: 'AWS' }), skill({ skill: 'Azure' })] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },

  { name: 'a substitute cannot rescue a negated candidate skill', category: 'semantic',
    job: job({ requirements: [req('AWS')] }),
    candidate: cand({ skills: [skill({ skill: 'Azure', assertion: 'NEGATED' })] }),
    expect: { state: 'NOT_SATISFIED' } },
];

// ================================================================ EVIDENCE-AWARE
const EVIDENCE_AWARE: GoldenMatchCase[] = [
  { name: 'claimed-only Kubernetes is not a strong Kubernetes match', category: 'evidence',
    job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED',
      strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['skills'] })] }),
    expect: { state: 'WEAKLY_SATISFIED' } },

  { name: 'a certification alone does not satisfy a hands-on requirement', category: 'evidence',
    job: job({ requirements: [req('AWS')] }),
    candidate: cand({ credentials: [{ name: 'AWS Certified Solutions Architect', kind: 'CERTIFICATION' }] }),
    expect: { state: 'NOT_SATISFIED' } },

  { name: 'an academic project does not satisfy a production requirement', category: 'evidence',
    job: job({ requirements: [req('Docker', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ skills: [skill({ skill: 'Docker', depth: 'PROJECT_USED', context: 'ACADEMIC' })] }),
    expect: { state: 'WEAKLY_SATISFIED' } },

  { name: 'an unlabelled project does not establish professional context', category: 'evidence',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ projects: [{ name: 'Built a recruitment platform', technologies: ['Python'] }] }),
    expect: { state: 'PARTIALLY_SATISFIED' } },

  { name: 'a project marked PRODUCTION by Phase 4 does satisfy production', category: 'evidence',
    job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ projects: [{ name: 'Payments cluster', technologies: ['Kubernetes'], context_type: 'PRODUCTION' }] }),
    expect: { state: 'SATISFIED' } },

  { name: 'Phase 7 never rates a requirement above its Phase 6 evidence', category: 'evidence',
    job: job({ requirements: [req('Go')] }),
    candidate: cand({ skills: [skill({ skill: 'Go', depth: 'MENTIONED', assertion: 'MENTIONED',
      strength: 'MODERATE', context: 'UNKNOWN' })] }),
    expect: { state: 'WEAKLY_SATISFIED' } },
];

// ================================================================ EXPERIENCE RELEVANCE
const EXPERIENCE: GoldenMatchCase[] = [
  { name: 'THE CORE CASE: 7 years data analysis does not meet 5 years backend', category: 'experience',
    job: job({ role_family: 'backend engineering', role_title: 'Backend Engineer',
      requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [emp('Data Analyst', '2018-01', '2025-01'), emp('Backend Engineer', '2025-01', '2026-01')] }),
    expect: { experienceAlignment: 'UNDER', hasContradiction: true } },

  { name: 'relevant role meeting the duration is ALIGNED', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [emp('Backend Engineer', '2019-01', '2026-01')] }),
    expect: { experienceAlignment: 'ALIGNED' } },

  { name: 'overlapping relevant roles are unioned, not summed', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 6, qualifier: 'AT_LEAST' }] }),
    // 2020-2023 and 2021-2024 are 72 months of employment across 48 elapsed months.
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [emp('Backend Engineer', '2020-01', '2023-01'), emp('Backend Developer', '2021-01', '2024-01')] }),
    expect: { experienceAlignment: 'UNDER' } },

  { name: 'no role information leaves relevance UNKNOWN, never zero', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [{ role: null, organization: null, start: '2019-01', end: '2026-01', ongoing: false, months: 84, context_type: 'PROFESSIONAL' }] }),
    expect: { experienceAlignment: 'UNKNOWN' } },

  { name: 'no experience requirement means no experience demand', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], experience: [emp('Backend Engineer', '2024-01', '2026-01')] }),
    expect: { experienceAlignment: 'UNKNOWN' } },

  { name: 'far more relevant experience than required reads OVER', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 2, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], experience: [emp('Backend Engineer', '2014-01', '2026-01')] }),
    expect: { experienceAlignment: 'OVER' } },

  { name: 'seniority words are stripped before role comparison', category: 'experience',
    job: job({ role_family: 'backend engineering', role_title: 'Backend Engineer', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 3, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], experience: [emp('Senior Backend Developer', '2020-01', '2026-01')] }),
    // 72 relevant months against a 36-month bar is OVER by the 2x policy; the case still proves the
    // stripping works, because a failure to strip "Senior" would read UNKNOWN or UNDER instead.
    expect: { experienceAlignment: 'OVER' } },

  { name: 'a career changer has relevant months well below the total', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 4, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [emp('Marketing Manager', '2015-01', '2023-01'), emp('Backend Engineer', '2023-01', '2026-01')] }),
    expect: { experienceAlignment: 'UNDER' } },
];

// ================================================================ NEGATION
const NEGATION: GoldenMatchCase[] = [
  { name: 'a negated JD requirement is WAIVED, never a demand', category: 'negation',
    job: job({ requirements: [req('PHP', 'MANDATORY', ['WORK_EXPERIENCE'], null, true)] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { state: 'WAIVED' } },

  { name: 'an EXCLUDED level requirement is WAIVED', category: 'negation',
    job: job({ requirements: [req('COBOL', 'EXCLUDED')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { state: 'WAIVED' } },

  { name: 'a waived requirement is not a gap even when the candidate lacks it', category: 'negation',
    job: job({ requirements: [req('PHP', 'MANDATORY', ['WORK_EXPERIENCE'], null, true)] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { state: 'WAIVED', hasContradiction: false } },

  { name: 'a candidate denying a required skill is CONTRADICTED', category: 'negation',
    job: job({ requirements: [req('Kubernetes')] }),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'NEGATED' })] }),
    expect: { state: 'CONTRADICTED', hasContradiction: true } },

  { name: 'denying one skill leaves a neighbouring requirement intact', category: 'negation',
    job: job({ requirements: [req('Docker'), req('Kubernetes')] }),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'NEGATED' }), skill({ skill: 'Docker' })] }),
    expect: { subject: 'Docker', state: 'SATISFIED' } },
];

// ================================================================ COMPOSITE / OR
const COMPOSITE: GoldenMatchCase[] = [
  { name: 'AWS OR Azure is satisfied by holding either', category: 'composite',
    job: job({ requirements: [req('AWS'), req('Azure')] }),
    candidate: cand({ skills: [skill({ skill: 'AWS' })] }),
    expect: { compositeState: 'SATISFIED' } },

  { name: 'AWS OR Azure with neither held is NOT_SATISFIED', category: 'composite',
    job: job({ requirements: [req('AWS'), req('Azure')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { compositeState: 'NOT_SATISFIED' } },

  { name: 'PostgreSQL OR MySQL is satisfied by MySQL', category: 'composite',
    job: job({ requirements: [req('PostgreSQL'), req('MySQL')] }),
    candidate: cand({ skills: [skill({ skill: 'MySQL' })] }),
    expect: { compositeState: 'SATISFIED' } },

  { name: 'an OR group takes the STRONGEST member, not the weakest', category: 'composite',
    job: job({ requirements: [req('AWS'), req('Azure')] }),
    candidate: cand({ skills: [skill({ skill: 'AWS' }),
      skill({ skill: 'Azure', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY',
        context: 'UNKNOWN', fields: ['skills'] })] }),
    expect: { compositeState: 'SATISFIED' } },
];

// ================================================================ UNKNOWN vs MISSING
const UNKNOWN_VS_MISSING: GoldenMatchCase[] = [
  { name: 'an empty candidate record is UNKNOWN, not NOT_SATISFIED', category: 'unknown',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({}),
    expect: { state: 'UNKNOWN', insufficientData: true } },

  { name: 'a rich record missing the skill is NOT_SATISFIED', category: 'unknown',
    job: job({ requirements: [req('Rust')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' }), skill({ skill: 'Go' }), skill({ skill: 'Java' })] }),
    expect: { state: 'NOT_SATISFIED', insufficientData: false } },

  { name: 'UNKNOWN requirements do not drag the score to zero', category: 'unknown',
    job: job({ requirements: [req('Python'), req('Rust', 'OPTIONAL')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { subject: 'Python', state: 'SATISFIED', minScore: 40 } },

  { name: 'an all-unknown profile reports insufficient data rather than a low score', category: 'unknown',
    job: job({ requirements: [req('Python'), req('Java'), req('Go')] }),
    candidate: cand({}),
    expect: { insufficientData: true } },
];

// ================================================================ SENIORITY / DOMAIN / LOCATION
const CONTEXT: GoldenMatchCase[] = [
  { name: 'matching seniority is ALIGNED', category: 'context',
    job: job({ seniority: { seniority: 'SENIOR' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'SENIOR' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'ALIGNED' } },

  { name: 'a junior candidate for a senior role is UNDER', category: 'context',
    job: job({ seniority: { seniority: 'SENIOR' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'JUNIOR' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'UNDER' } },

  { name: 'a principal candidate for a mid role is OVER, not a rejection', category: 'context',
    job: job({ seniority: { seniority: 'MID' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'PRINCIPAL' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'OVER' } },

  { name: 'unknown candidate seniority is UNKNOWN, not UNDER', category: 'context',
    job: job({ seniority: { seniority: 'SENIOR' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: null }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'UNKNOWN' } },

  { name: 'matching domain is MATCHED', category: 'context',
    job: job({ requirements: [req('Python')], domain_requirements: [{ subject: 'fintech', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], domains: [{ domain: 'fintech' }] }),
    expect: { domainCompatibility: 'MATCHED' } },

  { name: 'absent candidate domain is UNKNOWN, never MISMATCHED', category: 'context',
    job: job({ requirements: [req('Python')], domain_requirements: [{ subject: 'fintech', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { domainCompatibility: 'UNKNOWN' } },

  { name: 'a different stated domain is MISMATCHED', category: 'context',
    job: job({ requirements: [req('Python')], domain_requirements: [{ subject: 'fintech', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], domains: [{ domain: 'agriculture' }] }),
    expect: { domainCompatibility: 'MISMATCHED' } },

  { name: 'no domain requirement is NOT_APPLICABLE', category: 'context',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], domains: [{ domain: 'fintech' }] }),
    expect: { domainCompatibility: 'NOT_APPLICABLE' } },

  { name: 'a remote job imposes no location constraint', category: 'context',
    job: job({ requirements: [req('Python')], location_constraints: [{ subject: 'Remote', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { locationCompatibility: 'MATCHED' } },

  { name: 'an onsite job with no candidate location is UNKNOWN, never inferred', category: 'context',
    job: job({ requirements: [req('Python')], location_constraints: [{ subject: 'Bangalore', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { locationCompatibility: 'UNKNOWN' } },

  { name: 'no location constraint is NOT_APPLICABLE', category: 'context',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { locationCompatibility: 'NOT_APPLICABLE' } },
];

// ================================================================ SCORING
const SCORING: GoldenMatchCase[] = [
  { name: 'a fully satisfied senior candidate scores high', category: 'scoring',
    job: job({ role_family: 'backend engineering', seniority: { seniority: 'SENIOR' },
      requirements: [req('Python'), req('AWS')],
      experience_requirements: [{ subject: null, min_years: 3, qualifier: 'AT_LEAST' }],
      location_constraints: [{ subject: 'Remote', level: 'MANDATORY' }] }),
    candidate: cand({ seniority: { seniority: 'SENIOR' },
      skills: [skill({ skill: 'Python' }), skill({ skill: 'AWS' })],
      experience: [emp('Backend Engineer', '2019-01', '2026-01')] }),
    expect: { minScore: 85 } },

  { name: 'a candidate missing every mandatory requirement scores low', category: 'scoring',
    job: job({ role_family: 'backend engineering', requirements: [req('Python'), req('AWS'), req('Kubernetes')] }),
    candidate: cand({ skills: [skill({ skill: 'Photoshop' }), skill({ skill: 'Illustrator' })] }),
    expect: { maxScore: 35 } },

  { name: 'declared-only skills across the board score in the weak band', category: 'scoring',
    job: job({ role_family: 'backend engineering', requirements: [req('Python'), req('AWS')] }),
    candidate: cand({ skills: [
      skill({ skill: 'Python', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['skills'] }),
      skill({ skill: 'AWS', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['skills'] })] }),
    expect: { maxScore: 60 } },

  { name: 'the score never leaves 0-100 under a pile of contradictions', category: 'scoring',
    job: job({ requirements: [req('Python'), req('AWS'), req('Kubernetes'), req('Go'), req('Rust')] }),
    candidate: cand({ skills: [
      skill({ skill: 'Python', assertion: 'NEGATED' }), skill({ skill: 'AWS', assertion: 'NEGATED' }),
      skill({ skill: 'Kubernetes', assertion: 'NEGATED' }), skill({ skill: 'Go', assertion: 'NEGATED' }),
      skill({ skill: 'Rust', assertion: 'NEGATED' })] }),
    expect: { minScore: 0, maxScore: 40 } },

  { name: 'an OPTIONAL miss costs far less than a MANDATORY miss', category: 'scoring',
    job: job({ role_family: 'backend engineering', requirements: [req('Python'), req('Rust', 'OPTIONAL')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { minScore: 50 } },
];

// ================================================================ DOUBLE COUNTING
const DOUBLE_COUNT: GoldenMatchCase[] = [
  { name: 'one skill sighting cannot satisfy two requirements independently', category: 'double_count',
    // Python and "software development" rest on the same underlying Python sighting.
    job: job({ requirements: [req('Python'), req('software development')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { derivativeCount: 1 } },

  { name: 'genuinely separate skills are not marked derivative', category: 'double_count',
    job: job({ requirements: [req('Python'), req('AWS')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' }), skill({ skill: 'AWS' })] }),
    expect: { derivativeCount: 0 } },
];

export const GOLDEN_MATCH_CASES: GoldenMatchCase[] = [
  ...EXACT, ...SEMANTIC, ...EVIDENCE_AWARE, ...EXPERIENCE, ...NEGATION,
  ...COMPOSITE, ...UNKNOWN_VS_MISSING, ...CONTEXT, ...SCORING, ...DOUBLE_COUNT,
];
