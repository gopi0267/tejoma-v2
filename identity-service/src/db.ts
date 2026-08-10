/**
 * PostgreSQL connection pool and data-access functions for Identity Service's own database (the
 * "Identity DB" per Phase 3(database) section 1: users(auth columns), refresh_tokens,
 * password_history, candidate_accounts(auth columns only), candidate_refresh_tokens,
 * otp_verification).
 *
 * The functions below are ported from the monolith's src/db.ts (same file, same names, same
 * query shapes, same error-handling convention: catch, log, return null/false/[] - never throw
 * to the caller) - Batch 4 added the staff-auth slice; this batch (5) adds the candidate-auth
 * slice against candidate_accounts' AUTH COLUMNS ONLY (see types.ts's CandidateAccount comment).
 * OTP/password functions are added in the batches that add the routes using them.
 *
 * Pool configuration mirrors the root project's src/db.ts conventions (see that file) - same
 * idleTimeoutMillis/connectionTimeoutMillis/statement_timeout safety-net defaults, same env var
 * names, so an engineer familiar with the monolith's DB layer recognizes this immediately.
 */
import pkg from 'pg';
import type { User, RefreshTokenRecord, CandidateAccount, CandidateRefreshTokenRecord, OtpRecord, OtpPurpose, AuditEvent } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_identity',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('identity-service PostgreSQL pool error:', err);
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

// ==================== USERS (auth columns - ported from the monolith's src/db.ts) ====================

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

/**
 * New in Batch 11 - the INSERT half of the monolith's approveCompanyRegistrationRequest
 * (src/db.ts:836-896 in the monolith), extracted into its own function since it's now called
 * over the wire (routes/internal.routes.ts's POST /internal/users) by Platform Governance
 * Service's approve saga, rather than inline inside one cross-table transaction - see that
 * saga's header comment (platform-governance-service/src/routes/company-requests.routes.ts) for
 * the full distributed-transaction reasoning. Same columns, same defaults (is_active=true) as the
 * monolith's original INSERT.
 */
export async function createStaffUser(params: {
  name: string; email: string | null; phone: string | null; passwordHash: string;
  companyId: number; role: 'recruiter' | 'admin' | 'superadmin'; createdBy: number | null;
}): Promise<User | null> {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, phone, password_hash, company_id, role, is_active, name, created_by)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING *`,
      [params.email, params.phone, params.passwordHash, params.companyId, params.role, params.name, params.createdBy]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating staff user:', error);
    return null;
  }
}

export async function updateLastLogin(userId: number): Promise<void> {
  try {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
  } catch (error) {
    console.error('Error updating last login:', error);
  }
}

// ==================== REFRESH TOKENS (ported from the monolith's src/db.ts) ====================

export async function createRefreshToken(params: {
  userId: number;
  tokenHash: string;
  userAgent?: string | null;
  ip?: string | null;
  expiresAt: Date;
  remember?: boolean;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at, remember) VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.userId, params.tokenHash, params.userAgent || null, params.ip || null, params.expiresAt, params.remember !== false]
    );
  } catch (error) {
    console.error('Error creating refresh token:', error);
    throw error;
  }
}

export async function findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
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
    await pool.query('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  } catch (error) {
    console.error('Error revoking refresh token:', error);
  }
}

export async function revokeAllRefreshTokensForUser(userId: number): Promise<void> {
  try {
    await pool.query('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  } catch (error) {
    console.error('Error revoking all refresh tokens for user:', error);
  }
}

// ==================== CANDIDATE ACCOUNTS (auth columns only - ported from the monolith) ====================

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
    return result.rows[0];
  } catch (error) {
    console.error('Error creating candidate account:', error);
    return null;
  }
}

export async function updateCandidateAccountPasswordHash(candidateId: number, passwordHash: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'UPDATE candidate_accounts SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, candidateId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error updating candidate account password:', error);
    return false;
  }
}

// ==================== CANDIDATE REFRESH TOKENS (ported from the monolith) ====================

export async function createCandidateRefreshToken(params: {
  candidateId: number;
  tokenHash: string;
  userAgent?: string | null;
  ip?: string | null;
  expiresAt: Date;
  remember?: boolean;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO candidate_refresh_tokens (candidate_id, token_hash, user_agent, ip_address, expires_at, remember) VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.candidateId, params.tokenHash, params.userAgent || null, params.ip || null, params.expiresAt, params.remember !== false]
    );
  } catch (error) {
    console.error('Error creating candidate refresh token:', error);
    throw error;
  }
}

export async function findCandidateRefreshTokenByHash(tokenHash: string): Promise<CandidateRefreshTokenRecord | null> {
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
    await pool.query('UPDATE candidate_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  } catch (error) {
    console.error('Error revoking candidate refresh token:', error);
  }
}

export async function revokeAllCandidateRefreshTokensForCandidate(candidateId: number): Promise<void> {
  try {
    await pool.query('UPDATE candidate_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE candidate_id = $1 AND revoked_at IS NULL', [candidateId]);
  } catch (error) {
    console.error('Error revoking all candidate refresh tokens:', error);
  }
}

// ==================== OTP VERIFICATION (ported from the monolith's src/db.ts) ====================

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

export async function getLatestOtpRecord(params: { email?: string | null; phone?: string | null; purpose: OtpPurpose }): Promise<OtpRecord | null> {
  try {
    const result = params.email
      ? await pool.query(`SELECT * FROM otp_verification WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`, [params.email, params.purpose])
      : await pool.query(`SELECT * FROM otp_verification WHERE phone = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`, [params.phone, params.purpose]);
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

// ==================== PASSWORD HISTORY (ported from the monolith's src/db.ts) ====================

const PASSWORD_HISTORY_LIMIT = 5;

export async function updateUserPasswordHash(userId: number, passwordHash: string): Promise<boolean> {
  try {
    const result = await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [passwordHash, userId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error updating user password:', error);
    return false;
  }
}

export async function addPasswordHistory(userId: number, passwordHash: string): Promise<void> {
  try {
    await pool.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
    // Keep only the most recent N entries per user.
    await pool.query(
      `DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
       )`,
      [userId, PASSWORD_HISTORY_LIMIT]
    );
  } catch (error) {
    console.error('Error adding password history:', error);
  }
}

export async function getPasswordHistory(userId: number): Promise<{ password_hash: string }[]> {
  try {
    const result = await pool.query('SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, PASSWORD_HISTORY_LIMIT]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching password history:', error);
    return [];
  }
}

// ==================== AUDIT LOG (new in Batch 9 - see migrations/002_audit_log.up.sql) ====================

/**
 * Records a security-relevant identity event. Deliberately never throws to the caller - an audit
 * write failure must never block or fail the real request it's describing (the same
 * "never block on a non-critical dependency" principle already applied to
 * tenantDirectoryClient.ts/marketplaceClient.ts, here applied to a local-DB write instead of a
 * cross-service call). A logger.error call ensures a failed audit write is still visible
 * operationally, just not fatal to the request.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_type, actor_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.actorType, event.actorId, event.eventType, event.ip, event.userAgent, event.metadata ? JSON.stringify(event.metadata) : null]
    );
  } catch (error) {
    console.error('Error recording audit event (non-fatal, request continues):', error);
  }
}

// ==================== USER MANAGEMENT (Batch 21 - admin adding/managing recruiters within their
// own company) - ported from the monolith's src/db.ts, same query shapes, same error-handling
// convention. No dual-write back to the monolith from here - exactly like every other Tier 0
// service's own database, this service's own routes only ever read/write its own database. The
// monolith remains authoritative until a deliberate cutover; until then this database is kept
// current by the monolith's own dual-write (upsertUser/patchUser, already wired into every one of
// the monolith's own equivalent functions since an earlier batch), never the reverse. ====================

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
    return result.rows[0];
  } catch (error) {
    console.error('Error creating user by admin:', error);
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
    return result.rows[0] || null;
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
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating user status:', error);
    return null;
  }
}

export async function softDeleteUser(id: number, companyId: number, actorId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = CURRENT_TIMESTAMP, updated_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND company_id = $3 AND deleted_at IS NULL`,
      [actorId, id, companyId]
    );
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
    return result.rows[0] || null;
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

