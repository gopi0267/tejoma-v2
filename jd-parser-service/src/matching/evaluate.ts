/** Phase 7 evaluation harness: benchmark accuracy, false-positive control, determinism, latency, shadow. */
import { performance } from 'node:perf_hooks';
import { buildKnowledgeGraph } from '../knowledge-graph/graph.js';
import { buildMatchIntelligence, validateMatchProfile, type CandidateProfileP7, type JobProfileP7 } from './engine.js';
import { GOLDEN_MATCH_CASES, type GoldenMatchCase } from './golden-cases.js';
import { ADVERSARIAL_MATCH_CASES, EXTENDED_MATCH_CASES } from './golden-cases-extended.js';
import { SUPPLEMENTARY_MATCH_CASES } from './golden-cases-supplementary.js';
import { SATISFYING_ROUTES } from './contract.js';

const graph = buildKnowledgeGraph();
export const ALL_MATCH_CASES: GoldenMatchCase[] =
  [...GOLDEN_MATCH_CASES, ...EXTENDED_MATCH_CASES, ...SUPPLEMENTARY_MATCH_CASES];
const ALL_CASES = ALL_MATCH_CASES;

export function evaluateMatchCase(c: GoldenMatchCase): { total: number; passed: number; failures: string[] } {
  const p = buildMatchIntelligence(c.job, c.candidate, graph, 'tenant-1');
  const e = c.expect;
  let total = 0, passed = 0;
  const failures: string[] = [];
  const chk = (ok: boolean, label: string) => { total++; if (ok) passed++; else failures.push(label); };

  const target = e.subject
    ? p.requirement_results.find((r) => r.subject === e.subject)
    : p.requirement_results[0];

  if (e.state !== undefined) chk(target?.state === e.state, `state ${e.state} (got ${target?.state})`);
  if (e.route !== undefined) chk(target?.route === e.route, `route ${e.route} (got ${target?.route})`);
  if (e.experienceAlignment !== undefined) {
    chk(p.experience_fit.alignment === e.experienceAlignment,
      `experience ${e.experienceAlignment} (got ${p.experience_fit.alignment})`);
  }
  if (e.seniorityAlignment !== undefined) {
    chk(p.seniority_fit.alignment === e.seniorityAlignment,
      `seniority ${e.seniorityAlignment} (got ${p.seniority_fit.alignment})`);
  }
  if (e.domainCompatibility !== undefined) {
    chk(p.domain_fit.compatibility === e.domainCompatibility,
      `domain ${e.domainCompatibility} (got ${p.domain_fit.compatibility})`);
  }
  if (e.locationCompatibility !== undefined) {
    chk(p.location_fit.compatibility === e.locationCompatibility,
      `location ${e.locationCompatibility} (got ${p.location_fit.compatibility})`);
  }
  if (e.hasTransferable !== undefined) {
    chk((p.transferable_skills.length > 0) === e.hasTransferable, `hasTransferable=${e.hasTransferable}`);
  }
  if (e.minScore !== undefined) chk(p.overall_fit.score >= e.minScore, `score >= ${e.minScore} (got ${p.overall_fit.score})`);
  if (e.maxScore !== undefined) chk(p.overall_fit.score <= e.maxScore, `score <= ${e.maxScore} (got ${p.overall_fit.score})`);
  if (e.insufficientData !== undefined) {
    chk(p.overall_fit.insufficient_data === e.insufficientData, `insufficient_data=${e.insufficientData}`);
  }
  if (e.compositeState !== undefined) {
    chk(p.composite_groups[0]?.state === e.compositeState,
      `composite ${e.compositeState} (got ${p.composite_groups[0]?.state ?? 'no group'})`);
  }
  if (e.hasContradiction !== undefined) {
    chk((p.contradictions.length > 0) === e.hasContradiction, `hasContradiction=${e.hasContradiction}`);
  }
  if (e.derivativeCount !== undefined) {
    const n = p.requirement_results.filter((r) => r.derivative_of).length;
    chk(n === e.derivativeCount, `derivativeCount ${e.derivativeCount} (got ${n})`);
  }
  return { total, passed, failures };
}

