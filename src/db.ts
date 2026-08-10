/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PostgreSQL Database Layer for Tejoma Recruiting
 */

import pkg from 'pg';
import { config } from 'dotenv';
import { User, Company, Candidate, Job, Swipe, MatchScore, ModelVersion, DailyStat, RecruiterNote, CompanyRegistrationRequest, CandidateAccount, SkillNode, SkillEdge, SkillRelationshipType, RoleProfile, MatchFeatureRecord, LtrModelVersion, MatchEvaluationRun, SkillDiscoveryProposal, SkillDiscoveryStatus, NormalizedJob, ProgressionType, SeniorityLevel, SeniorityTrend, CareerTransition, TenurePattern, EmploymentGap, DomainBreakdown, PredictedRole, CareerTrajectory, ReasoningConclusion, ConclusionSubjectType, DraftConclusion, ProficiencyShadowScore, BgeRetrievalShadowComparison, RankingEntry } from './types.js';
// Tier 0 migration (Batch 13b) - see src/dualWrite.ts's header comment for the full contract.
// Disabled by default (DUAL_WRITE_ENABLED); every call below is a no-op until an operator opts in.
import * as dualWrite from './dualWrite.js';

config({ path: '.env.local' });

const { Pool } = pkg;

// max/min unchanged (still the pre-existing defaults/env vars) - this codebase's actual queries
// are all short, bounded operations (no batch/report-style long-running queries), and pool size
// wasn't a bottleneck found anywhere in this hardening pass, so raising it without a measured
// need would just be guessing. The three additions below are pure safety-net defaults that were
// previously implicit/unset, not sizing changes:
//   - idleTimeoutMillis: pins node-postgres's own default (10s) explicitly, so a future
//     node-postgres major version changing its default doesn't silently change production
//     connection-churn behavior underneath this app.
//   - connectionTimeoutMillis: was unset, which means node-postgres's actual default of 0 (wait
//     forever) applied - if the database is briefly unreachable or the pool is exhausted, a
//     request would previously hang indefinitely instead of failing fast with a clear error.
//   - statement_timeout: a generous 30s safety net (Postgres-side, applied per connection) so a
//     single runaway/blocked query can't hold a pool connection open forever - well above any
//     legitimate query in this codebase (nothing here does long-running batch/report queries).
// All three are env-overridable, matching the existing max/min pattern, defaulting to values that
// don't change today's observed behavior at current scale.
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000'),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000'),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000'),
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

console.log('PostgreSQL connection pool initialized');

// USERS
export async function getUsers(): Promise<User[]> {
  try {
    const result = await pool.query('SELECT * FROM users');
    return result.rows;
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
}

export async function getUserById(id: number): Promise<User | null> {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user by id:', error);
    return null;
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user by email:', error);
    return null;
  }
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user by phone:', error);
    return null;
  }
}

export async function createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User | null> {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, phone, password_hash, company_id, role, is_active, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user.email, user.phone, user.password_hash, user.company_id, user.role, user.is_active, user.name]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating user:', error);
    return null;
  }
}

export async function updateUserPasswordHash(userId: number, passwordHash: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING updated_at',
      [passwordHash, userId]
    );
    if ((result.rowCount ?? 0) > 0) {
      dualWrite.patchUser(userId, { password_hash: passwordHash, updated_at: result.rows[0].updated_at });
    }
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error updating user password:', error);
    return false;
  }
}

export async function updateLastLogin(userId: number): Promise<void> {
  try {
    const result = await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING last_login_at', [userId]);
    if (result.rows[0]) {
      dualWrite.patchUser(userId, { last_login_at: result.rows[0].last_login_at });
    }
  } catch (error) {
    console.error('Error updating last login:', error);
  }
}

// ==================== CANDIDATE ACCOUNTS (Phase 1 - independent of any company) ====================
// Modeled line-for-line on the getUserBy*/createUser/updateUserPasswordHash functions above,
// but against candidate_accounts, which has no company_id column at all (see
// migration-candidate-accounts.sql).

export async function getCandidateAccountById(id: number): Promise<CandidateAccount | null> {
  try {
    const result = await pool.query('SELECT * FROM candidate_accounts WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate account by id:', error);
    return null;
  }
}

export async function getCandidateAccountByEmail(email: string): Promise<CandidateAccount | null> {
  try {
    const result = await pool.query('SELECT * FROM candidate_accounts WHERE email = $1', [email]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate account by email:', error);
    return null;
  }
}

export async function getCandidateAccountByPhone(phone: string): Promise<CandidateAccount | null> {
  try {
    const result = await pool.query('SELECT * FROM candidate_accounts WHERE phone = $1', [phone]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate account by phone:', error);
    return null;
  }
}

export async function createCandidateAccount(account: { name: string; email: string | null; phone: string | null; password_hash: string }): Promise<CandidateAccount | null> {
  try {
    const result = await pool.query(
      `INSERT INTO candidate_accounts (name, email, phone, password_hash, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [account.name, account.email, account.phone, account.password_hash]
    );
    const row = result.rows[0];
    dualWrite.upsertCandidateAccount({
      id: row.id, name: row.name, email: row.email, phone: row.phone, password_hash: row.password_hash,
      is_active: row.is_active, deleted_at: row.deleted_at, created_at: row.created_at, updated_at: row.updated_at,
    });
    // Batch 16 (Candidate Service) - full-row mirror, same RETURNING result, second target database.
    dualWrite.upsertCandidateAccountProfile(row);
    return row;
  } catch (error) {
    console.error('Error creating candidate account:', error);
    return null;
  }
}

export async function updateCandidateAccountPasswordHash(candidateId: number, passwordHash: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'UPDATE candidate_accounts SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING updated_at',
      [passwordHash, candidateId]
    );
    if ((result.rowCount ?? 0) > 0) {
      dualWrite.patchCandidateAccount(candidateId, { password_hash: passwordHash, updated_at: result.rows[0].updated_at });
    }
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error updating candidate account password:', error);
    return false;
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
  resume_file_path?: string | null;
  resume_original_filename?: string | null;
  resume_file_uploaded_at?: string | null;
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
    const row = result.rows[0];
    // Identity DB only owns the auth-column slice of candidate_accounts (Phase 3(database)
    // section 4's split) - of everything this function can update, `name` is the only column
    // that also exists there. Every other profile field (headline, skills, etc.) has nothing to
    // mirror to on Identity's side.
    if (row && columns.includes('name')) {
      dualWrite.patchCandidateAccount(candidateId, { name: row.name, updated_at: row.updated_at });
    }
    // Batch 16 (Candidate Service) - mirrors whatever columns actually changed, generically,
    // using the RETURNING result's own values (never independently recomputed).
    if (row) {
      const changedFields: Record<string, unknown> = { updated_at: row.updated_at };
      for (const col of columns) changedFields[col] = row[col];
      dualWrite.patchCandidateAccountProfile(candidateId, changedFields);
    }
    return row || null;
  } catch (error) {
    console.error('Error updating candidate profile:', error);
    return null;
  }
}

export async function markCandidateOnboardingComplete(candidateId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      'UPDATE candidate_accounts SET onboarding_completed_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING onboarding_completed_at',
      [candidateId]
    );
    if ((result.rowCount ?? 0) > 0) {
      // Batch 16 (Candidate Service) - the one column this function touches that Identity DB
      // never had a reason to mirror (onboarding is a profile-domain concern, not an auth one).
      dualWrite.patchCandidateAccountProfile(candidateId, { onboarding_completed_at: result.rows[0].onboarding_completed_at });
    }
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error marking candidate onboarding complete:', error);
    return false;
  }
}

// ==================== CANDIDATE EXPERIENCES (onboarding "Add Experience", one-to-many) ====================
// Every function below is scoped by candidate_account_id - callers always pass the id from the
// caller's own auth token (req.candidate!.candidate_id), never a client-supplied id, so a
// candidate can only ever read/write their own experience rows.

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

export async function getCandidateExperiences(candidateAccountId: number): Promise<any[]> {
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

export async function createCandidateExperience(candidateAccountId: number, fields: CandidateExperienceInput): Promise<any | null> {
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
    const row = result.rows[0];
    dualWrite.upsertCandidateExperience(row); // Batch 16 (Candidate Service)
    return row;
  } catch (error) {
    console.error('Error creating candidate experience:', error);
    return null;
  }
}

export async function updateCandidateExperience(id: number, candidateAccountId: number, fields: CandidateExperienceInput): Promise<any | null> {
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
    const row = result.rows[0];
    if (row) dualWrite.upsertCandidateExperience(row); // Batch 16 (Candidate Service)
    return row || null;
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
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) dualWrite.deleteCandidateExperienceMirror(id); // Batch 16 (Candidate Service)
    return deleted;
  } catch (error) {
    console.error('Error deleting candidate experience:', error);
    return false;
  }
}

// CANDIDATE REFRESH TOKEN SESSIONS - mirrors the refresh_tokens functions below exactly,
// against candidate_refresh_tokens (FK'd to candidate_accounts, not users).

export async function createCandidateRefreshToken(params: { candidateId: number; tokenHash: string; userAgent?: string | null; ip?: string | null; expiresAt: Date; remember?: boolean }): Promise<void> {
  try {
    const result = await pool.query(
      `INSERT INTO candidate_refresh_tokens (candidate_id, token_hash, user_agent, ip_address, expires_at, remember) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [params.candidateId, params.tokenHash, params.userAgent || null, params.ip || null, params.expiresAt, params.remember !== false]
    );
    const row = result.rows[0];
    dualWrite.upsertCandidateRefreshToken({
      id: row.id, candidate_id: params.candidateId, token_hash: params.tokenHash, user_agent: params.userAgent || null,
      ip_address: params.ip || null, created_at: row.created_at, expires_at: params.expiresAt, revoked_at: null, remember: params.remember !== false,
    });
  } catch (error) {
    console.error('Error creating candidate refresh token:', error);
    throw error;
  }
}

export async function findCandidateRefreshTokenByHash(tokenHash: string): Promise<any | null> {
  try {
    const result = await pool.query('SELECT * FROM candidate_refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error finding candidate refresh token:', error);
    return null;
  }
}

export async function revokeCandidateRefreshTokenByHash(tokenHash: string): Promise<void> {
  try {
    const result = await pool.query('UPDATE candidate_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, revoked_at', [tokenHash]);
    if (result.rows.length > 0) dualWrite.revokeCandidateRefreshTokens(result.rows);
  } catch (error) {
    console.error('Error revoking candidate refresh token:', error);
  }
}

export async function revokeAllCandidateRefreshTokensForCandidate(candidateId: number): Promise<void> {
  try {
    const result = await pool.query('UPDATE candidate_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE candidate_id = $1 AND revoked_at IS NULL RETURNING id, revoked_at', [candidateId]);
    if (result.rows.length > 0) dualWrite.revokeCandidateRefreshTokens(result.rows);
  } catch (error) {
    console.error('Error revoking all candidate refresh tokens:', error);
  }
}

// ==================== USER MANAGEMENT (admin adding recruiters to their own company) ====================
// Deliberately separate from createUser/updateUserPasswordHash above (which stay exactly as
// signup uses them) - every function here is new, always scoped to a companyId derived
// server-side from the caller's JWT, and always excludes soft-deleted rows unless noted.

export interface UserManagementFilters {
  search?: string;
  role?: 'admin' | 'recruiter';
  status?: 'active' | 'disabled';
  page: number;
  pageSize: number;
  sortBy?: 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc' | 'last_login_desc';
}

const USER_MANAGEMENT_SORT: Record<string, string> = {
  name_asc: 'name ASC',
  name_desc: 'name DESC',
  created_desc: 'created_at DESC',
  created_asc: 'created_at ASC',
  last_login_desc: 'last_login_at DESC NULLS LAST',
};

export async function getUsersByCompany(companyId: number, filters: UserManagementFilters): Promise<{ rows: User[]; totalRecords: number }> {
  try {
    const params: any[] = [companyId];
    const conditions: string[] = ['company_id = $1', 'deleted_at IS NULL'];
    const addParam = (val: any) => { params.push(val); return `$${params.length}`; };

    if (filters.role) conditions.push(`role = ${addParam(filters.role)}`);
    if (filters.status === 'active') conditions.push('is_active = true');
    if (filters.status === 'disabled') conditions.push('is_active = false');
    if (filters.search) {
      const term = addParam(`%${filters.search}%`);
      conditions.push(`(name ILIKE ${term} OR email ILIKE ${term} OR phone ILIKE ${term})`);
    }

    const orderBy = USER_MANAGEMENT_SORT[filters.sortBy || 'created_desc'] || USER_MANAGEMENT_SORT.created_desc;
    const limitParam = addParam(filters.pageSize);
    const offsetParam = addParam((filters.page - 1) * filters.pageSize);

    const result = await pool.query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM users
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
    const totalRecords = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    return { rows: result.rows.map(({ total_count, ...row }) => row), totalRecords };
  } catch (error) {
    console.error('Error fetching users by company:', error);
    return { rows: [], totalRecords: 0 };
  }
}

export async function getUserByIdForCompany(id: number, companyId: number): Promise<User | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [id, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user by id for company:', error);
    return null;
  }
}

export async function createUserByAdmin(params: {
  companyId: number; name: string; email: string | null; phone: string | null;
  role: 'admin' | 'recruiter'; passwordHash: string; createdBy: number;
}): Promise<User | null> {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, phone, password_hash, company_id, role, is_active, name, created_by)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)
       RETURNING *`,
      [params.email, params.phone, params.passwordHash, params.companyId, params.role, params.name, params.createdBy]
    );
    const row = result.rows[0];
    dualWrite.upsertUser(row);
    return row;
  } catch (error) {
    console.error('Error creating user by admin:', error);
    return null;
  }
}

/**
 * Creates a superadmin user directly. Deliberately separate from createUserByAdmin, whose
 * `role` parameter is typed to only 'admin' | 'recruiter' - that restriction is what guarantees
 * no HTTP route (e.g. POST /api/users) can ever mint a superadmin. This function is only ever
 * called from one-off operator scripts (see scripts/promote-superadmin.ts and
 * scripts/migrate-production-owner.ts), never from request-handling code.
 */
export async function createSuperadminUser(params: {
  companyId: number; name: string; email: string; passwordHash: string;
}): Promise<User | null> {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, company_id, role, is_active, name)
       VALUES ($1, $2, $3, 'superadmin', true, $4)
       RETURNING *`,
      [params.email, params.passwordHash, params.companyId, params.name]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating superadmin user:', error);
    return null;
  }
}

export async function updateUserDetails(
  id: number, companyId: number,
  updates: { name?: string; email?: string | null; phone?: string | null; role?: 'admin' | 'recruiter' },
  updatedBy: number
): Promise<User | null> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }
    if (fields.length === 0) return getUserByIdForCompany(id, companyId);

    fields.push(`updated_by = $${paramIndex}`, `updated_at = CURRENT_TIMESTAMP`);
    values.push(updatedBy, id, companyId);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${paramIndex + 1} AND company_id = $${paramIndex + 2} AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    const row = result.rows[0];
    if (row) {
      const patch: Record<string, unknown> = { updated_by: row.updated_by, updated_at: row.updated_at };
      for (const key of Object.keys(updates) as (keyof typeof updates)[]) {
        if (updates[key] !== undefined) patch[key] = row[key];
      }
      dualWrite.patchUser(id, patch);
    }
    return row || null;
  } catch (error) {
    console.error('Error updating user details:', error);
    return null;
  }
}

export async function updateUserStatus(id: number, companyId: number, isActive: boolean, actorId: number): Promise<User | null> {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1, disabled_by = $2, updated_by = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND company_id = $4 AND deleted_at IS NULL
       RETURNING *`,
      [isActive, isActive ? null : actorId, id, companyId]
    );
    const row = result.rows[0];
    if (row) {
      dualWrite.patchUser(id, { is_active: row.is_active, disabled_by: row.disabled_by, updated_by: row.updated_by, updated_at: row.updated_at });
    }
    return row || null;
  } catch (error) {
    console.error('Error updating user status:', error);
    return null;
  }
}

export async function softDeleteUser(id: number, companyId: number, actorId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = CURRENT_TIMESTAMP, updated_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND company_id = $3 AND deleted_at IS NULL
       RETURNING deleted_at, updated_by, updated_at`,
      [actorId, id, companyId]
    );
    if ((result.rowCount ?? 0) > 0) {
      const row = result.rows[0];
      dualWrite.patchUser(id, { deleted_at: row.deleted_at, updated_by: row.updated_by, updated_at: row.updated_at });
    }
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error soft-deleting user:', error);
    return false;
  }
}

export async function resetUserPasswordHash(id: number, companyId: number, newPasswordHash: string, actorId: number): Promise<User | null> {
  try {
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, password_reset_by = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND company_id = $4 AND deleted_at IS NULL
       RETURNING *`,
      [newPasswordHash, actorId, id, companyId]
    );
    const row = result.rows[0];
    if (row) {
      dualWrite.patchUser(id, { password_hash: newPasswordHash, password_reset_by: row.password_reset_by, updated_at: row.updated_at });
    }
    return row || null;
  } catch (error) {
    console.error('Error resetting user password:', error);
    return null;
  }
}

export async function getUserManagementStats(companyId: number): Promise<{
  totalUsers: number; totalRecruiters: number; activeUsers: number; disabledUsers: number; adminUsers: number;
}> {
  const empty = { totalUsers: 0, totalRecruiters: 0, activeUsers: 0, disabledUsers: 0, adminUsers: 0 };
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_users,
         COUNT(*) FILTER (WHERE role = 'recruiter')::int AS total_recruiters,
         COUNT(*) FILTER (WHERE is_active = true)::int AS active_users,
         COUNT(*) FILTER (WHERE is_active = false)::int AS disabled_users,
         COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_users
       FROM users WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const row = result.rows[0];
    if (!row) return empty;
    return {
      totalUsers: row.total_users,
      totalRecruiters: row.total_recruiters,
      activeUsers: row.active_users,
      disabledUsers: row.disabled_users,
      adminUsers: row.admin_users,
    };
  } catch (error) {
    console.error('Error fetching user management stats:', error);
    return empty;
  }
}

export async function countActiveAdmins(companyId: number): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE company_id = $1 AND role = 'admin' AND is_active = true AND deleted_at IS NULL`,
      [companyId]
    );
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    console.error('Error counting active admins:', error);
    return 0;
  }
}

// Every signup creates its own new company (the signing-up user becomes its first Company
// Admin) - there is no join-an-existing-company-by-name flow, since that let anyone join or
// silently create a company just by typing its exact name. Joining an existing teammate's
// company is deferred to a future invite feature.
function slugifyCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function getCompanyById(id: number): Promise<Company | null> {
  try {
    const result = await pool.query('SELECT * FROM companies WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching company by id:', error);
    return null;
  }
}

export async function getOrCreateCompany(name: string): Promise<Company | null> {
  try {
    // company_slug is NOT NULL with no default, and its uniqueness scheme is `slug-id` - so the
    // id has to be known before the row is inserted. Reserving it from the sequence up front
    // lets this be a single INSERT instead of an insert-then-update (which would violate the
    // NOT NULL constraint on the first statement).
    const idResult = await pool.query("SELECT nextval('companies_id_seq') AS id");
    const id: number = idResult.rows[0].id;
    const slug = `${slugifyCompanyName(name)}-${id}`;
    const created = await pool.query(
      `INSERT INTO companies (id, name, industry, plan, seats_limit, is_active, company_slug)
       VALUES ($1, $2, 'Technology', 'starter', 5, true, $3) RETURNING *`,
      [id, name, slug]
    );
    return created.rows[0];
  } catch (error) {
    console.error('Error creating company:', error);
    return null;
  }
}

