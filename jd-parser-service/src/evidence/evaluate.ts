/** Phase 6 evaluation harness: benchmark metrics, false-attribution rates, determinism, latency. */
import { performance } from 'node:perf_hooks';
import { buildKnowledgeGraph } from '../knowledge-graph/graph.js';
import { evaluateEvidence, validateAssessment, type CandidateProfileLike, type JobProfileLike } from './engine.js';
import { GOLDEN_EVIDENCE_CASES as BASE_CASES, ADVERSARIAL_CANDIDATES as BASE_ADVERSARIAL, type GoldenEvidenceCase } from './golden-cases.js';
import { EXTENDED_EVIDENCE_CASES, EXTENDED_ADVERSARIAL } from './golden-cases-extended.js';
import { NON_PRODUCTION_TYPES, NON_PROFESSIONAL_TYPES } from './contract.js';

const graph = buildKnowledgeGraph();

/** The benchmark is the union of both sets; neither is a substitute for the other. */
const GOLDEN_EVIDENCE_CASES: GoldenEvidenceCase[] = [...BASE_CASES, ...EXTENDED_EVIDENCE_CASES];
const ADVERSARIAL_CANDIDATES = [...BASE_ADVERSARIAL, ...EXTENDED_ADVERSARIAL];

export function evaluateCase(c: GoldenEvidenceCase): { total: number; passed: number; failures: string[] } {
  const a = evaluateEvidence(c.job, c.candidate, graph, 'tenant-1');
  const r = a.assessments[0];
  let total = 0, passed = 0;
  const failures: string[] = [];
  const chk = (ok: boolean, label: string) => { total++; if (ok) passed++; else failures.push(label); };
  const e = c.expect;

  chk(r.state === e.state, `state ${e.state} (got ${r.state})`);
  if (e.maxEvidenceType !== undefined) {
    const strongest = r.evidence.length
      ? r.evidence.reduce((x, y) => (y.strength > x.strength ? y : x)).evidence_type : null;
    chk(strongest === e.maxEvidenceType, `strongest evidence ${e.maxEvidenceType} (got ${strongest})`);
  }
  if (e.professional !== undefined) {
    chk(r.evidence.some((x) => x.professional) === e.professional,
      `professional=${e.professional} (got ${r.evidence.some((x) => x.professional)})`);
  }
  if (e.production !== undefined) {
    chk(r.evidence.some((x) => x.production) === e.production,
      `production=${e.production} (got ${r.evidence.some((x) => x.production)})`);
  }
  if (e.academic !== undefined) {
    chk(r.evidence.some((x) => x.academic) === e.academic,
      `academic=${e.academic} (got ${r.evidence.some((x) => x.academic)})`);
  }
  for (const k of e.gapKinds ?? []) chk(r.gaps.some((x) => x.kind === k), `gap ${k} expected`);
  for (const k of e.noGapKinds ?? []) chk(!r.gaps.some((x) => x.kind === k), `gap ${k} must be absent`);
  if (e.independentSources !== undefined) {
    chk(r.independent_sources === e.independentSources,
      `independent_sources ${e.independentSources} (got ${r.independent_sources})`);
  }
  if (e.hasConflict !== undefined) chk((r.conflicts.length > 0) === e.hasConflict, `hasConflict=${e.hasConflict}`);
  if (e.hasLimitation !== undefined) chk((r.limitations.length > 0) === e.hasLimitation, `hasLimitation=${e.hasLimitation}`);
  return { total, passed, failures };
}

