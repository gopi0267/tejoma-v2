/**
 * Phase 6 golden evidence benchmark.
 *
 * Every expected state was decided by reading the requirement and the candidate evidence and asking
 * what a careful recruiter would conclude. None came from running the engine and recording its
 * output - a benchmark generated from the system under test proves only that the system is
 * self-consistent, which is exactly the failure mode this phase must exclude.
 *
 * The cases are built from small explicit fragments rather than whole profiles so a reviewer can
 * see, in one line, precisely which piece of evidence is supposed to change the verdict.
 */

import type { CandidateProfileLike, JobProfileLike } from './engine.js';
import type { EvidenceState, EvidenceType } from './contract.js';

export interface GoldenEvidenceCase {
  name: string;
  category: string;
  job: JobProfileLike;
  candidate: CandidateProfileLike;
  expect: {
    state: EvidenceState;
    /** The strongest evidence type that may be attributed. */
    maxEvidenceType?: EvidenceType;
    professional?: boolean;
    production?: boolean;
    academic?: boolean;
    gapKinds?: string[];
    noGapKinds?: string[];
    independentSources?: number;
    hasConflict?: boolean;
    hasLimitation?: boolean;
  };
}

// ---------------------------------------------------------------- fragment helpers
export type SkillArg = {
  skill: string; assertion?: string; depth?: string; strength?: string;
  context?: string; recency?: string; fields?: string[];
};
export const skill = (a: SkillArg) => ({
  skill: a.skill,
  assertion: a.assertion ?? 'DEMONSTRATED',
  depth: a.depth ?? 'USED',
  evidence_strength: a.strength ?? 'MODERATE',
  context_type: a.context ?? 'UNKNOWN',
  recency: a.recency ?? 'UNKNOWN',
  supporting_evidence: (a.fields ?? ['resume_text']).map((f, i) => ({
    source_field: f, source_text: a.skill, span: [i * 20, i * 20 + a.skill.length] as [number, number],
  })),
  provenance: { source_field: (a.fields ?? ['resume_text'])[0], source_text: a.skill, span: [0, a.skill.length] as [number, number] },
});

export const req = (subject: string, evidence: string[] = ['WORK_EXPERIENCE'], context: string | null = null,
  level = 'MANDATORY') => ({ subject, level, context, evidence_required: evidence });

export const job = (requirements: ReturnType<typeof req>[], years?: number, subject?: string): JobProfileLike => ({
  job_id: 1, intelligence_hash: 'sha256:job', requirements,
  experience_requirements: years ? [{ subject: subject ?? null, min_years: years, qualifier: 'AT_LEAST' }] : [],
});

export const cand = (c: Partial<CandidateProfileLike>): CandidateProfileLike =>
  ({ candidate_id: 1, intelligence_hash: 'sha256:cand', ...c });