export async function getCompanyByName(name: string): Promise<Company | null> {
  try {
    const result = await pool.query('SELECT * FROM companies WHERE lower(name) = lower($1)', [name]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching company by name:', error);
    return null;
  }
}

export async function promoteUserToSuperadmin(email: string): Promise<User | null> {
  try {
    const result = await pool.query(
      `UPDATE users SET role = 'superadmin', updated_at = CURRENT_TIMESTAMP WHERE email = $1 RETURNING *`,
      [email]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error promoting user to superadmin:', error);
    return null;
  }
}

// ==================== COMPANY APPROVAL WORKFLOW (moderated tenant onboarding) ====================
// A company/tenant is never created directly anymore for a brand-new customer - a request is
// created here in 'pending' status, and only becomes a real companies/users row once a
// superadmin approves it (approveCompanyRegistrationRequest below). This table is intentionally
// NOT company-scoped (there is no company yet, and a superadmin's whole job is to see every
// pending request across every prospective tenant).

export async function createCompanyRegistrationRequest(params: {
  companyName: string; companyWebsite: string | null; industry: string | null; companySize: string | null;
  businessEmail: string; companyPhone: string | null; country: string | null; state: string | null;
  city: string | null; address: string | null; adminName: string; adminEmail: string; adminPhone: string | null;
  passwordHash: string;
}): Promise<CompanyRegistrationRequest | null> {
  try {
    const result = await pool.query(
      `INSERT INTO company_registration_requests
       (company_name, company_website, industry, company_size, business_email, company_phone,
        country, state, city, address, admin_name, admin_email, admin_phone, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        params.companyName, params.companyWebsite, params.industry, params.companySize,
        params.businessEmail, params.companyPhone, params.country, params.state, params.city,
        params.address, params.adminName, params.adminEmail, params.adminPhone, params.passwordHash,
      ]
    );
    const row = result.rows[0];
    dualWrite.upsertCompanyRegistrationRequest(row);
    return row;
  } catch (error) {
    console.error('Error creating company registration request:', error);
    return null;
  }
}

/** Pre-check for a friendly error before hitting the partial unique indexes on pending rows. */
export async function findPendingCompanyRegistrationDuplicate(params: {
  companyName: string; businessEmail: string; adminEmail: string;
}): Promise<{ field: 'company_name' | 'business_email' | 'admin_email' } | null> {
  try {
    const result = await pool.query(
      `SELECT company_name, business_email, admin_email FROM company_registration_requests
       WHERE status = 'pending' AND (lower(company_name) = lower($1) OR lower(business_email) = lower($2) OR lower(admin_email) = lower($3))
       LIMIT 1`,
      [params.companyName, params.businessEmail, params.adminEmail]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.company_name.toLowerCase() === params.companyName.toLowerCase()) return { field: 'company_name' };
    if (row.business_email.toLowerCase() === params.businessEmail.toLowerCase()) return { field: 'business_email' };
    return { field: 'admin_email' };
  } catch (error) {
    console.error('Error checking for duplicate company registration request:', error);
    return null;
  }
}

export interface CompanyRegistrationFilters {
  status?: 'pending' | 'approved' | 'rejected';
  industry?: string;
  companyName?: string;
  businessEmail?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'newest' | 'oldest' | 'company_name' | 'status';
  page: number;
  pageSize: number;
}

const COMPANY_REGISTRATION_SORT: Record<string, string> = {
  newest: 'created_at DESC',
  oldest: 'created_at ASC',
  company_name: 'company_name ASC',
  status: 'status ASC',
};

export async function getCompanyRegistrationRequests(filters: CompanyRegistrationFilters): Promise<{ rows: CompanyRegistrationRequest[]; totalRecords: number }> {
  try {
    const params: any[] = [];
    const conditions: string[] = [];
    const addParam = (val: any) => { params.push(val); return `$${params.length}`; };

    if (filters.status) conditions.push(`status = ${addParam(filters.status)}`);
    if (filters.industry) conditions.push(`lower(industry) = lower(${addParam(filters.industry)})`);
    if (filters.companyName) conditions.push(`company_name ILIKE ${addParam(`%${filters.companyName}%`)}`);
    if (filters.businessEmail) conditions.push(`business_email ILIKE ${addParam(`%${filters.businessEmail}%`)}`);
    if (filters.dateFrom) conditions.push(`created_at >= ${addParam(filters.dateFrom)}`);
    if (filters.dateTo) conditions.push(`created_at <= ${addParam(filters.dateTo)}`);
    if (filters.search) {
      const term = addParam(`%${filters.search}%`);
      conditions.push(`(company_name ILIKE ${term} OR business_email ILIKE ${term} OR admin_name ILIKE ${term} OR admin_email ILIKE ${term})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = COMPANY_REGISTRATION_SORT[filters.sortBy || 'newest'] || COMPANY_REGISTRATION_SORT.newest;
    const limitParam = addParam(filters.pageSize);
    const offsetParam = addParam((filters.page - 1) * filters.pageSize);

    const result = await pool.query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM company_registration_requests
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
    const totalRecords = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    return { rows: result.rows.map(({ total_count, ...row }) => row), totalRecords };
  } catch (error) {
    console.error('Error fetching company registration requests:', error);
    return { rows: [], totalRecords: 0 };
  }
}

export async function getCompanyRegistrationRequestById(id: number): Promise<CompanyRegistrationRequest | null> {
  try {
    const result = await pool.query('SELECT * FROM company_registration_requests WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching company registration request:', error);
    return null;
  }
}

export async function getCompanyRegistrationRequestByIdentifier(identifier: { type: 'email' | 'phone'; value: string }): Promise<CompanyRegistrationRequest | null> {
  try {
    const result = identifier.type === 'email'
      ? await pool.query(`SELECT * FROM company_registration_requests WHERE lower(admin_email) = lower($1) ORDER BY created_at DESC LIMIT 1`, [identifier.value])
      : await pool.query(`SELECT * FROM company_registration_requests WHERE admin_phone = $1 ORDER BY created_at DESC LIMIT 1`, [identifier.value]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching company registration request by identifier:', error);
    return null;
  }
}

export async function getCompanyRegistrationStats(): Promise<{ total: number; pending: number; approved: number; rejected: number }> {
  const empty = { total: 0, pending: 0, approved: 0, rejected: 0 };
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM company_registration_requests`
    );
    return result.rows[0] || empty;
  } catch (error) {
    console.error('Error fetching company registration stats:', error);
    return empty;
  }
}

/**
 * Approves a pending request inside one transaction: creates the company (carrying over the
 * request's industry/website, unlike getOrCreateCompany's hardcoded 'Technology'), creates the
 * admin user via createUserByAdmin (same function the User Management module uses), and marks
 * the request approved with a link to both new rows. Re-checks status='pending' under the
 * transaction so a request can never be approved twice.
 */
export async function approveCompanyRegistrationRequest(id: number, reviewerId: number): Promise<{
  request: CompanyRegistrationRequest; company: Company; adminUser: User;
} | { error: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query('SELECT * FROM company_registration_requests WHERE id = $1 FOR UPDATE', [id]);
    const request: CompanyRegistrationRequest | undefined = reqResult.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return null;
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return { error: `Request has already been ${request.status}` };
    }

    const idResult = await client.query("SELECT nextval('companies_id_seq') AS id");
    const companyId: number = idResult.rows[0].id;
    const slug = `${slugifyCompanyName(request.company_name)}-${companyId}`;
    const companyResult = await client.query(
      `INSERT INTO companies (id, name, industry, plan, seats_limit, is_active, company_slug, website)
       VALUES ($1, $2, $3, 'starter', 5, true, $4, $5) RETURNING *`,
      [companyId, request.company_name, request.industry || 'Technology', slug, request.company_website]
    );
    const company: Company = companyResult.rows[0];

    const userResult = await client.query(
      `INSERT INTO users (email, phone, password_hash, company_id, role, is_active, name, created_by)
       VALUES ($1, $2, $3, $4, 'admin', true, $5, $6)
       RETURNING *`,
      [request.admin_email, request.admin_phone, request.password_hash, company.id, request.admin_name, reviewerId]
    );
    const adminUser: User = userResult.rows[0];

    const updatedRequestResult = await client.query(
      `UPDATE company_registration_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP,
           resulting_company_id = $2, resulting_user_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [reviewerId, company.id, adminUser.id, id]
    );

    await client.query('COMMIT');
    // Dual-write only after COMMIT succeeds - all three rows are now durably real on the primary
    // side, which is the only state that should ever be mirrored (see src/dualWrite.ts's header
    // comment). This is the one place a single db.ts function writes to three different target
    // databases, since the primary write itself is a single-transaction, three-table operation.
    dualWrite.upsertCompany(company);
    dualWrite.upsertUser(adminUser);
    dualWrite.upsertCompanyRegistrationRequest(updatedRequestResult.rows[0]);
    return { request: updatedRequestResult.rows[0], company, adminUser };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error approving company registration request:', error);
    return { error: 'Failed to approve request' };
  } finally {
    client.release();
  }
}

export async function rejectCompanyRegistrationRequest(id: number, reviewerId: number, reason: string): Promise<CompanyRegistrationRequest | { error: string } | null> {
  try {
    const existing = await pool.query('SELECT status FROM company_registration_requests WHERE id = $1', [id]);
    if (!existing.rows[0]) return null;
    if (existing.rows[0].status !== 'pending') {
      return { error: `Request has already been ${existing.rows[0].status}` };
    }

    const result = await pool.query(
      `UPDATE company_registration_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, review_notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reviewerId, reason, id]
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertCompanyRegistrationRequest(row);
    return row || null;
  } catch (error) {
    console.error('Error rejecting company registration request:', error);
    return { error: 'Failed to reject request' };
  }
}

// OTP VERIFICATION (signup + password reset, email or phone)
// 'candidate_signup' added for Phase 1 candidate registration; 'candidate_reset' added for
// Phase 6 candidate forgot-password - otp_verification has no user/company FK at all (purpose
// is a plain VARCHAR(20), which is why 'candidate_reset' rather than a longer, more descriptive
// name), so this is a safe, additive widening.
type OtpPurpose = 'signup' | 'password_reset' | 'candidate_signup' | 'candidate_reset';

export async function createOtpRecord(params: { email?: string | null; phone?: string | null; purpose: OtpPurpose; otpHash: string; expiresAt: Date }): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO otp_verification (email, phone, purpose, otp_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [params.email || null, params.phone || null, params.purpose, params.otpHash, params.expiresAt]
    );
  } catch (error) {
    console.error('Error creating OTP record:', error);
    throw error;
  }
}

export async function getLatestOtpRecord(params: { email?: string | null; phone?: string | null; purpose: OtpPurpose }): Promise<any | null> {
  try {
    const result = params.email
      ? await pool.query(
          `SELECT * FROM otp_verification WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
          [params.email, params.purpose]
        )
      : await pool.query(
          `SELECT * FROM otp_verification WHERE phone = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
          [params.phone, params.purpose]
        );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching OTP record:', error);
    return null;
  }
}

export async function incrementOtpAttempts(id: number): Promise<void> {
  try {
    await pool.query('UPDATE otp_verification SET attempts = attempts + 1 WHERE id = $1', [id]);
  } catch (error) {
    console.error('Error incrementing OTP attempts:', error);
  }
}

export async function markOtpVerified(id: number): Promise<void> {
  try {
    await pool.query('UPDATE otp_verification SET verified = true WHERE id = $1', [id]);
  } catch (error) {
    console.error('Error marking OTP verified:', error);
  }
}

export async function deleteOtpRecords(params: { email?: string | null; phone?: string | null; purpose: OtpPurpose }): Promise<void> {
  try {
    if (params.email) {
      await pool.query('DELETE FROM otp_verification WHERE email = $1 AND purpose = $2', [params.email, params.purpose]);
    } else if (params.phone) {
      await pool.query('DELETE FROM otp_verification WHERE phone = $1 AND purpose = $2', [params.phone, params.purpose]);
    }
  } catch (error) {
    console.error('Error deleting OTP records:', error);
  }
}

export async function countOtpRequestsSince(params: { email?: string | null; phone?: string | null; purpose: OtpPurpose; since: Date }): Promise<number> {
  try {
    const result = params.email
      ? await pool.query('SELECT COUNT(*) FROM otp_verification WHERE email = $1 AND purpose = $2 AND created_at > $3', [params.email, params.purpose, params.since])
      : await pool.query('SELECT COUNT(*) FROM otp_verification WHERE phone = $1 AND purpose = $2 AND created_at > $3', [params.phone, params.purpose, params.since]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Error counting OTP requests:', error);
    return 0;
  }
}

// PASSWORD HISTORY
const PASSWORD_HISTORY_LIMIT = 5;

export async function addPasswordHistory(userId: number, passwordHash: string): Promise<void> {
  try {
    const inserted = await pool.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2) RETURNING id, created_at', [userId, passwordHash]);
    const row = inserted.rows[0];
    dualWrite.upsertPasswordHistory({ id: row.id, user_id: userId, password_hash: passwordHash, created_at: row.created_at });
    // Keep only the most recent N entries per user.
    await pool.query(
      `DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
       )`,
      [userId, PASSWORD_HISTORY_LIMIT]
    );
    dualWrite.prunePasswordHistory(userId, PASSWORD_HISTORY_LIMIT);
  } catch (error) {
    console.error('Error adding password history:', error);
  }
}

export async function getPasswordHistory(userId: number): Promise<{ password_hash: string }[]> {
  try {
    const result = await pool.query(
      'SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, PASSWORD_HISTORY_LIMIT]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching password history:', error);
    return [];
  }
}

// Helper to map DB row to Candidate model
export function mapRowToCandidate(row: any): Candidate {
  if (!row) return row;

  const parseList = (val: any, sep = ', ') => {
    if (val === undefined || val === null) return [];
    if (Array.isArray(val)) return val;
    const str = String(val).trim();
    if (str === '' || str.toLowerCase() === 'null') return [];
    return str.split(sep).map((s: string) => s.trim()).filter((s: string) => s);
  };

  // skills_array (added by migration-phase0-unified-matching.sql) is an internal-only, GIN-
  // indexed projection of `skills` used by getCandidatesForJobScoring's structured pre-filter -
  // deliberately excluded from the returned Candidate so the app-level shape (and every existing
  // API response built from it) is byte-for-byte unchanged. `skills` (parsed below) remains the
  // one source of truth every existing caller already reads.
  const { skills_array, ...rest } = row;

  return {
    ...rest,
    skills: parseList(row.skills, ', '),
    previous_companies: parseList(row.previous_companies, '; '),
    certifications: parseList(row.certifications, '; ')
  };
}

// CANDIDATES - every read/write is scoped to the caller's company_id (derived server-side from
// req.user, never trusted from the client) so no route can see or touch another company's data.
export async function getCandidates(companyId: number): Promise<Candidate[]> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
    return result.rows.map(mapRowToCandidate);
  } catch (error) {
    console.error('Error fetching candidates:', error);
    return [];
  }
}

// Enterprise AI Matching Architecture, Phase 0 - "Hybrid Retrieval's structured pre-filter stage
// in front of the highest-risk endpoint (job-detail)". GET /jobs/:id (job.routes.ts) used to call
// getCandidates() above and score EVERY candidate in the company on every page load, with no
// bound - cost grew linearly with company size on an endpoint recruiters hit constantly.
//
// This is a bounded, RECALL-FIRST PRIORITIZATION, never a hard exclusion filter: it still
// returns every candidate in the company as long as the company has `limit` candidates or fewer
// (true for every company at today's scale, and the overwhelming majority of companies for a
// long time to come), which makes it a provable no-op below that size - identical candidate set,
// identical final ranking, to calling getCandidates() directly. Only once a company's candidate
// pool genuinely exceeds `limit` does it truncate, and even then it always includes every
// skill-overlapping candidate it can fit before padding the remainder with the most recent
// non-overlapping ones - a poor-fit candidate can still appear (recruiters must still be able to
// review someone with zero listed skill overlap), it just isn't guaranteed a slot once the pool
// is large enough that "score literally everyone" would itself be the actual problem.
//
// Uses skills_array (migration-phase0-unified-matching.sql), not the legacy `skills` string
// column, so the overlap check is a real GIN-indexed array operation (&&) rather than a text scan.
export async function getCandidatesForJobScoring(
  companyId: number,
  requiredSkills: string[] | undefined,
  limit: number = 1500
): Promise<Candidate[]> {
  try {
    const hasSkills = Array.isArray(requiredSkills) && requiredSkills.length > 0;
    const result = await pool.query(
      `SELECT * FROM candidates
       WHERE company_id = $1
       ORDER BY
         CASE WHEN $2::text[] IS NOT NULL AND skills_array && $2::text[] THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT $3`,
      [companyId, hasSkills ? requiredSkills : null, limit]
    );
    return result.rows.map(mapRowToCandidate);
  } catch (error) {
    console.error('Error fetching candidates for job scoring:', error);
    return [];
  }
}

// Production Database Hardening, Phase 2: a real, SQL-level paginated/searchable/sortable
// replacement for getCandidates() above, ready for GET /api/candidates to adopt whenever the
// frontend is migrated to consume a paginated response (see the Phase 2 report's "Candidate
// Management migration strategy" for the exact backward-compatible rollout plan). NOT wired into
// any route yet - getCandidates() and its callers (candidate.routes.ts, job.routes.ts,
// swipe.routes.ts) are completely untouched, so no existing API response shape changes.
// search mirrors CandidateManagement.tsx's current client-side filter exactly (name OR email,
// case-insensitive substring) so swapping it in later changes nothing about what recruiters see,
// only where the filtering happens.
export interface CandidatesPageOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: 'created_at_desc' | 'created_at_asc' | 'name_asc' | 'name_desc';
}

const CANDIDATES_SORT_COLUMNS: Record<NonNullable<CandidatesPageOptions['sortBy']>, string> = {
  created_at_desc: 'created_at DESC',
  created_at_asc: 'created_at ASC',
  name_asc: 'name ASC',
  name_desc: 'name DESC',
};

export async function getCandidatesPaginated(companyId: number, options: CandidatesPageOptions = {}): Promise<{ candidates: Candidate[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const sortColumn = CANDIDATES_SORT_COLUMNS[options.sortBy ?? 'created_at_desc'];
  const offset = (page - 1) * pageSize;

  try {
    const params: any[] = [companyId];
    let searchClause = '';
    if (options.search && options.search.trim()) {
      params.push(`%${options.search.trim()}%`);
      searchClause = `AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM candidates WHERE company_id = $1 ${searchClause}`,
      params
    );
    const total = countResult.rows[0]?.count ?? 0;

    params.push(pageSize, offset);
    const result = await pool.query(
      `SELECT * FROM candidates WHERE company_id = $1 ${searchClause}
       ORDER BY ${sortColumn} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { candidates: result.rows.map(mapRowToCandidate), total, page, pageSize };
  } catch (error) {
    console.error('Error fetching paginated candidates:', error);
    return { candidates: [], total: 0, page, pageSize };
  }
}

export async function getCandidateById(id: number, companyId: number): Promise<Candidate | null> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error fetching candidate by id:', error);
    return null;
  }
}

export async function getCandidateByHash(hash: string, companyId: number): Promise<Candidate | null> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE candidate_hash = $1 AND company_id = $2', [hash, companyId]);
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error fetching candidate by hash:', error);
    return null;
  }
}


export async function getCandidatesByIds(ids: number[], companyId: number): Promise<Candidate[]> {
  if (ids.length === 0) return [];
  try {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(`SELECT * FROM candidates WHERE company_id = $1 AND id IN (${placeholders})`, [companyId, ...ids]);
    return result.rows.map(mapRowToCandidate);
  } catch (error) {
    console.error('Error fetching candidates by ids:', error);
    return [];
  }
}

