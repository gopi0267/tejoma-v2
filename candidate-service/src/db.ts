/**
 * PostgreSQL connection pool and data-access functions for Candidate Service's own database
 * (Batch 16 domain audit) - candidate_accounts and candidate_experiences, moved out of the
 * monolith's shared database.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention: catch,
 * log, return null/false - never throw). No dual-write back to the monolith from here - exactly
 * like identity-service/src/db.ts, this service's own routes only ever read/write its own
 * database. The monolith remains the authoritative source of real traffic until a deliberate
 * cutover (MIGRATION_RUNBOOK.md); until then, this database is kept current by the monolith's own
 * dual-write (src/dualWrite.ts) mirroring INTO it, never the reverse.
 */
import pkg from 'pg';
import type { CandidateAccount, CandidateExperience, CandidateNotification } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_candidate',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('candidate-service PostgreSQL pool error:', err);
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

// ==================== candidate_accounts (profile) ====================
// Ported exactly from the monolith's src/db.ts getCandidateAccountById/updateCandidateProfile.

export async function getCandidateAccountById(id: number): Promise<CandidateAccount | null> {
  try {
    const result = await pool.query('SELECT * FROM candidate_accounts WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate account by id:', error);
    return null;
  }
}

// Remaining-monolith migration, Item 2 - candidate-search shortlisted tab. Returns candidate
// accounts for the given ids, used to hydrate candidates from the swipes + candidate-core-service
// data. Trivial local query since this service owns candidate_accounts directly.
export async function getCandidateAccountsByIds(ids: number[]): Promise<CandidateAccount[]> {
  if (ids.length === 0) return [];
  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(`SELECT * FROM candidate_accounts WHERE id IN (${placeholders})`, ids);
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate accounts by ids:', error);
    return [];
  }
}

export interface CandidateProfileUpdate {
  name?: string;
  headline?: string | null;
  skills?: string[] | null;
  years_of_experience?: string | null;
  location?: string | null;
  education?: string | null;
  summary?: string | null;
  current_company?: string | null;
  certifications?: string[] | null;
  tools?: string[] | null;
  languages?: string[] | null;
  notice_period?: string | null;
  current_ctc?: string | null;
  expected_ctc?: string | null;
  open_to_work?: boolean;
  visible_to_recruiters?: boolean;
  course_name?: string | null;
  course_type?: string | null;
  specialization?: string | null;
  institution_name?: string | null;
  start_year?: string | null;
  end_year?: string | null;
  grading_system?: string | null;
  grade_value?: string | null;
  primary_skill?: string | null;
  secondary_skills?: string[] | null;
  current_job_title?: string | null;
  projects?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
}

