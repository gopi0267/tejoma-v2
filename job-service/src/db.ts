/**
 * PostgreSQL connection pool and data-access functions for Job Service's own database -
 * a dual-written, read-only-from-this-service's-own-code mirror of `jobs`. The monolith remains
 * the sole writer (job.routes.ts's createJob/updateJob, unchanged) - upsertJob/patchJob below
 * exist only as dual-write's targets. getJobs/getJobById are real reads, served directly from this
 * service's own database for whichever caller is routed here.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention).
 */
import pkg from 'pg';
import type { Job } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_job',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('job-service PostgreSQL pool error:', err);
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

const JOB_COLUMNS = [
  'id', 'company_id', 'title', 'description', 'required_skills', 'experience_years', 'location',
  'salary_min', 'salary_max', 'status', 'created_at', 'updated_at', 'optional_skills',
  'min_experience', 'max_experience', 'experience_unit', 'remote_type', 'employment_type',
  'industry', 'department', 'education', 'certifications', 'salary_currency', 'notice_period',
  'number_of_openings', 'required_languages', 'responsibilities', 'tech_stack', 'keywords',
  'job_summary', 'source_raw_text', 'parse_confidence', 'description_embedding',
  'skills_embedding', 'responsibilities_embedding', 'title_embedding',
];
const JOB_JSON_COLUMNS = new Set(['tech_stack', 'parse_confidence']);

export async function upsertJob(row: Record<string, unknown>): Promise<void> {
  try {
    const columns = JOB_COLUMNS.filter((c) => c in row);
    const values = columns.map((c) => (JOB_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await pool.query(
      `INSERT INTO jobs (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
      values
    );
  } catch (error) {
    console.error('Error upserting job (dual-write):', error);
  }
}

export async function patchJob(id: number, fields: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  try {
    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = columns.map((c) => (JOB_JSON_COLUMNS.has(c) && fields[c] !== null && fields[c] !== undefined ? JSON.stringify(fields[c]) : fields[c]));
    await pool.query(`UPDATE jobs SET ${setClause} WHERE id = $${columns.length + 1}`, [...values, id]);
  } catch (error) {
    console.error('Error patching job (dual-write):', error);
  }
}

export async function deleteJobMirror(id: number): Promise<void> {
  try {
    await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
  } catch (error) {
    console.error('Error deleting job (dual-write):', error);
  }
}

export async function getJobs(companyId: number): Promise<Job[]> {
  try {
    const result = await pool.query("SELECT * FROM jobs WHERE company_id = $1 AND status = 'open' ORDER BY created_at DESC", [companyId]);
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

// Remaining-monolith migration, Step 6 - matching-decision-service's GET /api/swipes/history real
// cutover needs a bounded set of jobs by id for title hydration. No status filter, unlike getJobs
// above (that one's own "open only" bias is a pre-existing quirk of the monolith's own getJobs,
// not something this new by-ids shape needs to replicate) - a swipe can reference a job that's
// since closed, and this correctly shows its title instead of "Unknown Job".
export async function getJobsByIds(ids: number[], companyId: number): Promise<Job[]> {
  if (ids.length === 0) return [];
  try {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(`SELECT * FROM jobs WHERE company_id = $1 AND id IN (${placeholders})`, [companyId, ...ids]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching jobs by ids:', error);
    return [];
  }
}

// ==================== real writes (write-cutover completion plan, Phase B) ====================
// This service is now the write-authority for `jobs` - these are genuine INSERT/UPDATE/DELETE
// against this service's own database (its own SERIAL sequence assigns new ids), not dual-write
// targets. Ported from the monolith's own src/db.ts's createJob/updateJob: unlike candidates'
// delimited-string storage (write-cutover completion plan, Phase A), `jobs` already stores
// required_skills/optional_skills/etc. as real Postgres arrays here, so no join/split conversion
// is needed - a much closer byte-for-byte port. dualWrite.upsertJob does NOT fire here (unlike the
// monolith's own version) - this service IS the target that hook used to reach; the monolith's own
// copy is kept fresh in the other direction instead, via services/monolithClient.ts's
// mirrorAndNotifyJobCreate/mirrorAndNotifyJobUpdate, called by the route handler after this
// returns. deleteJob here only removes this service's own row - match_scores/swipes/
// reasoning_conclusions cleanup stays a monolith-side concern (those tables live in other
// services'/the monolith's own database), replicated unchanged in the new mirror-delete endpoint.

// skills_embedding/responsibilities_embedding/title_embedding are never set at creation time -
// they're populated later by the background embedding-indexing side effect, same as the
// monolith's own createJob (its INSERT column list never included them either).
type JobCreateInput = Omit<Job, 'id' | 'created_at' | 'updated_at' | 'skills_embedding' | 'responsibilities_embedding' | 'title_embedding' | 'description_embedding'> & {
  description_embedding?: number[] | null;
};

export async function createJob(job: JobCreateInput): Promise<Job | null> {
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
    return result.rows[0] || null;
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
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating job:', error);
    return null;
  }
}

export async function deleteJob(id: number, companyId: number): Promise<boolean> {
  try {
    const result = await pool.query('DELETE FROM jobs WHERE id = $1 AND company_id = $2', [id, companyId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error deleting job:', error);
    return false;
  }
}

export const db = {
  healthCheck,
  upsertJob,
  patchJob,
  deleteJobMirror,
  getJobs,
  getJobById,
  getJobsByIds,
  createJob,
  updateJob,
  deleteJob,
  // internal.routes.ts's GET /jobs/all calls db.query(...) directly for its unscoped read.
  // query was never on this object - same defect class as candidate-service's missing db.pool
  // and candidate-core-service's missing db.query (both fixed earlier this audit).
  query: (text: string, params?: unknown[]) => pool.query(text, params),
};

export { pool };