export async function createCandidate(candidate: Omit<Candidate, 'id' | 'created_at' | 'updated_at'>): Promise<Candidate | null> {
  try {
    const joinList = (val: any, sep = ', ') => {
      if (val === undefined || val === null) return 'NULL';
      if (Array.isArray(val)) {
        return val.length === 0 ? 'NULL' : val.join(sep);
      }
      return String(val).trim() === '' ? 'NULL' : String(val);
    };

    // skills_array dual-write (migration-phase0-unified-matching.sql) - kept in sync with the
    // legacy `skills` string on every create, same normalization as the backfill migration used
    // (drop blanks, trim). `skills` itself is untouched below - still the source of truth for
    // every pre-existing read path.
    const skillsArrayValue = Array.isArray(candidate.skills)
      ? candidate.skills.map((s) => String(s).trim()).filter((s) => s)
      : [];

    const cleanParams = [
      candidate.company_id,
      candidate.name,
      candidate.email,
      candidate.phone,
      joinList(candidate.skills, ', '),
      candidate.primary_skills,
      candidate.secondary_skills,
      candidate.years_of_experience,
      candidate.current_location,
      candidate.preferred_location,
      candidate.current_company,
      joinList(candidate.previous_companies, '; '),
      candidate.current_job_title,
      candidate.industry_domain,
      candidate.education,
      candidate.highest_qualification,
      candidate.graduation_year,
      candidate.university,
      joinList(candidate.certifications, '; '),
      candidate.projects,
      candidate.technical_tools,
      candidate.languages_known,
      candidate.current_ctc,
      candidate.expected_ctc,
      candidate.notice_period,
      candidate.willingness_to_relocate,
      candidate.linkedin_url,
      candidate.github_or_portfolio_url,
      candidate.resume_summary,
      candidate.resume_text,
      candidate.ai_confidence_score,
      candidate.resume_file_path || 'NULL',
      candidate.extraction_status || 'success',
      candidate.candidate_hash || 'NULL',
      candidate.resume_embedding || null
    ].map(val => (typeof val === 'string' ? val.replace(/\u0000/g, '') : val));

    cleanParams.push(skillsArrayValue);
    // confidence_profile dual-write target (migration-phase1-intelligence-layer.sql) - JSONB
    // needs an explicit stringify, same convention already used for jobs.parse_confidence/
    // tech_stack in updateJob below. null when the caller didn't supply one (e.g. a candidate
    // created through a path other than the parsed-resume flow in candidate.routes.ts).
    cleanParams.push(candidate.confidence_profile ? JSON.stringify(candidate.confidence_profile) : null);
    // Enterprise AI Matching Architecture, Phase 5 prerequisite (migration-phase5-structured-
    // history.sql) - same null-when-not-supplied convention as confidence_profile above.
    cleanParams.push(candidate.work_history !== undefined ? JSON.stringify(candidate.work_history) : null);
    cleanParams.push(candidate.project_entries !== undefined ? JSON.stringify(candidate.project_entries) : null);

    const result = await pool.query(
      `INSERT INTO candidates
       (company_id, name, email, phone, skills, primary_skills, secondary_skills, years_of_experience,
        current_location, preferred_location, current_company, previous_companies, current_job_title,
        industry_domain, education, highest_qualification, graduation_year, university, certifications,
        projects, technical_tools, languages_known, current_ctc, expected_ctc, notice_period,
        willingness_to_relocate, linkedin_url, github_or_portfolio_url, resume_summary, resume_text,
        ai_confidence_score, resume_file_path, extraction_status, candidate_hash, resume_embedding,
        skills_array, confidence_profile, work_history, project_entries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)
       RETURNING *`,
      cleanParams
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertCandidate(row);
    return row ? mapRowToCandidate(row) : null;
  } catch (error) {
    console.error('Error creating candidate:', error);
    return null;
  }
}

export async function deleteCandidate(id: number, companyId: number): Promise<boolean> {
  try {
    const result = await pool.query('DELETE FROM candidates WHERE id = $1 AND company_id = $2', [id, companyId]);
    const deleted = (result.rowCount ?? 0) > 0;
    // reasoning_conclusions.subject_id has no FK (polymorphic across candidates/jobs - see
    // migration-phase9-reasoning-layer.sql), so it needs an explicit cleanup call here; every
    // other Phase 9 table (career_trajectories, project_intelligence) is FK'd and cleans up on
    // its own via ON DELETE CASCADE.
    if (deleted) {
      await deleteReasoningConclusions('candidate', id);
      dualWrite.deleteCandidateMirror(id);
    }
    return deleted;
  } catch (error) {
    console.error('Error deleting candidate:', error);
    return false;
  }
}

// ==================== reverse mirror (write-cutover completion plan, Phase A) ====================
// Candidate Core Service is now the write-authority for `candidates` (its own real INSERT/DELETE,
// its own sequence assigns new ids) - these two functions are the reverse of this file's own
// existing dualWrite.upsertCandidate/deleteCandidateMirror: they keep THIS table (the monolith's
// own copy) fresh instead, by explicit id (never re-running this table's own sequence), so
// recruiter-review.routes.ts's list/detail views (staying monolith-local, reading this table
// directly) keep seeing real data. Called from src/api/candidate-core-internal.routes.ts's new
// mirror-and-notify/mirror-delete endpoints - same column-list-driven upsert shape
// candidate-core-service's own dual-write TARGET functions already use, just run in the other
// direction.
const CANDIDATE_MIRROR_COLUMNS = [
  'id', 'name', 'email', 'phone', 'skills', 'primary_skills', 'secondary_skills', 'skills_array',
  'years_of_experience', 'current_location', 'preferred_location', 'current_company',
  'previous_companies', 'current_job_title', 'industry_domain', 'education',
  'highest_qualification', 'graduation_year', 'university', 'certifications', 'projects',
  'technical_tools', 'languages_known', 'current_ctc', 'expected_ctc', 'notice_period',
  'willingness_to_relocate', 'linkedin_url', 'github_or_portfolio_url', 'resume_summary',
  'resume_text', 'ai_confidence_score', 'extraction_status', 'resume_file_path',
  'candidate_hash', 'resume_embedding', 'company_id', 'confidence_profile', 'work_history',
  'project_entries',
];
const CANDIDATE_MIRROR_JSON_COLUMNS = new Set(['confidence_profile', 'work_history', 'project_entries']);

export async function mirrorUpsertCandidate(row: Record<string, unknown>): Promise<void> {
  const columns = CANDIDATE_MIRROR_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (CANDIDATE_MIRROR_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO candidates (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

export async function mirrorDeleteCandidate(id: number): Promise<void> {
  const result = await pool.query('DELETE FROM candidates WHERE id = $1', [id]);
  if ((result.rowCount ?? 0) > 0) {
    await deleteReasoningConclusions('candidate', id);
  }
}

export async function updateCandidate(id: number, updates: Partial<Candidate>, companyId: number): Promise<Candidate | null> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'company_id') {
        fields.push(`${key} = $${paramIndex}`);
        let mappedValue = value;
        if (key === 'skills' && Array.isArray(value)) mappedValue = value.join(', ');
        else if (key === 'previous_companies' && Array.isArray(value)) mappedValue = value.join('; ');
        else if (key === 'certifications' && Array.isArray(value)) mappedValue = value.join('; ');
        // confidence_profile dual-write target (migration-phase1-intelligence-layer.sql) - JSONB
        // needs an explicit stringify, matching updateJob's identical tech_stack/parse_confidence handling.
        else if (key === 'confidence_profile') mappedValue = JSON.stringify(value ?? {});
        // Enterprise AI Matching Architecture, Phase 5 prerequisite - same JSONB stringify pattern.
        else if (key === 'work_history' || key === 'project_entries') mappedValue = JSON.stringify(value ?? []);
        // Enterprise AI Matching Architecture, §2.3 Project Intelligence Graph - same pattern.
        else if (key === 'project_intelligence') mappedValue = JSON.stringify(value ?? []);

        values.push(mappedValue);
        paramIndex++;

        // skills_array dual-write (migration-phase0-unified-matching.sql) - whenever `skills` is
        // updated, keep the GIN-indexed array projection in sync in the same statement. `skills`
        // itself (pushed above) remains the source of truth for every pre-existing read path.
        if (key === 'skills' && Array.isArray(value)) {
          fields.push(`skills_array = $${paramIndex}`);
          values.push((value as unknown[]).map((s) => String(s).trim()).filter((s) => s));
          paramIndex++;
        }
      }
    }

    if (fields.length === 0) return getCandidateById(id, companyId);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, companyId);

    const result = await pool.query(
      `UPDATE candidates SET ${fields.join(', ')} WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1} RETURNING *`,
      values
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertCandidate(row);
    return row ? mapRowToCandidate(row) : null;
  } catch (error) {
    console.error('Error updating candidate:', error);
    return null;
  }
}

// JOBS - scoped to the caller's company_id, derived server-side from req.user.
export async function getJobs(companyId: number): Promise<Job[]> {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE company_id = $1 AND status = \'open\' ORDER BY created_at DESC', [companyId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return [];
  }
}

export async function getJobById(id: number, companyId: number): Promise<Job | null> {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching job by id:', error);
    return null;
  }
}

export async function createJob(job: Omit<Job, 'id' | 'created_at' | 'updated_at'>): Promise<Job | null> {
  try {
    const result = await pool.query(
      `INSERT INTO jobs
       (company_id, title, description, required_skills, experience_years, location, salary_min, salary_max, status,
        optional_skills, min_experience, max_experience, experience_unit, remote_type, employment_type, industry,
        department, education, certifications, salary_currency, notice_period, number_of_openings, required_languages,
        responsibilities, tech_stack, keywords, job_summary, source_raw_text, parse_confidence,
        description_embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
       RETURNING *`,
      [
        job.company_id,
        job.title,
        job.description,
        job.required_skills,
        job.experience_years,
        job.location,
        job.salary_min,
        job.salary_max,
        job.status,
        job.optional_skills ?? [],
        job.min_experience ?? null,
        job.max_experience ?? null,
        job.experience_unit ?? null,
        job.remote_type ?? null,
        job.employment_type ?? null,
        job.industry ?? null,
        job.department ?? null,
        job.education ?? [],
        job.certifications ?? [],
        job.salary_currency ?? null,
        job.notice_period ?? null,
        job.number_of_openings ?? null,
        job.required_languages ?? [],
        job.responsibilities ?? [],
        JSON.stringify(job.tech_stack ?? {}),
        job.keywords ?? [],
        job.job_summary ?? null,
        job.source_raw_text ?? null,
        JSON.stringify(job.parse_confidence ?? {}),
        job.description_embedding ?? null,
      ]
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertJob(row);
    return row;
  } catch (error) {
    console.error('Error creating job:', error);
    return null;
  }
}

export async function updateJob(id: number, companyId: number, updates: Partial<Job>): Promise<Job | null> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'id' && key !== 'company_id') {
        fields.push(`${key} = $${paramIndex}`);
        let mappedValue: any = value;
        if (key === 'tech_stack' || key === 'parse_confidence') mappedValue = JSON.stringify(value ?? {});
        values.push(mappedValue);
        paramIndex++;
      }
    }

    if (fields.length === 0) return getJobById(id, companyId);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, companyId);

    const result = await pool.query(
      `UPDATE jobs SET ${fields.join(', ')} WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1} RETURNING *`,
      values
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertJob(row);
    return row || null;
  } catch (error) {
    console.error('Error updating job:', error);
    return null;
  }
}

export async function updateJobEmbedding(id: number, embedding: number[]): Promise<void> {
  try {
    await pool.query('UPDATE jobs SET description_embedding = $1 WHERE id = $2', [embedding, id]);
    dualWrite.patchJob(id, { description_embedding: embedding });
  } catch (error) {
    console.error('Error updating job embedding:', error);
  }
}

export async function updateJobStatus(id: number, status: 'open' | 'closed' | 'on_hold', companyId: number): Promise<Job | null> {
  try {
    const result = await pool.query(
      'UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND company_id = $3 RETURNING *',
      [status, id, companyId]
    );
    const row = result.rows[0];
    if (row) dualWrite.patchJob(id, { status: row.status, updated_at: row.updated_at });
    return row || null;
  } catch (error) {
    console.error('Error updating job status:', error);
    return null;
  }
}

// ==================== RAG KNOWLEDGE BASE (chatbot) ====================
export interface KnowledgeChunk {
  id: number;
  company_id: number | null;
  source_type: 'candidate' | 'job' | 'company';
  source_id: number;
  content: string;
  embedding: number[];
}

// Upsert-by-(source_type, source_id) so re-indexing an entity (e.g. a candidate edited after
// import) replaces its chunk instead of accumulating duplicates.
export async function upsertKnowledgeChunk(chunk: {
  company_id: number | null;
  source_type: 'candidate' | 'job' | 'company';
  source_id: number;
  content: string;
  embedding: number[];
}): Promise<void> {
  const result = await pool.query(
    `INSERT INTO knowledge_base_chunks (company_id, source_type, source_id, content, embedding)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_type, source_id)
     DO UPDATE SET company_id = $1, content = $4, embedding = $5, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [chunk.company_id, chunk.source_type, chunk.source_id, chunk.content, chunk.embedding]
  );
  dualWrite.upsertKnowledgeChunk(result.rows[0]); // Batch 17 (Chat Service)
}

export async function deleteKnowledgeChunk(sourceType: 'candidate' | 'job' | 'company', sourceId: number): Promise<void> {
  await pool.query('DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, sourceId]);
  dualWrite.deleteKnowledgeChunkMirror(sourceType, sourceId); // Batch 17 (Chat Service)
}

// Candidate/job/company chunks are all scoped to the caller's own company_id now that
// candidates carry one too. The `company_id IS NULL` branch is kept for any legacy chunks
// indexed before this field existed (or genuinely platform-wide chunks, if that's ever added).
export async function getKnowledgeChunksForCompany(companyId: number): Promise<KnowledgeChunk[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM knowledge_base_chunks WHERE company_id IS NULL OR company_id = $1`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching knowledge base chunks:', error);
    return [];
  }
}

export async function countKnowledgeChunks(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM knowledge_base_chunks');
  return result.rows[0]?.count ?? 0;
}

// SWIPES - scoped to company_id. Reads/deletes are filtered by it; recordSwipe requires it be
// passed in explicitly by the caller (derived from the swiped job's own company, already
// validated via getJobById before this is called - never taken from client input directly).
export async function getSwipes(companyId: number): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE company_id = $1 ORDER BY timestamp DESC', [companyId]);
    return result.rows.map(row => ({
      ...row,
      action: Number(row.action)
    }));
  } catch (error) {
    console.error('Error fetching swipes:', error);
    return [];
  }
}

export async function getSwipesByJobId(jobId: number, companyId: number): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE job_id = $1 AND company_id = $2 ORDER BY timestamp DESC', [jobId, companyId]);
    return result.rows.map(row => ({
      ...row,
      action: Number(row.action)
    }));
  } catch (error) {
    console.error('Error fetching swipes by job:', error);
    return [];
  }
}

export async function getSwipesByRecruiterId(recruiterId: number, companyId: number): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE recruiter_id = $1 AND company_id = $2 ORDER BY timestamp DESC', [recruiterId, companyId]);
    return result.rows.map(row => ({
      ...row,
      action: Number(row.action)
    }));
  } catch (error) {
    console.error('Error fetching swipes by recruiter:', error);
    return [];
  }
}

