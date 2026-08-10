/**
 * Dual-write layer for the Tier 0 migration (Phase 11 section 12's methodology: backfill ->
 * dual-write -> shadow-read -> validate -> cutover -> rollback -> legacy removal). Batch 13a
 * built the one-time backfill; this is the second step - keeping each Tier 0 service's database
 * in sync with every further monolith write, so that by the time a real cutover happens, the new
 * databases are fully caught up and validate-*-sync.ts continues to report zero drift.
 *
 * HARD RULES, enforced structurally, not just by convention:
 *   1. Disabled by default (DUAL_WRITE_ENABLED must be exactly 'true'). Every exported function
 *      is a cheap no-op when disabled - merely importing/calling this module changes NOTHING
 *      about the monolith's behavior until an operator deliberately opts in.
 *   2. Never blocks the primary write. Every function is designed to be called WITHOUT `await`
 *      from db.ts (fire-and-forget) - the monolith's response to a real user must never wait on,
 *      or be endangered by, a secondary database it doesn't otherwise depend on.
 *   3. Never throws. Every function catches everything internally and logs failures at `error`
 *      level (via the existing src/utils/logger.ts) rather than letting a rejection propagate -
 *      an unhandled rejection from a fire-and-forget call would crash the process for a write the
 *      primary operation already completed successfully.
 *   4. Exact value propagation, not independent recomputation. Every timestamp/id mirrored here
 *      comes from what the PRIMARY write's own `RETURNING` clause produced (added additively to
 *      the relevant db.ts statements - never re-derived via a fresh CURRENT_TIMESTAMP on the
 *      target connection, which would drift from the source by however many milliseconds elapsed
 *      between the two writes and make validate-*-sync.ts report false mismatches forever.
 *   5. Preserves ids exactly, upserting by id (ON CONFLICT DO UPDATE) - the same reasoning
 *      backfillTable() in scripts/lib/migrationDb.ts already documents: other tables reference
 *      these ids as opaque, unconstrained integers, and the validation scripts compare rows by
 *      id, so an id mismatch would be a real correctness bug, not just cosmetic.
 *
 * Deliberately NOT hooked, with reasoning (see the Batch 13b investigation this module's
 * accompanying db.ts changes were based on):
 *   - createUser, createSuperadminUser, promoteUserToSuperadmin: no live HTTP route reaches these
 *     - operator-invoked CLI scripts only (scripts/promote-superadmin.ts,
 *     scripts/migrate-production-owner.ts). A rare, deliberate operator action is adequately
 *     covered by re-running the already-idempotent backfill scripts before an actual cutover,
 *     rather than adding dual-write plumbing to one-off scripts that aren't part of continuous
 *     request traffic.
 *   - getOrCreateCompany (called from POST /auth/signup/start): confirmed in Batch 11 that
 *     signup/start has no reachable frontend caller (its own completion endpoint,
 *     signup/complete, unconditionally returns 403) - this INSERT is technically live/reachable
 *     but produces permanently orphaned company rows with no real use. Dual-writing it would
 *     mirror garbage, not real state - same "confirmed dead code, do not propagate" reasoning
 *     Batch 11 already applied to signup/start itself.
 * Updated by Batch 16 (Candidate Service): candidate_accounts profile-column updates and
 * candidate_experiences writes now DO mirror - to Candidate Service's database, not Identity's
 * (see the "candidate_accounts (profile columns) / candidate_experiences" section below). The
 * note above about profile fields having "nothing to mirror" was true only relative to Identity
 * DB, which still only ever receives the auth-column slice (upsertCandidateAccount/
 * patchCandidateAccount, unchanged by this batch).
 * Updated by Batch 19 (Recruiting Service): recruiter_notifications writes now mirror too - see
 * the "recruiter_notifications" section below. Created from createMatchNotifications' INSERT
 * (fired from the recordSwipe/candidate-decision mutual-match path); patched from
 * markRecruiterNotificationRead/markAllRecruiterNotificationsRead's read_at updates.
 * Updated by Batch 20 (Candidate Service, extended): candidate_notifications writes now mirror
 * too - see the "candidate_notifications" section below. Lands in Candidate Service's EXISTING
 * pool/database (Batch 16), not a new one - its primary FK target, candidate_accounts, is already
 * owned there.
 * Updated by Batch 24 (Matching Evaluation Service): match_evaluation_runs and
 * ltr_model_versions writes now mirror too - see those sections below. Created from
 * db.ts's saveEvaluationRun (fired from POST /ml/evaluate) and saveLtrModelVersion (fired from
 * POST /ml/train/ranking) - both functions are otherwise unchanged.
 * Updated by Batch 26 (Matching Reasoning Service): skill_nodes/skill_edges writes now mirror too
 * - see the "skill_nodes / skill_edges" section below. Created from skillIntelligence.ts's seeding
 * and unknownSkillDiscovery.ts's promotion pipeline, both otherwise unchanged. Unlike every batch
 * above, this is NOT a "new service reads what the monolith proxies" extraction - the target
 * service (matching-reasoning-service) is called BY the monolith as a shadow-validation client
 * (src/reasoningServiceShadow.ts), the inverse direction of every prior batch's /internal/* API.
 * Updated by Batch 27 (Matching Skill Discovery Service): skill_nodes now ALSO mirrors to a second,
 * independent target database (each service owns its own isolated mirror - no cross-service DB
 * sharing). skill_edges does not gain a second target - Matching Skill Discovery Service never
 * reads it. Same inverse "monolith calls the new service" shadow-client direction as Batch 26
 * (src/skillDiscoveryServiceShadow.ts), PLUS a normal forward proxy call in the other direction
 * for the one write matching-skill-discovery-service doesn't own (src/api/
 * skill-discovery-internal.routes.ts's new /promote endpoint) - the first batch in this migration
 * with traffic flowing in both directions between the monolith and one new service.
 * Updated by Batch 28 (Matching BGE Shadow Service): bge_retrieval_shadow_comparisons was NOT
 * added here - that table was a genuine full cutover (zero reporting consumers, confirmed via
 * grep), not a mirror. Noted here only so its absence from this file isn't mistaken for an
 * oversight.
 * Updated by Batch 29 (Role Intelligence Service): role_profiles writes now mirror too - see the
 * "role_profiles" section below. Created from src/matching/roleIntelligence.ts's unchanged
 * upsertRoleProfile/updateRoleProfileEmbedding calls (fired only from the admin
 * scripts/seed-intelligence-layer.ts run, never a live route). Mirror only, not a cutover -
 * dynamicWeighting.ts/careerWeighting.ts/proficiencyWeighting.ts/recencyWeighting.ts/
 * futureRolePrediction.ts all still read role_profiles directly from the monolith's own database.
 * Updated by Batch 30 (Career Intelligence Service): role_profiles now ALSO mirrors to a THIRD,
 * independent target database (each service owns its own isolated mirror - same "no shared
 * database" fan-out pattern already established for skill_nodes across Batches 26/27). This
 * service needs its own role_profiles copy for normalizeJobSequence/resolveJobRole and
 * predictNextRoles. career_trajectories itself is NOT added here - unlike role_profiles, it is not
 * a mirror target at all (this service computes its own copy independently; see
 * career-intelligence-service/README.md and src/careerIntelligenceServiceShadow.ts).
 * Updated by Batch 31 (Matching Evaluation Service extension - the shadow-weighting cluster):
 *   - skill_nodes now mirrors to a THIRD independent target (matching-evaluation-service), needed
 *     by its own ported canonicalizeSkill (skillIntelligence.ts subset).
 *   - role_profiles now mirrors to a THIRD independent target (matching-evaluation-service),
 *     needed by its own ported findLexicalRoleMatch/resolveJobRole.
 *   - career_trajectories gains its FIRST passive mirror (matching-evaluation-service) - a genuine
 *     first for this table. Unlike career-intelligence-service's independently-computed copy
 *     (Batch 30, populated only via shadow trigger and therefore sparse), this mirror needs the
 *     monolith's real, fully-populated table, because careerWeighting.ts's ported copy reads it
 *     via a plain `db.getCareerTrajectory()` lookup exactly like the monolith's original - a
 *     sparse/independent copy would silently under-serve most candidates. See the
 *     "career_trajectories (plain mirror)" section below.
 *   - reasoning_conclusions gains its FIRST passive mirror (matching-evaluation-service), for the
 *     same reason - matching-reasoning-service's own copy (Batch 26) is independently computed via
 *     shadow trigger and sparse; reasoningWeighting.ts needs the monolith's real, complete table.
 *     Unlike every mirror above, this table is written via transactional delete+insert (a "replace"
 *     of the full row-set per subject), not per-id upsert - see the new `replaceWrite` helper and
 *     the "reasoning_conclusions (replace mirror)" section below.
 * Updated by Batch 33 (Dynamic Weighting / Explainable Matching Service): skill_nodes and
 * role_profiles each gain a FOURTH independent mirror target, and skill_edges gains a SECOND
 * (alongside matching-reasoning-service's own, Batch 26) - needed by this service's own ported
 * computeDynamicSkillScore/hybridRetrieveCandidates graph expansion. Unlike every prior batch,
 * this one has no shadow client and nothing calling it live - see
 * dynamic-weighting-service/README.md's "no trigger to swap at all" section.
 * Updated by the full-migration batch (Job Service): jobs now mirrors to a new, independent
 * target - createJob/updateJob/deleteJob all fan out. job.routes.ts's own scoring-fused endpoints
 * are unchanged; this is a plain data mirror only, following the same "check real consumers first"
 * discipline as every prior table (job.routes.ts, swipe.routes.ts, recruiter-review.routes.ts, and
 * candidate-search/analytics all still read `jobs` directly from the monolith's own database, so
 * this is NOT a cutover - see job-service/README.md).
 * Updated by the full-migration batch (Candidate Core Service): candidates now mirrors to a new,
 * independent target - createCandidate/updateCandidate/deleteCandidate all fan out. Same plain-
 * mirror, not-a-cutover shape as jobs above, for the identical reason (candidate.routes.ts,
 * swipe.routes.ts, recruiter-review.routes.ts, candidate-search.routes.ts, upload.routes.ts, and
 * the live-scoring engine all still read `candidates` directly - see candidate-core-service/
 * README.md).
 * Updated by the full-migration batch (Matching Decision Service): swipes, recruiter_notes, and
 * detailed_scoring_reports now mirror to a new, independent target - recordSwipe/
 * upsertRecruiterNote/upsertDetailedScoringReport all fan out. Deliberately does NOT touch the
 * live-scoring engine itself (services.ts/matchingApi.ts) or the request-time decision logic in
 * swipe.routes.ts/recruiter-review.routes.ts - only the already-recorded OUTCOME rows are
 * mirrored (see matching-decision-service/README.md).
 */