export async function updateCandidateProfile(candidateId: number, fields: CandidateProfileUpdate): Promise<CandidateAccount | null> {
  const columns = Object.keys(fields) as (keyof CandidateProfileUpdate)[];
  if (columns.length === 0) {
    return getCandidateAccountById(candidateId);
  }
  try {
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
    const values = columns.map((col) => fields[col]);
    const result = await pool.query(
      `UPDATE candidate_accounts SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${columns.length + 1} RETURNING *`,
      [...values, candidateId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating candidate profile:', error);
    return null;
  }
}

// ==================== candidate_experiences ====================
// Ported exactly from the monolith's src/db.ts. Every function is scoped by candidate_account_id
// - callers always pass the id from the caller's own auth token (req.candidate!.candidate_id),
// never a client-supplied id, so a candidate can only ever read/write their own experience rows.

export interface CandidateExperienceInput {
  job_title?: string | null;
  company?: string | null;
  employment_type?: string | null;
  experience_years?: number | null;
  experience_months?: number | null;
  current_ctc?: string | null;
  expected_ctc?: string | null;
  notice_period?: string | null;
  current_location?: string | null;
  preferred_location?: string | null;
  key_responsibilities?: string | null;
  skills_used?: string[] | null;
}

export async function getCandidateExperiences(candidateAccountId: number): Promise<CandidateExperience[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM candidate_experiences WHERE candidate_account_id = $1 ORDER BY created_at ASC',
      [candidateAccountId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate experiences:', error);
    return [];
  }
}

export async function createCandidateExperience(candidateAccountId: number, fields: CandidateExperienceInput): Promise<CandidateExperience | null> {
  try {
    const result = await pool.query(
      `INSERT INTO candidate_experiences
        (candidate_account_id, job_title, company, employment_type, experience_years, experience_months,
         current_ctc, expected_ctc, notice_period, current_location, preferred_location, key_responsibilities, skills_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        candidateAccountId,
        fields.job_title ?? null, fields.company ?? null, fields.employment_type ?? null,
        fields.experience_years ?? null, fields.experience_months ?? null,
        fields.current_ctc ?? null, fields.expected_ctc ?? null, fields.notice_period ?? null,
        fields.current_location ?? null, fields.preferred_location ?? null,
        fields.key_responsibilities ?? null, fields.skills_used ?? null,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating candidate experience:', error);
    return null;
  }
}

export async function updateCandidateExperience(id: number, candidateAccountId: number, fields: CandidateExperienceInput): Promise<CandidateExperience | null> {
  const columns = Object.keys(fields) as (keyof CandidateExperienceInput)[];
  if (columns.length === 0) return null;
  try {
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
    const values = columns.map((col) => fields[col]);
    const result = await pool.query(
      `UPDATE candidate_experiences SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${columns.length + 1} AND candidate_account_id = $${columns.length + 2}
       RETURNING *`,
      [...values, id, candidateAccountId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating candidate experience:', error);
    return null;
  }
}

export async function deleteCandidateExperience(id: number, candidateAccountId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      'DELETE FROM candidate_experiences WHERE id = $1 AND candidate_account_id = $2',
      [id, candidateAccountId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error deleting candidate experience:', error);
    return false;
  }
}

// ==================== candidate_notifications (Batch 20) ====================
// Ported exactly from the monolith's src/db.ts getCandidateNotifications/
// getCandidateUnreadNotificationCount/markCandidateNotificationRead/
// markAllCandidateNotificationsRead - same queries, same server-side ownership scoping
// (candidate_account_id from the authenticated session, never trusted from a route param alone).

export async function getCandidateNotifications(candidateAccountId: number): Promise<CandidateNotification[]> {
  try {
    const result = await pool.query(
      `SELECT id, candidate_account_id, match_id, type, title, message, read_at, created_at, job_id
       FROM candidate_notifications WHERE candidate_account_id = $1 ORDER BY created_at DESC`,
      [candidateAccountId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate notifications:', error);
    return [];
  }
}

export async function getCandidateUnreadNotificationCount(candidateAccountId: number): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM candidate_notifications WHERE candidate_account_id = $1 AND read_at IS NULL`,
      [candidateAccountId]
    );
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Error counting unread candidate notifications:', error);
    return 0;
  }
}

export async function markCandidateNotificationRead(id: number, candidateAccountId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE candidate_notifications SET read_at = NOW() WHERE id = $1 AND candidate_account_id = $2 AND read_at IS NULL`,
      [id, candidateAccountId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error marking candidate notification read:', error);
    return false;
  }
}

export async function markAllCandidateNotificationsRead(candidateAccountId: number): Promise<number> {
  try {
    const result = await pool.query(
      `UPDATE candidate_notifications SET read_at = NOW() WHERE candidate_account_id = $1 AND read_at IS NULL`,
      [candidateAccountId]
    );
    return result.rowCount ?? 0;
  } catch (error) {
    console.error('Error marking all candidate notifications read:', error);
    return 0;
  }
}

// ==================== candidate-search (Remaining-monolith migration, Step 5) ====================
// Ported verbatim from the monolith's own src/db.ts - same query text, same semantics. See
// migrations/003_candidate_search.up.sql's header comment for why this lands here, not
// candidate-core-service.

export interface CandidateSearchFilters {
  q?: string;
  skills?: string[];
  location?: string;
  currentCompany?: string;
  jobTitle?: string;
  education?: string;
  certifications?: string[];
  tools?: string[];
  languages?: string[];
  noticePeriod?: string;
  minExperience?: number;
  maxExperience?: number;
  openToWork?: boolean;
}

const CANDIDATE_SEARCH_BASE_WHERE = `visible_to_recruiters = true AND is_active = true AND deleted_at IS NULL AND onboarding_completed_at IS NOT NULL`;

function buildCandidateSearchWhere(filters: CandidateSearchFilters): { whereSql: string; params: any[] } {
  const params: any[] = [];
  const conditions: string[] = [CANDIDATE_SEARCH_BASE_WHERE];
  const addParam = (val: any) => { params.push(val); return `$${params.length}`; };

  if (filters.q) {
    const term = addParam(`%${filters.q}%`);
    conditions.push(`(name ILIKE ${term} OR headline ILIKE ${term} OR location ILIKE ${term} OR current_company ILIKE ${term} OR summary ILIKE ${term})`);
  }
  if (filters.skills && filters.skills.length > 0) {
    conditions.push(`skills && ${addParam(filters.skills)}::text[]`);
  }
  if (filters.location) conditions.push(`location ILIKE ${addParam(`%${filters.location}%`)}`);
  if (filters.currentCompany) conditions.push(`current_company ILIKE ${addParam(`%${filters.currentCompany}%`)}`);
  if (filters.jobTitle) conditions.push(`headline ILIKE ${addParam(`%${filters.jobTitle}%`)}`);
  if (filters.education) conditions.push(`education ILIKE ${addParam(`%${filters.education}%`)}`);
  if (filters.certifications && filters.certifications.length > 0) {
    conditions.push(`certifications && ${addParam(filters.certifications)}::text[]`);
  }
  if (filters.tools && filters.tools.length > 0) {
    conditions.push(`tools && ${addParam(filters.tools)}::text[]`);
  }
  if (filters.languages && filters.languages.length > 0) {
    conditions.push(`languages && ${addParam(filters.languages)}::text[]`);
  }
  if (filters.noticePeriod) conditions.push(`notice_period ILIKE ${addParam(`%${filters.noticePeriod}%`)}`);
  if (filters.minExperience !== undefined) {
    conditions.push(`NULLIF(regexp_replace(years_of_experience, '[^0-9.].*', ''), '')::numeric >= ${addParam(filters.minExperience)}`);
  }
  if (filters.maxExperience !== undefined) {
    conditions.push(`NULLIF(regexp_replace(years_of_experience, '[^0-9.].*', ''), '')::numeric <= ${addParam(filters.maxExperience)}`);
  }
  if (filters.openToWork !== undefined) conditions.push(`open_to_work = ${addParam(filters.openToWork)}`);

  return { whereSql: conditions.join(' AND '), params };
}

export async function searchCandidateAccounts(filters: CandidateSearchFilters, limit: number = 2000): Promise<CandidateAccount[]> {
  try {
    const { whereSql, params } = buildCandidateSearchWhere(filters);
    const limitParam = `$${params.length + 1}`;
    const query = `SELECT * FROM candidate_accounts WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ${limitParam}`;
    const result = await pool.query(query, [...params, limit]);
    return result.rows;
  } catch (error) {
    console.error('Error searching candidate accounts:', error);
    return [];
  }
}

export async function countCandidateSearchResults(filters: CandidateSearchFilters): Promise<number> {
  try {
    const { whereSql, params } = buildCandidateSearchWhere(filters);
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM candidate_accounts WHERE ${whereSql}`, params);
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    console.error('Error counting candidate search results:', error);
    return 0;
  }
}