// ✅ THIS IS THE KEY FUNCTION - recordSwipe
export async function recordSwipe(swipe: {
  company_id: number;
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: number;
  match_score: number;
  used_for_training?: boolean;
  // Recruiter Review fields - both optional so the existing swipe-queue call site (POST
  // /swipes) is unaffected if it doesn't pass them; reason is only ever set by the
  // decision-change flow (PATCH /api/recruiter-review/:id/decision).
  reason?: string | null;
  breakdown?: unknown;
  // Analytics Hub decision-timing (see migration-analytics-decision-timing.sql) - optional so
  // any caller that doesn't measure it (or predates the feature) simply stores NULL.
  decision_time_seconds?: number | null;
}): Promise<Swipe | null> {
  try {
    console.log('📝 recordSwipe called with:', swipe);

    const result = await pool.query(
      `INSERT INTO swipes (company_id, recruiter_id, candidate_id, job_id, action, match_score, used_for_training, reason, breakdown, decision_time_seconds, timestamp)
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

    const savedRow = result.rows[0];
    console.log('✅ recordSwipe SUCCESS:', savedRow);
    dualWrite.upsertSwipe(savedRow);

    // Phase 3: fire-and-forget mutual-match check - never awaited, never throws into this
    // function, cannot change this response in any way. Returns instantly for every ordinary
    // recruiter-uploaded candidate (getLinkedCandidateAccountId resolves null for those).
    if (Number(swipe.action) === 1) {
      getLinkedCandidateAccountId(swipe.candidate_id)
        .then((candidateAccountId) => {
          if (candidateAccountId) return evaluateAndCreateMutualMatch(candidateAccountId, swipe.job_id);
        })
        .catch((err) => console.error('Error in post-swipe match check:', err));
    }

    // Phase 5: fire-and-forget application-status sync - runs for every action (0/0.5/1),
    // unlike the match-check hook above. Covers both POST /swipes and PATCH
    // /recruiter-review/:id/decision, since both call this same function - no changes needed
    // to either route file. Never awaited, never throws into this response.
    syncApplicationStatusFromRecruiterDecision(swipe.candidate_id, swipe.job_id, swipe.company_id, Number(swipe.action)).catch((err) =>
      console.error('Error in post-swipe application status sync:', err)
    );

    return {
      ...savedRow,
      action: Number(savedRow.action)
    };
  } catch (error) {
    console.error('❌ recordSwipe FAILED:', error);
    return null;
  }
}

// ==================== reverse mirror (write-cutover completion plan, Phase C) ====================
// Matching Decision Service is now the write-authority for `swipes` (its own real INSERT, its own
// sequence assigns new ids - see matching-decision-service/migrations/002_resync_sequences.up.sql
// for the primary-key-collision bug found and fixed before this could ship). This keeps THIS
// table (the monolith's own copy) fresh by explicit id, the same reverse-mirror shape as
// mirrorUpsertJob/mirrorUpsertCandidate above, so recruiter-review.routes.ts's list/detail views
// (staying monolith-local, reading this table directly) keep seeing real data. Called from
// src/api/matching-decision-internal.routes.ts's new POST /swipes/mirror-and-notify, which then
// re-fires recordSwipe's own hook bundle (mutual-match check, syncApplicationStatusFromRecruiter
// Decision) plus recordSwipeWithSideEffects's (shadow logging, broadcastEvent, enqueueRetrain)
// against the now-mirrored row - dualWrite.upsertSwipe is deliberately NOT called here (unlike
// recordSwipe above); this service IS dual-write's target, not its source, for this table now.
const SWIPE_MIRROR_COLUMNS = [
  'id', 'company_id', 'recruiter_id', 'candidate_id', 'job_id', 'action', 'match_score',
  'used_for_training', 'reason', 'breakdown', 'decision_time_seconds', 'timestamp',
];
const SWIPE_MIRROR_JSON_COLUMNS = new Set(['breakdown']);

export async function mirrorUpsertSwipe(row: Record<string, unknown>): Promise<void> {
  const columns = SWIPE_MIRROR_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (SWIPE_MIRROR_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO swipes (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

// ==================== reverse mirror (write-cutover completion plan, Phase D) ====================
// Matching Decision Service is now the write-authority for `recruiter_notes` and
// `detailed_scoring_reports` too, same reverse-mirror shape as mirrorUpsertSwipe above - explicit
// id, never re-running this table's own sequence. Called from src/api/matching-decision-internal
// .routes.ts's new POST /recruiter-review/notes/mirror-and-notify and .../detailed-score/mirror-
// and-notify. Neither has a hook bundle to re-fire (the monolith's own upsertRecruiterNoteForSwipe/
// generateAndSaveDetailedScore never had background side effects beyond the write itself) - unlike
// mirrorUpsertSwipe, these two are the entire job of their endpoints.
const RECRUITER_NOTE_MIRROR_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'note', 'created_by', 'updated_by', 'created_at', 'updated_at'];

export async function mirrorUpsertRecruiterNote(row: Record<string, unknown>): Promise<void> {
  const columns = RECRUITER_NOTE_MIRROR_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => row[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO recruiter_notes (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

const DETAILED_SCORING_REPORT_MIRROR_COLUMNS = ['id', 'company_id', 'candidate_id', 'job_id', 'report', 'generated_by', 'generated_at'];
const DETAILED_SCORING_REPORT_MIRROR_JSON_COLUMNS = new Set(['report']);

export async function mirrorUpsertDetailedScoringReport(row: Record<string, unknown>): Promise<void> {
  const columns = DETAILED_SCORING_REPORT_MIRROR_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (DETAILED_SCORING_REPORT_MIRROR_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO detailed_scoring_reports (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

// Deliberate, documented exceptions to company scoping - used only by (a) the ML ensemble,
// which trains pooled across every company since it only ever sees numeric feature vectors
// (Jaccard/cosine/Euclidean scores), never candidate/job PII, and (b) the admin-only
// /api/chat/reindex full resync, which by design rebuilds the knowledge base for every
// company at once. Every other candidate/job/swipe read above requires a companyId; these
// intentionally don't.
export async function getAllSwipesUnscoped(): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes ORDER BY timestamp DESC');
    return result.rows.map(row => ({ ...row, action: Number(row.action) }));
  } catch (error) {
    console.error('Error fetching all swipes for training:', error);
    return [];
  }
}

// Enterprise AI Matching Architecture, Phase 3 - Feedback Learning Engine. candidate_application_
// status is keyed by candidate_account_id (the candidate-portal login identity), not candidates.id
// (the recruiter-facing resume record swipes.candidate_id points at) - most recruiter-uploaded
// candidates have candidate_account_id = NULL (no portal account at all), so this join only ever
// corroborates the subset of swipes whose candidate also has a linked self-service account. That
// is real and expected, not a bug - see src/matching/feedbackSignals.ts's module doc. Pooled
// across companies for the same reason getAllSwipesUnscoped is (feeds the same training set).
export async function getAllApplicationStatusLinkedToCandidatesUnscoped(): Promise<Array<{ candidate_id: number; job_id: number; status: string }>> {
  try {
    const result = await pool.query(
      `SELECT c.id AS candidate_id, cas.job_id, cas.status
       FROM candidate_application_status cas
       JOIN candidates c ON c.candidate_account_id = cas.candidate_account_id AND c.company_id = cas.company_id`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching application status linked to candidates for training:', error);
    return [];
  }
}

export async function getAllCandidatesUnscoped(): Promise<Candidate[]> {
  try {
    const result = await pool.query('SELECT * FROM candidates ORDER BY created_at DESC');
    return result.rows.map(mapRowToCandidate);
  } catch (error) {
    console.error('Error fetching all candidates for training:', error);
    return [];
  }
}

export async function getAllJobsUnscoped(): Promise<Job[]> {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE status = \'open\' ORDER BY created_at DESC');
    return result.rows;
  } catch (error) {
    console.error('Error fetching all jobs for training:', error);
    return [];
  }
}

// ==================== CANDIDATE JOB DISCOVERY (Phase 2 - cross-tenant, read-only) ====================
// The first API-exposed cross-tenant job query in this codebase (getAllJobsUnscoped above is
// the only precedent, and it's internal-only, never reached via a route). Uses an explicit
// column allowlist - never SELECT * - so recruiter-internal fields (source_raw_text,
// parse_confidence, description_embedding, company_id itself) and anything from
// recruiter_notes/detailed_scoring_reports/swipes/match_scores (none of which are joined here)
// can never reach a candidate, regardless of what the API route requests.
const OPEN_JOB_PUBLIC_COLUMNS = `
  j.id, j.title, j.description, j.required_skills, j.optional_skills, j.experience_years,
  j.min_experience, j.max_experience, j.experience_unit, j.location, j.remote_type,
  j.employment_type, j.industry, j.department, j.education, j.certifications,
  j.salary_min, j.salary_max, j.salary_currency, j.number_of_openings, j.required_languages,
  j.responsibilities, j.job_summary, j.created_at,
  c.name AS company_name, c.logo_url AS company_logo_url
`;

export interface OpenJobsFilters {
  search?: string;
  skill?: string;
  location?: string;
  company?: string;
  page?: number;
  pageSize?: number;
}

export async function getOpenJobsPublic(filters: OpenJobsFilters = {}): Promise<{ jobs: any[]; total: number }> {
  try {
    const conditions: string[] = [`j.status = 'open'`];
    const params: any[] = [];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(j.title ILIKE $${params.length} OR j.job_summary ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (filters.skill) {
      params.push(`%${filters.skill}%`);
      conditions.push(`EXISTS (SELECT 1 FROM unnest(j.required_skills) s WHERE s ILIKE $${params.length})`);
    }
    if (filters.location) {
      params.push(`%${filters.location}%`);
      conditions.push(`j.location ILIKE $${params.length}`);
    }
    if (filters.company) {
      params.push(`%${filters.company}%`);
      conditions.push(`c.name ILIKE $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const pageSize = Math.min(Math.max(filters.pageSize || 20, 1), 100);
    const page = Math.max(filters.page || 1, 1);
    const offset = (page - 1) * pageSize;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const listParams = [...params, pageSize, offset];
    const result = await pool.query(
      `SELECT ${OPEN_JOB_PUBLIC_COLUMNS} FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE ${whereClause} ORDER BY j.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return { jobs: result.rows, total };
  } catch (error) {
    console.error('Error fetching public open jobs:', error);
    return { jobs: [], total: 0 };
  }
}

export async function getOpenJobByIdPublic(id: number): Promise<any | null> {
  try {
    const result = await pool.query(
      `SELECT ${OPEN_JOB_PUBLIC_COLUMNS} FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1 AND j.status = 'open'`,
      [id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching public open job by id:', error);
    return null;
  }
}

export async function getUnusedSwipesForTraining(): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE used_for_training = false');
    return result.rows.map(row => ({
      ...row,
      action: Number(row.action)
    }));
  } catch (error) {
    console.error('Error fetching unused swipes:', error);
    return [];
  }
}

export async function markSwipesAsUsedForTraining(swipeIds: number[]): Promise<void> {
  if (swipeIds.length === 0) return;
  try {
    const placeholders = swipeIds.map((_, i) => `$${i + 1}`).join(',');
    await pool.query(`UPDATE swipes SET used_for_training = true WHERE id IN (${placeholders})`, swipeIds);
  } catch (error) {
    console.error('Error marking swipes as used:', error);
  }
}

// ==================== RECRUITER REVIEW ====================
// swipes is already an append-only decision log (recordSwipe only ever INSERTs) - these
// functions read the *latest* row per (candidate_id, job_id) pair for the main list, while
// full history remains queryable per-pair for the detail panel. Nothing here ever deletes or
// updates an existing swipe row.

export async function getSwipeById(id: number, companyId: number): Promise<Swipe | null> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rows[0] ? { ...result.rows[0], action: Number(result.rows[0].action) } : null;
  } catch (error) {
    console.error('Error fetching swipe by id:', error);
    return null;
  }
}

export interface RecruiterReviewFilters {
  search?: string;
  jobId?: number;
  decision?: 'accepted' | 'rejected' | 'saved';
  recruiterId?: number;
  dateFrom?: string;
  dateTo?: string;
  minExperience?: number;
  maxExperience?: number;
  skills?: string[];
  minScore?: number;
  maxScore?: number;
  sortBy?: 'latest_decision' | 'oldest_decision' | 'highest_score' | 'lowest_score' | 'name_asc' | 'name_desc';
  page: number;
  pageSize: number;
}

const RECRUITER_REVIEW_SORT: Record<string, string> = {
  latest_decision: 'latest.timestamp DESC',
  oldest_decision: 'latest.timestamp ASC',
  highest_score: 'latest.match_score DESC NULLS LAST',
  lowest_score: 'latest.match_score ASC NULLS LAST',
  name_asc: 'c.name ASC',
  name_desc: 'c.name DESC',
};

export async function getRecruiterReviewList(companyId: number, filters: RecruiterReviewFilters): Promise<{ rows: any[]; totalRecords: number }> {
  try {
    const params: any[] = [companyId];
    const conditions: string[] = [];

    const addParam = (val: any) => { params.push(val); return `$${params.length}`; };

    if (filters.jobId) conditions.push(`latest.job_id = ${addParam(filters.jobId)}`);
    if (filters.decision) {
      const actionValue = filters.decision === 'accepted' ? 1 : filters.decision === 'rejected' ? 0 : 0.5;
      conditions.push(`latest.action = ${addParam(actionValue)}`);
    }
    if (filters.recruiterId) conditions.push(`latest.recruiter_id = ${addParam(filters.recruiterId)}`);
    if (filters.dateFrom) conditions.push(`latest.timestamp >= ${addParam(filters.dateFrom)}`);
    if (filters.dateTo) conditions.push(`latest.timestamp <= ${addParam(filters.dateTo)}`);
    if (filters.minScore !== undefined) conditions.push(`latest.match_score >= ${addParam(filters.minScore)}`);
    if (filters.maxScore !== undefined) conditions.push(`latest.match_score <= ${addParam(filters.maxScore)}`);
    if (filters.minExperience !== undefined) {
      conditions.push(`NULLIF(regexp_replace(c.years_of_experience, '[^0-9.].*', ''), '')::numeric >= ${addParam(filters.minExperience)}`);
    }
    if (filters.maxExperience !== undefined) {
      conditions.push(`NULLIF(regexp_replace(c.years_of_experience, '[^0-9.].*', ''), '')::numeric <= ${addParam(filters.maxExperience)}`);
    }
    if (filters.skills && filters.skills.length > 0) {
      const skillConditions = filters.skills.map((skill) => `c.skills ILIKE ${addParam(`%${skill}%`)}`);
      conditions.push(`(${skillConditions.join(' OR ')})`);
    }
    if (filters.search) {
      const term = addParam(`%${filters.search}%`);
      conditions.push(`(c.name ILIKE ${term} OR c.email ILIKE ${term} OR c.phone ILIKE ${term} OR c.primary_skills ILIKE ${term} OR c.current_company ILIKE ${term})`);
    }

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
    const orderBy = RECRUITER_REVIEW_SORT[filters.sortBy || 'latest_decision'] || RECRUITER_REVIEW_SORT.latest_decision;
    const limitParam = addParam(filters.pageSize);
    const offsetParam = addParam((filters.page - 1) * filters.pageSize);

    const query = `
      WITH latest AS (
        SELECT DISTINCT ON (candidate_id, job_id) *
        FROM swipes
        WHERE company_id = $1
        ORDER BY candidate_id, job_id, timestamp DESC, id DESC
      )
      SELECT
        latest.id AS swipe_id,
        latest.candidate_id,
        latest.job_id,
        latest.action,
        latest.match_score,
        latest.reason,
        latest.timestamp AS decision_date,
        latest.recruiter_id,
        u.name AS recruiter_name,
        c.name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.current_job_title,
        c.current_company,
        c.years_of_experience,
        c.primary_skills,
        j.title AS job_title,
        rn.note AS recruiter_note,
        rn.updated_at AS note_updated_at,
        COUNT(*) OVER() AS total_count
      FROM latest
      JOIN candidates c ON c.id = latest.candidate_id
      JOIN jobs j ON j.id = latest.job_id
      LEFT JOIN users u ON u.id = latest.recruiter_id
      LEFT JOIN recruiter_notes rn ON rn.company_id = latest.company_id AND rn.candidate_id = latest.candidate_id AND rn.job_id = latest.job_id
      WHERE 1=1 ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await pool.query(query, params);
    const totalRecords = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    return { rows: result.rows.map((r) => ({ ...r, action: Number(r.action) })), totalRecords };
  } catch (error) {
    console.error('Error fetching recruiter review list:', error);
    return { rows: [], totalRecords: 0 };
  }
}

// Candidates whose LATEST swipe for this job is 0.5 ("Saved") - i.e. shortlisted from Job
// Positions' Select button (or SwipeInterface's own "Save for later" gesture) but not yet
// finalized to Accepted/Rejected. Powers the AI Match Candidates queue's shortlist-only filter -
// see GET /api/matches/queue/:job_id.
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

// ==================== MUTUAL MATCHING ENGINE (Phase 3) ====================
// Bridges the recruiter-owned `candidates` table (swiped on by recruiters, unchanged) and the
// self-owned `candidate_accounts` identity (Phase 1/2) via candidates.candidate_account_id -
// set only when a candidate's own positive decision auto-creates/reuses a candidates row.
// candidate_decisions mirrors swipes' append-only, action-NUMERIC, latest-row-via-DISTINCT-ON
// shape exactly, on purpose, so match evaluation can read both sides symmetrically.

export async function getJobCompanyId(jobId: number): Promise<number | null> {
  try {
    const result = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
    return result.rows[0]?.company_id ?? null;
  } catch (error) {
    console.error('Error fetching job company id:', error);
    return null;
  }
}

export async function getOrCreateLinkedCandidateRow(candidateAccountId: number, companyId: number): Promise<number | null> {
  try {
    const existing = await pool.query(
      'SELECT id FROM candidates WHERE candidate_account_id = $1 AND company_id = $2',
      [candidateAccountId, companyId]
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const account = await pool.query('SELECT * FROM candidate_accounts WHERE id = $1', [candidateAccountId]);
    const profile = account.rows[0];
    if (!profile) return null;

    const skills = Array.isArray(profile.skills) && profile.skills.length > 0 ? profile.skills.join(', ') : 'NULL';
    // skills_array dual-write (migration-phase0-unified-matching.sql) - candidate_accounts.skills
    // is already a real array, so this is a direct pass-through, not a re-parse.
    const skillsArray: string[] = Array.isArray(profile.skills) ? profile.skills : [];
    const result = await pool.query(
      `INSERT INTO candidates (company_id, candidate_account_id, name, email, phone, skills, years_of_experience, current_location, education, resume_summary, skills_array)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        companyId,
        candidateAccountId,
        profile.name,
        profile.email || 'NULL',
        profile.phone || 'NULL',
        skills,
        profile.years_of_experience || 'NULL',
        profile.location || 'NULL',
        profile.education || 'NULL',
        profile.summary || 'NULL',
        skillsArray,
      ]
    );
    const row = result.rows[0];
    dualWrite.upsertCandidate(row);
    return row.id;
  } catch (error: any) {
    if (error.code === '23505') {
      // Unique-violation on (candidate_account_id, company_id) - a concurrent request already
      // created the linked row between our check and our insert. Fetch and use that one.
      const existing = await pool.query(
        'SELECT id FROM candidates WHERE candidate_account_id = $1 AND company_id = $2',
        [candidateAccountId, companyId]
      );
      if (existing.rows[0]) return existing.rows[0].id;
    }
    console.error('Error linking candidate account to candidates row:', error);
    return null;
  }
}

export async function recordCandidateDecision(params: { candidateAccountId: number; jobId: number; action: number; decisionType: 'swipe_right' | 'swipe_left' | 'apply' }): Promise<any | null> {
  try {
    const result = await pool.query(
      `INSERT INTO candidate_decisions (candidate_account_id, job_id, action, decision_type, "timestamp")
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [params.candidateAccountId, params.jobId, params.action, params.decisionType]
    );
    const row = result.rows[0];
    if (row) {
      dualWrite.upsertCandidateDecision({
        id: row.id,
        candidate_account_id: row.candidate_account_id,
        job_id: row.job_id,
        decision_type: row.decision_type,
        decision_date: row.timestamp,
        created_at: row.timestamp,
        updated_at: row.timestamp,
      });
    }
    return row;
  } catch (error) {
    console.error('Error recording candidate decision:', error);
    return null;
  }
}

export async function getLatestCandidateDecision(candidateAccountId: number, jobId: number): Promise<any | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM candidate_decisions WHERE candidate_account_id = $1 AND job_id = $2 ORDER BY timestamp DESC, id DESC LIMIT 1`,
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
       JOIN jobs j ON j.id = cd.job_id
       JOIN companies c ON c.id = j.company_id
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
      actionFilter = `WHERE latest.action = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (cd.job_id) cd.id, cd.job_id, cd.action, cd.decision_type, cd.timestamp,
                j.title AS job_title, j.location AS location, c.name AS company_name, c.logo_url AS company_logo_url
         FROM candidate_decisions cd
         JOIN jobs j ON j.id = cd.job_id
         JOIN companies c ON c.id = j.company_id
         WHERE cd.candidate_account_id = $1
         ORDER BY cd.job_id, cd.timestamp DESC, cd.id DESC
       ) latest
       ${actionFilter}
       ORDER BY latest.timestamp DESC`,
      params
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching active candidate decisions:', error);
    return [];
  }
}

// Single atomic statement - no check-then-act race regardless of which side (candidate
// decision or recruiter swipe) triggers the evaluation. ON CONFLICT DO NOTHING against the
// mutual_matches_candidate_job_key UNIQUE constraint is the DB-enforced duplicate guard.
async function tryCreateMutualMatchAtomic(candidateAccountId: number, jobId: number, companyId: number, candidatesId: number): Promise<void> {
  try {
    // RETURNING * (Phase 4, extended by Item 4) - a row only comes back when this call is the one that actually
    // inserted the match (not skipped by ON CONFLICT), so notification creation below inherits
    // mutual_matches' own exactly-once guarantee for free: no separate dedup logic needed. Full row needed for dual-write mirror.
    const result = await pool.query(
      `INSERT INTO mutual_matches (candidate_account_id, job_id, company_id, candidates_id)
       SELECT $1, $2, $3, $4
       WHERE (
         SELECT action FROM candidate_decisions
         WHERE candidate_account_id = $1 AND job_id = $2
         ORDER BY timestamp DESC, id DESC LIMIT 1
       ) = 1
       AND (
         SELECT action FROM swipes
         WHERE candidate_id = $4 AND job_id = $2 AND company_id = $3
         ORDER BY timestamp DESC, id DESC LIMIT 1
       ) = 1
       ON CONFLICT (candidate_account_id, job_id) DO NOTHING
       RETURNING *`,
      [candidateAccountId, jobId, companyId, candidatesId]
    );

    const matchRow = result.rows[0];
    if (matchRow) {
      // Never let a notification failure look like it affected the match itself - the match
      // row above is already committed regardless of what happens here.
      createMatchNotifications(matchRow.id, candidateAccountId, jobId, companyId, candidatesId).catch((err) =>
        console.error('Error creating match notifications:', err)
      );
      // Mirror to candidate-service (fire-and-forget, non-fatal)
      dualWrite.upsertMutualMatch({
        id: matchRow.id,
        candidate_account_id: matchRow.candidate_account_id,
        job_id: matchRow.job_id,
        match_score: matchRow.match_score ?? null,
        created_at: matchRow.created_at,
        updated_at: matchRow.updated_at,
      });
    }
  } catch (error) {
    console.error('Error evaluating mutual match:', error);
  }
}

// Phase 4: fires exactly once per match (see RETURNING id above). Creates one notification for
// the candidate and one for the specific recruiter whose latest action=1 swipe completed the
// match (swipes.recruiter_id) - the same "latest row wins" convention used everywhere else in
// this codebase. Each INSERT also carries its own ON CONFLICT DO NOTHING as a second,
// independent, DB-level duplicate guard.
async function createMatchNotifications(matchId: number, candidateAccountId: number, jobId: number, companyId: number, candidatesId: number): Promise<void> {
  const jobRes = await pool.query(
    `SELECT j.title, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
    [jobId]
  );
  const jobTitle = jobRes.rows[0]?.title || 'a job';
  const companyName = jobRes.rows[0]?.company_name;

  const candidateNotifTitle = `You matched with ${jobTitle}`;
  const candidateNotifMessage = `You and the recruiter both showed interest${companyName ? ` at ${companyName}` : ''} for ${jobTitle}. Check out your match!`;
  const candidateNotifRes = await pool.query(
    `INSERT INTO candidate_notifications (candidate_account_id, match_id, type, title, message)
     VALUES ($1, $2, 'match_created', $3, $4)
     ON CONFLICT (candidate_account_id, match_id, type) DO NOTHING
     RETURNING id, read_at, created_at`,
    [candidateAccountId, matchId, candidateNotifTitle, candidateNotifMessage]
  );
  const candidateNotifRow = candidateNotifRes.rows[0];
  if (candidateNotifRow) {
    dualWrite.upsertCandidateNotification({
      id: candidateNotifRow.id, candidate_account_id: candidateAccountId, match_id: matchId,
      type: 'match_created', title: candidateNotifTitle, message: candidateNotifMessage,
      read_at: candidateNotifRow.read_at, created_at: candidateNotifRow.created_at, job_id: null,
    });
  }

  const swipeRes = await pool.query(
    `SELECT recruiter_id FROM swipes WHERE candidate_id = $1 AND job_id = $2 AND company_id = $3 AND action = 1 ORDER BY timestamp DESC, id DESC LIMIT 1`,
    [candidatesId, jobId, companyId]
  );
  const recruiterId = swipeRes.rows[0]?.recruiter_id;
  if (recruiterId) {
    const title = `New mutual match for ${jobTitle}`;
    const message = `A candidate matched with your job posting for ${jobTitle}.`;
    const notifRes = await pool.query(
      `INSERT INTO recruiter_notifications (user_id, company_id, match_id, type, title, message)
       VALUES ($1, $2, $3, 'match_created', $4, $5)
       ON CONFLICT (user_id, match_id, type) DO NOTHING
       RETURNING id, read_at, created_at`,
      [recruiterId, companyId, matchId, title, message]
    );
    const notifRow = notifRes.rows[0];
    if (notifRow) {
      dualWrite.upsertRecruiterNotification({
        id: notifRow.id, user_id: recruiterId, company_id: companyId, match_id: matchId,
        type: 'match_created', title, message, read_at: notifRow.read_at, created_at: notifRow.created_at,
      });
    }
  }
}

// Called from the candidate-decision path (candidateAccountId/jobId known directly) and from
// the recruiter-swipe hook (via getLinkedCandidateAccountId below) - the single shared entry
// point for evaluating "did this pair just become a match" from either direction.
export async function evaluateAndCreateMutualMatch(candidateAccountId: number, jobId: number): Promise<void> {
  try {
    const jobRes = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
    const companyId = jobRes.rows[0]?.company_id;
    if (!companyId) return;

    const linked = await pool.query(
      'SELECT id FROM candidates WHERE candidate_account_id = $1 AND company_id = $2',
      [candidateAccountId, companyId]
    );
    const candidatesId = linked.rows[0]?.id;
    if (!candidatesId) return; // no linked candidates row yet - recruiter couldn't have swiped on this candidate

    await tryCreateMutualMatchAtomic(candidateAccountId, jobId, companyId, candidatesId);
  } catch (error) {
    console.error('Error evaluating mutual match:', error);
  }
}

// Used only by the recordSwipe fire-and-forget hook - returns null for every ordinary,
// resume-uploaded candidates row (candidate_account_id is NULL), which is the common case.
export async function getLinkedCandidateAccountId(candidatesId: number): Promise<number | null> {
  try {
    const result = await pool.query('SELECT candidate_account_id FROM candidates WHERE id = $1', [candidatesId]);
    return result.rows[0]?.candidate_account_id ?? null;
  } catch (error) {
    console.error('Error looking up linked candidate account:', error);
    return null;
  }
}

// Candidate Explore/Likes redesign: the reverse lookup of getLinkedCandidateAccountId above -
// "has the recruiter made a swipe decision on this candidate for this job yet". Read-only over
// the existing candidates + swipes tables (the same two tables the mutual-match hook already
// reads/writes) - no new table, no write. Returns null when the recruiter hasn't acted yet
// (either no linked candidates row exists for this company, or one exists but has no swipe on
// this job) - the caller displays that as "waiting for review".
export async function getRecruiterDecisionForCandidateJob(candidateAccountId: number, jobId: number): Promise<{ action: number; timestamp: string } | null> {
  try {
    const jobRes = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
    const companyId = jobRes.rows[0]?.company_id;
    if (!companyId) return null;

    const linked = await pool.query(
      'SELECT id FROM candidates WHERE candidate_account_id = $1 AND company_id = $2',
      [candidateAccountId, companyId]
    );
    const candidatesId = linked.rows[0]?.id;
    if (!candidatesId) return null;

    const swipeRes = await pool.query(
      `SELECT action, "timestamp" FROM swipes WHERE candidate_id = $1 AND job_id = $2 ORDER BY "timestamp" DESC, id DESC LIMIT 1`,
      [candidatesId, jobId]
    );
    if (!swipeRes.rows[0]) return null;
    return { action: Number(swipeRes.rows[0].action), timestamp: swipeRes.rows[0].timestamp };
  } catch (error) {
    console.error('Error looking up recruiter decision for candidate job:', error);
    return null;
  }
}

// ==================== APPLICATION STATUS (Phase 5) ====================
// "Applied" is deliberately never written eagerly - it's the read-time default (COALESCE)
// for any job the candidate has a decision_type='apply' row for but no
// candidate_application_status row yet. The ONLY write path is
// syncApplicationStatusFromRecruiterDecision, called from recordSwipe's hook above - there is
// no separate "create application" function, matching the fact that candidate-decisions.routes.ts
// (where the apply action itself is recorded) is explicitly not modified in this phase.
// 'under_review' is a valid, schema-supported status but has no automatic trigger from the
// existing 3-state swipe system (0=reject, 0.5=save/shortlist, 1=accept) - documented here
// rather than invented a fake heuristic to reach it.

export async function syncApplicationStatusFromRecruiterDecision(candidatesId: number, jobId: number, companyId: number, action: number): Promise<void> {
  try {
    const candidateAccountId = await getLinkedCandidateAccountId(candidatesId);
    if (!candidateAccountId) return; // ordinary resume-uploaded candidate, not self-applied

    // Only sync a status for a job the candidate formally applied to (decision_type='apply') -
    // a recruiter swiping on someone who only ever swiped-right (interested, not applied) here,
    // or applied to a different job at this company, gets no status row.
    const appliedCheck = await pool.query(
      `SELECT 1 FROM candidate_decisions WHERE candidate_account_id = $1 AND job_id = $2 AND decision_type = 'apply' LIMIT 1`,
      [candidateAccountId, jobId]
    );
    if (appliedCheck.rows.length === 0) return;

    const status = action === 1 ? 'accepted' : action === 0 ? 'rejected' : 'shortlisted';

    const existing = await pool.query(
      `SELECT status FROM candidate_application_status WHERE candidate_account_id = $1 AND job_id = $2`,
      [candidateAccountId, jobId]
    );
    if (existing.rows[0]?.status === status) return; // no-op - avoids a duplicate notification for an unchanged status

    const result = await pool.query(
      `INSERT INTO candidate_application_status (candidate_account_id, job_id, company_id, status, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (candidate_account_id, job_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
       RETURNING *`,
      [candidateAccountId, jobId, companyId, status]
    );

    const statusRow = result.rows[0];
    if (statusRow) {
      // Mirror to candidate-service (fire-and-forget, non-fatal)
      dualWrite.upsertCandidateApplicationStatus({
        id: statusRow.id,
        candidate_account_id: statusRow.candidate_account_id,
        job_id: statusRow.job_id,
        status: statusRow.status,
        updated_at: statusRow.updated_at,
      });
    }

    const jobRes = await pool.query('SELECT title FROM jobs WHERE id = $1', [jobId]);
    const jobTitle = jobRes.rows[0]?.title || 'a job';
    const statusLabel = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Shortlisted';

    // Reuses Phase 4's candidate_notifications table (job_id now nullable-widened to support
    // this non-match notification type) - candidate only, recruiter gets nothing per spec.
    const appStatusTitle = `Application update: ${jobTitle}`;
    const appStatusMessage = `Your application for ${jobTitle} is now ${statusLabel}.`;
    const appStatusNotifRes = await pool.query(
      `INSERT INTO candidate_notifications (candidate_account_id, job_id, type, title, message)
       VALUES ($1, $2, 'application_status_changed', $3, $4)
       RETURNING id, read_at, created_at`,
      [candidateAccountId, jobId, appStatusTitle, appStatusMessage]
    );
    const appStatusNotifRow = appStatusNotifRes.rows[0];
    if (appStatusNotifRow) {
      dualWrite.upsertCandidateNotification({
        id: appStatusNotifRow.id, candidate_account_id: candidateAccountId, match_id: null,
        type: 'application_status_changed', title: appStatusTitle, message: appStatusMessage,
        read_at: appStatusNotifRow.read_at, created_at: appStatusNotifRow.created_at, job_id: jobId,
      });
    }
  } catch (error) {
    console.error('Error syncing application status:', error);
  }
}

