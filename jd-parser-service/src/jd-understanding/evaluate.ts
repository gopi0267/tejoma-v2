/**
 * Phase 3 evaluation harness: benchmark metrics, false-inference rate, shadow comparison against
 * the existing parser, and latency. Read-only; run as `npx tsx src/jd-understanding/evaluate.ts`.
 */
import { performance } from 'node:perf_hooks';
import { buildJobIntelligence, validateProfile, type JobRecordInput } from './engine.js';
import { GOLDEN_CASES, FALSE_INFERENCE_PROBES, type GoldenCase } from './golden-cases.js';

function hasLevel(p: ReturnType<typeof buildJobIntelligence>, subject: string, level: string): boolean {
  const all = [...p.requirements, ...p.education_requirements, ...p.certification_requirements,
    ...p.domain_requirements, ...p.location_constraints, ...p.work_constraints];
  return all.some((r) => r.subject.toLowerCase() === subject.toLowerCase() && r.level === level);
}

function evaluate(c: GoldenCase): { total: number; passed: number } {
  const p = buildJobIntelligence(c.job);
  let total = 0, passed = 0;
  const chk = (ok: boolean) => { total++; if (ok) passed++; };
  for (const e of c.expect.level ?? []) chk(hasLevel(p, e.subject, e.level));
  for (const e of c.expect.notLevel ?? []) chk(!hasLevel(p, e.subject, e.level));
  for (const s of c.expect.absent ?? []) chk(!p.requirements.some((r) => r.subject.toLowerCase() === s.toLowerCase()));
  for (const s of c.expect.negated ?? []) chk(p.requirements.some((r) => r.subject.toLowerCase() === s.toLowerCase() && r.negated));
  for (const e of c.expect.experience ?? []) {
    if (e.min === undefined) { chk(p.experience_requirements.length > 0); continue; }
    const m = p.experience_requirements.find((x) => x.min_years === e.min);
    chk(!!m);
    if (m) {
      if (e.max !== undefined) chk(m.max_years === e.max);
      if (e.subject) chk(!!m.subject && e.subject.test(m.subject));
      if (e.type) chk(m.experience_type === e.type);
    }
  }
  if ('seniority' in c.expect) chk(p.seniority.seniority === c.expect.seniority);
  if (c.expect.seniorityConfidenceNot) chk(p.seniority.confidence !== c.expect.seniorityConfidenceNot);
  for (const cap of c.expect.capabilities ?? []) chk(p.capabilities.some((x) => x.capability === cap));
  if (c.expect.ambiguityTypes) {
    if (c.expect.ambiguityTypes.length === 0) chk(p.ambiguities.length === 0);
    else for (const t of c.expect.ambiguityTypes) chk(p.ambiguities.some((a) => a.type === t));
  }
  if (c.expect.contradictionTypes) {
    if (c.expect.contradictionTypes.length === 0) chk(!p.contradictions.some((x) => x.type === 'SENIORITY_VS_EXPERIENCE'));
    else for (const t of c.expect.contradictionTypes) chk(p.contradictions.some((x) => x.type === t));
  }
  for (const e of c.expect.context ?? []) {
    chk(p.requirements.some((r) => r.subject.toLowerCase() === e.subject.toLowerCase() && r.context === e.context));
  }
  for (const e of c.expect.relationship ?? []) {
    const t = p.technologies.find((x) => x.name === e.name);
    chk(!!t && t.relationships.some((r) => r.type === e.type && r.target === e.target));
  }
  return { total, passed };
}

