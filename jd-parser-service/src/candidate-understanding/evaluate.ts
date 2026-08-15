/** Phase 4 evaluation harness: benchmark metrics, false attribution, determinism, latency, shadow. */
import { performance } from 'node:perf_hooks';
import {
  buildCandidateIntelligence, validateCandidateProfile, type CandidateRecordInput,
} from './engine.js';
import {
  GOLDEN_CANDIDATE_CASES, FALSE_ATTRIBUTION_PROBES, type GoldenCandidateCase,
} from './golden-cases.js';

type Profile = ReturnType<typeof buildCandidateIntelligence>;
const skillOf = (p: Profile, name: string) =>
  p.skills.find((s) => s.skill.toLowerCase() === name.toLowerCase());

export function evaluateCase(cse: GoldenCandidateCase): { total: number; passed: number; failures: string[] } {
  const p = buildCandidateIntelligence(cse.record);
  let total = 0, passed = 0;
  const failures: string[] = [];
  const chk = (ok: boolean, label: string) => { total++; if (ok) passed++; else failures.push(label); };
  const e = cse.expect;

  for (const s of e.skill ?? []) {
    const u = skillOf(p, s.name);
    chk(!!u, `skill ${s.name} present`);
    if (!u) continue;
    if (s.assertion) chk(u.assertion === s.assertion, `${s.name} assertion ${s.assertion} (got ${u.assertion})`);
    if (s.depth) chk(u.depth === s.depth, `${s.name} depth ${s.depth} (got ${u.depth})`);
    if (s.evidence) chk(u.evidence_strength === s.evidence, `${s.name} evidence ${s.evidence} (got ${u.evidence_strength})`);
    if (s.context) chk(u.context_type === s.context, `${s.name} context ${s.context} (got ${u.context_type})`);
    if (s.recency) chk(u.recency === s.recency, `${s.name} recency ${s.recency} (got ${u.recency})`);
  }
  for (const n of e.absentSkills ?? []) chk(!skillOf(p, n), `${n} must be absent`);
  if (e.skillCount !== undefined) chk(p.skills.length === e.skillCount, `skillCount ${e.skillCount} (got ${p.skills.length})`);
  for (const cap of e.capabilities ?? []) chk(p.capabilities.some((x) => x.capability === cap), `capability ${cap}`);
  for (const l of e.leadership ?? []) chk(p.leadership.some((x) => x.kind === l), `leadership ${l}`);
  if (e.noLeadership) chk(p.leadership.length === 0, `no leadership (got ${p.leadership.map((l) => l.kind).join(',')})`);
  if ('seniority' in e) chk(p.seniority.seniority === e.seniority, `seniority ${e.seniority} (got ${p.seniority.seniority})`);
  if (e.seniorityConfidenceNot) chk(p.seniority.confidence !== e.seniorityConfidenceNot, `seniority confidence not ${e.seniorityConfidenceNot}`);
  if ('roleFamily' in e) chk(p.role_family === e.roleFamily, `roleFamily ${e.roleFamily} (got ${p.role_family})`);
  if ('evidenceRoleFamily' in e) chk(p.evidence_role_family === e.evidenceRoleFamily, `evidenceRoleFamily ${e.evidenceRoleFamily} (got ${p.evidence_role_family})`);
  if ('timelineMonths' in e) chk(p.timeline_months === e.timelineMonths, `timelineMonths ${e.timelineMonths} (got ${p.timeline_months})`);
  if (e.experienceCount !== undefined) chk(p.experience.length === e.experienceCount, `experienceCount ${e.experienceCount} (got ${p.experience.length})`);
  for (const k of e.credentialKinds ?? []) {
    const u = p.credentials.find((x) => x.name === k.name);
    chk(!!u && u.kind === k.kind, `credential ${k.name} kind ${k.kind} (got ${u?.kind})`);
  }
  for (const d of e.domains ?? []) chk(p.domains.some((x) => x.domain === d), `domain ${d}`);
  if (e.noDomains) chk(p.domains.length === 0, `no domains (got ${p.domains.map((d) => d.domain).join(',')})`);
  if (e.ambiguityTypes) {
    if (e.ambiguityTypes.length === 0) chk(p.ambiguities.length === 0, `no ambiguities (got ${p.ambiguities.map((a) => a.type).join(',')})`);
    else for (const t of e.ambiguityTypes) chk(p.ambiguities.some((a) => a.type === t), `ambiguity ${t}`);
  }
  if (e.contradictionTypes) {
    for (const t of e.contradictionTypes) chk(p.contradictions.some((x) => x.type === t), `contradiction ${t}`);
  }
  for (const pr of e.projects ?? []) {
    const u = p.projects.find((x) => x.name === pr.name);
    chk(!!u, `project ${pr.name}`);
    if (u && pr.technologies) chk(JSON.stringify(u.technologies) === JSON.stringify(pr.technologies),
      `project ${pr.name} technologies ${JSON.stringify(pr.technologies)} (got ${JSON.stringify(u.technologies)})`);
  }
  if (e.education) {
    const u = p.education[0];
    chk(!!u, 'education present');
    if (u) {
      if (e.education.qualification) chk(u.qualification === e.education.qualification, `education qualification`);
      if ('year' in e.education) chk(u.graduation_year === e.education.year, `education year ${e.education.year} (got ${u.graduation_year})`);
    }
  }
  if (e.usage) {
    const u = p.technologies.find((x) => x.name === e.usage!.name);
    chk(!!u, `technology ${e.usage.name}`);
    if (u) chk(JSON.stringify(u.usage) === JSON.stringify(e.usage.verbs),
      `usage ${JSON.stringify(e.usage.verbs)} (got ${JSON.stringify(u.usage)})`);
  }
  return { total, passed, failures };
}