export async function getCandidateApplications(candidateAccountId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (cd.job_id)
              cd.job_id, cd.timestamp AS applied_at,
              j.title AS job_title, c.name AS company_name, c.logo_url AS company_logo_url,
              COALESCE(cas.status, 'applied') AS status,
              COALESCE(cas.updated_at, cd.timestamp) AS last_updated
       FROM candidate_decisions cd
       JOIN jobs j ON j.id = cd.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN candidate_application_status cas ON cas.candidate_account_id = cd.candidate_account_id AND cas.job_id = cd.job_id
       WHERE cd.candidate_account_id = $1 AND cd.decision_type = 'apply'
       ORDER BY cd.job_id, cd.timestamp ASC`,
      [candidateAccountId]
    );
    return result.rows.sort((a: any, b: any) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());
  } catch (error) {
    console.error('Error fetching candidate applications:', error);
    return [];
  }
}

export async function getCandidateApplication(candidateAccountId: number, jobId: number): Promise<any | null> {
  try {
    const result = await pool.query(
      `SELECT cd.job_id, MIN(cd.timestamp) AS applied_at,
              j.title AS job_title, j.location, j.employment_type,
              c.name AS company_name, c.logo_url AS company_logo_url,
              COALESCE(cas.status, 'applied') AS status,
              COALESCE(cas.updated_at, MIN(cd.timestamp)) AS last_updated
       FROM candidate_decisions cd
       JOIN jobs j ON j.id = cd.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN candidate_application_status cas ON cas.candidate_account_id = cd.candidate_account_id AND cas.job_id = cd.job_id
       WHERE cd.candidate_account_id = $1 AND cd.job_id = $2 AND cd.decision_type = 'apply'
       GROUP BY cd.job_id, j.title, j.location, j.employment_type, c.name, c.logo_url, cas.status, cas.updated_at`,
      [candidateAccountId, jobId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate application:', error);
    return null;
  }
}

// ==================== CANDIDATE ANALYTICS (read-only aggregation, no schema change) ====================
// Every function below only SELECTs from existing tables via patterns already established
// elsewhere (getCandidateActiveDecisions' latest-decision-per-job dedup, getRecruiterDecision
// ForCandidateJob's candidates->swipes join) - none of it writes, and none of it touches an
// existing function, so Likes/Applications/Matches/Explore behavior is provably unaffected.

// Full job detail (required_skills/salary/experience/description) for the candidate's liked
// jobs - getCandidateActiveDecisions doesn't select these columns since Likes/Applications never
// needed them, so this is a new, separate query rather than widening a function three other
// screens depend on.
export async function getCandidateLikedJobsForAnalytics(candidateAccountId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (cd.job_id) cd.job_id, cd.action, cd.timestamp,
                j.title, j.location, j.required_skills, j.description,
                j.salary_min, j.salary_max, j.experience_years, j.min_experience, j.max_experience
         FROM candidate_decisions cd
         JOIN jobs j ON j.id = cd.job_id
         WHERE cd.candidate_account_id = $1
         ORDER BY cd.job_id, cd.timestamp DESC, cd.id DESC
       ) latest
       WHERE latest.action = 1
       ORDER BY latest.timestamp DESC`,
      [candidateAccountId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate liked jobs for analytics:', error);
    return [];
  }
}

// Aggregates across every company this candidate has a linked `candidates` row in (a candidate
// can have one per company, same as getRecruiterDecisionForCandidateJob's per-job lookup does) -
// "reviewed" = at least one swipe recorded for that job, "interested" = the latest swipe for
// that job is action=1. Distinct job_id, not distinct swipe rows, since a recruiter can change
// their decision (re-swipe) and that must count once, not twice.
export async function getCandidateRecruiterReviewStats(candidateAccountId: number): Promise<{ reviewedJobIds: number[]; interestedJobIds: number[] }> {
  try {
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (s.job_id) s.job_id, s.action
         FROM candidates cand
         JOIN swipes s ON s.candidate_id = cand.id
         WHERE cand.candidate_account_id = $1
         ORDER BY s.job_id, s.timestamp DESC, s.id DESC
       ) latest`,
      [candidateAccountId]
    );
    const reviewedJobIds = result.rows.map((r) => r.job_id);
    const interestedJobIds = result.rows.filter((r) => Number(r.action) === 1).map((r) => r.job_id);
    return { reviewedJobIds, interestedJobIds };
  } catch (error) {
    console.error('Error fetching candidate recruiter review stats:', error);
    return { reviewedJobIds: [], interestedJobIds: [] };
  }
}

// candidate_profile_views is a per-recruiter snapshot (UNIQUE recruiter+candidate, re-viewed
// just bumps viewed_at) - a correct total-distinct-viewers count, not a historical event count.
export async function getCandidateProfileViewCount(candidateAccountId: number): Promise<number> {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM candidate_profile_views WHERE candidate_account_id = $1', [candidateAccountId]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Error fetching candidate profile view count:', error);
    return 0;
  }
}

export async function getCandidateApplicationStatusCounts(candidateAccountId: number): Promise<Record<string, number>> {
  try {
    const result = await pool.query(
      `SELECT COALESCE(cas.status, 'applied') AS status, COUNT(*) FROM candidate_decisions cd
       LEFT JOIN candidate_application_status cas ON cas.candidate_account_id = cd.candidate_account_id AND cas.job_id = cd.job_id
       WHERE cd.candidate_account_id = $1 AND cd.decision_type = 'apply'
       GROUP BY COALESCE(cas.status, 'applied')`,
      [candidateAccountId]
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) counts[row.status] = parseInt(row.count, 10);
    return counts;
  } catch (error) {
    console.error('Error fetching candidate application status counts:', error);
    return {};
  }
}

// Three real, append-only event sources (verified: none of these tables dedupe/overwrite on
// re-insert, unlike candidate_profile_views) bucketed by day for the last N days. Days with zero
// events simply don't appear in the result - the route fills gaps to zero for a continuous chart.
export async function getCandidateActivityTrend(candidateAccountId: number, days: number): Promise<{
  liked: { date: string; count: number }[];
  recruiterInterest: { date: string; count: number }[];
  matches: { date: string; count: number }[];
}> {
  try {
    const [likedRes, interestRes, matchesRes] = await Promise.all([
      pool.query(
        `SELECT date_trunc('day', "timestamp")::date AS date, COUNT(*) FROM candidate_decisions
         WHERE candidate_account_id = $1 AND decision_type = 'swipe_right' AND "timestamp" >= NOW() - ($2 || ' days')::interval
         GROUP BY 1 ORDER BY 1`,
        [candidateAccountId, days]
      ),
      pool.query(
        `SELECT date_trunc('day', s."timestamp")::date AS date, COUNT(*) FROM candidates cand
         JOIN swipes s ON s.candidate_id = cand.id
         WHERE cand.candidate_account_id = $1 AND s.action = 1 AND s."timestamp" >= NOW() - ($2 || ' days')::interval
         GROUP BY 1 ORDER BY 1`,
        [candidateAccountId, days]
      ),
      pool.query(
        `SELECT date_trunc('day', matched_at)::date AS date, COUNT(*) FROM mutual_matches
         WHERE candidate_account_id = $1 AND matched_at >= NOW() - ($2 || ' days')::interval
         GROUP BY 1 ORDER BY 1`,
        [candidateAccountId, days]
      ),
    ]);
    const toSeries = (rows: any[]) => rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), count: parseInt(r.count, 10) }));
    return { liked: toSeries(likedRes.rows), recruiterInterest: toSeries(interestRes.rows), matches: toSeries(matchesRes.rows) };
  } catch (error) {
    console.error('Error fetching candidate activity trend:', error);
    return { liked: [], recruiterInterest: [], matches: [] };
  }
}

export async function getCandidateMatches(candidateAccountId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT mm.id, mm.job_id, mm.matched_at,
              j.title, j.location, j.employment_type, j.required_skills,
              c.name AS company_name, c.logo_url AS company_logo_url,
              cn.id AS notification_id, cn.read_at
       FROM mutual_matches mm
       JOIN jobs j ON j.id = mm.job_id
       JOIN companies c ON c.id = mm.company_id
       LEFT JOIN candidate_notifications cn ON cn.match_id = mm.id AND cn.candidate_account_id = mm.candidate_account_id
       WHERE mm.candidate_account_id = $1
       ORDER BY mm.matched_at DESC`,
      [candidateAccountId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate matches:', error);
    return [];
  }
}

export async function getRecruiterMatches(companyId: number, jobId?: number, userId?: number): Promise<any[]> {
  try {
    const params: any[] = [companyId];
    let jobFilter = '';
    if (jobId) {
      params.push(jobId);
      jobFilter = `AND mm.job_id = $${params.length}`;
    }
    // Notification join is additionally scoped to the viewing recruiter (userId) when provided -
    // recruiter_notifications are personal, so read/unread state shown is always this viewer's
    // own, never a colleague's.
    let notifJoin = 'LEFT JOIN recruiter_notifications rn ON rn.match_id = mm.id';
    if (userId) {
      params.push(userId);
      notifJoin += ` AND rn.user_id = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT mm.id, mm.job_id, mm.matched_at,
              j.title AS job_title,
              cand.id AS candidate_id, cand.name AS candidate_name, cand.email AS candidate_email,
              cand.skills AS candidate_skills, cand.years_of_experience AS candidate_years_of_experience,
              rn.id AS notification_id, rn.read_at
       FROM mutual_matches mm
       JOIN jobs j ON j.id = mm.job_id
       LEFT JOIN candidates cand ON cand.id = mm.candidates_id
       ${notifJoin}
       WHERE mm.company_id = $1 ${jobFilter}
       ORDER BY mm.matched_at DESC`,
      params
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching recruiter matches:', error);
    return [];
  }
}

// ==================== NOTIFICATIONS (Phase 4) ====================
// Every query/update below is scoped to the owning identity in its WHERE clause - never trust
// a route param alone for whose notifications are being read or marked, per the explicit
// server-side ownership requirement (candidate/recruiter notifications must never cross
// accounts or companies).

export async function getCandidateNotifications(candidateAccountId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT id, match_id, type, title, message, read_at, created_at
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
      `UPDATE candidate_notifications SET read_at = NOW() WHERE id = $1 AND candidate_account_id = $2 AND read_at IS NULL RETURNING id, read_at`,
      [id, candidateAccountId]
    );
    const row = result.rows[0];
    if (row) {
      dualWrite.patchCandidateNotification(row.id, { read_at: row.read_at });
    }
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error marking candidate notification read:', error);
    return false;
  }
}

export async function markAllCandidateNotificationsRead(candidateAccountId: number): Promise<number> {
  try {
    const result = await pool.query(
      `UPDATE candidate_notifications SET read_at = NOW() WHERE candidate_account_id = $1 AND read_at IS NULL RETURNING id, read_at`,
      [candidateAccountId]
    );
    for (const row of result.rows) {
      dualWrite.patchCandidateNotification(row.id, { read_at: row.read_at });
    }
    return result.rowCount ?? 0;
  } catch (error) {
    console.error('Error marking all candidate notifications read:', error);
    return 0;
  }
}

export async function getRecruiterNotifications(userId: number, companyId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT id, match_id, type, title, message, read_at, created_at
       FROM recruiter_notifications WHERE user_id = $1 AND company_id = $2 ORDER BY created_at DESC`,
      [userId, companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching recruiter notifications:', error);
    return [];
  }
}

export async function getRecruiterUnreadNotificationCount(userId: number, companyId: number): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM recruiter_notifications WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL`,
      [userId, companyId]
    );
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Error counting unread recruiter notifications:', error);
    return 0;
  }
}

export async function markRecruiterNotificationRead(id: number, userId: number, companyId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE recruiter_notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND company_id = $3 AND read_at IS NULL RETURNING id, read_at`,
      [id, userId, companyId]
    );
    const row = result.rows[0];
    if (row) {
      dualWrite.patchRecruiterNotification(row.id, { read_at: row.read_at });
    }
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error marking recruiter notification read:', error);
    return false;
  }
}

export async function markAllRecruiterNotificationsRead(userId: number, companyId: number): Promise<number> {
  try {
    const result = await pool.query(
      `UPDATE recruiter_notifications SET read_at = NOW() WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL RETURNING id, read_at`,
      [userId, companyId]
    );
    for (const row of result.rows) {
      dualWrite.patchRecruiterNotification(row.id, { read_at: row.read_at });
    }
    return result.rowCount ?? 0;
  } catch (error) {
    console.error('Error marking all recruiter notifications read:', error);
    return 0;
  }
}

export async function getRecruiterReviewDetail(candidateId: number, jobId: number, companyId: number): Promise<{
  candidate: Candidate | null;
  job: Job | null;
  history: Swipe[];
  note: RecruiterNote | null;
} | null> {
  try {
    const candidate = await getCandidateById(candidateId, companyId);
    const job = await getJobById(jobId, companyId);
    if (!candidate || !job) return null;

    const historyResult = await pool.query(
      'SELECT * FROM swipes WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3 ORDER BY timestamp DESC, id DESC',
      [companyId, candidateId, jobId]
    );
    // Both action and match_score are Postgres NUMERIC columns - node-postgres returns NUMERIC as
    // a JS string, not a number (see replaceReasoningConclusions's coercion comment for the same
    // root cause). match_score wasn't coerced here before Phase 10 - found because Phase 10's own
    // MatchNarrative.matchScore field surfaced the raw string value in its JSON response.
    const history = historyResult.rows.map((r) => ({ ...r, action: Number(r.action), match_score: r.match_score === null ? null : Number(r.match_score) }));

    const noteResult = await pool.query(
      'SELECT * FROM recruiter_notes WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3',
      [companyId, candidateId, jobId]
    );

    return { candidate, job, history, note: noteResult.rows[0] || null };
  } catch (error) {
    console.error('Error fetching recruiter review detail:', error);
    return null;
  }
}

export async function getRecruiterReviewStats(companyId: number): Promise<{
  totalReviewed: number; accepted: number; rejected: number; saved: number;
  avgMatchScore: number; today: number; thisWeek: number; thisMonth: number;
}> {
  const empty = { totalReviewed: 0, accepted: 0, rejected: 0, saved: 0, avgMatchScore: 0, today: 0, thisWeek: 0, thisMonth: 0 };
  try {
    const result = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (candidate_id, job_id) *
         FROM swipes
         WHERE company_id = $1
         ORDER BY candidate_id, job_id, timestamp DESC, id DESC
       )
       SELECT
         COUNT(*)::int AS total_reviewed,
         COUNT(*) FILTER (WHERE action = 1)::int AS accepted,
         COUNT(*) FILTER (WHERE action = 0)::int AS rejected,
         COUNT(*) FILTER (WHERE action = 0.5)::int AS saved,
         COALESCE(AVG(match_score), 0)::numeric AS avg_match_score,
         COUNT(*) FILTER (WHERE timestamp::date = CURRENT_DATE)::int AS today,
         COUNT(*) FILTER (WHERE timestamp >= date_trunc('week', CURRENT_DATE))::int AS this_week,
         COUNT(*) FILTER (WHERE timestamp >= date_trunc('month', CURRENT_DATE))::int AS this_month
       FROM latest`,
      [companyId]
    );
    const row = result.rows[0];
    if (!row) return empty;
    return {
      totalReviewed: row.total_reviewed,
      accepted: row.accepted,
      rejected: row.rejected,
      saved: row.saved,
      avgMatchScore: Number(Number(row.avg_match_score).toFixed(1)),
      today: row.today,
      thisWeek: row.this_week,
      thisMonth: row.this_month,
    };
  } catch (error) {
    console.error('Error fetching recruiter review stats:', error);
    return empty;
  }
}

export async function upsertRecruiterNote(params: { companyId: number; candidateId: number; jobId: number; note: string; userId: number }): Promise<RecruiterNote | null> {
  try {
    const result = await pool.query(
      `INSERT INTO recruiter_notes (company_id, candidate_id, job_id, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (company_id, candidate_id, job_id)
       DO UPDATE SET note = $4, updated_by = $5, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [params.companyId, params.candidateId, params.jobId, params.note, params.userId]
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertRecruiterNote(row);
    return row || null;
  } catch (error) {
    console.error('Error upserting recruiter note:', error);
    return null;
  }
}

// ==================== DETAILED RUBRIC SCORING REPORT ====================
// A separate, on-demand, LLM-judged report - one row per (company, candidate, job), upserted on
// regenerate. See src/rubric-scoring.service.ts. Not tied to the swipes/match_scores tables at
// all - entirely independent of the real matching engine.

export async function upsertDetailedScoringReport(params: {
  companyId: number; candidateId: number; jobId: number; report: unknown; generatedBy: number;
}): Promise<{ report: unknown; generated_at: string } | null> {
  try {
    const result = await pool.query(
      `INSERT INTO detailed_scoring_reports (company_id, candidate_id, job_id, report, generated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, candidate_id, job_id)
       DO UPDATE SET report = $4, generated_by = $5, generated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [params.companyId, params.candidateId, params.jobId, JSON.stringify(params.report), params.generatedBy]
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertDetailedScoringReport(row);
    return row ? { report: row.report, generated_at: row.generated_at } : null;
  } catch (error) {
    console.error('Error upserting detailed scoring report:', error);
    return null;
  }
}

export async function getDetailedScoringReport(companyId: number, candidateId: number, jobId: number): Promise<{ report: unknown; generated_at: string } | null> {
  try {
    const result = await pool.query(
      `SELECT report, generated_at FROM detailed_scoring_reports WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3`,
      [companyId, candidateId, jobId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching detailed scoring report:', error);
    return null;
  }
}

// ==================== ANALYTICS HUB ====================
// Every stat here is computed with SQL aggregation (COUNT/AVG/FILTER/GROUP BY), not by pulling
// full tables into Node and reducing in JS - the pattern already proven in
// getRecruiterReviewStats/getRecruiterReviewList. This also fixes the root cause of the
// corrupted "average match score" bug: swipes.match_score is a Postgres NUMERIC column, and
// node-postgres returns NUMERIC values as JS strings (to avoid float precision loss) - the old
// code did `swipes.reduce((acc, s) => acc + s.match_score, 0)`, which silently string-concatenated
// instead of summing. AVG() runs in SQL here, and the single resulting value is converted with
// exactly one `Number(...)` call (safe - it's repeated `+=` accumulation on a string that breaks,
// not a single conversion), matching the pattern getRecruiterReviewStats already uses safely.

export interface AnalyticsDashboardStats {
  totalReviewed: number;
  matchesMade: number;
  avgScore: number;
  acceptanceRate: number;
  totalSwipesToday: number;
  pendingCandidates: number;
  // Dashboard-only additions (see Dashboard.tsx) - both nullable when there's no real basis to
  // compute them yet, rather than ever fabricating a number.
  swipesYesterday: number;
  swipesTodayChangePct: number | null;
  modelAccuracy: number | null;
}

export async function getAnalyticsDashboardStats(companyId: number): Promise<AnalyticsDashboardStats> {
  const empty: AnalyticsDashboardStats = { totalReviewed: 0, matchesMade: 0, avgScore: 0, acceptanceRate: 0, totalSwipesToday: 0, pendingCandidates: 0, swipesYesterday: 0, swipesTodayChangePct: null, modelAccuracy: null };
  try {
    const [statsResult, modelVersion] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM swipes WHERE company_id = $1)::int AS total_reviewed,
           (SELECT COUNT(*) FROM swipes WHERE company_id = $1 AND action = 1)::int AS matches_made,
           (SELECT COALESCE(AVG(match_score), 0) FROM swipes WHERE company_id = $1) AS avg_score_raw,
           (SELECT COUNT(*) FROM swipes WHERE company_id = $1 AND timestamp::date = CURRENT_DATE)::int AS total_swipes_today,
           (SELECT COUNT(*) FROM swipes WHERE company_id = $1 AND timestamp::date = CURRENT_DATE - INTERVAL '1 day')::int AS total_swipes_yesterday,
           (SELECT COUNT(*) FROM jobs WHERE company_id = $1 AND status = 'open')::int AS open_job_count,
           (SELECT COUNT(*) FROM candidates WHERE company_id = $1)::int AS total_candidates,
           COALESCE((
             SELECT SUM(unswiped_count) FROM (
               SELECT (
                 SELECT COUNT(*) FROM candidates c
                 WHERE c.company_id = $1
                   AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.job_id = j.id AND s.candidate_id = c.id)
               ) AS unswiped_count
               FROM jobs j WHERE j.company_id = $1 AND j.status = 'open'
             ) per_open_job
           ), 0)::int AS pending_from_open_jobs`,
        [companyId]
      ),
      // Model training is pooled/global across every company (documented in getAllSwipesUnscoped
      // etc.) - model_versions has no company_id, so this is intentionally not company-scoped.
      getLatestModelVersion(),
    ]);
    const row = statsResult.rows[0];
    if (!row) return empty;

    const totalReviewed = row.total_reviewed;
    const matchesMade = row.matches_made;
    const swipesToday = row.total_swipes_today;
    const swipesYesterday = row.total_swipes_yesterday;
    // Preserves the original semantics exactly: when there are open jobs, sum the unswiped
    // count *per open job* (a candidate unswiped for multiple open jobs is counted once per
    // job - a pre-existing quirk, not something this fix changes); otherwise fall back to the
    // total candidate count.
    const pendingCandidates = row.open_job_count > 0 ? row.pending_from_open_jobs : row.total_candidates;

    return {
      totalReviewed,
      matchesMade,
      avgScore: Number(Number(row.avg_score_raw).toFixed(1)),
      acceptanceRate: totalReviewed > 0 ? Number(((matchesMade / totalReviewed) * 100).toFixed(1)) : 0,
      totalSwipesToday: swipesToday,
      pendingCandidates,
      swipesYesterday,
      // No baseline to compare against (yesterday had zero swipes, whether or not today did) ->
      // null, never a divide-by-zero, never Infinity, never a fabricated percentage.
      swipesTodayChangePct: swipesYesterday === 0 ? null : Number((((swipesToday - swipesYesterday) / swipesYesterday) * 100).toFixed(1)),
      modelAccuracy: modelVersion ? Number(modelVersion.accuracy) : null,
    };
  } catch (error) {
    console.error('Error fetching analytics dashboard stats:', error);
    return empty;
  }
}

export async function getJobSwipeCounts(companyId: number): Promise<Map<number, { reviewed: number; accepted: number; rejected: number; saved: number }>> {
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

export async function countCandidates(companyId: number): Promise<number> {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM candidates WHERE company_id = $1', [companyId]);
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    console.error('Error counting candidates:', error);
    return 0;
  }
}

export async function getJobAnalyticsCounts(jobId: number, companyId: number): Promise<{ totalReviewed: number; acceptanceRate: number }> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total_reviewed, COUNT(*) FILTER (WHERE action = 1)::int AS accepted
       FROM swipes WHERE company_id = $1 AND job_id = $2`,
      [companyId, jobId]
    );
    const row = result.rows[0];
    const totalReviewed = row?.total_reviewed ?? 0;
    const accepted = row?.accepted ?? 0;
    return {
      totalReviewed,
      acceptanceRate: totalReviewed > 0 ? Number(((accepted / totalReviewed) * 100).toFixed(1)) : 0,
    };
  } catch (error) {
    console.error('Error fetching job analytics counts:', error);
    return { totalReviewed: 0, acceptanceRate: 0 };
  }
}