import pkg from 'pg';
import { logger } from './utils/logger.js';

const { Pool } = pkg;
type Pool = InstanceType<typeof pkg.Pool>;

export const DUAL_WRITE_ENABLED = process.env.DUAL_WRITE_ENABLED === 'true';

if (process.env.DUAL_WRITE_ENABLED !== undefined && !DUAL_WRITE_ENABLED) {
  logger.info('DUAL_WRITE_ENABLED is set but not "true" - dual-write stays OFF (this is the safe default).');
}

const CONNECT_TIMEOUT_MS = 3000;
const STATEMENT_TIMEOUT_MS = 5000;

function makePool(dbName: string): Pool {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: dbName,
    user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD || ''),
    max: 5,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
}

// Lazy - never opened unless DUAL_WRITE_ENABLED is actually true, so the default (off) state
// opens zero extra connections to any target database.
let identityPool: Pool | null = null;
let tenantDirectoryPool: Pool | null = null;
let platformGovernancePool: Pool | null = null;
let candidateServicePool: Pool | null = null;
let chatServicePool: Pool | null = null;
let recruitingServicePool: Pool | null = null;
let matchingEvaluationServicePool: Pool | null = null;
let matchingReasoningServicePool: Pool | null = null;
let matchingSkillDiscoveryServicePool: Pool | null = null;
let roleIntelligenceServicePool: Pool | null = null;
let careerIntelligenceServicePool: Pool | null = null;
let dynamicWeightingServicePool: Pool | null = null;
let jobServicePool: Pool | null = null;
let candidateCoreServicePool: Pool | null = null;
let matchingDecisionServicePool: Pool | null = null;
let uploadServicePool: Pool | null = null;
let resumeServicePool: Pool | null = null;
let notificationsServicePool: Pool | null = null;

function getIdentityPool(): Pool {
  if (!identityPool) identityPool = makePool(process.env.IDENTITY_DB_NAME || 'tejoma_identity');
  return identityPool;
}
function getTenantDirectoryPool(): Pool {
  if (!tenantDirectoryPool) tenantDirectoryPool = makePool(process.env.TENANT_DIRECTORY_DB_NAME || 'tejoma_tenant_directory');
  return tenantDirectoryPool;
}
function getPlatformGovernancePool(): Pool {
  if (!platformGovernancePool) platformGovernancePool = makePool(process.env.PLATFORM_GOVERNANCE_DB_NAME || 'tejoma_platform_governance');
  return platformGovernancePool;
}
function getCandidateServicePool(): Pool {
  if (!candidateServicePool) candidateServicePool = makePool(process.env.CANDIDATE_SERVICE_DB_NAME || 'tejoma_candidate');
  return candidateServicePool;
}
function getChatServicePool(): Pool {
  if (!chatServicePool) chatServicePool = makePool(process.env.CHAT_SERVICE_DB_NAME || 'tejoma_chat');
  return chatServicePool;
}
function getRecruitingServicePool(): Pool {
  if (!recruitingServicePool) recruitingServicePool = makePool(process.env.RECRUITING_SERVICE_DB_NAME || 'tejoma_recruiting_service');
  return recruitingServicePool;
}
function getMatchingEvaluationServicePool(): Pool {
  if (!matchingEvaluationServicePool) matchingEvaluationServicePool = makePool(process.env.MATCHING_EVALUATION_SERVICE_DB_NAME || 'tejoma_matching_evaluation');
  return matchingEvaluationServicePool;
}
function getMatchingReasoningServicePool(): Pool {
  if (!matchingReasoningServicePool) matchingReasoningServicePool = makePool(process.env.MATCHING_REASONING_SERVICE_DB_NAME || 'tejoma_matching_reasoning');
  return matchingReasoningServicePool;
}
function getMatchingSkillDiscoveryServicePool(): Pool {
  if (!matchingSkillDiscoveryServicePool) matchingSkillDiscoveryServicePool = makePool(process.env.MATCHING_SKILL_DISCOVERY_SERVICE_DB_NAME || 'tejoma_matching_skill_discovery');
  return matchingSkillDiscoveryServicePool;
}
function getRoleIntelligenceServicePool(): Pool {
  if (!roleIntelligenceServicePool) roleIntelligenceServicePool = makePool(process.env.ROLE_INTELLIGENCE_SERVICE_DB_NAME || 'tejoma_role_intelligence');
  return roleIntelligenceServicePool;
}
function getCareerIntelligenceServicePool(): Pool {
  if (!careerIntelligenceServicePool) careerIntelligenceServicePool = makePool(process.env.CAREER_INTELLIGENCE_SERVICE_DB_NAME || 'tejoma_career_intelligence');
  return careerIntelligenceServicePool;
}
function getDynamicWeightingServicePool(): Pool {
  if (!dynamicWeightingServicePool) dynamicWeightingServicePool = makePool(process.env.DYNAMIC_WEIGHTING_SERVICE_DB_NAME || 'tejoma_dynamic_weighting');
  return dynamicWeightingServicePool;
}
function getJobServicePool(): Pool {
  if (!jobServicePool) jobServicePool = makePool(process.env.JOB_SERVICE_DB_NAME || 'tejoma_job');
  return jobServicePool;
}
function getCandidateCoreServicePool(): Pool {
  if (!candidateCoreServicePool) candidateCoreServicePool = makePool(process.env.CANDIDATE_CORE_SERVICE_DB_NAME || 'tejoma_candidate_core');
  return candidateCoreServicePool;
}
function getMatchingDecisionServicePool(): Pool {
  if (!matchingDecisionServicePool) matchingDecisionServicePool = makePool(process.env.MATCHING_DECISION_SERVICE_DB_NAME || 'tejoma_matching_decision');
  return matchingDecisionServicePool;
}