// ---------------------------------------------------------------- the four forbidden conversions
const CONVERSION_CASES: GoldenEvidenceCase[] = [
  { name: 'skill list alone never satisfies demonstrated capability', category: 'conversion',
    job: job([req('Python', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Python', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', fields: ['primary_skills'] })] }),
    expect: { state: 'WEAKLY_SUPPORTED', maxEvidenceType: 'EXPLICIT_SKILL', professional: false, gapKinds: ['PROFESSIONAL'] } },

  { name: 'skill list alone never satisfies production experience', category: 'conversion',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', fields: ['skills'] })] }),
    expect: { state: 'WEAKLY_SUPPORTED', production: false, gapKinds: ['PRODUCTION'] } },

  { name: 'academic project never becomes professional experience', category: 'conversion',
    job: job([req('Java', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Java', depth: 'PROJECT_USED', context: 'ACADEMIC', strength: 'STRONG' })] }),
    expect: { state: 'WEAKLY_SUPPORTED', academic: true, professional: false, maxEvidenceType: 'ACADEMIC_PROJECT', gapKinds: ['PROFESSIONAL'] } },

  { name: 'academic project never becomes production experience', category: 'conversion',
    job: job([req('Python', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({ skills: [skill({ skill: 'Python', depth: 'PROJECT_USED', context: 'ACADEMIC' })] }),
    expect: { state: 'WEAKLY_SUPPORTED', production: false, academic: true, gapKinds: ['PRODUCTION'] } },

  { name: 'certification alone never becomes hands-on experience', category: 'conversion',
    job: job([req('AWS', ['WORK_EXPERIENCE'])]),
    candidate: cand({ credentials: [{ name: 'AWS Certified Solutions Architect', kind: 'CERTIFICATION' }] }),
    expect: { state: 'UNSUPPORTED', gapKinds: ['CONCEPT'] } },

  { name: 'graph relationship never manufactures candidate evidence', category: 'conversion',
    job: job([req('API development', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'FastAPI', depth: 'PRODUCTION_USED', context: 'PRODUCTION', strength: 'DIRECT' })] }),
    expect: { state: 'INDIRECTLY_SUPPORTED', maxEvidenceType: 'INDIRECT_EVIDENCE', professional: false, production: false } },
];

// ---------------------------------------------------------------- evidence hierarchy
const HIERARCHY_CASES: GoldenEvidenceCase[] = [
  { name: 'production evidence for a production requirement is DIRECTLY_SUPPORTED', category: 'hierarchy',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PRODUCTION_USED', context: 'PRODUCTION', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', production: true, professional: true, noGapKinds: ['PRODUCTION', 'PROFESSIONAL'] } },

  { name: 'professional evidence for a professional requirement is DIRECTLY_SUPPORTED', category: 'hierarchy',
    job: job([req('Java', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Java', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', professional: true } },

  { name: 'project evidence for a professional requirement is PARTIALLY_SUPPORTED', category: 'hierarchy',
    job: job([req('Go', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Go', depth: 'PROJECT_USED', context: 'UNKNOWN', strength: 'STRONG' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['PROFESSIONAL'] } },

  { name: 'leadership evidence outranks production in the hierarchy', category: 'hierarchy',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'LEADERSHIP_EVIDENCE'])]),
    candidate: cand({
      skills: [skill({ skill: 'Kubernetes', depth: 'LEADERSHIP_LEVEL_USE', context: 'PROFESSIONAL', strength: 'DIRECT' })],
      leadership: [{ kind: 'TEAM_LEADERSHIP', scope: '8 people' }],
    }),
    expect: { state: 'DIRECTLY_SUPPORTED', maxEvidenceType: 'LEADERSHIP_EVIDENCE', noGapKinds: ['LEADERSHIP'] } },

  { name: 'mentioned-only evidence cannot reach professional', category: 'hierarchy',
    job: job([req('Redis', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Redis', assertion: 'MENTIONED', depth: 'MENTIONED' })] }),
    // WEAKLY, not PARTIALLY: a bare mention is a claim, and PARTIALLY_SUPPORTED would assert the
    // concept had been proven with only a side element outstanding. Nothing here proves Redis use.
    expect: { state: 'WEAKLY_SUPPORTED', maxEvidenceType: 'EXPLICIT_TECHNOLOGY', professional: false } },
];

// ---------------------------------------------------------------- negation
const NEGATION_CASES: GoldenEvidenceCase[] = [
  { name: 'explicit denial is CONTRADICTED, never supported', category: 'negation',
    job: job([req('Kubernetes')]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'NEGATED', strength: 'NEGATIVE' })] }),
    expect: { state: 'CONTRADICTED', professional: false, production: false } },

  { name: 'denial outranks a skills-column listing of the same token', category: 'negation',
    job: job([req('Terraform')]),
    candidate: cand({ skills: [skill({ skill: 'Terraform', assertion: 'NEGATED', strength: 'NEGATIVE', fields: ['primary_skills', 'resume_text'] })] }),
    expect: { state: 'CONTRADICTED' } },

  { name: 'a denied skill is not reached indirectly through the graph', category: 'negation',
    job: job([req('API development', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'FastAPI', assertion: 'NEGATED', strength: 'NEGATIVE' })] }),
    expect: { state: 'UNSUPPORTED' } },
];

// ---------------------------------------------------------------- absence semantics
const ABSENCE_CASES: GoldenEvidenceCase[] = [
  { name: 'rich profile without the concept is UNSUPPORTED, not insufficient', category: 'absence',
    job: job([req('Kubernetes')]),
    candidate: cand({ skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL' })] }),
    expect: { state: 'UNSUPPORTED', gapKinds: ['CONCEPT'] } },

  { name: 'empty profile is INSUFFICIENT_EVIDENCE, not unsupported', category: 'absence',
    job: job([req('Kubernetes')]),
    candidate: cand({ skills: [] }),
    expect: { state: 'INSUFFICIENT_EVIDENCE', hasLimitation: true } },

  { name: 'absence never becomes a claim that the candidate lacks the skill', category: 'absence',
    job: job([req('Rust')]),
    candidate: cand({ skills: [skill({ skill: 'Go', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL' })] }),
    expect: { state: 'UNSUPPORTED', gapKinds: ['CONCEPT'] } },

  { name: 'informational requirement is NOT_APPLICABLE', category: 'absence',
    job: job([req('MongoDB', [], null, 'INFORMATIONAL')]),
    candidate: cand({ skills: [] }),
    expect: { state: 'NOT_APPLICABLE' } },

  { name: 'contextual requirement is NOT_APPLICABLE', category: 'absence',
    job: job([req('Go', [], null, 'CONTEXTUAL')]),
    candidate: cand({ skills: [skill({ skill: 'Go' })] }),
    expect: { state: 'NOT_APPLICABLE' } },

  { name: 'excluded requirement is NOT_APPLICABLE in Phase 6', category: 'absence',
    job: job([req('PHP', [], null, 'EXCLUDED')]),
    candidate: cand({ skills: [skill({ skill: 'PHP' })] }),
    expect: { state: 'NOT_APPLICABLE' } },
];

// ---------------------------------------------------------------- temporal
const TEMPORAL_CASES: GoldenEvidenceCase[] = [
  { name: 'timeline meets the required duration', category: 'temporal',
    job: job([req('Python', ['WORK_EXPERIENCE'])], 5),
    candidate: cand({ timeline_months: 72, skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', noGapKinds: ['DURATION'] } },

  { name: 'timeline short of the requirement is PARTIALLY_SUPPORTED with a duration gap', category: 'temporal',
    job: job([req('Python', ['WORK_EXPERIENCE'])], 5),
    candidate: cand({ timeline_months: 24, skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['DURATION'], hasLimitation: true } },

  { name: 'no timeline means duration cannot be verified, not that it failed', category: 'temporal',
    job: job([req('Python', ['WORK_EXPERIENCE'])], 5),
    candidate: cand({ timeline_months: null, skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['DURATION'], hasLimitation: true } },

  { name: 'stated experience exceeding the timeline raises a claim conflict', category: 'temporal',
    job: job([req('Python', ['WORK_EXPERIENCE'])], 8),
    candidate: cand({ timeline_months: 24, stated_experience: '8 years', skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', hasConflict: true, gapKinds: ['DURATION'] } },

  { name: 'a requirement with no duration produces no duration gap', category: 'temporal',
    job: job([req('Python', ['WORK_EXPERIENCE'])]),
    candidate: cand({ timeline_months: null, skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', noGapKinds: ['DURATION'] } },
];

// ---------------------------------------------------------------- recency
const RECENCY_CASES: GoldenEvidenceCase[] = [
  { name: 'active recency satisfies a recency requirement', category: 'recency',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'RECENCY'])]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', recency: 'ACTIVE', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', noGapKinds: ['RECENCY'] } },

  { name: 'stale evidence fails a recency requirement', category: 'recency',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'RECENCY'])]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', recency: 'STALE', strength: 'DIRECT' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['RECENCY'] } },

  { name: 'unknown recency is a gap, never assumed current', category: 'recency',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'RECENCY'])]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', recency: 'UNKNOWN', strength: 'DIRECT' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['RECENCY'] } },

  { name: 'recency is not demanded unless the requirement asks', category: 'recency',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', recency: 'STALE', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', noGapKinds: ['RECENCY'] } },
];

// ---------------------------------------------------------------- context matching
const CONTEXT_CASES: GoldenEvidenceCase[] = [
  { name: 'production requirement vs professional-only evidence leaves a gap', category: 'context',
    job: job([req('Python', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({ skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['PRODUCTION'], production: false } },

  // Project-level depth in an internship is professional context but not professional-grade DEPTH,
  // so STRONGLY_SUPPORTED is the honest ceiling. Expecting DIRECTLY_SUPPORTED here would have asked
  // the engine to treat an intern's project as equivalent to owned professional work.
  { name: 'internship project is professional context but not full professional depth', category: 'context',
    job: job([req('React', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'React', depth: 'PROJECT_USED', context: 'INTERNSHIP', strength: 'STRONG' })] }),
    expect: { state: 'STRONGLY_SUPPORTED', professional: true, production: false } },

  { name: 'freelance context counts as professional', category: 'context',
    job: job([req('PHP', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'PHP', depth: 'PROFESSIONAL_USED', context: 'FREELANCE', strength: 'DIRECT' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', professional: true } },
];

// ---------------------------------------------------------------- source independence
const INDEPENDENCE_CASES: GoldenEvidenceCase[] = [
  { name: 'three declaration columns count as ONE independent source', category: 'independence',
    job: job([req('Python', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Python', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', fields: ['primary_skills', 'secondary_skills', 'skills'] })] }),
    expect: { state: 'WEAKLY_SUPPORTED', independentSources: 1, hasLimitation: true } },

  { name: 'declaration plus narrative is TWO independent sources', category: 'independence',
    job: job([req('Python', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT', fields: ['primary_skills', 'resume_text'] })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', independentSources: 2 } },

  { name: 'resume summary and resume text share the narrative class', category: 'independence',
    job: job([req('Go', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Go', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT', fields: ['resume_summary', 'resume_text'] })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', independentSources: 1 } },

  { name: 'a single declared skill is flagged as never demonstrated', category: 'independence',
    job: job([req('Docker', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Docker', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', fields: ['skills'] })] }),
    expect: { state: 'WEAKLY_SUPPORTED', hasLimitation: true, independentSources: 1 } },
];

// ---------------------------------------------------------------- project evidence
const PROJECT_CASES: GoldenEvidenceCase[] = [
  { name: 'unknown-ownership project is project evidence, not professional', category: 'project',
    job: job([req('Python', ['WORK_EXPERIENCE'])]),
    candidate: cand({ projects: [{ name: 'Built a recruitment platform using Python', technologies: ['Python'] }] }),
    expect: { state: 'PARTIALLY_SUPPORTED', maxEvidenceType: 'PROJECT_EXPERIENCE', professional: false, gapKinds: ['PROFESSIONAL'] } },

  { name: 'academic project is capped at academic evidence', category: 'project',
    job: job([req('Java', ['WORK_EXPERIENCE'])]),
    candidate: cand({ projects: [{ name: 'College final year project in Java', technologies: ['Java'] }] }),
    expect: { state: 'WEAKLY_SUPPORTED', maxEvidenceType: 'ACADEMIC_PROJECT', academic: true, professional: false } },

  { name: 'production project supplies production evidence', category: 'project',
    job: job([req('Docker', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({ projects: [{ name: 'Deployed Docker services to production', technologies: ['Docker'], context_type: 'PRODUCTION' }] }),
    expect: { state: 'DIRECTLY_SUPPORTED', production: true, professional: true } },

  // Client work IS professional evidence - but the promotion must come from Phase 4's structured
  // context_type, not from the word "client" in a project title. This case originally supplied the
  // signal in the untrusted name, which made professional evidence reachable by typing; see the
  // classifyProject comment and the "does not mint professional evidence" case in the extended set.
  { name: 'client project supplies professional evidence', category: 'project',
    job: job([req('React', ['WORK_EXPERIENCE'])]),
    candidate: cand({ projects: [{ name: 'React portal delivery', technologies: ['React'], context_type: 'CLIENT' }] }),
    expect: { state: 'DIRECTLY_SUPPORTED', professional: true, production: false } },

  { name: 'personal project is not professional evidence', category: 'project',
    job: job([req('Rust', ['WORK_EXPERIENCE'])]),
    candidate: cand({ projects: [{ name: 'Personal side project in Rust', technologies: ['Rust'] }] }),
    expect: { state: 'PARTIALLY_SUPPORTED', professional: false, gapKinds: ['PROFESSIONAL'] } },
];

// ---------------------------------------------------------------- leadership
const LEADERSHIP_CASES: GoldenEvidenceCase[] = [
  { name: 'leadership requirement with no leadership evidence leaves a gap', category: 'leadership',
    job: job([req('Python', ['WORK_EXPERIENCE', 'LEADERSHIP_EVIDENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['LEADERSHIP'] } },

  { name: 'leadership requirement satisfied by recorded leadership', category: 'leadership',
    job: job([req('Python', ['WORK_EXPERIENCE', 'LEADERSHIP_EVIDENCE'])]),
    candidate: cand({
      skills: [skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })],
      leadership: [{ kind: 'TEAM_LEADERSHIP', scope: '8 people' }],
    }),
    expect: { state: 'DIRECTLY_SUPPORTED', noGapKinds: ['LEADERSHIP'] } },

  { name: 'a senior title alone is not leadership evidence', category: 'leadership',
    job: job([req('Go', ['WORK_EXPERIENCE', 'LEADERSHIP_EVIDENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'Go', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL' })], leadership: [] }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['LEADERSHIP'] } },
];

// ---------------------------------------------------------------- graph-reached
const GRAPH_CASES: GoldenEvidenceCase[] = [
  { name: 'FastAPI reaches API development indirectly', category: 'graph',
    job: job([req('API development', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'FastAPI', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' })] }),
    expect: { state: 'INDIRECTLY_SUPPORTED', professional: false, production: false } },

  { name: 'indirect evidence never claims production even from production source', category: 'graph',
    job: job([req('API development', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({ skills: [skill({ skill: 'FastAPI', depth: 'PRODUCTION_USED', context: 'PRODUCTION', strength: 'DIRECT' })] }),
    expect: { state: 'INDIRECTLY_SUPPORTED', production: false } },

  { name: 'unrelated concepts are not reached through the graph', category: 'graph',
    job: job([req('distributed systems', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [skill({ skill: 'FastAPI', depth: 'PRODUCTION_USED', context: 'PRODUCTION' })] }),
    expect: { state: 'UNSUPPORTED' } },

  { name: 'direct evidence is preferred over an available graph path', category: 'graph',
    job: job([req('Python', ['WORK_EXPERIENCE'])]),
    candidate: cand({ skills: [
      skill({ skill: 'Python', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL', strength: 'DIRECT' }),
      skill({ skill: 'FastAPI', depth: 'PROFESSIONAL_USED', context: 'PROFESSIONAL' })] }),
    expect: { state: 'DIRECTLY_SUPPORTED', maxEvidenceType: 'PROFESSIONAL_EXPERIENCE' } },
];

// ---------------------------------------------------------------- realistic composites
const COMPOSITE_CASES: GoldenEvidenceCase[] = [
  { name: "brief's core example - Python production backend", category: 'composite',
    job: job([req('Python', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')], 5, 'production backend engineering'),
    candidate: cand({
      timeline_months: 72, stated_experience: '6 years',
      skills: [skill({ skill: 'Python', depth: 'PROJECT_USED', context: 'PROFESSIONAL', strength: 'STRONG', fields: ['primary_skills', 'resume_text'] })],
    }),
    expect: { state: 'PARTIALLY_SUPPORTED', gapKinds: ['PRODUCTION'], professional: true, independentSources: 2 } },

  { name: "brief's core example - Kubernetes explicit production deployment", category: 'composite',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({
      timeline_months: 72,
      skills: [skill({ skill: 'Kubernetes', depth: 'PRODUCTION_USED', context: 'PRODUCTION', strength: 'DIRECT' })],
    }),
    expect: { state: 'DIRECTLY_SUPPORTED', production: true, professional: true } },

  { name: 'skill stuffing across every column yields one weak source', category: 'composite',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')]),
    candidate: cand({
      skills: [skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY',
        fields: ['primary_skills', 'secondary_skills', 'skills', 'technical_tools'] })],
    }),
    expect: { state: 'WEAKLY_SUPPORTED', independentSources: 1, production: false, gapKinds: ['PRODUCTION'] } },

  { name: 'certification plus skill listing still lacks hands-on evidence', category: 'composite',
    job: job([req('AWS', ['WORK_EXPERIENCE'])]),
    candidate: cand({
      skills: [skill({ skill: 'AWS', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', fields: ['skills'] })],
      credentials: [{ name: 'AWS Certified Solutions Architect', kind: 'CERTIFICATION' }],
    }),
    expect: { state: 'WEAKLY_SUPPORTED', professional: false, gapKinds: ['PROFESSIONAL'] } },

  { name: 'strong candidate meeting every element', category: 'composite',
    job: job([req('Kubernetes', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE', 'RECENCY'], 'production')], 3),
    candidate: cand({
      timeline_months: 60,
      skills: [skill({ skill: 'Kubernetes', depth: 'PRODUCTION_USED', context: 'PRODUCTION', strength: 'DIRECT', recency: 'ACTIVE', fields: ['primary_skills', 'resume_text'] })],
    }),
    expect: { state: 'DIRECTLY_SUPPORTED', production: true, professional: true, independentSources: 2, noGapKinds: ['PRODUCTION', 'DURATION', 'RECENCY'] } },
];

export const GOLDEN_EVIDENCE_CASES: GoldenEvidenceCase[] = [
  ...CONVERSION_CASES, ...HIERARCHY_CASES, ...NEGATION_CASES, ...ABSENCE_CASES,
  ...TEMPORAL_CASES, ...RECENCY_CASES, ...CONTEXT_CASES, ...INDEPENDENCE_CASES,
  ...PROJECT_CASES, ...LEADERSHIP_CASES, ...GRAPH_CASES, ...COMPOSITE_CASES,
];

/**
 * Adversarial candidate records. None may produce professional or production evidence, and none may
 * change the shape of the assessment - these are the resume-side attacks in §34.
 */
export const ADVERSARIAL_CANDIDATES: { name: string; candidate: CandidateProfileLike }[] = [
  { name: 'prompt injection in prose',
    candidate: cand({ skills: [skill({ skill: 'Python', assertion: 'MENTIONED', depth: 'MENTIONED' })] }) },
  { name: 'fake production claim in a skills column',
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', context: 'PRODUCTION', fields: ['skills'] })] }) },
  { name: 'academic dressed as production',
    candidate: cand({ skills: [skill({ skill: 'Python', depth: 'PRODUCTION_USED', context: 'ACADEMIC', strength: 'DIRECT' })] }) },
  { name: 'certification inflation',
    candidate: cand({ credentials: Array.from({ length: 20 }, (_, i) => ({ name: `Cert ${i}`, kind: 'CERTIFICATION' })) }) },
  { name: 'keyword stuffing across all declaration columns',
    candidate: cand({ skills: [skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY', fields: ['primary_skills', 'secondary_skills', 'skills', 'technical_tools'] })] }) },
];