export async function saveCandidateForRecruiter(recruiterUserId: number, companyId: number, candidateAccountId: number): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO saved_candidates (recruiter_user_id, company_id, candidate_account_id) VALUES ($1, $2, $3)
       ON CONFLICT (recruiter_user_id, candidate_account_id) DO NOTHING`,
      [recruiterUserId, companyId, candidateAccountId]
    );
    return true;
  } catch (error) {
    console.error('Error saving candidate:', error);
    return false;
  }
}

export async function removeSavedCandidate(recruiterUserId: number, candidateAccountId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      'DELETE FROM saved_candidates WHERE recruiter_user_id = $1 AND candidate_account_id = $2',
      [recruiterUserId, candidateAccountId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error removing saved candidate:', error);
    return false;
  }
}

export async function getSavedCandidateAccounts(recruiterUserId: number): Promise<CandidateAccount[]> {
  try {
    const result = await pool.query(
      `SELECT ca.*, sc.created_at AS saved_at FROM saved_candidates sc
       JOIN candidate_accounts ca ON ca.id = sc.candidate_account_id
       WHERE sc.recruiter_user_id = $1
       ORDER BY sc.created_at DESC`,
      [recruiterUserId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching saved candidates:', error);
    return [];
  }
}

export async function getSavedCandidateAccountIds(recruiterUserId: number): Promise<Set<number>> {
  try {
    const result = await pool.query('SELECT candidate_account_id FROM saved_candidates WHERE recruiter_user_id = $1', [recruiterUserId]);
    return new Set(result.rows.map((r) => r.candidate_account_id));
  } catch (error) {
    console.error('Error fetching saved candidate ids:', error);
    return new Set();
  }
}

export async function recordCandidateProfileView(recruiterUserId: number, companyId: number, candidateAccountId: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO candidate_profile_views (recruiter_user_id, company_id, candidate_account_id, viewed_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (recruiter_user_id, candidate_account_id) DO UPDATE SET viewed_at = CURRENT_TIMESTAMP`,
      [recruiterUserId, companyId, candidateAccountId]
    );
  } catch (error) {
    console.error('Error recording candidate profile view:', error);
  }
}

