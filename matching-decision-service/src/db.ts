/**
 * PostgreSQL connection pool and data-access functions for Matching Decision Service's own
 * database - dual-written, read-only-from-this-service's-own-code mirrors of `swipes`,
 * `recruiter_notes`, and `detailed_scoring_reports`. The monolith remains the sole writer for all
 * three (swipe.routes.ts's recordSwipe, recruiter-review.routes.ts's upsertRecruiterNote/
 * upsertDetailedScoringReport, all unchanged) - the upsert functions below exist only as
 * dual-write's targets.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention).
 */
import pkg from 'pg';
import type { SwipeRow, RecruiterNoteRow, DetailedScoringReportRow } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_matching_decision',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('matching-decision-service PostgreSQL pool error:', err);
});

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

// ==================== swipes ====================

const SWIPE_COLUMNS = ['id', 'recruiter_id', 'candidate_id', 'job_id', 'action', 'match_score', 'timestamp', 'used_for_training', 'company_id', 'reason', 'breakdown', 'decision_time_seconds'];
const SWIPE_JSON_COLUMNS = new Set(['breakdown']);

export async function upsertSwipe(row: Record<string, unknown>): Promise<void> {
  try {
    const columns = SWIPE_COLUMNS.filter((c) => c in row);
    const values = columns.map((c) => (SWIPE_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await pool.query(
      `INSERT INTO swipes (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
      values
    );
  } catch (error) {
    console.error('Error upserting swipe (dual-write):', error);
  }
}

// NUMERIC columns come back from node-postgres as strings, not numbers - action/match_score/
// decision_time_seconds are all real NUMERIC columns on the live database (verified directly
// against information_schema, not assumed from schema.sql - see migrations/
// 001_initial_schema.up.sql's header comment on action's real type).
function coerceSwipeRow(row: any): SwipeRow {
  const n = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  return { ...row, action: n(row.action), match_score: n(row.match_score), decision_time_seconds: n(row.decision_time_seconds) };
}

export async function getSwipes(companyId: number): Promise<SwipeRow[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE company_id = $1 ORDER BY "timestamp" DESC', [companyId]);
    return result.rows.map(coerceSwipeRow);
  } catch (error) {
    console.error('Error fetching swipes:', error);
    return [];
  }
}

// Write-cutover completion plan, Phase D - recruiterReview.routes.ts's own notes/decision-change
// routes both need to resolve ":id" (a swipe id) to its candidate_id/job_id before writing,
// exactly like the monolith's own upsertRecruiterNoteForSwipe/changeRecruiterReviewDecision did.
// Ported from the monolith's own src/db.ts, unchanged.
export async function getSwipeById(id: number, companyId: number): Promise<SwipeRow | null> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rows[0] ? coerceSwipeRow(result.rows[0]) : null;
  } catch (error) {
    console.error('Error fetching swipe by id:', error);
    return null;
  }
}

// Remaining-monolith migration, Step 6 - ported from the monolith's own src/db.ts, unchanged.
// Candidates whose LATEST swipe for this job is 0.5 ("Saved") - powers GET /api/matches/queue/
// :job_id's real cutover shortlist-only filter, same query this service's own dual-written swipes
// mirror already has everything needed to answer locally (no cross-service call required).
export async function getShortlistedCandidateIds(jobId: number, companyId: number): Promise<Set<number>> {
  try {
    const result = await pool.query(
      `SELECT candidate_id FROM (
         SELECT DISTINCT ON (candidate_id, job_id) candidate_id, action
         FROM swipes
         WHERE company_id = $1 AND job_id = $2
         ORDER BY candidate_id, job_id, timestamp DESC, id DESC
       ) latest
       WHERE latest.action = 0.5`,
      [companyId, jobId]
    );
    return new Set(result.rows.map((r) => r.candidate_id));
  } catch (error) {
    console.error('Error fetching shortlisted candidate ids:', error);
    return new Set();
  }
}

// Remaining-monolith migration, Step 6 - GET /api/swipes/stats's real cutover. The monolith's own
// swipe.routes.ts computes this in JS after fetching every swipe row for the recruiter
// (`getSwipes(companyId).filter(...)`); done here as a single aggregate query instead, same
// result, no behavior change - purely a local optimization enabled by this being a fresh
// implementation rather than a byte-for-byte port of JS logic that no longer needs the full row
// set for anything else.
export async function getSwipeStats(companyId: number, recruiterId: number): Promise<{ total_swipes: number; acceptance_rate: number; average_score: number }> {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_swipes,
         COUNT(*) FILTER (WHERE action = 1)::int AS acceptances,
         COALESCE(AVG(match_score), 0) AS average_score
       FROM swipes WHERE company_id = $1 AND recruiter_id = $2`,
      [companyId, recruiterId]
    );
    const row = result.rows[0];
    const total_swipes = row?.total_swipes ?? 0;
    const acceptances = row?.acceptances ?? 0;
    const acceptance_rate = total_swipes > 0 ? Number(((acceptances / total_swipes) * 100).toFixed(1)) : 0;
    const average_score = total_swipes > 0 ? Number(Number(row.average_score).toFixed(1)) : 0;
    return { total_swipes, acceptance_rate, average_score };
  } catch (error) {
    console.error('Error computing swipe stats:', error);
    return { total_swipes: 0, acceptance_rate: 0, average_score: 0 };
  }
}

// Remaining-monolith migration, Item 1 - GET /api/jobs (list) fan-out. Job-service calls this
// to get per-job swipe counts, ported verbatim from the monolith's own getJobSwipeCounts.
export async function getSwipeCountsByJob(companyId: number): Promise<Map<number, { reviewed: number; accepted: number; rejected: number; saved: number }>> {
  const map = new Map<number, { reviewed: number; accepted: number; rejected: number; saved: number }>();
  try {
    const result = await pool.query(
      `SELECT job_id,
              COUNT(*)::int AS reviewed,
              COUNT(*) FILTER (WHERE action = 1)::int AS accepted,
              COUNT(*) FILTER (WHERE action = 0)::int AS rejected,
              COUNT(*) FILTER (WHERE action = 0.5)::int AS saved
       FROM swipes
       WHERE company_id = $1
       GROUP BY job_id`,
      [companyId]
    );
    for (const row of result.rows) {
      map.set(row.job_id, { reviewed: row.reviewed, accepted: row.accepted, rejected: row.rejected, saved: row.saved });
    }
    return map;
  } catch (error) {
    console.error('Error fetching job swipe counts:', error);
    return map;
  }
}

// Remaining-monolith migration, Item 2 - candidate-search shortlisted tab. Candidate-service calls
// this to get the latest swipe per (candidate_id, job_id) pair, optionally filtered by action.
// Ported verbatim from the monolith's DISTINCT ON (candidate_id, job_id) ... ORDER BY ... timestamp DESC
// CTE, reused in getShortlistedCandidateAccounts, getRecruiterReviewList, getRecruiterReviewStats.
export async function getLatestSwipePerPair(companyId: number, action?: number): Promise<SwipeRow[]> {
  try {
    const query = `
      SELECT DISTINCT ON (candidate_id, job_id) *
      FROM swipes
      WHERE company_id = $1${action !== undefined ? ' AND action = $2' : ''}
      ORDER BY candidate_id, job_id, "timestamp" DESC
    `;
    const params = action !== undefined ? [companyId, action] : [companyId];
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error fetching latest swipes per pair:', error);
    return [];
  }
}

// Remaining-monolith migration, Item 3 - recruiter-review detail's explainability module needs
// the full swipe history for a (candidate_id, job_id) pair. Ported verbatim from the monolith's
// own scoped query, including its NUMERIC-string coercion for match_score (a quirk of the original).
export async function getSwipeHistoryForPair(candidateId: number, jobId: number, companyId: number): Promise<SwipeRow[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM swipes
       WHERE candidate_id = $1 AND job_id = $2 AND company_id = $3
       ORDER BY "timestamp" DESC`,
      [candidateId, jobId, companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching swipe history for pair:', error);
    return [];
  }
}

// Remaining-monolith migration, Item 4 - candidate-analytics unscoped cross-company lookup.
// Returns latest swipe (across all jobs) per candidate. Unscoped by company - matches the
// monolith's own analytics semantics. For each candidate_id, returns their most recent swipe.
export async function getLatestSwipesByCandidateIds(candidateIds: number[]): Promise<SwipeRow[]> {
  if (candidateIds.length === 0) return [];
  try {
    const placeholders = candidateIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT DISTINCT ON (candidate_id) *
       FROM swipes
       WHERE candidate_id IN (${placeholders})
       ORDER BY candidate_id, "timestamp" DESC`,
      candidateIds
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching latest swipes by candidate ids:', error);
    return [];
  }
}

// ==================== recruiter_notes ====================

const RECRUITER_NOTE_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'note', 'created_by', 'updated_by', 'created_at', 'updated_at'];