export function runEvaluation(productionJobs: JobRecordInput[] = []): void {
  // ---- benchmark accuracy by category
  const byCat = new Map<string, { total: number; passed: number }>();
  let total = 0, passed = 0;
  for (const c of GOLDEN_CASES) {
    const r = evaluate(c);
    total += r.total; passed += r.passed;
    const a = byCat.get(c.category) ?? { total: 0, passed: 0 };
    a.total += r.total; a.passed += r.passed; byCat.set(c.category, a);
  }
  console.log('PHASE 3 GOLDEN BENCHMARK');
  console.log(`  cases=${GOLDEN_CASES.length} assertions=${total}`);
  for (const [k, v] of [...byCat.entries()].sort()) {
    console.log(`  ${k.padEnd(13)} ${String(v.passed).padStart(3)}/${String(v.total).padEnd(3)} ${((v.passed / v.total) * 100).toFixed(1)}%`);
  }
  console.log(`  ${'OVERALL'.padEnd(13)} ${passed}/${total} ${((passed / total) * 100).toFixed(1)}%`);

  // ---- false inference
  let fab = 0, probes = 0;
  for (const probe of FALSE_INFERENCE_PROBES) {
    const p = buildJobIntelligence(probe.job);
    const subs = new Set(p.requirements.map((r) => r.subject.toLowerCase()));
    for (const f of probe.mustNotContain) { probes++; if (subs.has(f.toLowerCase())) fab++; }
  }
  console.log(`\nFALSE INFERENCE RATE  ${fab}/${probes} = ${((fab / probes) * 100).toFixed(2)}%`);

  // ---- schema/provenance validity across the whole benchmark
  let invalid = 0;
  for (const c of GOLDEN_CASES) {
    if (validateProfile(buildJobIntelligence(c.job), c.job).length > 0) invalid++;
  }
  console.log(`SCHEMA + SPAN VALIDITY ${GOLDEN_CASES.length - invalid}/${GOLDEN_CASES.length} valid, ${invalid} invalid`);

  // ---- determinism
  let nondet = 0;
  for (const c of GOLDEN_CASES) {
    const h = new Set([0, 1, 2].map(() => buildJobIntelligence(c.job).intelligence_hash));
    if (h.size !== 1) nondet++;
  }
  console.log(`DETERMINISM            ${GOLDEN_CASES.length - nondet}/${GOLDEN_CASES.length} stable over 3 runs`);

  // ---- latency
  const sample = GOLDEN_CASES.map((c) => c.job);
  const t0 = performance.now();
  const ITER = 50;
  for (let i = 0; i < ITER; i++) for (const j of sample) buildJobIntelligence(j);
  const el = performance.now() - t0;
  const n = ITER * sample.length;
  console.log(`\nLATENCY                ${n} profiles in ${el.toFixed(0)} ms = ${(el / n).toFixed(3)} ms/JD`);

  // ---- shadow comparison against real production JDs
  if (productionJobs.length) {
    console.log(`\nSHADOW ON PRODUCTION JDs (${productionJobs.length})`);
    let reqTotal = 0, mandatory = 0, preferred = 0, optional = 0, excluded = 0, contextual = 0, informational = 0;
    let caps = 0, amb = 0, con = 0, tech = 0, exp = 0, invalidProd = 0;
    const seniorities: string[] = [];
    for (const job of productionJobs) {
      const p = buildJobIntelligence(job);
      if (validateProfile(p, job).length > 0) invalidProd++;
      reqTotal += p.requirements.length;
      for (const r of p.requirements) {
        if (r.level === 'MANDATORY') mandatory++;
        else if (r.level === 'PREFERRED' || r.level === 'STRONGLY_PREFERRED') preferred++;
        else if (r.level === 'OPTIONAL') optional++;
        else if (r.level === 'EXCLUDED') excluded++;
        else if (r.level === 'CONTEXTUAL') contextual++;
        else informational++;
      }
      caps += p.capabilities.length; amb += p.ambiguities.length;
      con += p.contradictions.length; tech += p.technologies.length;
      exp += p.experience_requirements.length;
      seniorities.push(`${job.id}:${p.seniority.seniority ?? 'null'}/${p.seniority.confidence}`);
    }
    console.log(`  requirements ${reqTotal}  (MANDATORY ${mandatory} · PREFERRED ${preferred} · OPTIONAL ${optional} · CONTEXTUAL ${contextual} · INFORMATIONAL ${informational} · EXCLUDED ${excluded})`);
    console.log(`  technologies ${tech}  capabilities ${caps}  experience ${exp}`);
    console.log(`  ambiguities ${amb}  contradictions ${con}`);
    console.log(`  invalid profiles ${invalidProd}`);
    console.log(`  seniority: ${seniorities.join(', ')}`);
  }
}
