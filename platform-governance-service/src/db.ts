/**
 * PostgreSQL connection pool and data-access functions for Platform Governance Service's own
 * database (Phase 3(database) section 1) - a single table, company_registration_requests, moved
 * out of the monolith's shared database (Phase 3(database) section 4's per-service isolation,
 * already applied to Identity DB in identity-service/src/db.ts).
 *
 * Ported from the monolith's src/db.ts (same file, same names, same query shapes, same
 * error-handling convention: catch, log, return null/false/[] - never throw to the caller) with
 * one function deliberately NOT ported: approveCompanyRegistrationRequest. See
 * routes/company-requests.routes.ts's header comment for why - it's a cross-service transaction
 * (creates a company AND a user, neither of which lives in this service's database anymore) that
 * cannot be implemented until Tenant Directory Service exists (Batch 11).
 */
import pkg from 'pg';
import type { CompanyRegistrationRequest, CompanyRegistrationFilters } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_platform_governance',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('platform-governance-service PostgreSQL pool error:', err);
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

// ==================== COMPANY APPROVAL WORKFLOW (ported from the monolith's src/db.ts) ====================

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

export async function rejectCompanyRegistrationRequest(id: number, reviewerId: number, reason: string): Promise<CompanyRegistrationRequest | { error: string } | null> {
  try {
    const existing = await pool.query('SELECT status FROM company_registration_requests WHERE id = $1', [id]);
    if (!existing.rows[0]) return null;
    if (existing.rows[0].status !== 'pending') return { error: `Request has already been ${existing.rows[0].status}` };

    const result = await pool.query(
      `UPDATE company_registration_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, review_notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'pending' RETURNING *`,
      [reviewerId, reason, id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error rejecting company registration request:', error);
    return { error: 'Failed to reject request' };
  }
}

// ==================== APPROVE SAGA PRIMITIVES (new in Batch 11) ====================
// See routes/company-requests.routes.ts's header comment for the full saga design. Concurrency
// safety (preventing two superadmins, or a double-click, from both proceeding past the same
// request) is handled by a Postgres session-level advisory lock held for the whole handler (see
// the route itself) - not by these functions, which is why there's no separate "claim" step here.
// reviewed_by/reviewed_at are set exactly once, together with status='approved', in
// finalizeApproval - the same one-shot semantics the monolith's original schema always had.

/** Checkpoint: company creation succeeded. Persisted immediately so a crash-and-retry (still under the advisory lock on resume) knows not to create a second company. */
export async function setResultingCompany(id: number, companyId: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE company_registration_requests SET resulting_company_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [companyId, id]
    );
  } catch (error) {
    console.error('Error recording resulting company on approval request:', error);
  }
}

/** Clears a checkpointed company reference after user-creation failed and the company was compensated (deactivated) - a retry will create a fresh company rather than reuse the now-deactivated one. */
export async function clearResultingCompany(id: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE company_registration_requests SET resulting_company_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
  } catch (error) {
    console.error('Error clearing resulting company on approval request:', error);
  }
}

/** Final saga step: both company and user exist - mark the request approved for real, in one atomic update. */
export async function finalizeApproval(id: number, reviewerId: number, userId: number): Promise<CompanyRegistrationRequest | null> {
  try {
    const result = await pool.query(
      `UPDATE company_registration_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, resulting_user_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [reviewerId, userId, id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error finalizing company registration approval:', error);
    return null;
  }
}

// Aggregate export, matching the monolith's/identity-service's `import { db } from '../db.js'`
// calling convention exactly.
export const db = {
  healthCheck,
  createCompanyRegistrationRequest,
  findPendingCompanyRegistrationDuplicate,
  getCompanyRegistrationRequests,
  getCompanyRegistrationRequestById,
  getCompanyRegistrationRequestByIdentifier,
  getCompanyRegistrationStats,
  rejectCompanyRegistrationRequest,
  setResultingCompany,
  clearResultingCompany,
  finalizeApproval,
};

export { pool };