export function runEvidenceEvaluation(
  shadow?: { jobs: JobProfileLike[]; candidates: CandidateProfileLike[] },
): void {
  const byCat = new Map<string, { total: number; passed: number }>();
  let total = 0, passed = 0;
  const allFailures: string[] = [];
  for (const c of GOLDEN_EVIDENCE_CASES) {
    const r = evaluateCase(c);
    total += r.total; passed += r.passed;
    for (const f of r.failures) allFailures.push(`[${c.category}] ${c.name}: ${f}`);
    const agg = byCat.get(c.category) ?? { total: 0, passed: 0 };
    agg.total += r.total; agg.passed += r.passed; byCat.set(c.category, agg);
  }
  console.log('PHASE 6 GOLDEN BENCHMARK');
  console.log(`  cases=${GOLDEN_EVIDENCE_CASES.length} assertions=${total}`);
  for (const [k, v] of [...byCat.entries()].sort()) {
    console.log(`  ${k.padEnd(14)} ${String(v.passed).padStart(3)}/${String(v.total).padEnd(3)} ${((v.passed / v.total) * 100).toFixed(1)}%`);
  }
  console.log(`  ${'OVERALL'.padEnd(14)} ${passed}/${total} ${((passed / total) * 100).toFixed(1)}%`);
  if (allFailures.length) {
    console.log('\nFAILURES');
    for (const f of allFailures.slice(0, 40)) console.log('  ' + f);
  }

  // ---- false attribution: the safety metrics
  let falseProf = 0, falseProd = 0, falseAcademic = 0, checked = 0;
  const probe = (a: ReturnType<typeof evaluateEvidence>) => {
    for (const r of a.assessments) {
      for (const u of r.evidence) {
        checked++;
        if (u.professional && NON_PROFESSIONAL_TYPES.has(u.evidence_type)) falseProf++;
        if (u.production && NON_PRODUCTION_TYPES.has(u.evidence_type)) falseProd++;
        if (u.academic && u.professional) falseAcademic++;
      }
    }
  };
  for (const c of GOLDEN_EVIDENCE_CASES) probe(evaluateEvidence(c.job, c.candidate, graph, 't'));
  const advJob: JobProfileLike = {
    job_id: 99, intelligence_hash: 'sha256:adv',
    requirements: [
      { subject: 'Python', level: 'MANDATORY', context: 'production', evidence_required: ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'] },
      { subject: 'Kubernetes', level: 'MANDATORY', context: 'production', evidence_required: ['WORK_EXPERIENCE', 'PRODUCTION_EXPERIENCE'] },
      { subject: 'AWS', level: 'MANDATORY', evidence_required: ['WORK_EXPERIENCE'] },
    ],
    experience_requirements: [{ subject: null, min_years: 5, qualifier: 'AT_LEAST' }],
  };
  for (const adv of ADVERSARIAL_CANDIDATES) probe(evaluateEvidence(advJob, adv.candidate, graph, 't'));
  console.log(`\nFALSE PROFESSIONAL ATTRIBUTION  ${falseProf}/${checked} = ${((falseProf / checked) * 100).toFixed(2)}%`);
  console.log(`FALSE PRODUCTION ATTRIBUTION    ${falseProd}/${checked} = ${((falseProd / checked) * 100).toFixed(2)}%`);
  console.log(`ACADEMIC -> PROFESSIONAL        ${falseAcademic}/${checked} = ${((falseAcademic / checked) * 100).toFixed(2)}%`);

  // adversarial states
  console.log('\nADVERSARIAL CANDIDATES (production+professional requirements)');
  for (const adv of ADVERSARIAL_CANDIDATES) {
    const a = evaluateEvidence(advJob, adv.candidate, graph, 't');
    const worst = a.assessments.map((r) => `${r.concept}:${r.state}`).join(' ');
    const anyProd = a.assessments.some((r) => r.evidence.some((u) => u.production));
    console.log(`  ${adv.name.padEnd(46)} ${worst}   production_claimed=${anyProd}`);
  }

  // ---- schema validity + determinism
  let invalid = 0;
  for (const c of GOLDEN_EVIDENCE_CASES) {
    if (validateAssessment(evaluateEvidence(c.job, c.candidate, graph, 't')).length > 0) invalid++;
  }
  console.log(`\nSCHEMA + ATTRIBUTION VALIDITY   ${GOLDEN_EVIDENCE_CASES.length - invalid}/${GOLDEN_EVIDENCE_CASES.length} valid`);
  let nondet = 0;
  for (const c of GOLDEN_EVIDENCE_CASES) {
    const h = new Set([0, 1, 2].map(() => evaluateEvidence(c.job, c.candidate, graph, 't').assessment_hash));
    if (h.size !== 1) nondet++;
  }
  console.log(`DETERMINISM                     ${GOLDEN_EVIDENCE_CASES.length - nondet}/${GOLDEN_EVIDENCE_CASES.length} stable over 3 runs`);

  // ---- latency
  const t0 = performance.now();
  const ITER = 200;
  for (let i = 0; i < ITER; i++) {
    for (const c of GOLDEN_EVIDENCE_CASES) evaluateEvidence(c.job, c.candidate, graph, 't');
  }
  const n = ITER * GOLDEN_EVIDENCE_CASES.length;
  const el = performance.now() - t0;
  console.log(`\nLATENCY  ${n} single-requirement evaluations in ${el.toFixed(0)} ms = ${((el / n) * 1000).toFixed(2)} µs/requirement`);

  // ---- shadow over the real corpus
  if (shadow) {
    console.log(`\nSHADOW (${shadow.jobs.length} jobs × ${shadow.candidates.length} candidates) - read-only`);
    const states: Record<string, number> = {};
    const gapKinds: Record<string, number> = {};
    let pairs = 0, reqs = 0, invalidProd = 0, prof = 0, prod = 0, evUnits = 0, provComplete = 0;
    const tS = performance.now();
    for (const j of shadow.jobs) {
      for (const c of shadow.candidates) {
        const a = evaluateEvidence(j, c, graph, 'tenant-1');
        if (validateAssessment(a).length > 0) invalidProd++;
        pairs++;
        for (const r of a.assessments) {
          reqs++;
          states[r.state] = (states[r.state] ?? 0) + 1;
          for (const g of r.gaps) gapKinds[g.kind] = (gapKinds[g.kind] ?? 0) + 1;
          for (const u of r.evidence) {
            evUnits++;
            if (u.professional) prof++;
            if (u.production) prod++;
            if (u.provenance.source_field && u.provenance.rule) provComplete++;
          }
        }
      }
    }
    const elS = performance.now() - tS;
    console.log(`  pairs ${pairs} · requirements assessed ${reqs} · evidence units ${evUnits}`);
    console.log(`  states ${JSON.stringify(states)}`);
    console.log(`  gaps   ${JSON.stringify(gapKinds)}`);
    console.log(`  professional units ${prof} · production units ${prod}`);
    console.log(`  provenance completeness ${provComplete}/${evUnits}`);
    console.log(`  invalid assessments ${invalidProd}`);
    console.log(`  ${elS.toFixed(0)} ms total = ${(elS / pairs).toFixed(2)} ms per JD×candidate pair`);
  }
}