export async function upsertRecruiterNote(row: Record<string, unknown>): Promise<void> {
  try {
    const columns = RECRUITER_NOTE_COLUMNS.filter((c) => c in row);
    const values = columns.map((c) => row[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await pool.query(
      `INSERT INTO recruiter_notes (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
      values
    );
  } catch (error) {
    console.error('Error upserting recruiter note (dual-write):', error);
  }
}

export async function getRecruiterNote(companyId: number, candidateId: number, jobId: number): Promise<RecruiterNoteRow | null> {
  try {
    const result = await pool.query('SELECT * FROM recruiter_notes WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3', [companyId, candidateId, jobId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching recruiter note:', error);
    return null;
  }
}

// Write-cutover completion plan, Phase D - this service is now the write-authority for
// `recruiter_notes` - a genuine upsert against this service's own database, on the real
// (company_id, candidate_id, job_id) unique constraint (migrations/001_initial_schema.up.sql),
// not a dual-write target keyed by id. Ported from the monolith's own src/db.ts's
// upsertRecruiterNote. dualWrite.upsertRecruiterNote does NOT fire here (unlike the monolith's own
// version) - this service IS the target that hook used to reach; the monolith's own copy is kept
// fresh in the other direction instead, via services/monolithClient.ts's
// mirrorAndNotifyRecruiterNote, called by the route handler after this returns.
export async function recordRecruiterNote(params: { companyId: number; candidateId: number; jobId: number; note: string; userId: number }): Promise<RecruiterNoteRow | null> {
  try {
    const result = await pool.query(
      `INSERT INTO recruiter_notes (company_id, candidate_id, job_id, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (company_id, candidate_id, job_id)
       DO UPDATE SET note = $4, updated_by = $5, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [params.companyId, params.candidateId, params.jobId, params.note, params.userId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error recording recruiter note:', error);
    return null;
  }
}

// ==================== detailed_scoring_reports ====================

const DETAILED_SCORING_REPORT_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'report', 'generated_by', 'generated_at'];
const DETAILED_SCORING_REPORT_JSON_COLUMNS = new Set(['report']);

export async function upsertDetailedScoringReport(row: Record<string, unknown>): Promise<void> {
  try {
    const columns = DETAILED_SCORING_REPORT_COLUMNS.filter((c) => c in row);
    const values = columns.map((c) => (DETAILED_SCORING_REPORT_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await pool.query(
      `INSERT INTO detailed_scoring_reports (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
      values
    );
  } catch (error) {
    console.error('Error upserting detailed scoring report (dual-write):', error);
  }
}

export async function getDetailedScoringReport(companyId: number, candidateId: number, jobId: number): Promise<DetailedScoringReportRow | null> {
  try {
    const result = await pool.query('SELECT * FROM detailed_scoring_reports WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3', [companyId, candidateId, jobId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching detailed scoring report:', error);
    return null;
  }
}

// Write-cutover completion plan, Phase D - this service is now the write-authority for
// `detailed_scoring_reports`, same shape as recordRecruiterNote above - a genuine upsert on the
// real (company_id, candidate_id, job_id) unique constraint, not a dual-write target keyed by id.
// Ported from the monolith's own src/db.ts's upsertDetailedScoringReport, but returns the FULL row
// (not just {report, generated_at}) - the route handler narrows it for the HTTP response, while
// the full row (with id/company_id/candidate_id/job_id/generated_by) is what
// monolithClient.mirrorAndNotifyDetailedScore needs for the reverse mirror.
export async function recordDetailedScoringReport(params: {
  companyId: number; candidateId: number; jobId: number; report: unknown; generatedBy: number;
}): Promise<DetailedScoringReportRow | null> {
  try {
    const result = await pool.query(
      `INSERT INTO detailed_scoring_reports (company_id, candidate_id, job_id, report, generated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, candidate_id, job_id)
       DO UPDATE SET report = $4, generated_by = $5, generated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [params.companyId, params.candidateId, params.jobId, JSON.stringify(params.report), params.generatedBy]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error recording detailed scoring report:', error);
    return null;
  }
}

// ==================== real writes (write-cutover completion plan, Phase C) ====================
// This service is now the write-authority for `swipes` - a genuine INSERT against this service's
// own database (its own SERIAL sequence assigns new ids - see migrations/002_resync_sequences.up
// .sql's header comment for the real primary-key-collision bug found and fixed before this could
// ship). Ported from the monolith's own src/db.ts's recordSwipe. dualWrite.upsertSwipe does NOT
// fire here (unlike the monolith's own version) - this service IS the target that hook used to
// reach; the monolith's own copy (plus the mutual-match check, application-status sync,
// broadcastEvent, enqueueRetrain, and shadow logging recordSwipe's own hooks always fired) is kept
// fresh in the other direction instead, via services/monolithClient.ts's mirrorAndNotifySwipe,
// called by the route handler after this returns.
export interface RecordSwipeInput {
  company_id: number;
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: number;
  match_score: number;
  used_for_training?: boolean;
  reason?: string | null;
  breakdown?: unknown;
  decision_time_seconds?: number | null;
}

export async function recordSwipe(swipe: RecordSwipeInput): Promise<SwipeRow | null> {
  try {
    const result = await pool.query(
      `INSERT INTO swipes (company_id, recruiter_id, candidate_id, job_id, action, match_score, used_for_training, reason, breakdown, decision_time_seconds, "timestamp")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING *`,
      [
        swipe.company_id,
        swipe.recruiter_id,
        swipe.candidate_id,
        swipe.job_id,
        swipe.action,
        swipe.match_score,
        swipe.used_for_training || false,
        swipe.reason ?? null,
        swipe.breakdown ? JSON.stringify(swipe.breakdown) : null,
        swipe.decision_time_seconds ?? null,
      ]
    );
    return result.rows[0] ? coerceSwipeRow(result.rows[0]) : null;
  } catch (error) {
    console.error('Error recording swipe:', error);
    return null;
  }
}

// Every swipe across every company. Learning-to-Rank training pools globally (the ranker is not
// per-tenant), which is why this is deliberately unscoped - the same shape the monolith's own
// getAllSwipesUnscoped had. Mirrors the existing unscoped reads other services already expose for
// the same training/reindex use case (candidate-core /internal/candidates/all,
// job-service /internal/jobs/all). NOT reachable through the API Gateway: /internal/* is 404'd
// there unconditionally, so this stays a network-boundary-trusted, service-to-service read.
export async function getAllSwipesUnscoped(): Promise<SwipeRow[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes ORDER BY id');
    return result.rows.map(coerceSwipeRow);
  } catch (error) {
    console.error('Error fetching all swipes:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  upsertSwipe,
  getSwipes,
  getAllSwipesUnscoped,
  getSwipeById,
  getShortlistedCandidateIds,
  getSwipeStats,
  getSwipeCountsByJob,
  getLatestSwipePerPair,
  getLatestSwipesByCandidateIds,
  getSwipeHistoryForPair,
  upsertRecruiterNote,
  getRecruiterNote,
  recordRecruiterNote,
  upsertDetailedScoringReport,
  getDetailedScoringReport,
  recordDetailedScoringReport,
  recordSwipe,
  upsertRecruiterReviewViewRow,
  patchRecruiterReviewViewNote,
  deleteRecruiterReviewViewRow,
  getRecruiterReviewListFromView,
};

// ==================== recruiter_review_view (Item 5 CQRS) ====================
// Materialized view for recruiter-review list - one row per (candidate_id, job_id) pair,
// upserted in place when any component changes. Denormalized columns from candidates, jobs,
// users (recruiter), swipes, and recruiter_notes - ready for filter/sort/paginate without joins.

export interface RecruiterReviewViewRow {
  candidate_id: number;
  job_id: number;
  company_id: number;
  candidate_name: string | null;
  candidate_email: string | null;
  candidate_phone: string | null;
  candidate_skills: string | null;
  candidate_location: string | null;
  candidate_years_exp: string | null;
  candidate_company: string | null;
  job_title: string | null;
  job_location: string | null;
  job_company_name: string | null;
  recruiter_name: string | null;
  recruiter_id: number | null;
  latest_action: number | null;
  latest_decision_date: Date | null;
  match_score: string | number | null;
  reason: string | null;
  note_text: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function upsertRecruiterReviewViewRow(row: Partial<RecruiterReviewViewRow>): Promise<void> {
  try {
    const columns = ['candidate_id', 'job_id', 'company_id', 'candidate_name', 'candidate_email', 'candidate_phone', 'candidate_skills', 'candidate_location', 'candidate_years_exp', 'candidate_company', 'job_title', 'job_location', 'job_company_name', 'recruiter_name', 'recruiter_id', 'latest_action', 'latest_decision_date', 'match_score', 'reason', 'note_text'].filter((c) => c in row);
    if (columns.length === 0) return;

    const values = columns.map((c) => row[c as keyof typeof row]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns.filter((c) => !['candidate_id', 'job_id'].includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(', ');

    await pool.query(
      `INSERT INTO recruiter_review_view (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (candidate_id, job_id) DO UPDATE SET ${updateSet}, updated_at = CURRENT_TIMESTAMP`,
      values
    );
  } catch (error) {
    console.error('Error upserting recruiter review view row:', error);
  }
}

export async function patchRecruiterReviewViewNote(candidateId: number, jobId: number, noteText: string | null): Promise<void> {
  try {
    await pool.query(
      `UPDATE recruiter_review_view SET note_text = $1, updated_at = CURRENT_TIMESTAMP WHERE candidate_id = $2 AND job_id = $3`,
      [noteText, candidateId, jobId]
    );
  } catch (error) {
    console.error('Error patching recruiter review view note:', error);
  }
}

export async function deleteRecruiterReviewViewRow(candidateId: number, jobId: number): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM recruiter_review_view WHERE candidate_id = $1 AND job_id = $2`,
      [candidateId, jobId]
    );
  } catch (error) {
    console.error('Error deleting recruiter review view row:', error);
  }
}

export async function getRecruiterReviewListFromView(
  companyId: number,
  filters: {
    page?: number;
    pageSize?: number;
    search?: string;
    jobId?: number;
    decision?: string;
    recruiterId?: number;
    dateFrom?: string;
    dateTo?: string;
    minExperience?: number;
    maxExperience?: number;
    skills?: string;
    minScore?: number;
    maxScore?: number;
    sortBy?: string;
  }
): Promise<{ rows: RecruiterReviewViewRow[]; total: number }> {
  try {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 25;
    const offset = (page - 1) * pageSize;

    // Build WHERE clause
    const whereClauses: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let paramIndex = 2;

    if (filters.search) {
      whereClauses.push(`(candidate_name ILIKE $${paramIndex} OR candidate_skills ILIKE $${paramIndex} OR job_title ILIKE $${paramIndex})`);
      params.push(`%${filters.search}%`);
      paramIndex++;
    }
    if (filters.jobId) {
      whereClauses.push(`job_id = $${paramIndex}`);
      params.push(filters.jobId);
      paramIndex++;
    }
    if (filters.decision) {
      const actionValue = filters.decision === 'accepted' ? 1 : filters.decision === 'rejected' ? 0 : 0.5;
      whereClauses.push(`latest_action = $${paramIndex}`);
      params.push(actionValue);
      paramIndex++;
    }
    if (filters.recruiterId) {
      whereClauses.push(`recruiter_id = $${paramIndex}`);
      params.push(filters.recruiterId);
      paramIndex++;
    }
    if (filters.dateFrom) {
      whereClauses.push(`latest_decision_date >= $${paramIndex}::timestamp`);
      params.push(filters.dateFrom);
      paramIndex++;
    }
    if (filters.dateTo) {
      whereClauses.push(`latest_decision_date <= $${paramIndex}::timestamp`);
      params.push(filters.dateTo);
      paramIndex++;
    }
    if (filters.minExperience) {
      whereClauses.push(`candidate_years_exp::int >= $${paramIndex}`);
      params.push(filters.minExperience);
      paramIndex++;
    }
    if (filters.maxExperience) {
      whereClauses.push(`candidate_years_exp::int <= $${paramIndex}`);
      params.push(filters.maxExperience);
      paramIndex++;
    }
    if (filters.minScore) {
      whereClauses.push(`match_score >= $${paramIndex}`);
      params.push(filters.minScore);
      paramIndex++;
    }
    if (filters.maxScore) {
      whereClauses.push(`match_score <= $${paramIndex}`);
      params.push(filters.maxScore);
      paramIndex++;
    }
    if (filters.skills) {
      whereClauses.push(`candidate_skills ILIKE $${paramIndex}`);
      params.push(`%${filters.skills}%`);
      paramIndex++;
    }

    // Build ORDER BY clause
    let orderBy = 'latest_decision_date DESC';
    if (filters.sortBy === 'oldest_decision') orderBy = 'latest_decision_date ASC';
    else if (filters.sortBy === 'highest_score') orderBy = 'match_score DESC';
    else if (filters.sortBy === 'lowest_score') orderBy = 'match_score ASC';
    else if (filters.sortBy === 'name_asc') orderBy = 'candidate_name ASC';
    else if (filters.sortBy === 'name_desc') orderBy = 'candidate_name DESC';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM recruiter_review_view WHERE ${whereClauses.join(' AND ')}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Fetch paginated results
    const result = await pool.query(
      `SELECT * FROM recruiter_review_view WHERE ${whereClauses.join(' AND ')} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    return { rows: result.rows, total };
  } catch (error) {
    console.error('Error fetching recruiter review list from view:', error);
    return { rows: [], total: 0 };
  }
}

export { pool };
