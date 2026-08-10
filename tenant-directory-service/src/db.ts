/**
 * PostgreSQL connection pool and data-access functions for Tenant Directory Service's own
 * database (Phase 3(database) section 1) - a single table, companies, moved out of the
 * monolith's shared database.
 *
 * Ported from the monolith's src/db.ts (same file, same query shapes, same error-handling
 * convention: catch, log, return null - never throw) with one adjustment: `createCompany` merges
 * the monolith's two separate creation paths - `getOrCreateCompany(name)` (used by the now-dead
 * `signup/start`, hardcodes industry='Technology') and the company-creation half of
 * `approveCompanyRegistrationRequest` (carries over the request's real industry/website) - into
 * one function taking optional industry/website, since both call sites just need "create a
 * company with a reserved id and a matching slug," and only one of those two original callers
 * (the approval workflow) is actually reachable (see identity-service's auth.routes.ts header
 * comment on why signup/start was not ported).
 */
import pkg from 'pg';
import type { Company } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_tenant_directory',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('tenant-directory-service PostgreSQL pool error:', err);
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

// Ported exactly from the monolith's src/db.ts slugifyCompanyName.
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

export async function getCompanyByName(name: string): Promise<Company | null> {
  try {
    const result = await pool.query('SELECT * FROM companies WHERE lower(name) = lower($1)', [name]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching company by name:', error);
    return null;
  }
}

/**
 * Reserves a company id up front (company_slug is NOT NULL with no default, and its uniqueness
 * scheme is `slug-id`, so the id must be known before the row is inserted - unchanged from the
 * monolith's reasoning) and creates the company in one INSERT. industry defaults to 'Technology'
 * to match the monolith's original getOrCreateCompany default when the caller doesn't supply one.
 */
export async function createCompany(params: { name: string; industry?: string | null; website?: string | null }): Promise<Company | null> {
  try {
    const idResult = await pool.query("SELECT nextval('companies_id_seq') AS id");
    const id: number = idResult.rows[0].id;
    const slug = `${slugifyCompanyName(params.name)}-${id}`;
    const created = await pool.query(
      `INSERT INTO companies (id, name, industry, plan, seats_limit, is_active, company_slug, website)
       VALUES ($1, $2, $3, 'starter', 5, true, $4, $5) RETURNING *`,
      [id, params.name, params.industry || 'Technology', slug, params.website || null]
    );
    return created.rows[0];
  } catch (error) {
    console.error('Error creating company:', error);
    return null;
  }
}

export async function deactivateCompany(id: number): Promise<boolean> {
  try {
    const result = await pool.query('UPDATE companies SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error deactivating company:', error);
    return false;
  }
}

export const db = {
  healthCheck,
  getCompanyById,
  getCompanyByName,
  createCompany,
  deactivateCompany,
};

export { pool };