// Phase 2 services
function getUploadServicePool(): Pool {
  if (!uploadServicePool) uploadServicePool = makePool(process.env.UPLOAD_SERVICE_DB_NAME || 'tejoma_uploads');
  return uploadServicePool;
}
function getResumeServicePool(): Pool {
  if (!resumeServicePool) resumeServicePool = makePool(process.env.RESUME_SERVICE_DB_NAME || 'tejoma_resume');
  return resumeServicePool;
}
function getNotificationsServicePool(): Pool {
  if (!notificationsServicePool) notificationsServicePool = makePool(process.env.NOTIFICATIONS_SERVICE_DB_NAME || 'tejoma_notifications');
  return notificationsServicePool;
}

/**
 * A single global FIFO queue every dual-write operation funnels through - not just for "never
 * throw, always log," but to fix a real ordering bug found while verifying this batch: two
 * fire-and-forget writes issued back-to-back on the primary path (e.g. createRefreshToken's
 * INSERT immediately followed by revokeRefreshTokenByHash's UPDATE, as happens in a real
 * theft-detection or logout flow) are otherwise two independent, unawaited promises racing
 * against the same target pool - nothing guarantees the UPDATE's query actually reaches Postgres
 * after the INSERT's does, and an UPDATE that lands first simply matches zero rows and silently
 * no-ops, leaving the target permanently missing that revocation. Chaining every write onto one
 * tail promise guarantees strict issuance-order execution without ever requiring the PRIMARY
 * caller (db.ts) to await anything - only the dual-write operations serialize relative to each
 * other, never relative to the request path they're mirroring.
 */
let writeQueueTail: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  writeQueueTail = writeQueueTail.then(fn, fn);
}

function safeWrite(target: Pool, label: string, sql: string, params: unknown[]): void {
  if (!DUAL_WRITE_ENABLED) return;
  enqueue(async () => {
    try {
      await target.query(sql, params);
    } catch (error: any) {
      logger.error({ err: error?.message, label }, 'Dual-write failed - target database is now behind the monolith for this row. Re-run the matching backfill script before cutover.');
    }
  });
}

function upsertSql(table: string, columns: string[], conflictColumn = 'id'): string {
  const columnList = columns.join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns.filter((c) => c !== conflictColumn).map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  return `INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updateSet}`;
}

/**
 * For the many db.ts functions that update only a handful of columns on an already-backfilled
 * row (a password reset, a status toggle, a last-login timestamp) - mirrors exactly those columns
 * rather than requiring the caller to assemble a full row just to call an upsert. `fields` values
 * must already be the PRIMARY write's own RETURNING result (or, for id-only parameters the caller
 * already had, the exact value passed to the primary write) - never independently recomputed.
 */
function patchWrite(target: Pool, label: string, table: string, id: number, fields: Record<string, unknown>): void {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  safeWrite(target, label, `UPDATE ${table} SET ${setClause} WHERE id = $${columns.length + 1}`, [...columns.map((c) => fields[c]), id]);
}

/**
 * For tables where the PRIMARY write's own semantics are "replace the full row-set for one
 * subject" (a transactional DELETE-then-INSERT), not a per-row upsert - reasoning_conclusions is
 * the only table in this migration shaped that way (see db.ts's replaceReasoningConclusions). One
 * enqueued task per call, wrapped in its own transaction on the target pool, mirroring the
 * primary's exact transaction shape.
 */