// Remaining-monolith migration, Step 5 - candidate-search.routes.ts's "last_active" enrichment
// (recruiter-facing candidate search, folded into candidate-service) needs this table, which is
// this service's own domain (candidate auth sessions), not candidate-service's. Ported verbatim
// from the monolith's own db.ts:getCandidateAccountsLastActiveBulk - identical query, identical
// semantics (MAX(created_at) per candidate id, i.e. most recent session).
export async function getCandidateAccountsLastActiveBulk(candidateAccountIds: number[]): Promise<Record<number, string>> {
  if (candidateAccountIds.length === 0) return {};
  try {
    const result = await pool.query(
      'SELECT candidate_id, MAX(created_at) AS last_active FROM candidate_refresh_tokens WHERE candidate_id = ANY($1::int[]) GROUP BY candidate_id',
      [candidateAccountIds]
    );
    const out: Record<number, string> = {};
    for (const row of result.rows) out[row.candidate_id] = row.last_active;
    return out;
  } catch (error) {
    console.error('Error fetching bulk candidate last active:', error);
    return {};
  }
}

// Aggregate export, matching the monolith's `import { db } from '../db.js'` calling convention
// exactly (see the root project's src/db.ts) - so route code reads identically either way.
export const db = {
  healthCheck,
  getUserById,
  getUserByEmail,
  getUserByPhone,
  getUsersByCompany,
  getUserByIdForCompany,
  createUserByAdmin,
  updateUserDetails,
  updateUserStatus,
  softDeleteUser,
  resetUserPasswordHash,
  getUserManagementStats,
  countActiveAdmins,
  revokeAllRefreshTokensForUser,
  createStaffUser,
  updateLastLogin,
  createRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshTokenByHash,
  getCandidateAccountById,
  getCandidateAccountByEmail,
  getCandidateAccountByPhone,
  createCandidateAccount,
  updateCandidateAccountPasswordHash,
  createCandidateRefreshToken,
  findCandidateRefreshTokenByHash,
  revokeCandidateRefreshTokenByHash,
  revokeAllCandidateRefreshTokensForCandidate,
  createOtpRecord,
  getLatestOtpRecord,
  incrementOtpAttempts,
  markOtpVerified,
  deleteOtpRecords,
  countOtpRequestsSince,
  updateUserPasswordHash,
  addPasswordHistory,
  getPasswordHistory,
  recordAuditEvent,
  getCandidateAccountsLastActiveBulk,
};

export { pool };
