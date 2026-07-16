/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PostgreSQL Database Layer for Tejoma Recruiting
 */

import pkg from 'pg';
import { config } from 'dotenv';
import { User, Company, Candidate, Job, Swipe, MatchScore, ModelVersion, DailyStat, RecruiterNote, CompanyRegistrationRequest } from './types.js';

config({ path: '.env.local' });

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  min: parseInt(process.env.DB_POOL_MIN || '2'),
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
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error updating user password:', error);
    return false;
  }
}

export async function updateLastLogin(userId: number): Promise<void> {
  try {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
  } catch (error) {
    console.error('Error updating last login:', error);
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
    return result.rows[0];
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
    return result.rows[0];
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
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error rejecting company registration request:', error);
    return { error: 'Failed to reject request' };
  }
}

// OTP VERIFICATION (signup + password reset, email or phone)
type OtpPurpose = 'signup' | 'password_reset';

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
function mapRowToCandidate(row: any): Candidate {
  if (!row) return row;
  
  const parseList = (val: any, sep = ', ') => {
    if (val === undefined || val === null) return [];
    if (Array.isArray(val)) return val;
    const str = String(val).trim();
    if (str === '' || str.toLowerCase() === 'null') return [];
    return str.split(sep).map((s: string) => s.trim()).filter((s: string) => s);
  };

  return {
    ...row,
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

    const result = await pool.query(
      `INSERT INTO candidates
       (company_id, name, email, phone, skills, primary_skills, secondary_skills, years_of_experience,
        current_location, preferred_location, current_company, previous_companies, current_job_title,
        industry_domain, education, highest_qualification, graduation_year, university, certifications,
        projects, technical_tools, languages_known, current_ctc, expected_ctc, notice_period,
        willingness_to_relocate, linkedin_url, github_or_portfolio_url, resume_summary, resume_text,
        ai_confidence_score, resume_file_path, extraction_status, candidate_hash, resume_embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
       RETURNING *`,
      cleanParams
    );
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error creating candidate:', error);
    return null;
  }
}

export async function deleteCandidate(id: number, companyId: number): Promise<boolean> {
  try {
    const result = await pool.query('DELETE FROM candidates WHERE id = $1 AND company_id = $2', [id, companyId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error deleting candidate:', error);
    return false;
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

        values.push(mappedValue);
        paramIndex++;
      }
    }

    if (fields.length === 0) return getCandidateById(id, companyId);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, companyId);

    const result = await pool.query(
      `UPDATE candidates SET ${fields.join(', ')} WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1} RETURNING *`,
      values
    );
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
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
    return result.rows[0];
  } catch (error) {
    console.error('Error creating job:', error);
    return null;
  }
}

export async function updateJobEmbedding(id: number, embedding: number[]): Promise<void> {
  try {
    await pool.query('UPDATE jobs SET description_embedding = $1 WHERE id = $2', [embedding, id]);
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
    return result.rows[0] || null;
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
  await pool.query(
    `INSERT INTO knowledge_base_chunks (company_id, source_type, source_id, content, embedding)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_type, source_id)
     DO UPDATE SET company_id = $1, content = $4, embedding = $5, updated_at = CURRENT_TIMESTAMP`,
    [chunk.company_id, chunk.source_type, chunk.source_id, chunk.content, chunk.embedding]
  );
}

export async function deleteKnowledgeChunk(sourceType: 'candidate' | 'job' | 'company', sourceId: number): Promise<void> {
  await pool.query('DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, sourceId]);
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

    return {
      ...savedRow,
      action: Number(savedRow.action)
    };
  } catch (error) {
    console.error('❌ recordSwipe FAILED:', error);
    return null;
  }
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
    const history = historyResult.rows.map((r) => ({ ...r, action: Number(r.action) }));

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
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error upserting recruiter note:', error);
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
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at, remember) VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.userId, params.tokenHash, params.userAgent || null, params.ip || null, params.expiresAt, params.remember !== false]
    );
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

    const result = await client.query('DELETE FROM jobs WHERE id = $1 AND company_id = $2', [jobId, companyId]);

    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting job:', error);
    return false;
  } finally {
    client.release();
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
  getCandidates,
  getCandidateById,
  getCandidateByHash,
  getCandidatesByIds,
  createCandidate,
  updateCandidate,
  deleteCandidate,
  getJobs,
  getJobById,
  createJob,
  deleteJob,
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
  getAllSwipesUnscoped,
  getAllCandidatesUnscoped,
  getAllJobsUnscoped,
  getUnusedSwipesForTraining,
  markSwipesAsUsedForTraining,
  getSwipeById,
  getRecruiterReviewList,
  getRecruiterReviewDetail,
  getRecruiterReviewStats,
  upsertRecruiterNote,
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
  getLatestModelVersion,
  saveModelVersion,
  getDailyStats,
  updateDailyStats,
  healthCheck,
  closeConnection,
  truncateAll,
};