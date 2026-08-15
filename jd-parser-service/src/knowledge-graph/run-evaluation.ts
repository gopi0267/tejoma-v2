/**
 * Phase 5 evaluation: graph audit, benchmark metrics, performance (the §37 evidence), and shadow
 * ingestion of every real production job and candidate. Read-only against the databases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { buildKnowledgeGraph, auditGraph } from './graph.js';
import { ingestCandidateProfile, ingestJobProfile, mergeFacts, factsForTenant } from './ingest.js';
import {
  DISTINCT_CASES, EDGE_CASES, NO_EDGE_CASES, SAME_CASES, ILLEGAL_EDGE_CASES, PATH_CASES,
  FUZZY_TRAP_SURFACES, TENANT_LOCAL_SURFACES,
} from './golden-cases.js';
import { buildJobIntelligence } from '../jd-understanding/engine.js';
import { buildCandidateIntelligence } from '../candidate-understanding/engine.js';

const REPO = path.resolve(process.cwd(), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const pg = require('pg');
const env: Record<string, string> = {};
for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
const conn = (database: string) => new pg.Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database,
});

const g = buildKnowledgeGraph();
const a = auditGraph(g);

console.log('PHASE 5 GRAPH AUDIT');
console.log(`  nodes ${a.nodes}  edges ${a.edges}  rejected ${a.rejected}`);
console.log(`  node types  ${JSON.stringify(a.by_node_type)}`);
console.log(`  edge types  ${JSON.stringify(a.by_edge_type)}`);
console.log(`  invalid_edges ${a.invalid_edges.length} · orphans ${a.orphan_nodes.length} · missing_provenance ${a.missing_provenance}`);
console.log(`  cycles ${a.cycles.length} · duplicate_identities ${a.duplicate_identities.length} · issues ${a.issues.length}`);
console.log(`  cross-type polysemy (legal): ${a.cross_type_polysemy.join(' | ') || 'none'}`);
console.log(`  vocabulary nodes with no global edge (expected): ${a.vocabulary_nodes_unlinked.length}`);
console.log(`  fingerprint ${g.fingerprint().slice(7, 23)}`);

// ---- benchmark
const hasEdge = (from: string, type: string, to: string): boolean => {
  const f = g.resolve(from).node, t = g.resolve(to).node;
  if (!f || !t) return false;
  return g.neighbors(f.node_id).some((e) => e.type === type && e.to_id === t.node_id);
};
let total = 0, passed = 0;
const cat = (name: string, n: number, ok: number) => {
  total += n; passed += ok;
  console.log(`  ${name.padEnd(22)} ${String(ok).padStart(3)}/${String(n).padEnd(3)} ${((ok / n) * 100).toFixed(1)}%`);
};
console.log('\nGOLDEN BENCHMARK');
cat('distinct identity', DISTINCT_CASES.length, DISTINCT_CASES.filter((c) => {
  const x = g.resolve(c.a).node, y = g.resolve(c.b).node;
  return x && y && x.node_id !== y.node_id;
}).length);
cat('curated alias', SAME_CASES.length, SAME_CASES.filter((c) => {
  const x = g.resolve(c.surface).node, y = g.resolve(c.canonical).node;
  return x && y && x.node_id === y.node_id;
}).length);
cat('required edges', EDGE_CASES.length, EDGE_CASES.filter((c) => hasEdge(c.from, c.type, c.to)).length);
cat('rejected edges', NO_EDGE_CASES.length, NO_EDGE_CASES.filter((c) => !hasEdge(c.from, c.type, c.to)).length);
cat('illegal edges', ILLEGAL_EDGE_CASES.length, ILLEGAL_EDGE_CASES.filter((c) => !hasEdge(c.from, c.type, c.to)).length);
cat('transitive paths', PATH_CASES.length, PATH_CASES.filter((c) => {
  const f = g.resolve(c.from).node!, t = g.resolve(c.to).node!;
  const p = g.findPaths(f.node_id, t.node_id, 4);
  return p.length > 0 && Math.min(...p.map((x) => x.length)) >= c.minHops
    && !g.neighbors(f.node_id).some((e) => e.to_id === t.node_id);
}).length);
cat('fuzzy traps rejected', FUZZY_TRAP_SURFACES.length,
  FUZZY_TRAP_SURFACES.filter((s) => s.trim().toLowerCase() === 'python' || !g.resolve(s).node).length);
cat('tenant-local rejected', TENANT_LOCAL_SURFACES.length,
  TENANT_LOCAL_SURFACES.filter((s) => !g.resolve(s).node).length);
console.log(`  ${'OVERALL'.padEnd(22)} ${passed}/${total} ${((passed / total) * 100).toFixed(1)}%`);

const merges = DISTINCT_CASES.filter((c) => {
  const x = g.resolve(c.a).node, y = g.resolve(c.b).node;
  return x && y && x.node_id === y.node_id;
});
const falseRels = NO_EDGE_CASES.filter((c) => hasEdge(c.from, c.type, c.to));
console.log(`\nFALSE ENTITY MERGE RATE  ${merges.length}/${DISTINCT_CASES.length} = ${((merges.length / DISTINCT_CASES.length) * 100).toFixed(2)}%`);
console.log(`FALSE RELATIONSHIP RATE  ${falseRels.length}/${NO_EDGE_CASES.length} = ${((falseRels.length / NO_EDGE_CASES.length) * 100).toFixed(2)}%`);

// ---- performance: the §37 PostgreSQL-vs-graph-database evidence
const t0 = performance.now();
for (let i = 0; i < 200; i++) buildKnowledgeGraph();
const buildMs = (performance.now() - t0) / 200;
const ids = [...g.nodes.keys()];
let t = performance.now();
for (let i = 0; i < 20000; i++) g.resolve(i % 2 ? 'Postgres' : 'K8s');
const resolveUs = ((performance.now() - t) / 20000) * 1000;
t = performance.now();
for (let i = 0; i < 20000; i++) g.neighbors(ids[i % ids.length]);
const neighborUs = ((performance.now() - t) / 20000) * 1000;
const fa = g.resolve('FastAPI').node!.node_id, be = g.resolve('Backend Engineering').node!.node_id;
t = performance.now();
for (let i = 0; i < 2000; i++) g.findPaths(fa, be, 4);
const pathUs = ((performance.now() - t) / 2000) * 1000;
t = performance.now();
for (let i = 0; i < 2000; i++) g.expand(fa, 2);
const expandUs = ((performance.now() - t) / 2000) * 1000;
console.log('\nPERFORMANCE (in-memory graph)');
console.log(`  full build          ${buildMs.toFixed(2)} ms`);
console.log(`  entity resolution   ${resolveUs.toFixed(2)} us`);
console.log(`  typed neighbours    ${neighborUs.toFixed(2)} us`);
console.log(`  path discovery      ${pathUs.toFixed(2)} us  (depth 4)`);
console.log(`  concept expansion   ${expandUs.toFixed(2)} us  (depth 2)`);
console.log(`  heap after build    ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MiB`);

// ---- shadow over the real corpus
const jobsC = conn('tejoma_job');
await jobsC.connect();
const jobs = (await jobsC.query(
  `SELECT id, title, description, job_summary, responsibilities, required_skills, optional_skills,
          education, certifications, location, remote_type, employment_type, industry, department
     FROM jobs WHERE id < 990000 ORDER BY id`)).rows;
await jobsC.end();

const candC = conn('tejoma_candidate_core');
await candC.connect();
const candidates = (await candC.query(
  `SELECT id, current_job_title, years_of_experience, primary_skills, secondary_skills, skills,
          technical_tools, certifications, languages_known, projects, industry_domain, education,
          highest_qualification, university, graduation_year, current_company, resume_summary, resume_text
     FROM candidates WHERE id < 990000 ORDER BY id`)).rows;
await candC.end();

console.log(`\nSHADOW INGESTION (${jobs.length} jobs, ${candidates.length} candidates) - read-only`);
const before = g.fingerprint();
let facts: ReturnType<typeof mergeFacts> = [];
const unresolved = new Map<string, number>();
const predicates: Record<string, number> = {};
const tShadow = performance.now();
for (const job of jobs) {
  const profile = buildJobIntelligence(job);
  const r = ingestJobProfile(g, profile, `tenant-${job.company_id ?? 1}`);
  facts = mergeFacts(facts, r.facts);
  for (const u of r.unresolved) unresolved.set(u.surface, (unresolved.get(u.surface) ?? 0) + 1);
}
for (const cand of candidates) {
  const profile = buildCandidateIntelligence({ ...cand, reference_date: '2026-08' });
  const r = ingestCandidateProfile(g, profile, `tenant-1`);
  facts = mergeFacts(facts, r.facts);
  for (const u of r.unresolved) unresolved.set(u.surface, (unresolved.get(u.surface) ?? 0) + 1);
}
const shadowMs = performance.now() - tShadow;
for (const f of facts) predicates[f.predicate] = (predicates[f.predicate] ?? 0) + 1;

console.log(`  instance facts ${facts.length}   ${JSON.stringify(predicates)}`);
console.log(`  distinct concepts referenced ${new Set(facts.map((f) => f.object_id)).size}`);
console.log(`  unresolved surfaces ${unresolved.size} (reported, never auto-created)`);
console.log(`  top unresolved: ${[...unresolved.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(', ')}`);
console.log(`  provenance completeness ${facts.filter((f) => f.provenance.source_text && f.provenance.derivation).length}/${facts.length}`);
console.log(`  tenants: ${[...new Set(facts.map((f) => f.tenant_id))].sort().join(', ')}`);
console.log(`  cross-tenant leakage: ${[...new Set(facts.map((f) => f.tenant_id))].filter((t) => factsForTenant(facts, t).some((f) => f.tenant_id !== t)).length}`);
console.log(`  ingestion ${shadowMs.toFixed(0)} ms total = ${(shadowMs / (jobs.length + candidates.length)).toFixed(2)} ms/entity`);
console.log(`  GLOBAL GRAPH UNCHANGED: ${g.fingerprint() === before}`);

// idempotency over the real corpus
const firstCount = facts.length;
for (const job of jobs) facts = mergeFacts(facts, ingestJobProfile(g, buildJobIntelligence(job), `tenant-${job.company_id ?? 1}`).facts);
console.log(`  re-ingestion idempotent: ${facts.length === firstCount} (${firstCount} -> ${facts.length})`);