function replaceWrite(target: Pool, label: string, table: string, subjectColumns: Record<string, unknown>, rowsColumns: string[], rows: Record<string, unknown>[]): void {
  if (!DUAL_WRITE_ENABLED) return;
  enqueue(async () => {
    const client = await target.connect();
    try {
      await client.query('BEGIN');
      const whereClause = Object.keys(subjectColumns).map((c, i) => `${c} = $${i + 1}`).join(' AND ');
      const whereParams = Object.values(subjectColumns);
      await client.query(`DELETE FROM ${table} WHERE ${whereClause}`, whereParams);
      for (const row of rows) {
        const columnList = rowsColumns.join(', ');
        const placeholders = rowsColumns.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`, rowsColumns.map((c) => row[c]));
      }
      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error({ err: error?.message, label }, 'Dual-write (replace) failed - target database is now behind the monolith for this subject. Re-run the matching backfill script before cutover.');
    } finally {
      client.release();
    }
  });
}

// ==================== users ====================

export function upsertUser(row: {
  id: number; email: string | null; password_hash: string; company_id: number; role: string;
  is_active: boolean; name: string; created_at: Date | string; updated_at: Date | string; phone: string | null;
  deleted_at: Date | string | null; created_by: number | null; updated_by: number | null;
  disabled_by: number | null; password_reset_by: number | null; last_login_at: Date | string | null;
}): void {
  const columns = ['id', 'email', 'password_hash', 'company_id', 'role', 'is_active', 'name', 'created_at', 'updated_at', 'phone', 'deleted_at', 'created_by', 'updated_by', 'disabled_by', 'password_reset_by', 'last_login_at'];
  safeWrite(getIdentityPool(), 'upsertUser', upsertSql('users', columns), columns.map((c) => (row as any)[c]));
}

/** For password/status/detail updates that touch only a few columns on an already-existing row - see patchWrite's doc comment. */
export function patchUser(id: number, fields: Record<string, unknown>): void {
  patchWrite(getIdentityPool(), 'patchUser', 'users', id, fields);
}

// ==================== refresh_tokens (leaf table - only ever created/revoked, never updated otherwise) ====================

export function upsertRefreshToken(row: { id: number; user_id: number; token_hash: string; user_agent: string | null; ip_address: string | null; created_at: Date | string; expires_at: Date | string; revoked_at: Date | string | null; remember: boolean }): void {
  const columns = ['id', 'user_id', 'token_hash', 'user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'remember'];
  safeWrite(getIdentityPool(), 'upsertRefreshToken', upsertSql('refresh_tokens', columns), columns.map((c) => (row as any)[c]));
}

export function revokeRefreshTokens(rows: { id: number; revoked_at: Date | string }[]): void {
  for (const row of rows) {
    safeWrite(getIdentityPool(), 'revokeRefreshTokens', 'UPDATE refresh_tokens SET revoked_at = $1 WHERE id = $2', [row.revoked_at, row.id]);
  }
}

// ==================== password_history ====================

export function upsertPasswordHistory(row: { id: number; user_id: number; password_hash: string; created_at: Date | string }): void {
  const columns = ['id', 'user_id', 'password_hash', 'created_at'];
  safeWrite(getIdentityPool(), 'upsertPasswordHistory', upsertSql('password_history', columns), columns.map((c) => (row as any)[c]));
}

/** Mirrors the monolith's own "keep only the most recent N per user" pruning (src/db.ts's addPasswordHistory), so the target doesn't silently accumulate rows the source has already pruned. */
export function prunePasswordHistory(userId: number, keepLimit: number): void {
  safeWrite(
    getIdentityPool(),
    'prunePasswordHistory',
    `DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
     )`,
    [userId, keepLimit]
  );
}

// ==================== candidate_accounts (auth columns only) ====================

export function upsertCandidateAccount(row: { id: number; name: string; email: string | null; phone: string | null; password_hash: string; is_active: boolean; deleted_at: Date | string | null; created_at: Date | string; updated_at: Date | string }): void {
  const columns = ['id', 'name', 'email', 'phone', 'password_hash', 'is_active', 'deleted_at', 'created_at', 'updated_at'];
  safeWrite(getIdentityPool(), 'upsertCandidateAccount', upsertSql('candidate_accounts', columns), columns.map((c) => (row as any)[c]));
}

/** For password-hash updates and the one profile field (name) Identity DB also owns - see patchWrite's doc comment. Only ever called with `name` when db.ts's updateCandidateProfile actually touched that column. */
export function patchCandidateAccount(id: number, fields: Record<string, unknown>): void {
  patchWrite(getIdentityPool(), 'patchCandidateAccount', 'candidate_accounts', id, fields);
}

// ==================== candidate_refresh_tokens ====================

export function upsertCandidateRefreshToken(row: { id: number; candidate_id: number; token_hash: string; user_agent: string | null; ip_address: string | null; created_at: Date | string; expires_at: Date | string; revoked_at: Date | string | null; remember: boolean }): void {
  const columns = ['id', 'candidate_id', 'token_hash', 'user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'remember'];
  safeWrite(getIdentityPool(), 'upsertCandidateRefreshToken', upsertSql('candidate_refresh_tokens', columns), columns.map((c) => (row as any)[c]));
}

export function revokeCandidateRefreshTokens(rows: { id: number; revoked_at: Date | string }[]): void {
  for (const row of rows) {
    safeWrite(getIdentityPool(), 'revokeCandidateRefreshTokens', 'UPDATE candidate_refresh_tokens SET revoked_at = $1 WHERE id = $2', [row.revoked_at, row.id]);
  }
}

// ==================== companies ====================

export function upsertCompany(row: { id: number; name: string; industry: string | null; plan: string; seats_limit: number; is_active: boolean; created_at: Date | string; updated_at: Date | string; company_slug: string; logo_url: string | null; website: string | null }): void {
  const columns = ['id', 'name', 'industry', 'plan', 'seats_limit', 'is_active', 'created_at', 'updated_at', 'company_slug', 'logo_url', 'website'];
  safeWrite(getTenantDirectoryPool(), 'upsertCompany', upsertSql('companies', columns), columns.map((c) => (row as any)[c]));
}

// ==================== company_registration_requests ====================

export function upsertCompanyRegistrationRequest(row: {
  id: number; company_name: string; company_website: string | null; industry: string | null; company_size: string | null;
  business_email: string; company_phone: string | null; country: string | null; state: string | null; city: string | null;
  address: string | null; admin_name: string; admin_email: string; admin_phone: string | null; password_hash: string;
  status: string; review_notes: string | null; reviewed_by: number | null; reviewed_at: Date | string | null;
  resulting_company_id: number | null; resulting_user_id: number | null; created_at: Date | string; updated_at: Date | string;
}): void {
  const columns = [
    'id', 'company_name', 'company_website', 'industry', 'company_size', 'business_email', 'company_phone',
    'country', 'state', 'city', 'address', 'admin_name', 'admin_email', 'admin_phone', 'password_hash',
    'status', 'review_notes', 'reviewed_by', 'reviewed_at', 'resulting_company_id', 'resulting_user_id',
    'created_at', 'updated_at',
  ];
  safeWrite(getPlatformGovernancePool(), 'upsertCompanyRegistrationRequest', upsertSql('company_registration_requests', columns), columns.map((c) => (row as any)[c]));
}

// ==================== candidate_accounts (profile columns) / candidate_experiences ====================
// Batch 16 (Candidate Service). Target is a DIFFERENT database than Identity's own
// candidate_accounts mirror above - Candidate Service's copy carries the FULL row (same
// convention Identity's upsertCandidateAccount already uses: the whole row is mirrored, even
// though this service's application code only ever reads/writes the profile-column slice of it -
// see candidate-service/README.md's "What this service owns vs. proxies").

const CANDIDATE_ACCOUNT_PROFILE_COLUMNS = [
  'id', 'name', 'email', 'phone', 'password_hash', 'is_active', 'deleted_at',
  'headline', 'skills', 'years_of_experience', 'location', 'education', 'summary',
  'created_at', 'updated_at', 'onboarding_completed_at', 'current_company', 'certifications',
  'tools', 'languages', 'notice_period', 'current_ctc', 'expected_ctc', 'open_to_work',
  'visible_to_recruiters', 'course_name', 'course_type', 'specialization', 'institution_name',
  'start_year', 'end_year', 'grading_system', 'grade_value', 'primary_skill', 'secondary_skills',
  'resume_file_path', 'resume_original_filename', 'resume_file_uploaded_at', 'current_job_title',
  'projects', 'linkedin_url', 'github_url',
];

/** Full-row mirror, called alongside upsertCandidateAccount on candidate account creation. */
export function upsertCandidateAccountProfile(row: Record<string, unknown>): void {
  const columns = CANDIDATE_ACCOUNT_PROFILE_COLUMNS.filter((c) => c in row);
  safeWrite(getCandidateServicePool(), 'upsertCandidateAccountProfile', upsertSql('candidate_accounts', columns), columns.map((c) => row[c]));
}

/** For any profile-column update (headline, skills, CTC, onboarding, resume-file pointer, ...) - see patchWrite's doc comment. Mirrors whatever columns actually changed, generically. */
export function patchCandidateAccountProfile(id: number, fields: Record<string, unknown>): void {
  patchWrite(getCandidateServicePool(), 'patchCandidateAccountProfile', 'candidate_accounts', id, fields);
}

const CANDIDATE_EXPERIENCE_COLUMNS = [
  'id', 'candidate_account_id', 'job_title', 'company', 'employment_type', 'experience_years',
  'experience_months', 'current_ctc', 'expected_ctc', 'notice_period', 'current_location',
  'preferred_location', 'key_responsibilities', 'skills_used', 'created_at', 'updated_at',
];

/** Upsert-by-id covers both create and update with one function, per the same convention every other upsert* here already uses. */
export function upsertCandidateExperience(row: Record<string, unknown>): void {
  const columns = CANDIDATE_EXPERIENCE_COLUMNS.filter((c) => c in row);
  safeWrite(getCandidateServicePool(), 'upsertCandidateExperience', upsertSql('candidate_experiences', columns), columns.map((c) => row[c]));
}

export function deleteCandidateExperienceMirror(id: number): void {
  safeWrite(getCandidateServicePool(), 'deleteCandidateExperienceMirror', 'DELETE FROM candidate_experiences WHERE id = $1', [id]);
}

// ==================== candidate_notifications ====================
// Batch 20. Same target pool as candidate_accounts/candidate_experiences above -
// candidate_notifications lives in Candidate Service's existing database, not a new service, since
// its primary FK target (candidate_accounts) is already owned there (see candidate-service/
// migrations/002_candidate_notifications.up.sql's header comment). match_id/job_id have no FK on
// the target - upsertSql's generic column-list approach handles that transparently.

export function upsertCandidateNotification(row: { id: number; candidate_account_id: number; match_id: number | null; type: string; title: string; message: string; read_at: Date | string | null; created_at: Date | string; job_id: number | null }): void {
  const columns = ['id', 'candidate_account_id', 'match_id', 'type', 'title', 'message', 'read_at', 'created_at', 'job_id'];
  safeWrite(getCandidateServicePool(), 'upsertCandidateNotification', upsertSql('candidate_notifications', columns), columns.map((c) => (row as any)[c]));
}

/** For read_at updates (markCandidateNotificationRead/markAllCandidateNotificationsRead) - see patchWrite's doc comment. */
export function patchCandidateNotification(id: number, fields: Record<string, unknown>): void {
  patchWrite(getCandidateServicePool(), 'patchCandidateNotification', 'candidate_notifications', id, fields);
}

// ==================== match_evaluation_runs / ltr_model_versions ====================
// Batch 24 (Matching Evaluation Service). match_evaluation_runs.company_id has no FK on the
// target (matching-evaluation-service/migrations/001_initial_schema.up.sql's header comment).
// ltr_model_versions has no company scoping at all (pooled training, same as the monolith's own
// ensemble). Both are insert-only from the monolith's side (no update/delete path exists for
// either row today), so only upsert functions are needed - no patch counterpart.

export function upsertMatchEvaluationRun(row: { id: number; company_id: number; evaluated_at: Date | string; jobs_evaluated: number; swipes_evaluated: number; k: number; ndcg_at_k: number | null; map_at_k: number | null; mrr: number | null; precision_at_k: number | null; recall_at_k: number | null; data_volume_note: string | null }): void {
  const columns = ['id', 'company_id', 'evaluated_at', 'jobs_evaluated', 'swipes_evaluated', 'k', 'ndcg_at_k', 'map_at_k', 'mrr', 'precision_at_k', 'recall_at_k', 'data_volume_note'];
  safeWrite(getMatchingEvaluationServicePool(), 'upsertMatchEvaluationRun', upsertSql('match_evaluation_runs', columns), columns.map((c) => (row as any)[c]));
}

export function upsertLtrModelVersion(row: { id: number; version: string; algorithm: string; training_examples: number; training_groups: number; ndcg_at_10: number | null; trained_at: Date | string; is_active: boolean }): void {
  const columns = ['id', 'version', 'algorithm', 'training_examples', 'training_groups', 'ndcg_at_10', 'trained_at', 'is_active'];
  safeWrite(getMatchingEvaluationServicePool(), 'upsertLtrModelVersion', upsertSql('ltr_model_versions', columns), columns.map((c) => (row as any)[c]));
}

// ==================== skill_nodes / skill_edges ====================
// Batch 26 (Matching Reasoning Service), extended Batch 27 (Matching Skill Discovery Service) -
// skill_nodes now mirrors to TWO independent target databases (each service owns its own mirror,
// per the "no shared database" requirement - see matching-skill-discovery-service/README.md).
// skill_edges mirrors to Matching Reasoning Service only - Matching Skill Discovery Service never
// reads skill_edges (findNearestNeighbors/canonicalizeSkill only need skill_nodes), so mirroring it
// there too would be an unused table, not a real requirement.
//
// Within the Reasoning Service's own database, skill_edges keeps its real FK to skill_nodes(id) on
// the target side too (matching-reasoning-service/migrations/001_initial_schema.up.sql's header
// comment) - both tables mirror together into that SAME database. embedding/aliases are native
// Postgres array columns (DOUBLE PRECISION[]/TEXT[]), not JSONB - a bare JS array is the correct
// parameter shape for those (unlike a JSONB column holding an array, which needs explicit
// JSON.stringify - see scripts/backfill-matching-evaluation-service.ts's Batch 25 fix for that
// other case).

export function upsertSkillNode(row: {
  id: number; canonical_name: string; category: string; technology_domain: string | null;
  aliases: string[]; popularity_score: number; confidence: number; is_deprecated: boolean;
  is_emerging: boolean; source: string; embedding: number[] | null; created_at: Date | string; updated_at: Date | string;
}): void {
  const columns = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];
  const values = columns.map((c) => (row as any)[c]);
  safeWrite(getMatchingReasoningServicePool(), 'upsertSkillNode', upsertSql('skill_nodes', columns), values);
  safeWrite(getMatchingSkillDiscoveryServicePool(), 'upsertSkillNodeForSkillDiscoveryService', upsertSql('skill_nodes', columns), values);
  safeWrite(getMatchingEvaluationServicePool(), 'upsertSkillNodeForMatchingEvaluationService', upsertSql('skill_nodes', columns), values);
  safeWrite(getDynamicWeightingServicePool(), 'upsertSkillNodeForDynamicWeightingService', upsertSql('skill_nodes', columns), values);
}

/** For popularity_score/embedding updates that touch only a couple columns on an already-backfilled node - see patchWrite's doc comment. */
export function patchSkillNode(id: number, fields: Record<string, unknown>): void {
  patchWrite(getMatchingReasoningServicePool(), 'patchSkillNode', 'skill_nodes', id, fields);
  patchWrite(getMatchingSkillDiscoveryServicePool(), 'patchSkillNodeForSkillDiscoveryService', 'skill_nodes', id, fields);
  patchWrite(getMatchingEvaluationServicePool(), 'patchSkillNodeForMatchingEvaluationService', 'skill_nodes', id, fields);
  patchWrite(getDynamicWeightingServicePool(), 'patchSkillNodeForDynamicWeightingService', 'skill_nodes', id, fields);
}

export function upsertSkillEdge(row: { id: number; from_skill_id: number; to_skill_id: number; relationship_type: string; weight: number; source: string; created_at: Date | string }): void {
  const columns = ['id', 'from_skill_id', 'to_skill_id', 'relationship_type', 'weight', 'source', 'created_at'];
  const values = columns.map((c) => (row as any)[c]);
  safeWrite(getMatchingReasoningServicePool(), 'upsertSkillEdge', upsertSql('skill_edges', columns), values);
  safeWrite(getDynamicWeightingServicePool(), 'upsertSkillEdgeForDynamicWeightingService', upsertSql('skill_edges', columns), values);
}

// ==================== proficiency_shadow_scores ====================
// Batch 25 (Matching Evaluation Service extension). Append-only event log - the monolith's own
// insertProficiencyShadowScore never updates/deletes a row, so only an upsert function is needed.
// company_id/candidate_id have no FK on the target (cross-service, matching-evaluation-service/
// migrations/002_shadow_scores.up.sql's header comment).
export function upsertProficiencyShadowScore(row: {
  id: number;
  company_id: number;
  candidate_id: number;
  job_id: number;
  base_match_score: number;
  proficiency_adjusted_score: number;
  overall_multiplier: number;
  skill_multipliers: unknown;
  computed_at: Date | string;
  decision_action: number | null;
  career_multiplier: number | null;
  career_progression_signal: number | null;
  career_stability_signal: number | null;
  career_domain_signal: number | null;
  career_adjusted_score: number | null;
  career_progression_type: string | null;
  recency_multiplier: number | null;
  recency_adjusted_score: number | null;
  recency_role_expectation: string | null;
  recency_skill_multipliers: unknown;
  reasoning_multiplier: number | null;
  reasoning_density_signal: number | null;
  reasoning_coverage_signal: number | null;
  reasoning_quality_signal: number | null;
  reasoning_adjusted_score: number | null;
  reasoning_covered_domains: unknown;
  reasoning_uncovered_domains: unknown;
}): void {
  const columns = [
    'id', 'company_id', 'candidate_id', 'job_id', 'base_match_score', 'proficiency_adjusted_score',
    'overall_multiplier', 'skill_multipliers', 'computed_at', 'decision_action', 'career_multiplier',
    'career_progression_signal', 'career_stability_signal', 'career_domain_signal',
    'career_adjusted_score', 'career_progression_type', 'recency_multiplier', 'recency_adjusted_score',
    'recency_role_expectation', 'recency_skill_multipliers', 'reasoning_multiplier',
    'reasoning_density_signal', 'reasoning_coverage_signal', 'reasoning_quality_signal',
    'reasoning_adjusted_score', 'reasoning_covered_domains', 'reasoning_uncovered_domains',
  ];
  const jsonColumns = new Set(['skill_multipliers', 'recency_skill_multipliers', 'reasoning_covered_domains', 'reasoning_uncovered_domains']);
  const values = columns.map((c) => {
    const v = (row as any)[c];
    return jsonColumns.has(c) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  });
  safeWrite(getMatchingEvaluationServicePool(), 'upsertProficiencyShadowScore', upsertSql('proficiency_shadow_scores', columns), values);
}

// ==================== knowledge_base_chunks ====================
// Batch 17 (Chat Service). company_id has no FK on the target (chat-service/migrations/
// 001_initial_schema.up.sql's header comment) - upsertSql's generic column-list approach handles
// that transparently, it doesn't know or care about constraints on the target table.

export function upsertKnowledgeChunk(row: { id: number; company_id: number | null; source_type: string; source_id: number; content: string; embedding: number[]; created_at: Date | string; updated_at: Date | string }): void {
  const columns = ['id', 'company_id', 'source_type', 'source_id', 'content', 'embedding', 'created_at', 'updated_at'];
  safeWrite(getChatServicePool(), 'upsertKnowledgeChunk', upsertSql('knowledge_base_chunks', columns), columns.map((c) => (row as any)[c]));
}

export function deleteKnowledgeChunkMirror(sourceType: string, sourceId: number): void {
  safeWrite(getChatServicePool(), 'deleteKnowledgeChunkMirror', 'DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, sourceId]);
}

// ==================== recruiter_notifications ====================
// Batch 19 (Recruiting Service). user_id/company_id/match_id have no FK on the target
// (recruiting-service/migrations/001_initial_schema.up.sql's header comment) - upsertSql's
// generic column-list approach handles that transparently, it doesn't know or care about
// constraints on the target table.

export function upsertRecruiterNotification(row: { id: number; user_id: number; company_id: number; match_id: number; type: string; title: string; message: string; read_at: Date | string | null; created_at: Date | string }): void {
  const columns = ['id', 'user_id', 'company_id', 'match_id', 'type', 'title', 'message', 'read_at', 'created_at'];
  safeWrite(getRecruitingServicePool(), 'upsertRecruiterNotification', upsertSql('recruiter_notifications', columns), columns.map((c) => (row as any)[c]));
}

/** For read_at updates (markRecruiterNotificationRead/markAllRecruiterNotificationsRead) - see patchWrite's doc comment. */
export function patchRecruiterNotification(id: number, fields: Record<string, unknown>): void {
  patchWrite(getRecruitingServicePool(), 'patchRecruiterNotification', 'recruiter_notifications', id, fields);
}

// ==================== role_profiles ====================
// Batch 29 (Role Intelligence Service). Mirror only, NOT a full ownership transfer - unlike
// bge_retrieval_shadow_comparisons (Batch 28), role_profiles has real, live (if background)
// readers still on the monolith (dynamicWeighting.ts, careerWeighting.ts, proficiencyWeighting.ts,
// recencyWeighting.ts, careerIntelligence/futureRolePrediction.ts all call
// db.getAllRoleProfiles() directly), so the monolith's own copy must stay fully populated. No FK
// on this table in the monolith's own schema.sql - nothing to drop on the target side either.
// embedding is a native Postgres array column (DOUBLE PRECISION[]), not JSONB - a bare JS array is
// the correct parameter shape here, same reasoning as skill_nodes.embedding.

export function upsertRoleProfile(row: {
  id: number; role_key: string; display_name: string; mandatory_skills: string[]; preferred_skills: string[];
  optional_skills: string[]; common_tools: string[]; typical_responsibilities: string[]; preferred_certifications: string[];
  experience_band_min: number | null; experience_band_max: number | null; related_roles: string[]; career_progression: string[];
  embedding: number[] | null; source: string; created_at: Date | string; updated_at: Date | string;
}): void {
  const columns = ['id', 'role_key', 'display_name', 'mandatory_skills', 'preferred_skills', 'optional_skills', 'common_tools', 'typical_responsibilities', 'preferred_certifications', 'experience_band_min', 'experience_band_max', 'related_roles', 'career_progression', 'embedding', 'source', 'created_at', 'updated_at'];
  const values = columns.map((c) => (row as any)[c]);
  safeWrite(getRoleIntelligenceServicePool(), 'upsertRoleProfile', upsertSql('role_profiles', columns), values);
  safeWrite(getCareerIntelligenceServicePool(), 'upsertRoleProfileForCareerIntelligenceService', upsertSql('role_profiles', columns), values);
  safeWrite(getMatchingEvaluationServicePool(), 'upsertRoleProfileForMatchingEvaluationService', upsertSql('role_profiles', columns), values);
  safeWrite(getDynamicWeightingServicePool(), 'upsertRoleProfileForDynamicWeightingService', upsertSql('role_profiles', columns), values);
}

/** For embedding-only updates (updateRoleProfileEmbedding) - see patchWrite's doc comment. */
export function patchRoleProfile(id: number, fields: Record<string, unknown>): void {
  patchWrite(getRoleIntelligenceServicePool(), 'patchRoleProfile', 'role_profiles', id, fields);
  patchWrite(getCareerIntelligenceServicePool(), 'patchRoleProfileForCareerIntelligenceService', 'role_profiles', id, fields);
  patchWrite(getMatchingEvaluationServicePool(), 'patchRoleProfileForMatchingEvaluationService', 'role_profiles', id, fields);
  patchWrite(getDynamicWeightingServicePool(), 'patchRoleProfileForDynamicWeightingService', 'role_profiles', id, fields);
}

// ==================== career_trajectories (plain mirror, Batch 31) ====================
// Unlike career-intelligence-service's independently-computed copy (Batch 30), this is a passive,
// upsert-by-id mirror of the monolith's own real, fully-populated table - matching-evaluation-
// service's ported careerWeighting.ts needs a real, complete copy (see this file's header comment).

export function upsertCareerTrajectory(row: {
  id: number; candidate_id: number; company_id: number; job_sequence: unknown; total_career_months: number | null;
  role_count: number | null; progression_type: string | null; seniority_level: string | null; seniority_trend: string | null;
  transitions: unknown; avg_tenure_months: number | null; median_tenure_months: number | null; tenure_pattern: string | null;
  gaps: unknown; domain_concentration: number | null; domains: unknown; trajectory_embedding: number[] | null;
  predicted_next_roles: unknown; created_at: Date | string; updated_at: Date | string;
}): void {
  const columns = ['id', 'candidate_id', 'company_id', 'job_sequence', 'total_career_months', 'role_count', 'progression_type', 'seniority_level', 'seniority_trend', 'transitions', 'avg_tenure_months', 'median_tenure_months', 'tenure_pattern', 'gaps', 'domain_concentration', 'domains', 'trajectory_embedding', 'predicted_next_roles', 'created_at', 'updated_at'];
  const jsonColumns = new Set(['job_sequence', 'transitions', 'gaps', 'domains', 'predicted_next_roles']);
  const values = columns.map((c) => {
    const v = (row as any)[c];
    return jsonColumns.has(c) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  });
  safeWrite(getMatchingEvaluationServicePool(), 'upsertCareerTrajectoryForMatchingEvaluationService', upsertSql('career_trajectories', columns), values);
}

// ==================== reasoning_conclusions (replace mirror, Batch 31) ====================
// Unlike matching-reasoning-service's independently-computed copy (Batch 26), this is a passive
// mirror of the monolith's own real, fully-populated table, following the PRIMARY write's own
// transactional "replace the full row-set for one subject" semantics (see db.ts's
// replaceReasoningConclusions) rather than a per-id upsert - reasoning_conclusions has no stable
// natural key to upsert by other than its own auto-increment id, which the mirror target would
// need to reassign anyway on every recompute.

export function replaceReasoningConclusions(subjectType: string, subjectId: number, conclusions: Array<{
  id: number; subject_type: string; subject_id: number; conclusion_text: string; conclusion_type: string; reasoning_type: string;
  evidence_chain: unknown; conclusion_confidence: number; confidence_derivation: string; derived_from: unknown; created_at: Date | string;
}>): void {
  const columns = ['id', 'subject_type', 'subject_id', 'conclusion_text', 'conclusion_type', 'reasoning_type', 'evidence_chain', 'conclusion_confidence', 'confidence_derivation', 'derived_from', 'created_at'];
  // derived_from is a plain VARCHAR(60) (schema.sql:1090; src/types.ts:664/677), not JSON - only
  // evidence_chain is a real JSONB column here.
  const jsonColumns = new Set(['evidence_chain']);
  const rows = conclusions.map((c) => {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const v = (c as any)[col];
      row[col] = jsonColumns.has(col) && v !== null && v !== undefined ? JSON.stringify(v) : v;
    }
    return row;
  });
  replaceWrite(getMatchingEvaluationServicePool(), 'replaceReasoningConclusionsForMatchingEvaluationService', 'reasoning_conclusions', { subject_type: subjectType, subject_id: subjectId }, columns, rows);
}

// ==================== jobs (plain mirror, full-migration batch) ====================
// job-service's own database. Plain, upsert-by-id mirror - the monolith remains the sole writer
// (job.routes.ts unchanged). company_id has no FK on the target (cross-service, dropped - see
// job-service/migrations/001_initial_schema.up.sql's header comment).

const JOB_COLUMNS = [
  'id', 'company_id', 'title', 'description', 'required_skills', 'experience_years', 'location',
  'salary_min', 'salary_max', 'status', 'created_at', 'updated_at', 'optional_skills',
  'min_experience', 'max_experience', 'experience_unit', 'remote_type', 'employment_type',
  'industry', 'department', 'education', 'certifications', 'salary_currency', 'notice_period',
  'number_of_openings', 'required_languages', 'responsibilities', 'tech_stack', 'keywords',
  'job_summary', 'source_raw_text', 'parse_confidence', 'description_embedding',
  'skills_embedding', 'responsibilities_embedding', 'title_embedding',
];
// tech_stack/parse_confidence are JSONB columns that may hold a plain JS object - node-pg
// auto-stringifies bare objects correctly for JSONB, but explicit JSON.stringify here matches this
// file's own established convention (see e.g. skill_multipliers elsewhere in this file) and is a
// harmless no-op for objects, required only if either field is ever passed as an array.
const JOB_JSON_COLUMNS = new Set(['tech_stack', 'parse_confidence']);

export function upsertJob(row: Record<string, unknown>): void {
  const columns = JOB_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (JOB_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  safeWrite(getJobServicePool(), 'upsertJob', upsertSql('jobs', columns), values);
}

export function patchJob(id: number, fields: Record<string, unknown>): void {
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    mapped[k] = JOB_JSON_COLUMNS.has(k) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  }
  patchWrite(getJobServicePool(), 'patchJob', 'jobs', id, mapped);
}

export function deleteJobMirror(id: number): void {
  safeWrite(getJobServicePool(), 'deleteJobMirror', 'DELETE FROM jobs WHERE id = $1', [id]);
}

// ==================== candidates (plain mirror, full-migration batch) ====================
// candidate-core-service's own database. Plain, upsert-by-id mirror of the RAW stored row
// (skills/previous_companies/certifications as delimited strings, matching the monolith's own
// storage format - not the parsed-array shape mapRowToCandidate produces at its own read
// boundary). The monolith remains the sole writer (candidate.routes.ts unchanged). company_id and
// candidate_account_id both have no FK on the target (cross-service, dropped - see
// candidate-core-service/migrations/001_initial_schema.up.sql's header comment).

const CANDIDATE_COLUMNS = [
  'id', 'name', 'email', 'phone', 'skills', 'primary_skills', 'secondary_skills', 'skills_array',
  'years_of_experience', 'current_location', 'preferred_location', 'current_company',
  'previous_companies', 'current_job_title', 'industry_domain', 'education',
  'highest_qualification', 'graduation_year', 'university', 'certifications', 'projects',
  'technical_tools', 'languages_known', 'current_ctc', 'expected_ctc', 'notice_period',
  'willingness_to_relocate', 'linkedin_url', 'github_or_portfolio_url', 'resume_summary',
  'resume_text', 'ai_confidence_score', 'created_at', 'updated_at', 'extraction_status',
  'resume_file_path', 'candidate_hash', 'resume_embedding', 'company_id', 'candidate_account_id',
  'confidence_profile', 'skills_embedding', 'responsibilities_embedding', 'title_embedding',
  'work_history', 'project_entries', 'project_intelligence',
];
const CANDIDATE_JSON_COLUMNS = new Set(['confidence_profile', 'work_history', 'project_entries', 'project_intelligence']);

export function upsertCandidate(row: Record<string, unknown>): void {
  const columns = CANDIDATE_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (CANDIDATE_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  safeWrite(getCandidateCoreServicePool(), 'upsertCandidate', upsertSql('candidates', columns), values);
}

export function patchCandidate(id: number, fields: Record<string, unknown>): void {
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    mapped[k] = CANDIDATE_JSON_COLUMNS.has(k) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  }
  patchWrite(getCandidateCoreServicePool(), 'patchCandidate', 'candidates', id, mapped);
}

export function deleteCandidateMirror(id: number): void {
  safeWrite(getCandidateCoreServicePool(), 'deleteCandidateMirror', 'DELETE FROM candidates WHERE id = $1', [id]);
}

// ==================== swipes / recruiter_notes / detailed_scoring_reports (plain mirrors, full-migration batch) ====================
// matching-decision-service's own database. All three are outcome data - recorded once, after a
// real decision has already been made by the unchanged monolith code. Deliberately does NOT touch
// the live-scoring engine itself or the request-time decision logic (see matching-decision-service/
// README.md). company_id/candidate_id/job_id/created_by/updated_by/generated_by all have no FK on
// the target (cross-service, dropped - see matching-decision-service/migrations/
// 001_initial_schema.up.sql's header comment).

const SWIPE_COLUMNS = ['id', 'recruiter_id', 'candidate_id', 'job_id', 'action', 'match_score', 'timestamp', 'used_for_training', 'company_id', 'reason', 'breakdown', 'decision_time_seconds'];
const SWIPE_JSON_COLUMNS = new Set(['breakdown']);

export function upsertSwipe(row: Record<string, unknown>): void {
  const columns = SWIPE_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (SWIPE_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  safeWrite(getMatchingDecisionServicePool(), 'upsertSwipe', upsertSql('swipes', columns), values);
}

const RECRUITER_NOTE_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'note', 'created_by', 'updated_by', 'created_at', 'updated_at'];

export function upsertRecruiterNote(row: Record<string, unknown>): void {
  const columns = RECRUITER_NOTE_COLUMNS.filter((c) => c in row);
  safeWrite(getMatchingDecisionServicePool(), 'upsertRecruiterNote', upsertSql('recruiter_notes', columns), columns.map((c) => row[c]));
}

const DETAILED_SCORING_REPORT_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'report', 'generated_by', 'generated_at'];
const DETAILED_SCORING_REPORT_JSON_COLUMNS = new Set(['report']);

export function upsertDetailedScoringReport(row: Record<string, unknown>): void {
  const columns = DETAILED_SCORING_REPORT_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (DETAILED_SCORING_REPORT_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  safeWrite(getMatchingDecisionServicePool(), 'upsertDetailedScoringReport', upsertSql('detailed_scoring_reports', columns), values);
}

// Updated by Item 4 (Candidate Analytics Mirror): candidate_decisions, candidate_application_status,
// mutual_matches now mirror to candidate-service's own new tables (see migrations/004_analytics_mirror.up.sql).
// These are dual-write targets only, not read-cutover drivers - the monolith continues to own analytics
// computation and schema. Mirror rows are upserted by id, matching the backfill/validation script's
// expectation of id-based key uniqueness.

// (Removed duplicate functions - see Phase 4 below for newer versions with company_id support)

// ============================================================
// Phase 2: Upload Service Mirror (new microservice)
// ============================================================
// Updated by Phase 2 (Aug 2026): uploads table now mirrors to upload-service's own tejoma_uploads
// database. This table is NEW to the upload extraction flow and wasn't part of prior Tier 0 extractions.
// Mirroring enables shadow-phase validation before the upload-service cutover (UPLOAD_SERVICE_ENABLED flag).

const UPLOAD_COLUMNS = ['id', 'company_id', 'candidate_id', 'recruiter_id', 'file_name', 'file_type', 'mime_type', 'file_size_bytes', 'storage_key', 'upload_status', 'error_message', 'file_hash', 'virus_scan_status', 'virus_scan_timestamp', 'created_at', 'updated_at'];

export function upsertUpload(row: Record<string, unknown>): void {
  const columns = UPLOAD_COLUMNS.filter((c) => c in row);
  safeWrite(getUploadServicePool(), 'upsertUpload', upsertSql('uploads', columns), columns.map((c) => row[c]));
}

// ============================================================
// Phase 2: Resume Service Mirror (new microservice)
// ============================================================
// Mirrors extracted resume data to resume-service's tejoma_resume database.
// Includes extraction jobs tracking and skill detection results.

const RESUME_COLUMNS = ['id', 'upload_id', 'company_id', 'candidate_id', 'recruiter_id', 'extracted_text', 'skills', 'experience_years', 'education', 'extraction_status', 'extraction_error', 'skills_confidence', 'extracted_at', 'created_at', 'updated_at'];

export function upsertResume(row: Record<string, unknown>): void {
  const columns = RESUME_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => {
    if (c === 'skills' && Array.isArray(row[c])) {
      return `{${row[c].join(',')}}`;
    }
    if (c === 'education' && Array.isArray(row[c])) {
      return `{${row[c].map((e) => `"${e}"`).join(',')}}`;
    }
    return row[c];
  });
  safeWrite(getResumeServicePool(), 'upsertResume', upsertSql('resume_service.resumes', columns), values);
}

// ============================================================
// Phase 2: Notifications Service Mirror (new microservice)
// ============================================================
// Mirrors user notifications to notifications-service's tejoma_notifications database.
// Includes real-time notification history for WebSocket delivery.

const NOTIFICATION_COLUMNS = ['id', 'company_id', 'recipient_user_id', 'sender_user_id', 'notification_type', 'title', 'message', 'data', 'read_at', 'deleted_at', 'created_at', 'updated_at'];

export function upsertNotification(row: Record<string, unknown>): void {
  const columns = NOTIFICATION_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => {
    if (c === 'data' && typeof row[c] === 'object') {
      return JSON.stringify(row[c]);
    }
    return row[c];
  });
  safeWrite(getNotificationsServicePool(), 'upsertNotification', upsertSql('notifications_service.notifications', columns), values);
}

// ============================================================
// Phase 4: Candidate Analytics Mirror (candidate-service)
// ============================================================
// Mirrors analytics-related tables to candidate-service's tejoma_candidate database.
// Used for: GET /api/candidate-analytics enrichment (Item 4)
// Tables: candidate_decisions, candidate_application_status, mutual_matches

const CANDIDATE_DECISION_COLUMNS = ['id', 'company_id', 'candidate_id', 'recruiter_id', 'decision_type', 'decision_date', 'notes', 'created_at', 'updated_at'];

export function upsertCandidateDecision(row: Record<string, unknown>): void {
  const columns = CANDIDATE_DECISION_COLUMNS.filter((c) => c in row);
  safeWrite(getCandidateServicePool(), 'upsertCandidateDecision', upsertSql('candidate_decisions', columns), columns.map((c) => row[c]));
}

const CANDIDATE_APPLICATION_STATUS_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'status', 'status_date', 'notes', 'created_at', 'updated_at'];

export function upsertCandidateApplicationStatus(row: Record<string, unknown>): void {
  const columns = CANDIDATE_APPLICATION_STATUS_COLUMNS.filter((c) => c in row);
  safeWrite(getCandidateServicePool(), 'upsertCandidateApplicationStatus', upsertSql('candidate_application_status', columns), columns.map((c) => row[c]));
}

const MUTUAL_MATCH_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'candidate_interested', 'job_interested', 'matched_at', 'created_at', 'updated_at'];

export function upsertMutualMatch(row: Record<string, unknown>): void {
  const columns = MUTUAL_MATCH_COLUMNS.filter((c) => c in row);
  safeWrite(getCandidateServicePool(), 'upsertMutualMatch', upsertSql('mutual_matches', columns), columns.map((c) => row[c]));
}