export async function getAnalyticsTrend(companyId: number): Promise<{ date: string; swipes: number }[]> {
  try {
    const result = await pool.query(
      `SELECT date_trunc('day', timestamp)::date AS day, COUNT(*)::int AS count
       FROM swipes
       WHERE company_id = $1 AND timestamp >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY day
       ORDER BY day`,
      [companyId]
    );
    const countByDay = new Map<string, number>(result.rows.map((r) => [new Date(r.day).toISOString().split('T')[0], r.count]));

    const trend: { date: string; swipes: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      trend.push({ date: dateStr, swipes: countByDay.get(dateStr) ?? 0 });
    }
    return trend;
  } catch (error) {
    console.error('Error fetching analytics trend:', error);
    return [];
  }
}

export interface AnalyticsActivityRow {
  id: number;
  recruiterName: string;
  candidateName: string;
  jobTitle: string;
  action: 'accept' | 'save' | 'reject';
  matchScore: number;
  timestamp: string;
}

export async function getAnalyticsRecentActivity(companyId: number, limit: number = 5): Promise<AnalyticsActivityRow[]> {
  try {
    const result = await pool.query(
      `SELECT s.id, s.action, s.match_score, s.timestamp,
              COALESCE(u.name, 'Former team member') AS recruiter_name,
              c.name AS candidate_name, j.title AS job_title
       FROM swipes s
       JOIN candidates c ON c.id = s.candidate_id
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN users u ON u.id = s.recruiter_id
       WHERE s.company_id = $1
       ORDER BY s.timestamp DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return result.rows.map((r) => ({
      id: r.id,
      recruiterName: r.recruiter_name,
      candidateName: r.candidate_name,
      jobTitle: r.job_title,
      action: Number(r.action) === 1 ? 'accept' : Number(r.action) === 0.5 ? 'save' : 'reject',
      matchScore: Number(r.match_score),
      timestamp: r.timestamp,
    }));
  } catch (error) {
    console.error('Error fetching analytics recent activity:', error);
    return [];
  }
}

/**
 * Splits candidates.skills (a ", "-joined TEXT column) into individual skills and counts them,
 * excluding the same NULL/empty/"null"-string cases mapRowToCandidate already filters elsewhere
 * so results stay consistent with how skills are parsed everywhere else in the app. When jobId
 * is given, scopes to candidates with an *accepted* swipe for that job (matching the existing
 * job-detail panel's behavior); otherwise covers every candidate in the company.
 */
export async function getAnalyticsSkillDistribution(companyId: number, options: { jobId?: number; limit: number }): Promise<{ name: string; value: number }[]> {
  try {
    const query = options.jobId
      ? `SELECT skill, COUNT(*)::int AS count FROM (
           SELECT trim(unnest(string_to_array(c.skills, ', '))) AS skill
           FROM swipes s
           JOIN candidates c ON c.id = s.candidate_id
           WHERE s.company_id = $1 AND s.job_id = $2 AND s.action = 1
             AND c.skills IS NOT NULL AND c.skills <> '' AND lower(c.skills) <> 'null'
         ) expanded
         WHERE skill <> '' AND lower(skill) <> 'null'
         GROUP BY skill
         ORDER BY count DESC
         LIMIT $3`
      : `SELECT skill, COUNT(*)::int AS count FROM (
           SELECT trim(unnest(string_to_array(c.skills, ', '))) AS skill
           FROM candidates c
           WHERE c.company_id = $1
             AND c.skills IS NOT NULL AND c.skills <> '' AND lower(c.skills) <> 'null'
         ) expanded
         WHERE skill <> '' AND lower(skill) <> 'null'
         GROUP BY skill
         ORDER BY count DESC
         LIMIT $2`;
    const params = options.jobId ? [companyId, options.jobId, options.limit] : [companyId, options.limit];
    const result = await pool.query(query, params);
    return result.rows.map((r) => ({ name: r.skill, value: r.count }));
  } catch (error) {
    console.error('Error fetching analytics skill distribution:', error);
    return [];
  }
}

export interface AnalyticsRecruiterProfile {
  id: number;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  swipesCount: number;
  accepted: number;
  rejected: number;
  saved: number;
  acceptanceRate: number;
  averageMatchScore: number;
  avgDecisionTimeSeconds: number | null;
}

/** Always scoped to a specific (userId, companyId) pair - callers must derive userId from the
 * authenticated session (req.user.user_id), never accept it from client input, so a recruiter
 * can only ever see their own profile via this function's only caller (GET /analytics/recruiter/me). */
export async function getAnalyticsRecruiterProfile(userId: number, companyId: number): Promise<AnalyticsRecruiterProfile | null> {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login_at,
              COUNT(s.id)::int AS swipes_count,
              COUNT(s.id) FILTER (WHERE s.action = 1)::int AS accepted,
              COUNT(s.id) FILTER (WHERE s.action = 0)::int AS rejected,
              COUNT(s.id) FILTER (WHERE s.action = 0.5)::int AS saved,
              COALESCE(AVG(s.match_score), 0) AS avg_match_score_raw,
              AVG(s.decision_time_seconds) FILTER (WHERE s.decision_time_seconds IS NOT NULL) AS avg_decision_time_raw
       FROM users u
       LEFT JOIN swipes s ON s.recruiter_id = u.id AND s.company_id = u.company_id
       WHERE u.id = $1 AND u.company_id = $2
       GROUP BY u.id`,
      [userId, companyId]
    );
    const row = result.rows[0];
    if (!row) return null;

    const swipesCount = row.swipes_count;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at,
      swipesCount,
      accepted: row.accepted,
      rejected: row.rejected,
      saved: row.saved,
      acceptanceRate: swipesCount > 0 ? Number(((row.accepted / swipesCount) * 100).toFixed(1)) : 0,
      averageMatchScore: Number(Number(row.avg_match_score_raw).toFixed(1)),
      avgDecisionTimeSeconds: row.avg_decision_time_raw !== null ? Number(Number(row.avg_decision_time_raw).toFixed(1)) : null,
    };
  } catch (error) {
    console.error('Error fetching analytics recruiter profile:', error);
    return null;
  }
}

// MATCH SCORES
export async function getMatchScores(jobId: number, candidateId: number, companyId: number): Promise<MatchScore | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM match_scores WHERE job_id = $1 AND candidate_id = $2 AND company_id = $3 ORDER BY created_at DESC LIMIT 1',
      [jobId, candidateId, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching match score:', error);
    return null;
  }
}

export async function saveMatchScore(score: Omit<MatchScore, 'id' | 'created_at'>): Promise<MatchScore | null> {
  try {
    const result = await pool.query(
      `INSERT INTO match_scores (company_id, job_id, candidate_id, feature_score, embedding_score, ml_score, final_score, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [score.company_id, score.job_id, score.candidate_id, score.feature_score, score.embedding_score, score.ml_score, score.final_score, score.rank]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving match score:', error);
    return null;
  }
}

// ==================== FEATURE STORE (Phase 3) ====================
// Append-only - never updated, matching match_scores' write-through convention. See
// src/matching/featureStore.ts for the extraction/orchestration logic that calls this.
export async function saveMatchFeatures(record: Omit<MatchFeatureRecord, 'id' | 'computed_at'>): Promise<MatchFeatureRecord | null> {
  try {
    const result = await pool.query(
      `INSERT INTO match_features (
         company_id, job_id, candidate_id, feature_schema_version,
         jaccard_skill_score, cosine_text_score, cosine_bert_score, euclidean_feature_score,
         experience_score, location_score, salary_score, levenshtein_title_score,
         weighting, tier, model_version, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        record.company_id, record.job_id, record.candidate_id, record.feature_schema_version,
        record.jaccard_skill_score, record.cosine_text_score, record.cosine_bert_score, record.euclidean_feature_score,
        record.experience_score, record.location_score, record.salary_score, record.levenshtein_title_score,
        record.weighting, record.tier, record.model_version, record.source,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving match features:', error);
    return null;
  }
}

export async function getMatchFeaturesForJob(jobId: number, companyId: number): Promise<MatchFeatureRecord[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM match_features WHERE job_id = $1 AND company_id = $2 ORDER BY computed_at DESC',
      [jobId, companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching match features for job:', error);
    return [];
  }
}

// Point-in-time lookup: the most recent match_features row for this (job, candidate) pair that
// was computed AT OR BEFORE asOf - i.e. the feature vector that was actually current when a
// swipe/decision happened, not whatever candidate/job data looks like today. Training code uses
// this to avoid the classic training-serving skew a naive "recompute features now" join would
// introduce.
export async function getMatchFeaturesAsOf(jobId: number, candidateId: number, asOf: string): Promise<MatchFeatureRecord | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM match_features WHERE job_id = $1 AND candidate_id = $2 AND computed_at <= $3 ORDER BY computed_at DESC LIMIT 1',
      [jobId, candidateId, asOf]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching point-in-time match features:', error);
    return null;
  }
}

// ==================== LEARNING-TO-RANK (Phase 3) ====================
// Deliberately separate from getLatestModelVersion/saveModelVersion (the production
// classification ensemble) - see migration-phase3-feature-store-and-evaluation.sql's comment on
// ltr_model_versions for why.
export async function saveLtrModelVersion(version: Omit<LtrModelVersion, 'id' | 'trained_at'>): Promise<LtrModelVersion | null> {
  try {
    const result = await pool.query(
      `INSERT INTO ltr_model_versions (version, algorithm, training_examples, training_groups, ndcg_at_10, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [version.version, version.algorithm, version.training_examples, version.training_groups, version.ndcg_at_10, version.is_active]
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertLtrModelVersion(row);
    return row;
  } catch (error) {
    console.error('Error saving LTR model version:', error);
    return null;
  }
}

export async function getLatestLtrModelVersion(): Promise<LtrModelVersion | null> {
  try {
    const result = await pool.query('SELECT * FROM ltr_model_versions ORDER BY trained_at DESC LIMIT 1');
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching latest LTR model version:', error);
    return null;
  }
}

// ==================== EVALUATION FRAMEWORK (Phase 3) ====================
export async function saveEvaluationRun(run: Omit<MatchEvaluationRun, 'id' | 'evaluated_at'>): Promise<MatchEvaluationRun | null> {
  try {
    const result = await pool.query(
      `INSERT INTO match_evaluation_runs (
         company_id, jobs_evaluated, swipes_evaluated, k, ndcg_at_k, map_at_k, mrr, precision_at_k, recall_at_k, data_volume_note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [run.company_id, run.jobs_evaluated, run.swipes_evaluated, run.k, run.ndcg_at_k, run.map_at_k, run.mrr, run.precision_at_k, run.recall_at_k, run.data_volume_note]
    );
    const row = result.rows[0];
    if (row) dualWrite.upsertMatchEvaluationRun(row);
    return row;
  } catch (error) {
    console.error('Error saving evaluation run:', error);
    return null;
  }
}

export async function getEvaluationRuns(companyId: number, limit: number = 20): Promise<MatchEvaluationRun[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM match_evaluation_runs WHERE company_id = $1 ORDER BY evaluated_at DESC LIMIT $2',
      [companyId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching evaluation runs:', error);
    return [];
  }
}

// Every swipe for a single company (companyId, unlike getAllSwipesUnscoped) - the real dataset
// the Evaluation Framework grades ranking quality against, since evaluation is a per-tenant
// report a recruiter views (unlike the pooled-across-companies ML ensemble training set).
export async function getSwipesForEvaluation(companyId: number): Promise<Swipe[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM swipes WHERE company_id = $1 AND action IS NOT NULL ORDER BY job_id, "timestamp" ASC',
      [companyId]
    );
    // NUMERIC columns (action, match_score) come back as strings from node-postgres, not numbers
    // - same coercion getAllSwipesUnscoped already applies to action, extended here to
    // match_score too since evaluation.ts sorts/compares it numerically.
    return result.rows.map((row) => ({ ...row, action: Number(row.action), match_score: row.match_score === null ? null : Number(row.match_score) }));
  } catch (error) {
    console.error('Error fetching swipes for evaluation:', error);
    return [];
  }
}

// ==================== SKILL INTELLIGENCE PLATFORM (Phase 1) ====================
// Not yet read by src/matching/services.ts's live scoring - see src/matching/skillIntelligence.ts for the
// seeding/canonicalization logic that calls these. Every function here is a plain data-access
// primitive; the domain logic (what to seed, how to canonicalize) lives in that module.

export async function upsertSkillNode(node: {
  canonical_name: string;
  category: string;
  technology_domain?: string | null;
  aliases: string[];
  is_deprecated?: boolean;
  is_emerging?: boolean;
  source?: string;
  // Enterprise AI Matching Architecture, Phase 4 - optional, defaults to the column's existing
  // 1.0 default (every Phase 1 caller omits this and gets identical behavior to before). Lets
  // Unknown Skill Discovery create a newly-promoted node at a reduced initial confidence per the
  // architecture doc's "reduced initial confidence... until it accumulates more corroborating
  // evidence" (§5, pipeline stage 6), instead of every skill node starting at full confidence.
  confidence?: number;
}): Promise<SkillNode | null> {
  try {
    const result = await pool.query(
      `INSERT INTO skill_nodes (canonical_name, category, technology_domain, aliases, is_deprecated, is_emerging, source, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 1.0))
       ON CONFLICT (canonical_name) DO UPDATE SET
         category = EXCLUDED.category, technology_domain = EXCLUDED.technology_domain,
         aliases = EXCLUDED.aliases, is_deprecated = EXCLUDED.is_deprecated,
         is_emerging = EXCLUDED.is_emerging, source = EXCLUDED.source, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [node.canonical_name, node.category, node.technology_domain ?? null, node.aliases, node.is_deprecated ?? false, node.is_emerging ?? false, node.source ?? 'dictionary', node.confidence ?? null]
    );
    const row = result.rows[0] || null;
    if (row) dualWrite.upsertSkillNode(row);
    return row;
  } catch (error) {
    console.error('Error upserting skill node:', error);
    return null;
  }
}

export async function getSkillNodeByCanonical(canonicalName: string): Promise<SkillNode | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_nodes WHERE canonical_name = $1', [canonicalName]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching skill node by canonical name:', error);
    return null;
  }
}

// Enterprise AI Matching Architecture, Phase 2 - used by graph-edge traversal (retrieval.ts's
// GraphExpandedSkillStrategy, dynamicWeighting.ts's tier-weighted skill scoring) to resolve an
// edge's to_skill_id back to a display name without re-fetching the whole skill_nodes table.
export async function getSkillNodeById(id: number): Promise<SkillNode | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_nodes WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching skill node by id:', error);
    return null;
  }
}

// The actual canonicalization lookup: does this raw skill string resolve to a known node, either
// as the canonical spelling itself or one of its aliases? Case-insensitive on both sides (aliases
// are stored with their natural casing, e.g. "ReactJS" - lower() on both sides of the comparison
// avoids needing a second, all-lowercase copy of every alias).
export async function findSkillNodeByAlias(rawText: string): Promise<SkillNode | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM skill_nodes
       WHERE lower(canonical_name) = lower($1)
          OR EXISTS (SELECT 1 FROM unnest(aliases) AS a WHERE lower(a) = lower($1))
       LIMIT 1`,
      [rawText.trim()]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error resolving skill alias:', error);
    return null;
  }
}

export async function getAllSkillNodes(): Promise<SkillNode[]> {
  try {
    const result = await pool.query('SELECT * FROM skill_nodes ORDER BY canonical_name');
    return result.rows;
  } catch (error) {
    console.error('Error fetching all skill nodes:', error);
    return [];
  }
}

export async function updateSkillNodePopularity(id: number, popularityScore: number): Promise<void> {
  try {
    const result = await pool.query('UPDATE skill_nodes SET popularity_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING updated_at', [popularityScore, id]);
    if (result.rows[0]) dualWrite.patchSkillNode(id, { popularity_score: popularityScore, updated_at: result.rows[0].updated_at });
  } catch (error) {
    console.error('Error updating skill node popularity:', error);
  }
}

// Enterprise AI Matching Architecture, Phase 4 - Unknown Skill Discovery (architecture doc §5).
// Additive to every skill_nodes function above; nothing here is read by Phase 0-3 code.
export async function updateSkillNodeEmbedding(id: number, embedding: number[]): Promise<void> {
  try {
    const result = await pool.query('UPDATE skill_nodes SET embedding = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING updated_at', [embedding, id]);
    if (result.rows[0]) dualWrite.patchSkillNode(id, { embedding, updated_at: result.rows[0].updated_at });
  } catch (error) {
    console.error('Error updating skill node embedding:', error);
  }
}

export async function getSkillDiscoveryProposalByToken(normalizedToken: string): Promise<SkillDiscoveryProposal | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_discovery_proposals WHERE normalized_token = $1', [normalizedToken]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching skill discovery proposal by token:', error);
    return null;
  }
}

export async function getSkillDiscoveryProposalById(id: number): Promise<SkillDiscoveryProposal | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_discovery_proposals WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching skill discovery proposal by id:', error);
    return null;
  }
}

export async function createSkillDiscoveryProposal(input: {
  raw_token: string;
  normalized_token: string;
  source_type: 'resume' | 'jd';
  context_text: string | null;
  is_skill: boolean | null;
  proposed_category: string | null;
  nearest_neighbors: SkillDiscoveryProposal['nearest_neighbors'];
  proposed_relationship_type: SkillRelationshipType | null;
  proposed_related_skill_id: number | null;
  confidence: number | null;
  status: SkillDiscoveryStatus;
}): Promise<SkillDiscoveryProposal | null> {
  try {
    const result = await pool.query(
      `INSERT INTO skill_discovery_proposals (
         raw_token, normalized_token, source_type, context_text,
         is_skill, proposed_category, nearest_neighbors, proposed_relationship_type,
         proposed_related_skill_id, confidence, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (normalized_token) DO NOTHING
       RETURNING *`,
      [
        input.raw_token, input.normalized_token, input.source_type, input.context_text,
        input.is_skill, input.proposed_category, JSON.stringify(input.nearest_neighbors ?? []), input.proposed_relationship_type,
        input.proposed_related_skill_id, input.confidence, input.status,
      ]
    );
    // ON CONFLICT DO NOTHING returns no row on a race (two concurrent first-sightings of the same
    // token) - fetch the row the other writer just inserted rather than treating this as failure.
    return result.rows[0] || (await getSkillDiscoveryProposalByToken(input.normalized_token));
  } catch (error) {
    console.error('Error creating skill discovery proposal:', error);
    return null;
  }
}

// Generic partial update, same pattern as updateJob above - only columns present in `updates`
// are written.
export async function updateSkillDiscoveryProposal(id: number, updates: Partial<SkillDiscoveryProposal>): Promise<SkillDiscoveryProposal | null> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'id') {
        fields.push(`${key} = $${paramIndex}`);
        values.push(key === 'nearest_neighbors' ? JSON.stringify(value ?? []) : value);
        paramIndex++;
      }
    }

    if (fields.length === 0) return getSkillDiscoveryProposalById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE skill_discovery_proposals SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating skill discovery proposal:', error);
    return null;
  }
}