export function runMatchEvaluation(
  shadow?: { jobs: JobProfileP7[]; candidates: CandidateProfileP7[]; production?: (j: JobProfileP7, c: CandidateProfileP7) => number },
): void {
  const byCat = new Map<string, { total: number; passed: number }>();
  let total = 0, passed = 0;
  const allFailures: string[] = [];
  for (const c of ALL_CASES) {
    const r = evaluateMatchCase(c);
    total += r.total; passed += r.passed;
    for (const f of r.failures) allFailures.push(`[${c.category}] ${c.name}: ${f}`);
    const agg = byCat.get(c.category) ?? { total: 0, passed: 0 };
    agg.total += r.total; agg.passed += r.passed; byCat.set(c.category, agg);
  }
  console.log('PHASE 7 GOLDEN MATCH BENCHMARK');
  console.log(`  cases=${ALL_CASES.length} assertions=${total}`);
  for (const [k, v] of [...byCat.entries()].sort()) {
    console.log(`  ${k.padEnd(14)} ${String(v.passed).padStart(3)}/${String(v.total).padEnd(3)} ${((v.passed / v.total) * 100).toFixed(1)}%`);
  }
  console.log(`  ${'OVERALL'.padEnd(14)} ${passed}/${total} ${((passed / total) * 100).toFixed(1)}%`);
  if (allFailures.length) {
    console.log('\nFAILURES');
    for (const f of allFailures.slice(0, 40)) console.log('  ' + f);
  }

  // ---- FALSE POSITIVE CONTROL: the headline safety metric.
  // A false positive is a requirement reported SATISFIED that the adversarial case says must not be.
  let fp = 0, checked = 0, unsupported = 0, invalidRoute = 0;
  const advFailures: string[] = [];
  for (const a of ADVERSARIAL_MATCH_CASES) {
    const p = buildMatchIntelligence(a.job, a.candidate, graph, 't');
    for (const r of p.requirement_results) {
      checked++;
      if (r.state === 'SATISFIED') {
        if (a.mustNotSatisfy.includes(r.subject)) { fp++; advFailures.push(`${a.name}: ${r.subject} SATISFIED`); }
        // A SATISFIED reached through a non-satisfying route is an unsupported match claim.
        if (!SATISFYING_ROUTES.has(r.route) && r.route !== 'NONE') { unsupported++; }
      }
      if (r.route === 'RELATED' && ['SATISFIED', 'PARTIALLY_SATISFIED', 'TRANSFERABLE'].includes(r.state)) {
        invalidRoute++;
      }
    }
  }
  console.log(`\nADVERSARIAL  ${ADVERSARIAL_MATCH_CASES.length} scenarios, ${checked} requirement outcomes`);
  console.log(`FALSE POSITIVE MATCH RATE   ${fp}/${checked} = ${((fp / checked) * 100).toFixed(2)}%`);
  console.log(`UNSUPPORTED MATCH RATE      ${unsupported}/${checked} = ${((unsupported / checked) * 100).toFixed(2)}%`);
  console.log(`RELATED-CREDITED-AS-MATCH   ${invalidRoute}/${checked} = ${((invalidRoute / checked) * 100).toFixed(2)}%`);
  if (advFailures.length) { console.log('\nADVERSARIAL FAILURES'); for (const f of advFailures.slice(0, 25)) console.log('  ' + f); }

  // ---- schema validity + determinism + idempotency
  let invalid = 0;
  const invalidDetail: string[] = [];
  for (const c of ALL_CASES) {
    const issues = validateMatchProfile(buildMatchIntelligence(c.job, c.candidate, graph, 't'));
    if (issues.length > 0) { invalid++; invalidDetail.push(`${c.name}: ${issues[0].problem}`); }
  }
  console.log(`\nSCHEMA + POLICY VALIDITY    ${ALL_CASES.length - invalid}/${ALL_CASES.length} valid`);
  if (invalidDetail.length) for (const d of invalidDetail.slice(0, 15)) console.log('  ' + d);

  let nondet = 0;
  for (const c of ALL_CASES) {
    const h = new Set([0, 1, 2].map(() => buildMatchIntelligence(c.job, c.candidate, graph, 't').match_hash));
    if (h.size !== 1) nondet++;
  }
  console.log(`DETERMINISM / IDEMPOTENCY   ${ALL_CASES.length - nondet}/${ALL_CASES.length} stable over 3 runs`);

  // ---- score decomposition integrity: every score must reconstruct from its components
  let badDecomp = 0;
  for (const c of ALL_CASES) {
    const p = buildMatchIntelligence(c.job, c.candidate, graph, 't');
    const base = p.overall_fit.components.reduce((a, x) => a + x.contribution, 0);
    const pen = p.overall_fit.penalties.reduce((a, x) => a + x.contribution, 0);
    if (Math.max(0, Math.min(100, Math.round(base + pen))) !== p.overall_fit.score) badDecomp++;
  }
  console.log(`SCORE DECOMPOSITION         ${ALL_CASES.length - badDecomp}/${ALL_CASES.length} reconstruct exactly`);

  // ---- provenance completeness on satisfied requirements
  let sat = 0, satWithProv = 0;
  for (const c of ALL_CASES) {
    for (const r of buildMatchIntelligence(c.job, c.candidate, graph, 't').requirement_results) {
      if (r.state === 'SATISFIED') { sat++; if (r.provenance.length > 0 && r.reasoning.length > 0) satWithProv++; }
    }
  }
  console.log(`EXPLAINABILITY / PROVENANCE ${satWithProv}/${sat} satisfied requirements carry provenance + reasoning`);

  // ---- latency
  const ITER = 100;
  const t0 = performance.now();
  for (let i = 0; i < ITER; i++) for (const c of ALL_CASES) buildMatchIntelligence(c.job, c.candidate, graph, 't');
  const n = ITER * ALL_CASES.length;
  const el = performance.now() - t0;
  console.log(`\nLATENCY  ${n} JD x candidate matches in ${el.toFixed(0)} ms = ${((el / n) * 1000).toFixed(1)} us/match`);

  // ---- shadow over the real corpus
  if (shadow) {
    console.log(`\nSHADOW (${shadow.jobs.length} jobs x ${shadow.candidates.length} candidates) - read-only`);
    const states: Record<string, number> = {};
    const scores: number[] = [];
    const prodScores: number[] = [];
    let pairs = 0, reqs = 0, invalidP = 0, insufficient = 0, transferables = 0, derivatives = 0;
    const tS = performance.now();
    for (const j of shadow.jobs) {
      for (const c of shadow.candidates) {
        const p = buildMatchIntelligence(j, c, graph, 'tenant-1');
        if (validateMatchProfile(p).length > 0) invalidP++;
        pairs++;
        scores.push(p.overall_fit.score);
        if (p.overall_fit.insufficient_data) insufficient++;
        transferables += p.transferable_skills.length;
        derivatives += p.requirement_results.filter((r) => r.derivative_of).length;
        for (const r of p.requirement_results) { reqs++; states[r.state] = (states[r.state] ?? 0) + 1; }
        if (shadow.production) prodScores.push(shadow.production(j, c));
      }
    }
    const elS = performance.now() - tS;
    const pct = (arr: number[], q: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * q)] ?? 0; };
    console.log(`  pairs ${pairs} · requirements ${reqs} · invalid ${invalidP}`);
    console.log(`  states ${JSON.stringify(states)}`);
    console.log(`  phase7 score  p50=${pct(scores, 0.5)} p95=${pct(scores, 0.95)} p99=${pct(scores, 0.99)} max=${Math.max(...scores)}`);
    if (prodScores.length) {
      console.log(`  production    p50=${pct(prodScores, 0.5)} p95=${pct(prodScores, 0.95)} max=${Math.max(...prodScores)}`);
      const diffs = scores.map((s, i) => s - prodScores[i]);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const overrated = diffs.filter((d) => d < -20).length;
      console.log(`  mean delta (phase7 - production) ${mean.toFixed(1)}`);
      console.log(`  pairs where production scored >20 points HIGHER than phase7: ${overrated} `
        + `(${((overrated / diffs.length) * 100).toFixed(1)}%) - candidate-facing false positives phase7 refuses`);
    }
    console.log(`  insufficient_data ${insufficient} · transferable skills ${transferables} · derivative requirements ${derivatives}`);
    console.log(`  ${elS.toFixed(0)} ms total = ${(elS / pairs).toFixed(2)} ms per pair`);
  }
}