export async function getRecentlyViewedCandidateAccounts(recruiterUserId: number, limit: number = 50): Promise<CandidateAccount[]> {
  try {
    const result = await pool.query(
      `SELECT ca.*, cpv.viewed_at FROM candidate_profile_views cpv
       JOIN candidate_accounts ca ON ca.id = cpv.candidate_account_id
       WHERE cpv.recruiter_user_id = $1
       ORDER BY cpv.viewed_at DESC LIMIT $2`,
      [recruiterUserId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching recently viewed candidates:', error);
    return [];
  }
}

// ==================== analytics mirrors (Item 4) ====================

// Remaining-monolith migration, Item 4 - analytics support functions.
// These read from the locally-mirrored tables (candidate_decisions, candidate_application_status,
// mutual_matches) populated by the monolith's dual-write hooks.

export async function getCandidateProfileViewCount(candidateAccountId: number): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM candidate_profile_views WHERE candidate_account_id = $1`,
      [candidateAccountId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  } catch (error) {
    console.error('Error fetching candidate profile view count:', error);
    return 0;
  }
}

export async function getCandidateApplicationStatusCounts(candidateAccountId: number): Promise<{ [key: string]: number }> {
  try {
    const result = await pool.query(
      `SELECT status, COUNT(*) as count FROM candidate_application_status
       WHERE candidate_account_id = $1 GROUP BY status`,
      [candidateAccountId]
    );
    const counts: { [key: string]: number } = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    return counts;
  } catch (error) {
    console.error('Error fetching candidate application status counts:', error);
    return {};
  }
}

export async function getCandidateActivityTrend(candidateAccountId: number, days: number): Promise<{ liked: any[]; recruiterInterest: any[]; matches: any[] }> {
  try {
    // Activity trend from candidate_decisions (liked), candidate_decisions with recruiter action,
    // and mutual_matches. All unscoped by company per analytics semantics.
    const result = await pool.query(
      `SELECT
       date_trunc('day', cd.created_at)::date AS date,
       COUNT(CASE WHEN cd.decision_type = 'swipe_right' THEN 1 END) as liked_count,
       COUNT(CASE WHEN EXISTS (
         SELECT 1 FROM candidate_decisions cd2 WHERE cd2.candidate_account_id = $1
         AND cd2.job_id = cd.job_id AND cd2.decision_type != 'swipe_right'
         AND cd2.created_at >= date_trunc('day', cd.created_at)
       ) THEN 1 END) as recruiter_interest_count,
       COUNT(DISTINCT CASE WHEN EXISTS (
         SELECT 1 FROM mutual_matches mm WHERE mm.candidate_account_id = $1
         AND mm.job_id = cd.job_id AND mm.created_at >= date_trunc('day', cd.created_at)
       ) THEN cd.job_id END) as matches_count
       FROM candidate_decisions cd
       WHERE cd.candidate_account_id = $1 AND cd.created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY date_trunc('day', cd.created_at)`,
      [candidateAccountId, days]
    );

    const liked: any[] = [];
    const recruiterInterest: any[] = [];
    const matches: any[] = [];

    for (const row of result.rows) {
      if (row.date) {
        liked.push({ date: row.date.toISOString().slice(0, 10), count: parseInt(row.liked_count, 10) });
        recruiterInterest.push({ date: row.date.toISOString().slice(0, 10), count: parseInt(row.recruiter_interest_count, 10) });
        matches.push({ date: row.date.toISOString().slice(0, 10), count: parseInt(row.matches_count, 10) });
      }
    }

    return { liked, recruiterInterest, matches };
  } catch (error) {
    console.error('Error fetching candidate activity trend:', error);
    return { liked: [], recruiterInterest: [], matches: [] };
  }
}

// ==================== candidate_decisions (candidate swipes/decisions) ====================
// Candidate decisions: swipe_right, swipe_left, apply on jobs
// action: 1 = swipe_right or apply, 0 = swipe_left

export async function recordCandidateDecision(params: {
  candidateAccountId: number;
  jobId: number;
  action: number;
  decisionType: 'swipe_right' | 'swipe_left' | 'apply';
}): Promise<any | null> {
  try {
    const result = await pool.query(
      `INSERT INTO candidate_decisions
       (candidate_account_id, job_id, action, decision_type, timestamp)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [params.candidateAccountId, params.jobId, params.action, params.decisionType]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error recording candidate decision:', error);
    return null;
  }
}