export async function getPendingSkillDiscoveryProposals(limit: number = 50): Promise<SkillDiscoveryProposal[]> {
  try {
    const result = await pool.query(
      "SELECT * FROM skill_discovery_proposals WHERE status = 'pending' ORDER BY mention_count DESC, created_at ASC LIMIT $1",
      [limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching pending skill discovery proposals:', error);
    return [];
  }
}

// Read-only, cross-company (co-occurrence is a platform-wide statistical signal, not tenant
// data) - used only by src/matching/skillIntelligence.ts's computeCooccurrenceEdges to compute
// real skill co-occurrence weights. skills_array is the array projection added by
// migration-phase0-unified-matching.sql; the legacy `skills` string column is untouched.
export async function getAllCandidateSkillArrays(): Promise<string[][]> {
  try {
    const result = await pool.query('SELECT skills_array FROM candidates WHERE skills_array IS NOT NULL AND array_length(skills_array, 1) > 0');
    return result.rows.map((r) => r.skills_array as string[]);
  } catch (error) {
    console.error('Error fetching candidate skill arrays:', error);
    return [];
  }
}

export async function getAllJobRequiredSkills(): Promise<string[][]> {
  try {
    const result = await pool.query('SELECT required_skills FROM jobs WHERE required_skills IS NOT NULL AND array_length(required_skills, 1) > 0');
    return result.rows.map((r) => r.required_skills as string[]);
  } catch (error) {
    console.error('Error fetching job required skills:', error);
    return [];
  }
}

export async function upsertSkillEdge(
  fromSkillId: number,
  toSkillId: number,
  relationshipType: SkillRelationshipType,
  weight: number = 1.0,
  source: string = 'curated'
): Promise<SkillEdge | null> {
  try {
    const result = await pool.query(
      `INSERT INTO skill_edges (from_skill_id, to_skill_id, relationship_type, weight, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_skill_id, to_skill_id, relationship_type) DO UPDATE SET weight = EXCLUDED.weight, source = EXCLUDED.source
       RETURNING *`,
      [fromSkillId, toSkillId, relationshipType, weight, source]
    );
    const row = result.rows[0] || null;
    if (row) dualWrite.upsertSkillEdge(row);
    return row;
  } catch (error) {
    console.error('Error upserting skill edge:', error);
    return null;
  }
}

export async function getSkillEdgesFrom(skillId: number, relationshipType?: SkillRelationshipType): Promise<SkillEdge[]> {
  try {
    const result = relationshipType
      ? await pool.query('SELECT * FROM skill_edges WHERE from_skill_id = $1 AND relationship_type = $2', [skillId, relationshipType])
      : await pool.query('SELECT * FROM skill_edges WHERE from_skill_id = $1', [skillId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching skill edges:', error);
    return [];
  }
}

export async function getAllSkillEdges(): Promise<SkillEdge[]> {
  try {
    const result = await pool.query('SELECT * FROM skill_edges');
    return result.rows;
  } catch (error) {
    console.error('Error fetching all skill edges:', error);
    return [];
  }
}

// Reverse of getSkillEdgesFrom - needed by Phase 9's Reasoning Layer to walk a skill UP to its
// PARENT_OF domain node (skillIntelligence.ts seeds PARENT_OF as domain --PARENT_OF--> skill, so
// finding "which domain(s) is this skill under" means querying by to_skill_id, not from_skill_id).
export async function getSkillEdgesTo(skillId: number, relationshipType?: SkillRelationshipType): Promise<SkillEdge[]> {
  try {
    const result = relationshipType
      ? await pool.query('SELECT * FROM skill_edges WHERE to_skill_id = $1 AND relationship_type = $2', [skillId, relationshipType])
      : await pool.query('SELECT * FROM skill_edges WHERE to_skill_id = $1', [skillId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching skill edges:', error);
    return [];
  }
}

// ==================== ROLE INTELLIGENCE PLATFORM (Phase 1) ====================
// Not yet read by src/matching/services.ts's live scoring - see src/matching/roleIntelligence.ts.

export async function upsertRoleProfile(profile: {
  role_key: string;
  display_name: string;
  mandatory_skills: string[];
  preferred_skills: string[];
  optional_skills: string[];
  common_tools: string[];
  typical_responsibilities: string[];
  preferred_certifications: string[];
  experience_band_min?: number | null;
  experience_band_max?: number | null;
  related_roles: string[];
  career_progression: string[];
  source?: string;
}): Promise<RoleProfile | null> {
  try {
    const result = await pool.query(
      `INSERT INTO role_profiles (
         role_key, display_name, mandatory_skills, preferred_skills, optional_skills, common_tools,
         typical_responsibilities, preferred_certifications, experience_band_min, experience_band_max,
         related_roles, career_progression, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (role_key) DO UPDATE SET
         display_name = EXCLUDED.display_name, mandatory_skills = EXCLUDED.mandatory_skills,
         preferred_skills = EXCLUDED.preferred_skills, optional_skills = EXCLUDED.optional_skills,
         common_tools = EXCLUDED.common_tools, typical_responsibilities = EXCLUDED.typical_responsibilities,
         preferred_certifications = EXCLUDED.preferred_certifications,
         experience_band_min = EXCLUDED.experience_band_min, experience_band_max = EXCLUDED.experience_band_max,
         related_roles = EXCLUDED.related_roles, career_progression = EXCLUDED.career_progression,
         source = EXCLUDED.source, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        profile.role_key, profile.display_name, profile.mandatory_skills, profile.preferred_skills,
        profile.optional_skills, profile.common_tools, profile.typical_responsibilities,
        profile.preferred_certifications, profile.experience_band_min ?? null, profile.experience_band_max ?? null,
        profile.related_roles, profile.career_progression, profile.source ?? 'seed',
      ]
    );
    const row = result.rows[0] || null;
    if (row) dualWrite.upsertRoleProfile(row);
    return row;
  } catch (error) {
    console.error('Error upserting role profile:', error);
    return null;
  }
}

export async function getRoleProfileByKey(roleKey: string): Promise<RoleProfile | null> {
  try {
    const result = await pool.query('SELECT * FROM role_profiles WHERE role_key = $1', [roleKey]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching role profile:', error);
    return null;
  }
}

export async function getAllRoleProfiles(): Promise<RoleProfile[]> {
  try {
    const result = await pool.query('SELECT * FROM role_profiles ORDER BY display_name');
    return result.rows;
  } catch (error) {
    console.error('Error fetching all role profiles:', error);
    return [];
  }
}

export async function updateRoleProfileEmbedding(id: number, embedding: number[]): Promise<void> {
  try {
    const result = await pool.query('UPDATE role_profiles SET embedding = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING updated_at', [embedding, id]);
    if (result.rows[0]) dualWrite.patchRoleProfile(id, { embedding, updated_at: result.rows[0].updated_at });
  } catch (error) {
    console.error('Error updating role profile embedding:', error);
  }
}

// ==================== CAREER TRAJECTORIES (Phase 8, §2.4 Career Intelligence) ====================
// One row per candidate (UNIQUE candidate_id) - computed by src/matching/careerIntelligence/
// computeCareerTrajectory.ts from candidates.work_history. Upsert-on-conflict so a re-parse
// (updated work_history) simply recomputes and overwrites, never accumulates stale rows.
export async function upsertCareerTrajectory(input: {
  candidate_id: number;
  company_id: number;
  job_sequence: NormalizedJob[];
  total_career_months: number | null;
  role_count: number | null;
  progression_type: ProgressionType | null;
  seniority_level: SeniorityLevel | null;
  seniority_trend: SeniorityTrend | null;
  transitions: CareerTransition[];
  avg_tenure_months: number | null;
  median_tenure_months: number | null;
  tenure_pattern: TenurePattern | null;
  gaps: EmploymentGap[];
  domain_concentration: number | null;
  domains: DomainBreakdown[];
  trajectory_embedding: number[];
  predicted_next_roles: PredictedRole[];
}): Promise<CareerTrajectory | null> {
  try {
    const result = await pool.query(
      `INSERT INTO career_trajectories (
         candidate_id, company_id, job_sequence, total_career_months, role_count,
         progression_type, seniority_level, seniority_trend, transitions,
         avg_tenure_months, median_tenure_months, tenure_pattern, gaps,
         domain_concentration, domains, trajectory_embedding, predicted_next_roles
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (candidate_id) DO UPDATE SET
         job_sequence = EXCLUDED.job_sequence, total_career_months = EXCLUDED.total_career_months,
         role_count = EXCLUDED.role_count, progression_type = EXCLUDED.progression_type,
         seniority_level = EXCLUDED.seniority_level, seniority_trend = EXCLUDED.seniority_trend,
         transitions = EXCLUDED.transitions, avg_tenure_months = EXCLUDED.avg_tenure_months,
         median_tenure_months = EXCLUDED.median_tenure_months, tenure_pattern = EXCLUDED.tenure_pattern,
         gaps = EXCLUDED.gaps, domain_concentration = EXCLUDED.domain_concentration,
         domains = EXCLUDED.domains, trajectory_embedding = EXCLUDED.trajectory_embedding,
         predicted_next_roles = EXCLUDED.predicted_next_roles, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        input.candidate_id, input.company_id, JSON.stringify(input.job_sequence), input.total_career_months, input.role_count,
        input.progression_type, input.seniority_level, input.seniority_trend, JSON.stringify(input.transitions),
        input.avg_tenure_months, input.median_tenure_months, input.tenure_pattern, JSON.stringify(input.gaps),
        input.domain_concentration, JSON.stringify(input.domains), input.trajectory_embedding, JSON.stringify(input.predicted_next_roles),
      ]
    );
    const row = result.rows[0] || null;
    if (row) dualWrite.upsertCareerTrajectory(row);
    return row;
  } catch (error) {
    console.error('Error upserting career trajectory:', error);
    return null;
  }
}

export async function getCareerTrajectory(candidateId: number, companyId: number): Promise<CareerTrajectory | null> {
  try {
    const result = await pool.query('SELECT * FROM career_trajectories WHERE candidate_id = $1 AND company_id = $2', [candidateId, companyId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching career trajectory:', error);
    return null;
  }
}

export async function queryCareerTrajectoriesByProgressionType(companyId: number, progressionType: string): Promise<CareerTrajectory[]> {
  try {
    const result = await pool.query('SELECT * FROM career_trajectories WHERE company_id = $1 AND progression_type = $2', [companyId, progressionType]);
    return result.rows;
  } catch (error) {
    console.error('Error querying career trajectories by progression type:', error);
    return [];
  }
}

// Bounded to one company - used by querySimilarTrajectories's in-memory cosine comparison
// (pgvector remains uninstalled, same standing gap as everywhere else in this schema - see
// src/matching/retrieval.ts's InMemoryCosineVectorSearchProvider for the identical pattern).
export async function getAllCareerTrajectoriesForCompany(companyId: number): Promise<CareerTrajectory[]> {
  try {
    const result = await pool.query('SELECT * FROM career_trajectories WHERE company_id = $1', [companyId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all career trajectories for company:', error);
    return [];
  }
}

// ==================== REASONING LAYER (Phase 9, architecture doc §5.1) ====================
// reasoning_conclusions holds a SET of rows per subject (unlike career_trajectories/
// project_intelligence's single-JSONB-blob-per-subject pattern), so recomputation is a
// transactional replace (delete every existing conclusion for the subject, insert the freshly
// computed set) rather than a single-row upsert.

// conclusion_confidence is a Postgres NUMERIC column - node-postgres returns NUMERIC as a JS
// string, not a number, to avoid float precision loss (same root cause documented above for
// swipes.match_score/action). Coerced here, once, at the query boundary, rather than at every
// call site - found via Phase 10's explanation JSON actually surfacing the raw string value.
function coerceReasoningConclusionRow(row: any): ReasoningConclusion {
  return { ...row, conclusion_confidence: Number(row.conclusion_confidence) };
}

export async function replaceReasoningConclusions(
  subjectType: ConclusionSubjectType,
  subjectId: number,
  conclusions: DraftConclusion[]
): Promise<ReasoningConclusion[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2', [subjectType, subjectId]);

    const inserted: ReasoningConclusion[] = [];
    for (const c of conclusions) {
      const result = await client.query(
        `INSERT INTO reasoning_conclusions (
           subject_type, subject_id, conclusion_text, conclusion_type, reasoning_type,
           evidence_chain, conclusion_confidence, confidence_derivation, derived_from
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          subjectType, subjectId, c.conclusion_text, c.conclusion_type, c.reasoning_type,
          JSON.stringify(c.evidence_chain), c.conclusion_confidence, c.confidence_derivation, c.derived_from,
        ]
      );
      inserted.push(coerceReasoningConclusionRow(result.rows[0]));
    }

    await client.query('COMMIT');
    dualWrite.replaceReasoningConclusions(subjectType, subjectId, inserted);
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error replacing reasoning conclusions:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getReasoningConclusions(subjectType: ConclusionSubjectType, subjectId: number): Promise<ReasoningConclusion[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2 ORDER BY conclusion_confidence DESC',
      [subjectType, subjectId]
    );
    return result.rows.map(coerceReasoningConclusionRow);
  } catch (error) {
    console.error('Error fetching reasoning conclusions:', error);
    return [];
  }
}

export async function deleteReasoningConclusions(subjectType: ConclusionSubjectType, subjectId: number): Promise<void> {
  try {
    await pool.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2', [subjectType, subjectId]);
  } catch (error) {
    console.error('Error deleting reasoning conclusions:', error);
  }
}

// ==================== PROFICIENCY WEIGHTING (Phase 11, SHADOW MODE ONLY) ====================
// Append-only event log, same convention as swipes - one row per decision, never updated/
// deleted/upserted. Never read by any live scoring path (see proficiencyWeighting.ts's module
// doc) - insertProficiencyShadowScore/getProficiencyShadowScores exist purely so this data can be
// analyzed later, ahead of any future, separate decision to wire this in live.
export async function insertProficiencyShadowScore(input: {
  company_id: number;
  candidate_id: number;
  job_id: number;
  base_match_score: number;
  proficiency_adjusted_score: number;
  overall_multiplier: number;
  skill_multipliers: unknown;
  decision_action: number | null;
  // Phase 12 - all null when the candidate has no computed career_trajectories row yet.
  career_multiplier?: number | null;
  career_progression_signal?: number | null;
  career_stability_signal?: number | null;
  career_domain_signal?: number | null;
  career_adjusted_score?: number | null;
  career_progression_type?: string | null;
  // Phase 13 - all null when no matched skill has resolvable recency data.
  recency_multiplier?: number | null;
  recency_adjusted_score?: number | null;
  recency_role_expectation?: string | null;
  recency_skill_multipliers?: unknown;
  // Phase 15 - all null when the candidate has no reasoning_conclusions rows yet.
  reasoning_multiplier?: number | null;
  reasoning_density_signal?: number | null;
  reasoning_coverage_signal?: number | null;
  reasoning_quality_signal?: number | null;
  reasoning_adjusted_score?: number | null;
  reasoning_covered_domains?: unknown;
  reasoning_uncovered_domains?: unknown;
}): Promise<void> {
  try {
    const careerMultiplier = input.career_multiplier ?? null;
    const careerProgressionSignal = input.career_progression_signal ?? null;
    const careerStabilitySignal = input.career_stability_signal ?? null;
    const careerDomainSignal = input.career_domain_signal ?? null;
    const careerAdjustedScore = input.career_adjusted_score ?? null;
    const careerProgressionType = input.career_progression_type ?? null;
    const recencyMultiplier = input.recency_multiplier ?? null;
    const recencyAdjustedScore = input.recency_adjusted_score ?? null;
    const recencyRoleExpectation = input.recency_role_expectation ?? null;
    const recencySkillMultipliers = input.recency_skill_multipliers !== undefined ? input.recency_skill_multipliers : null;
    const reasoningMultiplier = input.reasoning_multiplier ?? null;
    const reasoningDensitySignal = input.reasoning_density_signal ?? null;
    const reasoningCoverageSignal = input.reasoning_coverage_signal ?? null;
    const reasoningQualitySignal = input.reasoning_quality_signal ?? null;
    const reasoningAdjustedScore = input.reasoning_adjusted_score ?? null;
    const reasoningCoveredDomains = input.reasoning_covered_domains !== undefined ? input.reasoning_covered_domains : null;
    const reasoningUncoveredDomains = input.reasoning_uncovered_domains !== undefined ? input.reasoning_uncovered_domains : null;

    const result = await pool.query(
      `INSERT INTO proficiency_shadow_scores (
         company_id, candidate_id, job_id, base_match_score, proficiency_adjusted_score,
         overall_multiplier, skill_multipliers, decision_action, career_multiplier,
         career_progression_signal, career_stability_signal, career_domain_signal,
         career_adjusted_score, career_progression_type, recency_multiplier,
         recency_adjusted_score, recency_role_expectation, recency_skill_multipliers,
         reasoning_multiplier, reasoning_density_signal, reasoning_coverage_signal,
         reasoning_quality_signal, reasoning_adjusted_score, reasoning_covered_domains,
         reasoning_uncovered_domains
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING id, computed_at`,
      [
        input.company_id, input.candidate_id, input.job_id, input.base_match_score,
        input.proficiency_adjusted_score, input.overall_multiplier, JSON.stringify(input.skill_multipliers),
        input.decision_action, careerMultiplier, careerProgressionSignal,
        careerStabilitySignal, careerDomainSignal,
        careerAdjustedScore, careerProgressionType,
        recencyMultiplier, recencyAdjustedScore,
        recencyRoleExpectation,
        recencySkillMultipliers !== null ? JSON.stringify(recencySkillMultipliers) : null,
        reasoningMultiplier, reasoningDensitySignal,
        reasoningCoverageSignal, reasoningQualitySignal,
        reasoningAdjustedScore,
        reasoningCoveredDomains !== null ? JSON.stringify(reasoningCoveredDomains) : null,
        reasoningUncoveredDomains !== null ? JSON.stringify(reasoningUncoveredDomains) : null,
      ]
    );

    const returned = result.rows[0];
    dualWrite.upsertProficiencyShadowScore({
      id: returned.id,
      company_id: input.company_id,
      candidate_id: input.candidate_id,
      job_id: input.job_id,
      base_match_score: input.base_match_score,
      proficiency_adjusted_score: input.proficiency_adjusted_score,
      overall_multiplier: input.overall_multiplier,
      skill_multipliers: input.skill_multipliers,
      computed_at: returned.computed_at,
      decision_action: input.decision_action,
      career_multiplier: careerMultiplier,
      career_progression_signal: careerProgressionSignal,
      career_stability_signal: careerStabilitySignal,
      career_domain_signal: careerDomainSignal,
      career_adjusted_score: careerAdjustedScore,
      career_progression_type: careerProgressionType,
      recency_multiplier: recencyMultiplier,
      recency_adjusted_score: recencyAdjustedScore,
      recency_role_expectation: recencyRoleExpectation,
      recency_skill_multipliers: recencySkillMultipliers,
      reasoning_multiplier: reasoningMultiplier,
      reasoning_density_signal: reasoningDensitySignal,
      reasoning_coverage_signal: reasoningCoverageSignal,
      reasoning_quality_signal: reasoningQualitySignal,
      reasoning_adjusted_score: reasoningAdjustedScore,
      reasoning_covered_domains: reasoningCoveredDomains,
      reasoning_uncovered_domains: reasoningUncoveredDomains,
    });
  } catch (error) {
    console.error('Error logging proficiency shadow score:', error);
  }
}

function coerceProficiencyShadowScoreRow(row: any): ProficiencyShadowScore {
  const n = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,
    base_match_score: Number(row.base_match_score),
    proficiency_adjusted_score: Number(row.proficiency_adjusted_score),
    overall_multiplier: Number(row.overall_multiplier),
    decision_action: n(row.decision_action),
    career_multiplier: n(row.career_multiplier),
    career_progression_signal: n(row.career_progression_signal),
    career_stability_signal: n(row.career_stability_signal),
    career_domain_signal: n(row.career_domain_signal),
    career_adjusted_score: n(row.career_adjusted_score),
    recency_multiplier: n(row.recency_multiplier),
    recency_adjusted_score: n(row.recency_adjusted_score),
    reasoning_multiplier: n(row.reasoning_multiplier),
    reasoning_adjusted_score: n(row.reasoning_adjusted_score),
    reasoning_coverage_signal: n(row.reasoning_coverage_signal),
  };
}

export async function getProficiencyShadowScores(companyId: number, candidateId: number, jobId: number): Promise<ProficiencyShadowScore[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM proficiency_shadow_scores WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3 ORDER BY computed_at DESC',
      [companyId, candidateId, jobId]
    );
    return result.rows.map(coerceProficiencyShadowScoreRow);
  } catch (error) {
    console.error('Error fetching proficiency shadow scores:', error);
    return [];
  }
}

// All shadow scores for a company - the analytics surface (proficiencyAnalytics.ts) needs the
// full set, not scoped to one candidate/job pair.
export async function getAllProficiencyShadowScoresForCompany(companyId: number): Promise<ProficiencyShadowScore[]> {
  try {
    const result = await pool.query('SELECT * FROM proficiency_shadow_scores WHERE company_id = $1 ORDER BY computed_at DESC', [companyId]);
    return result.rows.map(coerceProficiencyShadowScoreRow);
  } catch (error) {
    console.error('Error fetching all proficiency shadow scores for company:', error);
    return [];
  }
}

// ==================== BGE RETRIEVAL SHADOW COMPARISON (SHADOW MODE ONLY) ====================
// Append-only, same convention as swipes/proficiency_shadow_scores. Never read by any live
// ranking/scoring path - see bgeShadowRetrieval.ts's module doc.
export async function insertBgeRetrievalShadowComparison(input: {
  company_id: number;
  job_id: number;
  pool_size: number;
  existing_ranking: RankingEntry[];
  bge_ranking: RankingEntry[] | null;
  top10_overlap_count: number | null;
  top10_overlap_pct: number | null;
  rank_correlation: number | null;
  bge_available: boolean;
  embed_latency_ms: number | null;
  rerank_latency_ms: number | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bge_retrieval_shadow_comparisons (
         company_id, job_id, pool_size, existing_ranking, bge_ranking, top10_overlap_count,
         top10_overlap_pct, rank_correlation, bge_available, embed_latency_ms, rerank_latency_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.company_id, input.job_id, input.pool_size, JSON.stringify(input.existing_ranking),
        input.bge_ranking !== null ? JSON.stringify(input.bge_ranking) : null,
        input.top10_overlap_count, input.top10_overlap_pct, input.rank_correlation,
        input.bge_available, input.embed_latency_ms, input.rerank_latency_ms,
      ]
    );
  } catch (error) {
    console.error('Error logging BGE retrieval shadow comparison:', error);
  }
}

export async function getBgeRetrievalShadowComparisons(companyId: number, jobId?: number): Promise<BgeRetrievalShadowComparison[]> {
  try {
    const result = jobId
      ? await pool.query('SELECT * FROM bge_retrieval_shadow_comparisons WHERE company_id = $1 AND job_id = $2 ORDER BY computed_at DESC', [companyId, jobId])
      : await pool.query('SELECT * FROM bge_retrieval_shadow_comparisons WHERE company_id = $1 ORDER BY computed_at DESC', [companyId]);
    return result.rows.map((row) => ({
      ...row,
      top10_overlap_pct: row.top10_overlap_pct === null ? null : Number(row.top10_overlap_pct),
      rank_correlation: row.rank_correlation === null ? null : Number(row.rank_correlation),
      embed_latency_ms: row.embed_latency_ms === null ? null : Number(row.embed_latency_ms),
      rerank_latency_ms: row.rerank_latency_ms === null ? null : Number(row.rerank_latency_ms),
    }));
  } catch (error) {
    console.error('Error fetching BGE retrieval shadow comparisons:', error);
    return [];
  }
}

// MODEL VERSIONS
export async function getLatestModelVersion(): Promise<ModelVersion | null> {
  try {
    const result = await pool.query('SELECT * FROM model_versions WHERE is_active = true ORDER BY trained_at DESC LIMIT 1');
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching latest model version:', error);
    return null;
  }
}

export async function saveModelVersion(version: Omit<ModelVersion, 'id'>): Promise<ModelVersion | null> {
  try {
    const result = await pool.query(
      `INSERT INTO model_versions (version, accuracy, training_examples, trained_at, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [version.version, version.accuracy, version.training_examples, version.trained_at, version.is_active]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving model version:', error);
    return null;
  }
}

// Microservices Migration, Batch 23 - persists the active scoring model type (previously
// in-memory-only in src/matching/services.ts, see that file's `activeModelType` binding). Single
// row (id = 1), read once at startup and on every explicit change - never on the scoring hot path
// itself, which keeps reading the in-memory binding directly for zero added latency.
export async function getMatchingModelConfig(): Promise<'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted'> {
  try {
    const result = await pool.query('SELECT active_model_type FROM matching_model_config WHERE id = 1');
    return result.rows[0]?.active_model_type ?? 'random_forest';
  } catch (error) {
    console.error('Error fetching matching model config:', error);
    return 'random_forest';
  }
}

export async function setMatchingModelConfig(modelType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted'): Promise<void> {
  await pool.query(
    `INSERT INTO matching_model_config (id, active_model_type, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET active_model_type = $1, updated_at = NOW()`,
    [modelType]
  );
}

// DAILY STATS
export async function getDailyStats(recruiterId: number, date: string): Promise<DailyStat | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM daily_stats WHERE recruiter_id = $1 AND date = $2',
      [recruiterId, date]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    return null;
  }
}

export async function updateDailyStats(recruiterId: number, date: string, updates: Partial<DailyStat>): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO daily_stats (recruiter_id, date, swipes_count, acceptance_rate) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (recruiter_id, date) 
       DO UPDATE SET swipes_count = $3, acceptance_rate = $4`,
      [recruiterId, date, updates.swipes_count || 0, updates.acceptance_rate || 0]
    );
  } catch (error) {
    console.error('Error updating daily stats:', error);
  }
}

// REFRESH TOKEN SESSIONS
export async function createRefreshToken(params: { userId: number; tokenHash: string; userAgent?: string | null; ip?: string | null; expiresAt: Date; remember?: boolean }): Promise<void> {
  try {
    const result = await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at, remember) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [params.userId, params.tokenHash, params.userAgent || null, params.ip || null, params.expiresAt, params.remember !== false]
    );
    const row = result.rows[0];
    dualWrite.upsertRefreshToken({
      id: row.id, user_id: params.userId, token_hash: params.tokenHash, user_agent: params.userAgent || null,
      ip_address: params.ip || null, created_at: row.created_at, expires_at: params.expiresAt, revoked_at: null, remember: params.remember !== false,
    });
  } catch (error) {
    console.error('Error creating refresh token:', error);
    throw error;
  }
}

export async function findRefreshTokenByHash(tokenHash: string): Promise<any | null> {
  try {
    const result = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error finding refresh token:', error);
    return null;
  }
}

export async function revokeRefreshTokenByHash(tokenHash: string): Promise<void> {
  try {
    const result = await pool.query('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, revoked_at', [tokenHash]);
    if (result.rows.length > 0) dualWrite.revokeRefreshTokens(result.rows);
  } catch (error) {
    console.error('Error revoking refresh token:', error);
  }
}

export async function revokeAllRefreshTokensForUser(userId: number): Promise<void> {
  try {
    const result = await pool.query('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL RETURNING id, revoked_at', [userId]);
    if (result.rows.length > 0) dualWrite.revokeRefreshTokens(result.rows);
  } catch (error) {
    console.error('Error revoking all refresh tokens for user:', error);
  }
}

export async function getActiveRefreshTokensForUser(userId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching active refresh tokens:', error);
    return [];
  }
}

// ==================== SESSION / OTP CLEANUP (Production Database Hardening, Phase 2) ====================
// Deletes only rows that are already functionally dead - never anything a live session or a
// still-valid OTP could depend on. A generous 30-day retention on revoked/expired rows (rather
// than deleting the moment they expire) is deliberate, not arbitrary: auth.routes.ts's /refresh
// handler detects refresh-token theft by checking whether an already-revoked token gets reused
// (revoked_at IS NOT NULL on the presented token triggers revokeAllRefreshTokensForUser as a
// defensive measure) - deleting a revoked row too early would silently disable that specific
// defense for it (a replayed stolen token would just look like "not found" instead of triggering
// the account-wide revocation). 30 days preserves that security property for a realistic window
// while still bounding table growth. otp_verification rows are cleaned much sooner (24 hours)
// since nothing reads an OTP after its 10-minute TTL except the 1-hour request-rate-limit lookback
// in enforceOtpRequestLimits - 24 hours is a safe margin past both.
const REVOKED_TOKEN_RETENTION_DAYS = 30;
const OTP_RETENTION_HOURS = 24;

export interface SessionCleanupResult {
  refreshTokensDeleted: number;
  candidateRefreshTokensDeleted: number;
  otpRecordsDeleted: number;
}

export async function cleanupExpiredSessions(): Promise<SessionCleanupResult> {
  const result: SessionCleanupResult = { refreshTokensDeleted: 0, candidateRefreshTokensDeleted: 0, otpRecordsDeleted: 0 };
  try {
    const r1 = await pool.query(
      `DELETE FROM refresh_tokens
       WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 || ' days')::interval)
          OR (expires_at < NOW() - ($1 || ' days')::interval)`,
      [REVOKED_TOKEN_RETENTION_DAYS]
    );
    result.refreshTokensDeleted = r1.rowCount ?? 0;

    const r2 = await pool.query(
      `DELETE FROM candidate_refresh_tokens
       WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 || ' days')::interval)
          OR (expires_at < NOW() - ($1 || ' days')::interval)`,
      [REVOKED_TOKEN_RETENTION_DAYS]
    );
    result.candidateRefreshTokensDeleted = r2.rowCount ?? 0;

    const r3 = await pool.query(
      `DELETE FROM otp_verification WHERE expires_at < NOW() - ($1 || ' hours')::interval`,
      [OTP_RETENTION_HOURS]
    );
    result.otpRecordsDeleted = r3.rowCount ?? 0;
  } catch (error) {
    console.error('Error cleaning up expired sessions/OTP records:', error);
  }
  return result;
}

// HEALTH CHECK
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  try {
    await pool.end();
    console.log('PostgreSQL connection pool closed');
  } catch (error) {
    console.error('Error closing connection pool:', error);
  }
}

export async function truncateAll(): Promise<void> {
  console.log('🔄 Wiping out database tables (TRUNCATE)...');
  await pool.query('TRUNCATE TABLE match_scores CASCADE');
  await pool.query('TRUNCATE TABLE swipes CASCADE');
  await pool.query('TRUNCATE TABLE candidates CASCADE');
  console.log('✅ Database tables truncated successfully.');
}


export async function deleteJob(jobId: number, companyId: number): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM match_scores WHERE job_id = $1 AND company_id = $2', [jobId, companyId]);
    await client.query('DELETE FROM swipes WHERE job_id = $1 AND company_id = $2', [jobId, companyId]);
    // reasoning_conclusions.subject_id has no FK (polymorphic - see deleteCandidate's comment).
    await client.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2', ['job', jobId]);

    const result = await client.query('DELETE FROM jobs WHERE id = $1 AND company_id = $2', [jobId, companyId]);

    await client.query('COMMIT');
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) dualWrite.deleteJobMirror(jobId);
    return deleted;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting job:', error);
    return false;
  } finally {
    client.release();
  }
}

// ==================== reverse mirror (write-cutover completion plan, Phase B) ====================
// Job Service is now the write-authority for `jobs` (its own real INSERT/UPDATE/DELETE, its own
// sequence assigns new ids) - these two functions are the reverse of this file's own existing
// dualWrite.upsertJob/deleteJobMirror: they keep THIS table (the monolith's own copy) fresh
// instead, by explicit id, so recruiter-review.routes.ts's list/detail views (staying
// monolith-local, reading this table directly) keep seeing real data. Called from src/api/
// job-internal.routes.ts's new mirror-and-notify/mirror-delete endpoints. mirrorDeleteJob
// replicates the exact same match_scores/swipes/reasoning_conclusions cleanup transaction
// deleteJob above always ran - those tables still live here (or in other services not touched by
// this cutover), so the cleanup has to keep happening even though Job Service now owns the
// primary delete.
const JOB_MIRROR_COLUMNS = [
  'id', 'company_id', 'title', 'description', 'required_skills', 'experience_years', 'location',
  'salary_min', 'salary_max', 'status', 'optional_skills', 'min_experience', 'max_experience',
  'experience_unit', 'remote_type', 'employment_type', 'industry', 'department', 'education',
  'certifications', 'salary_currency', 'notice_period', 'number_of_openings', 'required_languages',
  'responsibilities', 'tech_stack', 'keywords', 'job_summary', 'source_raw_text', 'parse_confidence',
  'description_embedding',
];
const JOB_MIRROR_JSON_COLUMNS = new Set(['tech_stack', 'parse_confidence']);

export async function mirrorUpsertJob(row: Record<string, unknown>): Promise<void> {
  const columns = JOB_MIRROR_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => (JOB_MIRROR_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO jobs (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

export async function mirrorDeleteJob(jobId: number, companyId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM match_scores WHERE job_id = $1 AND company_id = $2', [jobId, companyId]);
    await client.query('DELETE FROM swipes WHERE job_id = $1 AND company_id = $2', [jobId, companyId]);
    await client.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2', ['job', jobId]);
    await client.query('DELETE FROM jobs WHERE id = $1 AND company_id = $2', [jobId, companyId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ==================== CANDIDATE SEARCH / TALENT DATABASE (Phase 7) ====================
// Global read over candidate_accounts (no company_id scoping - see migration-candidate-search.sql
// and the Phase 7 plan: candidate_accounts is deliberately company-agnostic, mirroring how
// candidates already browse every company's jobs in Job Discovery). Only rows with
// visible_to_recruiters = true, is_active = true, deleted_at IS NULL, and
// onboarding_completed_at IS NOT NULL are ever returned - hidden/incomplete/deactivated accounts
// are excluded server-side, never left to the client.

export interface CandidateSearchFilters {
  q?: string;
  skills?: string[];
  location?: string;
  currentCompany?: string;
  jobTitle?: string; // matched against headline, the existing "current title" field on candidate_accounts
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

// limit is a safety ceiling for the in-memory relevance-ranking/profile-strength-filtering step
// in candidate-search.routes.ts's rankAndRespond (business logic this hardening pass does not
// touch), not a page size - raised from 500 to 2000 as part of the Production Database Hardening
// pass. Callers that need an accurate total independent of this ceiling should use
// countCandidateSearchResults, not this function's row count.
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

// Extracted from searchCandidateAccounts (Production Database Hardening pass) so the exact same
// WHERE clause can back both the row fetch above and a real COUNT(*) below - previously the only
// way to know "how many candidates match" was `searchCandidateAccounts(...).length`, which is
// silently capped by whatever `limit` was passed (500, historically) regardless of how many rows
// actually match. For any filter combination matching more than that cap, the reported total was
// wrong and pages past the cap returned nothing even though more real matches existed - a
// correctness bug, not just a performance one. countCandidateSearchResults below gives the true
// count so the API's `total` is always accurate, independent of the fetch cap.
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

// "Shortlisted" reuses the EXISTING recruiter-review decision data (swipes.action = 1, i.e. the
// same "Accepted" bucket recruiter-review.routes.ts already computes) rather than introducing a
// second, parallel review/decision concept - only candidates linked to a candidate_accounts row
// are relevant here (candidates.candidate_account_id IS NOT NULL), scoped to this company.
export async function getShortlistedCandidateAccounts(companyId: number): Promise<CandidateAccount[]> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (ca.id) ca.*, latest.timestamp AS shortlisted_at
       FROM (
         SELECT DISTINCT ON (candidate_id, job_id) *
         FROM swipes
         WHERE company_id = $1 AND action = 1
         ORDER BY candidate_id, job_id, timestamp DESC, id DESC
       ) latest
       JOIN candidates c ON c.id = latest.candidate_id
       JOIN candidate_accounts ca ON ca.id = c.candidate_account_id
       WHERE c.candidate_account_id IS NOT NULL
       ORDER BY ca.id, latest.timestamp DESC`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching shortlisted candidates:', error);
    return [];
  }
}

export async function getCandidateAccountLastActive(candidateAccountId: number): Promise<string | null> {
  try {
    const result = await pool.query(
      'SELECT MAX(created_at) AS last_active FROM candidate_refresh_tokens WHERE candidate_id = $1',
      [candidateAccountId]
    );
    return result.rows[0]?.last_active ?? null;
  } catch (error) {
    console.error('Error fetching candidate last active:', error);
    return null;
  }
}

export async function getCandidateAccountsLastActiveBulk(candidateAccountIds: number[]): Promise<Map<number, string>> {
  if (candidateAccountIds.length === 0) return new Map();
  try {
    const result = await pool.query(
      'SELECT candidate_id, MAX(created_at) AS last_active FROM candidate_refresh_tokens WHERE candidate_id = ANY($1::int[]) GROUP BY candidate_id',
      [candidateAccountIds]
    );
    return new Map(result.rows.map((r) => [r.candidate_id, r.last_active]));
  } catch (error) {
    console.error('Error fetching bulk candidate last active:', error);
    return new Map();
  }
}

export const db = {
  getUsers,
  getUserById,
  getUserByEmail,
  getUserByPhone,
  createUser,
  updateUserPasswordHash,
  updateLastLogin,
  getCandidateAccountById,
  getCandidateAccountByEmail,
  getCandidateAccountByPhone,
  createCandidateAccount,
  updateCandidateAccountPasswordHash,
  updateCandidateProfile,
  markCandidateOnboardingComplete,
  getCandidateExperiences,
  createCandidateExperience,
  updateCandidateExperience,
  deleteCandidateExperience,
  searchCandidateAccounts,
  countCandidateSearchResults,
  saveCandidateForRecruiter,
  removeSavedCandidate,
  getSavedCandidateAccounts,
  getSavedCandidateAccountIds,
  recordCandidateProfileView,
  getRecentlyViewedCandidateAccounts,
  getShortlistedCandidateAccounts,
  getCandidateAccountLastActive,
  getCandidateAccountsLastActiveBulk,
  createCandidateRefreshToken,
  findCandidateRefreshTokenByHash,
  revokeCandidateRefreshTokenByHash,
  revokeAllCandidateRefreshTokensForCandidate,
  getUsersByCompany,
  getUserByIdForCompany,
  createUserByAdmin,
  createSuperadminUser,
  updateUserDetails,
  updateUserStatus,
  softDeleteUser,
  resetUserPasswordHash,
  getUserManagementStats,
  countActiveAdmins,
  getCompanyById,
  getOrCreateCompany,
  getCompanyByName,
  promoteUserToSuperadmin,
  createCompanyRegistrationRequest,
  findPendingCompanyRegistrationDuplicate,
  getCompanyRegistrationRequests,
  getCompanyRegistrationRequestById,
  getCompanyRegistrationRequestByIdentifier,
  getCompanyRegistrationStats,
  approveCompanyRegistrationRequest,
  rejectCompanyRegistrationRequest,
  createOtpRecord,
  getLatestOtpRecord,
  incrementOtpAttempts,
  markOtpVerified,
  deleteOtpRecords,
  countOtpRequestsSince,
  addPasswordHistory,
  getPasswordHistory,
  createRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshTokenByHash,
  revokeAllRefreshTokensForUser,
  getActiveRefreshTokensForUser,
  cleanupExpiredSessions,
  getCandidates,
  getCandidatesForJobScoring,
  getCandidatesPaginated,
  getCandidateById,
  getCandidateByHash,
  getCandidatesByIds,
  createCandidate,
  updateCandidate,
  deleteCandidate,
  mirrorUpsertCandidate,
  mirrorDeleteCandidate,
  getJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  mirrorUpsertJob,
  mirrorDeleteJob,
  updateJobStatus,
  updateJobEmbedding,
  upsertKnowledgeChunk,
  deleteKnowledgeChunk,
  getKnowledgeChunksForCompany,
  countKnowledgeChunks,
  getSwipes,
  getSwipesByJobId,
  getSwipesByRecruiterId,
  recordSwipe,
  mirrorUpsertSwipe,
  mirrorUpsertRecruiterNote,
  mirrorUpsertDetailedScoringReport,
  getAllSwipesUnscoped,
  getAllCandidatesUnscoped,
  getAllJobsUnscoped,
  getOpenJobsPublic,
  getOpenJobByIdPublic,
  getUnusedSwipesForTraining,
  markSwipesAsUsedForTraining,
  getSwipeById,
  getRecruiterReviewList,
  getRecruiterReviewDetail,
  getShortlistedCandidateIds,
  getJobCompanyId,
  getOrCreateLinkedCandidateRow,
  recordCandidateDecision,
  getLatestCandidateDecision,
  getCandidateDecisions,
  getCandidateActiveDecisions,
  evaluateAndCreateMutualMatch,
  getLinkedCandidateAccountId,
  getRecruiterDecisionForCandidateJob,
  getCandidateLikedJobsForAnalytics,
  getCandidateRecruiterReviewStats,
  getCandidateProfileViewCount,
  getCandidateApplicationStatusCounts,
  getCandidateActivityTrend,
  getCandidateMatches,
  getRecruiterMatches,
  syncApplicationStatusFromRecruiterDecision,
  getCandidateApplications,
  getCandidateApplication,
  getCandidateNotifications,
  getCandidateUnreadNotificationCount,
  markCandidateNotificationRead,
  markAllCandidateNotificationsRead,
  getRecruiterNotifications,
  getRecruiterUnreadNotificationCount,
  markRecruiterNotificationRead,
  markAllRecruiterNotificationsRead,
  getRecruiterReviewStats,
  upsertRecruiterNote,
  upsertDetailedScoringReport,
  getDetailedScoringReport,
  getAnalyticsDashboardStats,
  getJobAnalyticsCounts,
  getJobSwipeCounts,
  countCandidates,
  getAnalyticsTrend,
  getAnalyticsRecentActivity,
  getAnalyticsSkillDistribution,
  getAnalyticsRecruiterProfile,
  getMatchScores,
  saveMatchScore,
  saveMatchFeatures,
  getMatchFeaturesForJob,
  getMatchFeaturesAsOf,
  saveLtrModelVersion,
  getLatestLtrModelVersion,
  saveEvaluationRun,
  getEvaluationRuns,
  getSwipesForEvaluation,
  getAllApplicationStatusLinkedToCandidatesUnscoped,
  upsertSkillNode,
  getSkillNodeByCanonical,
  getSkillNodeById,
  findSkillNodeByAlias,
  getAllSkillNodes,
  updateSkillNodePopularity,
  updateSkillNodeEmbedding,
  getSkillDiscoveryProposalByToken,
  getSkillDiscoveryProposalById,
  createSkillDiscoveryProposal,
  updateSkillDiscoveryProposal,
  getPendingSkillDiscoveryProposals,
  getAllCandidateSkillArrays,
  getAllJobRequiredSkills,
  upsertSkillEdge,
  getSkillEdgesFrom,
  getSkillEdgesTo,
  getAllSkillEdges,
  upsertCareerTrajectory,
  getCareerTrajectory,
  queryCareerTrajectoriesByProgressionType,
  getAllCareerTrajectoriesForCompany,
  replaceReasoningConclusions,
  getReasoningConclusions,
  deleteReasoningConclusions,
  insertProficiencyShadowScore,
  getProficiencyShadowScores,
  getAllProficiencyShadowScoresForCompany,
  insertBgeRetrievalShadowComparison,
  getBgeRetrievalShadowComparisons,
  upsertRoleProfile,
  getRoleProfileByKey,
  getAllRoleProfiles,
  updateRoleProfileEmbedding,
  getLatestModelVersion,
  saveModelVersion,
  getMatchingModelConfig,
  setMatchingModelConfig,
  getDailyStats,
  updateDailyStats,
  healthCheck,
  closeConnection,
  truncateAll,
};