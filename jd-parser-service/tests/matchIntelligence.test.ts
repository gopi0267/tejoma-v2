/**
 * Phase 7 Semantic Matching & Reasoning regression suite.
 *
 * The golden benchmark (src/matching/evaluate.ts) measures accuracy across 151 curated scenarios;
 * this file is the CI gate. It asserts the properties that must hold for EVERY input rather than
 * re-listing the benchmark: route discipline, Phase 6 authority, no double counting, UNKNOWN vs
 * MISSING, score decomposition, determinism, forged-input rejection, and the API's auth/tenant
 * behaviour.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { buildKnowledgeGraph } from '../src/knowledge-graph/graph.js';
import { buildMatchIntelligence, validateMatchProfile } from '../src/matching/engine.js';
import {
  SATISFACTION_CREDIT, SATISFYING_ROUTES, TRANSFERABLE_ROUTES, MATCH_SCHEMA_VERSION,
} from '../src/matching/contract.js';
import { cand, emp, job, req, skill, GOLDEN_MATCH_CASES } from '../src/matching/golden-cases.js';
import { ADVERSARIAL_MATCH_CASES, EXTENDED_MATCH_CASES } from '../src/matching/golden-cases-extended.js';
import { SUPPLEMENTARY_MATCH_CASES } from '../src/matching/golden-cases-supplementary.js';
import { evaluateMatchCase } from '../src/matching/evaluate.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.env.IDENTITY_JWT_PUBLIC_KEY = publicKey;
const { app } = await import('../src/server.js');

const graph = buildKnowledgeGraph();
const ALL = [...GOLDEN_MATCH_CASES, ...EXTENDED_MATCH_CASES, ...SUPPLEMENTARY_MATCH_CASES];
const build = (j: Parameters<typeof buildMatchIntelligence>[0], c: Parameters<typeof buildMatchIntelligence>[1]) =>
  buildMatchIntelligence(j, c, graph, 'tenant-1');

// ============================================================ benchmark
describe('golden match benchmark', () => {
  it('has at least 150 curated scenarios', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(150);
  });

  it('passes every assertion in every scenario', () => {
    const failures: string[] = [];
    for (const c of ALL) for (const f of evaluateMatchCase(c).failures) failures.push(`[${c.category}] ${c.name}: ${f}`);
    expect(failures).toEqual([]);
  });
});

// ============================================================ false positives
describe('false-positive control', () => {
  it('never reports SATISFIED for anything an adversarial scenario forbids', () => {
    for (const a of ADVERSARIAL_MATCH_CASES) {
      for (const r of build(a.job, a.candidate).requirement_results) {
        if (a.mustNotSatisfy.includes(r.subject)) {
          expect(r.state, `${a.name}: ${r.subject}`).not.toBe('SATISFIED');
        }
      }
    }
  });

  it('never credits a RELATED_TO adjacency as any kind of satisfaction', () => {
    for (const c of ALL) {
      for (const r of build(c.job, c.candidate).requirement_results) {
        if (r.route === 'RELATED') {
          expect(['SATISFIED', 'PARTIALLY_SATISFIED', 'TRANSFERABLE']).not.toContain(r.state);
        }
      }
    }
  });

  it('Docker never satisfies a Kubernetes requirement', () => {
    const p = build(job({ requirements: [req('Kubernetes')] }),
      cand({ skills: [skill({ skill: 'Docker', depth: 'PRODUCTION_USED', context: 'PRODUCTION' })] }));
    expect(p.requirement_results[0].state).not.toBe('SATISFIED');
  });

  it('a taxonomy bucket is not a transferable family', () => {
    // "programming language" has 19 members; sharing it must not make Python a route to Rust.
    const p = build(job({ requirements: [req('Rust')] }), cand({ skills: [skill({ skill: 'Python' })] }));
    expect(p.requirement_results[0].route).toBe('NONE');
    expect(p.requirement_results[0].state).toBe('NOT_SATISFIED');
  });

  it('a specific family remains transferable', () => {
    // "python web framework" has 3 members; Django -> FastAPI must still transfer.
    const p = build(job({ requirements: [req('FastAPI')] }), cand({ skills: [skill({ skill: 'Django' })] }));
    expect(p.requirement_results[0].route).toBe('SAME_FAMILY');
    expect(p.requirement_results[0].state).toBe('TRANSFERABLE');
  });
});

// ============================================================ route discipline
describe('route discipline', () => {
  it('only EXACT and EQUIVALENT routes may yield SATISFIED', () => {
    for (const c of ALL) {
      for (const r of build(c.job, c.candidate).requirement_results) {
        if (r.state === 'SATISFIED' && r.route !== 'NONE') {
          expect(SATISFYING_ROUTES.has(r.route), `${c.name}: ${r.subject} via ${r.route}`).toBe(true);
        }
      }
    }
  });

  it('SAME_FAMILY and ENABLING never exceed TRANSFERABLE', () => {
    for (const c of ALL) {
      for (const r of build(c.job, c.candidate).requirement_results) {
        if (TRANSFERABLE_ROUTES.has(r.route)) {
          expect(['SATISFIED', 'PARTIALLY_SATISFIED']).not.toContain(r.state);
        }
      }
    }
  });

  it('every non-exact route cites a justifying graph link', () => {
    for (const c of ALL) {
      for (const r of build(c.job, c.candidate).requirement_results) {
        if (r.route !== 'EXACT' && r.route !== 'NONE') expect(r.semantic_links.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================ Phase 6 authority
describe('Phase 6 authority', () => {
  it('never rates a requirement stronger than the evidence Phase 6 found', () => {
    for (const c of ALL) expect(validateMatchProfile(build(c.job, c.candidate))).toEqual([]);
  });

  it('an explicit denial is never overridden by a substitute', () => {
    const p = build(job({ requirements: [req('AWS')] }), cand({
      skills: [skill({ skill: 'AWS', assertion: 'NEGATED' }),
        skill({ skill: 'Azure', depth: 'PRODUCTION_USED', context: 'PRODUCTION' })],
    }));
    expect(p.requirement_results[0].state).toBe('CONTRADICTED');
  });

  it('a claimed-only skill is never SATISFIED', () => {
    const p = build(job({ requirements: [req('Kubernetes')] }), cand({
      skills: [skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED',
        strength: 'DECLARED_ONLY', context: 'UNKNOWN', fields: ['skills'] })],
    }));
    expect(p.requirement_results[0].state).toBe('WEAKLY_SATISFIED');
  });
});

// ============================================================ negation
describe('negation', () => {
  it('a negated JD requirement always resolves to WAIVED and carries no weight', () => {
    const p = build(job({ requirements: [req('PHP', 'MANDATORY', ['WORK_EXPERIENCE'], null, true)] }),
      cand({ skills: [skill({ skill: 'PHP', depth: 'PRODUCTION_USED', context: 'PRODUCTION' })] }));
    expect(p.requirement_results[0].state).toBe('WAIVED');
    expect(p.requirement_results[0].weight).toBe(0);
  });
});

// ============================================================ experience relevance
describe('experience relevance', () => {
  it('THE CORE FIX: 7 years of data analysis does not satisfy 5 years of backend', () => {
    const p = build(
      job({ role_family: 'backend engineering', requirements: [req('Python')],
        experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
      cand({ skills: [skill({ skill: 'Python' })],
        experience: [emp('Data Analyst', '2018-01', '2025-01'), emp('Backend Engineer', '2025-01', '2026-01')] }));
    expect(p.experience_fit.alignment).toBe('UNDER');
    expect(p.experience_fit.relevant_months).toBeLessThan(p.experience_fit.total_months!);
    // The production matcher would score this 100 on experience (7 >= 5).
    expect(p.contradictions.some((x) => x.kind === 'RELEVANCE_CONFLICT')).toBe(true);
  });

  it('never sums overlapping relevant roles', () => {
    const p = build(
      job({ role_family: 'backend engineering', requirements: [req('Python')],
        experience_requirements: [{ subject: null, min_years: 6, qualifier: 'AT_LEAST' }] }),
      cand({ skills: [skill({ skill: 'Python' })],
        experience: [emp('Backend Engineer', '2020-01', '2023-01'), emp('Backend Developer', '2021-01', '2024-01')] }));
    // 72 months of employment across 48 elapsed months.
    expect(p.experience_fit.relevant_months).toBe(48);
    expect(p.experience_fit.alignment).toBe('UNDER');
  });

  it('reports UNKNOWN rather than zero when no role is stated', () => {
    const p = build(
      job({ role_family: 'backend engineering', requirements: [req('Python')],
        experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }] }),
      cand({ skills: [skill({ skill: 'Python' })],
        experience: [{ role: null, organization: null, start: '2019-01', end: '2026-01', ongoing: false, months: 84, context_type: 'PROFESSIONAL' }] }));
    expect(p.experience_fit.alignment).toBe('UNKNOWN');
    expect(p.experience_fit.relevant_months).toBeNull();
  });
});

// ============================================================ unknown vs missing
describe('UNKNOWN is not MISSING', () => {
  it('an empty record is UNKNOWN and flagged insufficient', () => {
    const p = build(job({ requirements: [req('Python')] }), cand({}));
    expect(p.requirement_results[0].state).toBe('UNKNOWN');
    expect(p.overall_fit.insufficient_data).toBe(true);
  });

  it('a rich record missing the skill is NOT_SATISFIED and not flagged insufficient', () => {
    const p = build(job({ requirements: [req('Rust')] }),
      cand({ skills: [skill({ skill: 'Python' }), skill({ skill: 'Go' }), skill({ skill: 'Java' })] }));
    expect(p.requirement_results[0].state).toBe('NOT_SATISFIED');
    expect(p.overall_fit.insufficient_data).toBe(false);
  });

  it('UNKNOWN requirements are excluded from the coverage denominator, not scored zero', () => {
    const coverage = (p: ReturnType<typeof build>) =>
      p.overall_fit.components.find((x) => x.name === 'requirement_coverage')!;
    const withUnknown = build(job({ requirements: [req('Python')] }), cand({}));
    expect(coverage(withUnknown).basis).toContain('UNKNOWN excluded');
  });
});

// ============================================================ no double counting
describe('no double counting', () => {
  it('marks a requirement derivative when it rests on the same evidence identity', () => {
    const p = build(job({ requirements: [req('Python'), req('software development')] }),
      cand({ skills: [skill({ skill: 'Python' })] }));
    expect(p.requirement_results.filter((r) => r.derivative_of).length).toBe(1);
  });

  it('does not mark genuinely distinct evidence as derivative', () => {
    const p = build(job({ requirements: [req('Python'), req('AWS')] }),
      cand({ skills: [skill({ skill: 'Python' }), skill({ skill: 'AWS' })] }));
    expect(p.requirement_results.filter((r) => r.derivative_of).length).toBe(0);
  });
});

// ============================================================ score integrity
describe('score integrity', () => {
  it('reconstructs the score from its components for every scenario', () => {
    for (const c of ALL) {
      const p = build(c.job, c.candidate);
      const base = p.overall_fit.components.reduce((a, x) => a + x.contribution, 0);
      const pen = p.overall_fit.penalties.reduce((a, x) => a + x.contribution, 0);
      expect(Math.max(0, Math.min(100, Math.round(base + pen))), c.name).toBe(p.overall_fit.score);
    }
  });

  it('keeps every score within 0-100', () => {
    for (const c of ALL) {
      const s = build(c.job, c.candidate).overall_fit.score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('never emits a score without a decomposition', () => {
    for (const c of ALL) {
      const p = build(c.job, c.candidate);
      expect(p.overall_fit.components.length).toBeGreaterThan(0);
      for (const comp of p.overall_fit.components) expect(comp.basis).toBeTruthy();
    }
  });

  it('keeps credit consistent with the published satisfaction policy', () => {
    for (const c of ALL) {
      for (const r of build(c.job, c.candidate).requirement_results) {
        expect(r.credit).toBe(SATISFACTION_CREDIT[r.state]);
      }
    }
  });
});

// ============================================================ explainability, determinism, lineage
describe('explainability, determinism and lineage', () => {
  it('gives every SATISFIED requirement provenance and reasoning', () => {
    for (const c of ALL) {
      for (const r of build(c.job, c.candidate).requirement_results) {
        if (r.state === 'SATISFIED') {
          expect(r.provenance.length, `${c.name}/${r.subject}`).toBeGreaterThan(0);
          expect(r.reasoning.length, `${c.name}/${r.subject}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is deterministic and idempotent over three runs', () => {
    for (const c of ALL) {
      const hashes = new Set([0, 1, 2].map(() => build(c.job, c.candidate).match_hash));
      expect(hashes.size, c.name).toBe(1);
    }
  });

  it('carries lineage from every upstream phase', () => {
    const p = build(job({ requirements: [req('Python')] }), cand({ skills: [skill({ skill: 'Python' })] }));
    expect(p.source_hashes.job_intelligence_hash).toBe('sha256:job');
    expect(p.source_hashes.candidate_intelligence_hash).toBe('sha256:cand');
    expect(p.source_hashes.evidence_assessment_hash).toMatch(/^sha256:/);
    expect(p.source_hashes.graph_fingerprint).toBeTruthy();
    expect(p.match_schema_version).toBe(MATCH_SCHEMA_VERSION);
  });

  it('survives every adversarial scenario without throwing', () => {
    for (const a of ADVERSARIAL_MATCH_CASES) {
      expect(() => build(a.job, a.candidate), a.name).not.toThrow();
      expect(validateMatchProfile(build(a.job, a.candidate)), a.name).toEqual([]);
    }
  });
});

// ============================================================ API
describe('POST /api/match/evaluate', () => {
  const token = (role: string, companyId = 7) =>
    jwt.sign({ user_id: 1, email: 'r@tejoma.com', name: 'R', role, company_id: companyId },
      privateKey, { algorithm: 'RS256', expiresIn: '15m' });

  const body = () => ({
    job: job({ requirements: [req('Python')] }),
    candidate: cand({ skills: [skill({ skill: 'Python' })] }),
  });

  it('rejects an unauthenticated request', async () => {
    await request(app).post('/api/match/evaluate').send(body()).expect(401);
  });

  it('rejects a candidate-role token', async () => {
    await request(app).post('/api/match/evaluate')
      .set('Authorization', `Bearer ${token('candidate')}`).send(body()).expect(403);
  });

  it('returns a decomposed profile for a recruiter', async () => {
    const res = await request(app).post('/api/match/evaluate')
      .set('Authorization', `Bearer ${token('recruiter')}`).send(body()).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.shadow_only).toBe(true);
    expect(res.body.profile.requirement_results[0].state).toBe('SATISFIED');
    expect(res.body.profile.overall_fit.components.length).toBeGreaterThan(0);
    expect(res.body.profile.match_hash).toMatch(/^sha256:/);
  });

  it('stamps the tenant from the token', async () => {
    const res = await request(app).post('/api/match/evaluate')
      .set('Authorization', `Bearer ${token('recruiter', 42)}`).send(body()).expect(200);
    expect(res.body.profile.tenant_id).toBe('tenant-42');
  });

  it('refuses a body that supplies tenant_id, score or overall_fit', async () => {
    for (const forged of [{ tenant_id: 'tenant-1' }, { score: 100 }, { overall_fit: { score: 100 } }]) {
      await request(app).post('/api/match/evaluate')
        .set('Authorization', `Bearer ${token('recruiter')}`)
        .send({ ...body(), ...forged }).expect(400);
    }
  });

  it('recomputes authoritative values and ignores forged fields inside the candidate', async () => {
    const forged = {
      job: job({ requirements: [req('Kubernetes', 'MANDATORY', ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'], 'production')] }),
      candidate: cand({ skills: [Object.assign(
        skill({ skill: 'Kubernetes', assertion: 'DECLARED', depth: 'MENTIONED', strength: 'DECLARED_ONLY',
          context: 'UNKNOWN', fields: ['skills'] }),
        { state: 'SATISFIED', professional: true, production: true, confidence: 'HIGH' })] }),
    };
    const res = await request(app).post('/api/match/evaluate')
      .set('Authorization', `Bearer ${token('recruiter')}`).send(forged).expect(200);
    const r = res.body.profile.requirement_results[0];
    expect(r.state).not.toBe('SATISFIED');
  });

  it('enforces input limits', async () => {
    const many = { job: { job_id: 1, requirements: Array.from({ length: 300 }, () => req('Python')) },
      candidate: cand({}) };
    await request(app).post('/api/match/evaluate')
      .set('Authorization', `Bearer ${token('recruiter')}`).send(many).expect(400);
  });

  it('rejects a missing job or candidate', async () => {
    await request(app).post('/api/match/evaluate')
      .set('Authorization', `Bearer ${token('recruiter')}`).send({}).expect(400);
  });

  it('declares itself shadow-only in meta', async () => {
    const res = await request(app).get('/api/match/meta')
      .set('Authorization', `Bearer ${token('recruiter')}`).expect(200);
    expect(res.body.shadow_only).toBe(true);
    expect(res.body.affects_production_ranking).toBe(false);
    expect(res.body.satisfaction_states).toContain('UNKNOWN');
  });
});
