/**
 * Phase 7 golden benchmark, supplementary breadth set.
 *
 * Each case pins one behaviour the primary sets assert only once, so a regression in a shared code
 * path surfaces as a cluster of failures rather than a single ambiguous one. Labels reasoned from
 * the policy in contract.ts and the measured ontology, never from engine output.
 */

import type { GoldenMatchCase } from './golden-cases.js';
import { cand, emp, job, req, skill } from './golden-cases.js';

const prodSkill = (s: string) => skill({ skill: s, depth: 'PRODUCTION_USED', context: 'PRODUCTION' });
const declared = (s: string) => skill({ skill: s, assertion: 'DECLARED', depth: 'MENTIONED',
  strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['skills'] });

export const SUPPLEMENTARY_MATCH_CASES: GoldenMatchCase[] = [
  // ---- ALTERNATIVE_TO symmetry across the whole substitute set
  { name: 'AWS satisfies Azure symmetrically', category: 'routes',
    job: job({ requirements: [req('Azure')] }), candidate: cand({ skills: [skill({ skill: 'AWS' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT' } },
  { name: 'PostgreSQL satisfies MySQL symmetrically', category: 'routes',
    job: job({ requirements: [req('MySQL')] }), candidate: cand({ skills: [skill({ skill: 'PostgreSQL' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT' } },
  { name: 'TensorFlow satisfies PyTorch symmetrically', category: 'routes',
    job: job({ requirements: [req('PyTorch')] }), candidate: cand({ skills: [skill({ skill: 'TensorFlow' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT' } },
  { name: 'FastAPI satisfies Flask symmetrically', category: 'routes',
    job: job({ requirements: [req('Flask')] }), candidate: cand({ skills: [skill({ skill: 'FastAPI' })] }),
    expect: { state: 'SATISFIED', route: 'EQUIVALENT' } },

  // ---- taxonomy buckets must never transfer (the measured >5-member classes)
  { name: 'Java does not transfer to Python (programming language is a bucket)', category: 'routes',
    job: job({ requirements: [req('Python')] }), candidate: cand({ skills: [prodSkill('Java')] }),
    expect: { state: 'NOT_SATISFIED', route: 'NONE' } },
  { name: 'Angular does not transfer to React (frontend framework is a bucket)', category: 'routes',
    job: job({ requirements: [req('React')] }), candidate: cand({ skills: [prodSkill('Angular')] }),
    expect: { state: 'NOT_SATISFIED', route: 'NONE' } },
  { name: 'Terraform does not transfer to Kubernetes (devops tooling is a bucket)', category: 'routes',
    job: job({ requirements: [req('Kubernetes')] }), candidate: cand({ skills: [prodSkill('Terraform')] }),
    expect: { state: 'NOT_SATISFIED' } },
  { name: 'a specific family still transfers: Flask reaches Django', category: 'routes',
    job: job({ requirements: [req('Django')] }), candidate: cand({ skills: [prodSkill('Flask')] }),
    expect: { hasTransferable: true } },

  // ---- project-sourced evidence
  { name: 'a professional project satisfies a professional requirement', category: 'evidence',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ projects: [{ name: 'Billing portal', technologies: ['Python'], context_type: 'PROFESSIONAL' }] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },
  { name: 'a project-satisfied requirement reports route EXACT, not NONE', category: 'evidence',
    job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
    candidate: cand({ projects: [{ name: 'Cluster', technologies: ['Kubernetes'], context_type: 'PRODUCTION' }] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },
  { name: 'an academic project cannot satisfy a professional requirement', category: 'evidence',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ projects: [{ name: 'University capstone', technologies: ['Python'] }] }),
    expect: { state: 'WEAKLY_SATISFIED' } },
  { name: 'a project not listing the technology is not evidence for it', category: 'evidence',
    job: job({ requirements: [req('Kubernetes')] }),
    candidate: cand({ projects: [{ name: 'Cluster', technologies: ['Docker'], context_type: 'PRODUCTION' }] }),
    expect: { state: 'NOT_SATISFIED' } },
  { name: 'skills and projects together yield one coherent verdict', category: 'evidence',
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      projects: [{ name: 'Portal', technologies: ['Python'], context_type: 'PROFESSIONAL' }] }),
    expect: { state: 'SATISFIED', route: 'EXACT' } },

  // ---- negation breadth
  { name: 'negation is honoured even with a strong substitute present', category: 'negation',
    job: job({ requirements: [req('AWS')] }),
    candidate: cand({ skills: [skill({ skill: 'AWS', assertion: 'NEGATED' }), prodSkill('Azure')] }),
    expect: { state: 'CONTRADICTED' } },
  { name: 'a negated JD requirement stays WAIVED even when the candidate has the skill', category: 'negation',
    job: job({ requirements: [req('PHP', 'MANDATORY', ['WORK_EXPERIENCE'], null, true)] }),
    candidate: cand({ skills: [prodSkill('PHP')] }),
    expect: { state: 'WAIVED' } },
  { name: 'a waived requirement contributes no weight to the score', category: 'negation',
    job: job({ requirements: [req('Python'), req('PHP', 'MANDATORY', ['WORK_EXPERIENCE'], null, true)] }),
    candidate: cand({ skills: [prodSkill('Python')] }),
    expect: { minScore: 60 } },

  // ---- unknown vs missing breadth
  { name: 'a skills-only record can still say NOT_SATISFIED for an absent skill', category: 'unknown',
    job: job({ requirements: [req('Rust')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' }), skill({ skill: 'Go' })] }),
    expect: { state: 'NOT_SATISFIED', insufficientData: false } },
  { name: 'a credentials-only record is not insufficient data', category: 'unknown',
    job: job({ requirements: [req('Rust')] }),
    candidate: cand({ credentials: [{ name: 'Some cert', kind: 'CERTIFICATION' }] }),
    expect: { state: 'NOT_SATISFIED' } },
  { name: 'an empty record never reports a confident score', category: 'unknown',
    job: job({ requirements: [req('Python'), req('AWS')] }), candidate: cand({}),
    expect: { insufficientData: true } },

  // ---- seniority ladder breadth
  { name: 'INTERN against SENIOR is UNDER', category: 'context',
    job: job({ seniority: { seniority: 'SENIOR' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'INTERN' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'UNDER' } },
  { name: 'STAFF against SENIOR is OVER', category: 'context',
    job: job({ seniority: { seniority: 'SENIOR' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'STAFF' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'OVER' } },
  { name: 'MID against MID is ALIGNED', category: 'context',
    job: job({ seniority: { seniority: 'MID' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'MID' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'ALIGNED' } },
  { name: 'an unknown JOB seniority is UNKNOWN, not a mismatch', category: 'context',
    job: job({ seniority: { seniority: null }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'SENIOR' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'UNKNOWN' } },
  { name: 'an off-ladder seniority label is UNKNOWN rather than guessed', category: 'context',
    job: job({ seniority: { seniority: 'FELLOW' }, requirements: [req('Python')] }),
    candidate: cand({ seniority: { seniority: 'SENIOR' }, skills: [skill({ skill: 'Python' })] }),
    expect: { seniorityAlignment: 'UNKNOWN' } },

  // ---- location / work constraints
  { name: 'a hybrid constraint with no candidate location is UNKNOWN', category: 'context',
    job: job({ requirements: [req('Python')], work_constraints: [{ subject: 'Hybrid', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { locationCompatibility: 'UNKNOWN' } },
  { name: 'work-from-home phrasing counts as remote', category: 'context',
    job: job({ requirements: [req('Python')], work_constraints: [{ subject: 'WFH', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
    expect: { locationCompatibility: 'MATCHED' } },
  { name: 'location UNKNOWN is neutral in the score, not a penalty', category: 'scoring',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      location_constraints: [{ subject: 'Bangalore', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [prodSkill('Python')] }),
    expect: { minScore: 55 } },

  // ---- domain breadth
  { name: 'one matching domain among several is MATCHED', category: 'context',
    job: job({ requirements: [req('Python')], domain_requirements: [{ subject: 'fintech', level: 'MANDATORY' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      domains: [{ domain: 'retail' }, { domain: 'fintech' }] }),
    expect: { domainCompatibility: 'MATCHED' } },
  { name: 'a negated domain requirement imposes no demand', category: 'context',
    job: job({ requirements: [req('Python')],
      domain_requirements: [{ subject: 'defence', level: 'MANDATORY', negated: true }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], domains: [{ domain: 'fintech' }] }),
    expect: { domainCompatibility: 'NOT_APPLICABLE' } },

  // ---- composite breadth
  { name: 'an OR group of databases is not satisfied by a document store', category: 'composite',
    job: job({ requirements: [req('PostgreSQL'), req('MySQL')] }),
    candidate: cand({ skills: [prodSkill('MongoDB')] }),
    expect: { compositeState: 'NOT_SATISFIED' } },
  { name: 'an OR group with one weak member is weak', category: 'composite',
    job: job({ requirements: [req('AWS'), req('Azure')] }),
    candidate: cand({ skills: [declared('AWS')] }),
    expect: { compositeState: 'WEAKLY_SATISFIED' } },
  { name: 'an ML framework OR group is satisfied by either member', category: 'composite',
    job: job({ requirements: [req('TensorFlow'), req('PyTorch')] }),
    candidate: cand({ skills: [prodSkill('PyTorch')] }),
    expect: { compositeState: 'SATISFIED' } },

  // ---- experience breadth
  { name: 'a single month of relevant work is not five years', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [emp('Backend Engineer', '2026-01', '2026-02')] }),
    expect: { experienceAlignment: 'UNDER' } },
  { name: 'three adjacent relevant roles accumulate', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], experience: [
      emp('Backend Engineer', '2019-01', '2021-01'), emp('Backend Developer', '2021-01', '2023-01'),
      emp('Backend Engineer', '2023-01', '2026-01')] }),
    expect: { experienceAlignment: 'ALIGNED' } },
  { name: 'a relevant role among irrelevant ones is found', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 2, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })], experience: [
      emp('Barista', '2015-01', '2018-01'), emp('Backend Engineer', '2020-01', '2024-01'),
      emp('Photographer', '2024-01', '2026-01')] }),
    expect: { experienceAlignment: 'OVER' } },
  { name: 'a zero-length relevant span does not meet a real requirement', category: 'experience',
    job: job({ role_family: 'backend engineering', requirements: [req('Python')],
      experience_requirements: [{ subject: null, min_years: 1, qualifier: 'AT_LEAST' }] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })],
      experience: [emp('Backend Engineer', '2026-01', '2026-01')] }),
    expect: { experienceAlignment: 'UNDER' } },

  // ---- structural robustness
  { name: 'a job with no requirements produces an insufficient-data profile', category: 'scoring',
    job: job({ requirements: [] }), candidate: cand({ skills: [prodSkill('Python')] }),
    expect: { insufficientData: true } },
  { name: 'every requirement level appears without breaking the scorer', category: 'scoring',
    job: job({ requirements: [req('Python'), req('AWS', 'STRONGLY_PREFERRED'), req('Go', 'PREFERRED'),
      req('Rust', 'OPTIONAL'), req('Scala', 'CONTEXTUAL'), req('Perl', 'INFORMATIONAL')] }),
    candidate: cand({ skills: [prodSkill('Python')] }),
    expect: { minScore: 0, maxScore: 100 } },
];