export async function getLatestCandidateDecision(candidateAccountId: number, jobId: number): Promise<any | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM candidate_decisions
       WHERE candidate_account_id = $1 AND job_id = $2
       ORDER BY timestamp DESC, id DESC LIMIT 1`,
      [candidateAccountId, jobId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching latest candidate decision:', error);
    return null;
  }
}

export async function getCandidateDecisions(candidateAccountId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT cd.id, cd.job_id, cd.action, cd.decision_type, cd.timestamp,
              j.title AS job_title, c.name AS company_name, c.logo_url AS company_logo_url
       FROM candidate_decisions cd
       LEFT JOIN jobs j ON j.id = cd.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE cd.candidate_account_id = $1
       ORDER BY cd.timestamp DESC, cd.id DESC`,
      [candidateAccountId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate decisions:', error);
    return [];
  }
}

export async function getCandidateActiveDecisions(candidateAccountId: number, action?: number): Promise<any[]> {
  try {
    const params: any[] = [candidateAccountId];
    let actionFilter = '';
    if (action !== undefined) {
      params.push(action);
      actionFilter = `AND latest.action = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (cd.job_id) cd.id, cd.job_id, cd.action, cd.decision_type, cd.timestamp,
                j.title AS job_title, j.location AS location, c.name AS company_name, c.logo_url AS company_logo_url
         FROM candidate_decisions cd
         LEFT JOIN jobs j ON j.id = cd.job_id
         LEFT JOIN companies c ON c.id = j.company_id
         WHERE cd.candidate_account_id = $1
         ORDER BY cd.job_id, cd.timestamp DESC, cd.id DESC
       ) latest
       WHERE 1=1 ${actionFilter}
       ORDER BY latest.timestamp DESC`,
      params
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching active candidate decisions:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  getCandidateAccountById,
  getCandidateAccountsByIds,
  updateCandidateProfile,
  getCandidateExperiences,
  createCandidateExperience,
  updateCandidateExperience,
  deleteCandidateExperience,
  getCandidateNotifications,
  getCandidateUnreadNotificationCount,
  markCandidateNotificationRead,
  markAllCandidateNotificationsRead,
  searchCandidateAccounts,
  countCandidateSearchResults,
  saveCandidateForRecruiter,
  removeSavedCandidate,
  getSavedCandidateAccounts,
  getSavedCandidateAccountIds,
  recordCandidateProfileView,
  getRecentlyViewedCandidateAccounts,
  getCandidateProfileViewCount,
  getCandidateApplicationStatusCounts,
  getCandidateActivityTrend,
  recordCandidateDecision,
  getLatestCandidateDecision,
  getCandidateDecisions,
  getCandidateActiveDecisions,
};

export { pool };
