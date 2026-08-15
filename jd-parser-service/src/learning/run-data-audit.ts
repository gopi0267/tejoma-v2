/**
 * Phase 8 real-corpus data audit. READ-ONLY - every statement is a SELECT.
 *
 * Reads the live decision events, assembles them through the real dataset pipeline (tenant scoping,
 * replay protection, deduplication, conflict resolution), measures the resulting corpus and runs it
 * through the sufficiency gates. Nothing is written, no model is trained, no production value is
 * touched.
 *
 * Usage: npx tsx src/learning/run-data-audit.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assembleTrainingRows, computeCorpusStats, datasetVersion, temporalGroupSplit,
  type RawDecisionEvent } from './dataset.js';
import { DEFAULT_THRESHOLDS, evaluateSufficiency } from './sufficiency.js';
import { globalAuthorizedScope, singleTenantScope, verifyTenantIsolation } from './tenantGuard.js';
import { LABEL_SOURCES, OUTCOME_CAPTURE_GAPS } from './labelSources.js';

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

const c = conn('tejoma_matching_decision');
await c.connect();
const raw = (await c.query(
  `SELECT id, company_id, job_id, candidate_id, action, "timestamp"
     FROM swipes ORDER BY "timestamp", id`)).rows;
await c.end();

const events: RawDecisionEvent[] = raw.map((r: Record<string, unknown>) => ({
  event_id: r.id as number,
  tenant_id: r.company_id == null ? null : `tenant-${r.company_id}`,
  job_id: r.job_id as number,
  candidate_id: r.candidate_id as number,
  action: r.action as number,
  event_timestamp: r.timestamp ? new Date(r.timestamp as string).toISOString() : null,
}));

console.log('PHASE 8 DATA AUDIT (read-only)');
console.log(`  raw decision events: ${events.length}`);

// ---- label source register
console.log('\nLABEL SOURCE REGISTER');
for (const s of LABEL_SOURCES) {
  console.log(`  ${s.eligibility.padEnd(12)} ${(s.database + '.' + s.table).padEnd(48)} `
    + `rows=${String(s.auditedRows).padStart(5)} tenant=${s.tenantColumn ?? 'NONE'}`);
}
console.log('\nBUSINESS OUTCOME CAPTURE GAPS');
for (const g of OUTCOME_CAPTURE_GAPS) {
  console.log(`  ${g.outcome.padEnd(24)} ${g.status.padEnd(14)} nearest: ${g.nearestExisting}`);
}

// ---- per-tenant assembly, which is the only scope a request path may use
const tenants = [...new Set(events.map((e: RawDecisionEvent) => e.tenant_id).filter(Boolean))] as string[];
console.log(`\nPER-TENANT ASSEMBLY (${tenants.length} tenants observed)`);
for (const t of tenants.sort()) {
  const scope = singleTenantScope(t);
  const report = assembleTrainingRows(events, scope);
  const violations = verifyTenantIsolation(report.rows, scope);
  const stats = computeCorpusStats(report.rows, DEFAULT_THRESHOLDS.minCandidatesPerGroup, report);
  console.log(`  ${t.padEnd(14)} rows=${String(report.rows.length).padStart(4)} `
    + `jobs=${String(stats.uniqueJobs).padStart(3)} groups=${String(stats.rankingGroups).padStart(3)} `
    + `foreign_dropped=${report.droppedForeignTenant} violations=${violations.length}`);
}

// ---- whole corpus, assembled under an explicit audit authorisation
const scope = globalAuthorizedScope('PHASE8-PREFLIGHT-AUDIT-READ-ONLY');
const assembly = assembleTrainingRows(events, scope);
const violations = verifyTenantIsolation(assembly.rows, scope);
const stats = computeCorpusStats(assembly.rows, DEFAULT_THRESHOLDS.minCandidatesPerGroup, assembly);
const split = temporalGroupSplit(assembly.rows);

console.log('\nASSEMBLY (whole corpus, audit scope)');
console.log(`  rows in                 ${events.length}`);
console.log(`  dropped missing identity ${assembly.droppedMissingIdentity}`);
console.log(`  dropped unknown action   ${assembly.droppedUnknownAction}`);
console.log(`  dropped replay           ${assembly.droppedReplay}`);
console.log(`  dropped ambiguous order  ${assembly.droppedAmbiguousOrder}`);
console.log(`  superseded (duplicates)  ${assembly.supersededByConflictPolicy}`);
console.log(`  conflicting pairs        ${assembly.conflictingPairs}`);
console.log(`  training rows out        ${assembly.rows.length}`);
console.log(`  tenant violations        ${violations.length}`);
console.log(`  dataset_version          ${datasetVersion(assembly.rows, scope)}`);

console.log('\nCORPUS');
console.log(`  unique pairs      ${stats.totalPairs}`);
console.log(`  unique jobs       ${stats.uniqueJobs}`);
console.log(`  unique candidates ${stats.uniqueCandidates}`);
console.log(`  ranking groups    ${stats.rankingGroups} (>= ${DEFAULT_THRESHOLDS.minCandidatesPerGroup} candidates)`);
console.log(`  group sizes       [${stats.groupSizes.sort((a, b) => b - a).join(', ')}]`);
console.log(`  tenants           ${stats.tenants}  ${JSON.stringify(stats.rowsPerTenant)}`);
console.log(`  labels            ${JSON.stringify(stats.labelCounts)}`);
console.log(`  temporal span     ${stats.temporalSpanDays} days`);
console.log(`  split groups      train/val/test = ${split.train.length}/${split.validation.length}/${split.test.length} rows over ${split.groups} groups`);

// ---- the gate
const report = evaluateSufficiency(stats);
console.log('\nSUFFICIENCY GATES');
for (const g of report.gates) {
  console.log(`  ${(g.passed ? 'PASS' : 'FAIL').padEnd(5)} ${g.gate.padEnd(26)} `
    + `observed=${String(g.observed).padEnd(28)} requires ${g.required}`);
}
console.log(`\nCURRENT DATA SUFFICIENT: ${report.verdict === 'DATA_SUFFICIENT' ? 'YES' : 'NO'}`);
console.log(`VERDICT: ${report.verdict}`);
console.log(`TRAINING PERMITTED: ${report.training_permitted}`);
if (report.failed.length) console.log(`FAILED GATES (${report.failed.length}): ${report.failed.join(', ')}`);