export function runCandidateEvaluation(productionCandidates: CandidateRecordInput[] = []): void {
  const byCat = new Map<string, { total: number; passed: number }>();
  let total = 0, passed = 0;
  const allFailures: string[] = [];
  for (const cse of GOLDEN_CANDIDATE_CASES) {
    const r = evaluateCase(cse);
    total += r.total; passed += r.passed;
    for (const f of r.failures) allFailures.push(`[${cse.category}] ${cse.name}: ${f}`);
    const a = byCat.get(cse.category) ?? { total: 0, passed: 0 };
    a.total += r.total; a.passed += r.passed; byCat.set(cse.category, a);
  }
  console.log('PHASE 4 GOLDEN BENCHMARK');
  console.log(`  cases=${GOLDEN_CANDIDATE_CASES.length} assertions=${total}`);
  for (const [k, v] of [...byCat.entries()].sort()) {
    console.log(`  ${k.padEnd(16)} ${String(v.passed).padStart(3)}/${String(v.total).padEnd(3)} ${((v.passed / v.total) * 100).toFixed(1)}%`);
  }
  console.log(`  ${'OVERALL'.padEnd(16)} ${passed}/${total} ${((passed / total) * 100).toFixed(1)}%`);
  if (allFailures.length) {
    console.log('\nFAILURES');
    for (const f of allFailures.slice(0, 40)) console.log('  ' + f);
    if (allFailures.length > 40) console.log(`  ... ${allFailures.length - 40} more`);
  }

  let fab = 0, probes = 0;
  const found: string[] = [];
  for (const probe of FALSE_ATTRIBUTION_PROBES) {
    const p = buildCandidateIntelligence(probe.record);
    const subs = new Set(p.skills.filter((s) => s.assertion !== 'NEGATED').map((s) => s.skill.toLowerCase()));
    for (const f of probe.mustNotContain) { probes++; if (subs.has(f.toLowerCase())) { fab++; found.push(f); } }
  }
  console.log(`\nFALSE ATTRIBUTION RATE  ${fab}/${probes} = ${probes ? ((fab / probes) * 100).toFixed(2) : '0.00'}%`);
  if (found.length) console.log('  fabricated: ' + found.join(', '));

  let invalid = 0;
  for (const cse of GOLDEN_CANDIDATE_CASES) {
    if (validateCandidateProfile(buildCandidateIntelligence(cse.record), cse.record).length > 0) invalid++;
  }
  console.log(`SCHEMA + SPAN VALIDITY  ${GOLDEN_CANDIDATE_CASES.length - invalid}/${GOLDEN_CANDIDATE_CASES.length} valid`);

  let nondet = 0;
  for (const cse of GOLDEN_CANDIDATE_CASES) {
    const h = new Set([0, 1, 2].map(() => buildCandidateIntelligence(cse.record).intelligence_hash));
    if (h.size !== 1) nondet++;
  }
  console.log(`DETERMINISM             ${GOLDEN_CANDIDATE_CASES.length - nondet}/${GOLDEN_CANDIDATE_CASES.length} stable over 3 runs`);

  const sample = GOLDEN_CANDIDATE_CASES.map((x) => x.record);
  const t0 = performance.now();
  const ITER = 20;
  for (let i = 0; i < ITER; i++) for (const r of sample) buildCandidateIntelligence(r);
  const el = performance.now() - t0;
  console.log(`\nLATENCY                 ${ITER * sample.length} profiles in ${el.toFixed(0)} ms = ${(el / (ITER * sample.length)).toFixed(3)} ms/candidate`);

  if (productionCandidates.length) {
    console.log(`\nSHADOW ON PRODUCTION CANDIDATES (${productionCandidates.length})`);
    const assertions: Record<string, number> = {};
    const depths: Record<string, number> = {};
    const evidences: Record<string, number> = {};
    const recencies: Record<string, number> = {};
    let skills = 0, caps = 0, tech = 0, lead = 0, amb = 0, con = 0, invalidProd = 0;
    let dated = 0, undated = 0;
    const t1 = performance.now();
    for (const rec of productionCandidates) {
      const p = buildCandidateIntelligence(rec);
      if (validateCandidateProfile(p, rec).length > 0) invalidProd++;
      skills += p.skills.length; caps += p.capabilities.length; tech += p.technologies.length;
      lead += p.leadership.length; amb += p.ambiguities.length; con += p.contradictions.length;
      if (p.timeline_months !== null) dated++; else undated++;
      for (const s of p.skills) {
        assertions[s.assertion] = (assertions[s.assertion] ?? 0) + 1;
        depths[s.depth] = (depths[s.depth] ?? 0) + 1;
        evidences[s.evidence_strength] = (evidences[s.evidence_strength] ?? 0) + 1;
        recencies[s.recency] = (recencies[s.recency] ?? 0) + 1;
      }
    }
    const el2 = performance.now() - t1;
    console.log(`  skills ${skills} · technologies ${tech} · capabilities ${caps} · leadership ${lead}`);
    console.log(`  assertion  ${JSON.stringify(assertions)}`);
    console.log(`  depth      ${JSON.stringify(depths)}`);
    console.log(`  evidence   ${JSON.stringify(evidences)}`);
    console.log(`  recency    ${JSON.stringify(recencies)}`);
    console.log(`  timeline: ${dated} dated · ${undated} undatable`);
    console.log(`  ambiguities ${amb} · contradictions ${con} · invalid profiles ${invalidProd}`);
    console.log(`  latency ${(el2 / productionCandidates.length).toFixed(3)} ms/candidate on real resumes`);
  }
}
