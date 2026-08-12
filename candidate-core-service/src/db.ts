/**
 * PostgreSQL connection pool and data-access functions for Candidate Core Service's own database -
 * a dual-written, read-only-from-this-service's-own-code mirror of `candidates`. The monolith
 * remains the sole writer (candidate.routes.ts's createCandidate/updateCandidate, unchanged) -
 * upsertCandidate/patchCandidate below exist only as dual-write's targets. getCandidates/
 * getCandidateById are real reads, served directly from this service's own database for whichever
 * caller is routed here.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention).
 */
import pkg from 'pg';
import type { CandidateRow, Candidate } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_candidate_core',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('candidate-core-service PostgreSQL pool error:', err);
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
// JSONB columns whose value may arrive as a plain JS object/array - explicit JSON.stringify here
// matches this codebase's established convention (see job-service/matching-evaluation-service's
// own dual-write targets) and is a harmless no-op when pg would have auto-serialized it correctly
// anyway.
const CANDIDATE_JSON_COLUMNS = new Set(['confidence_profile', 'work_history', 'project_entries', 'project_intelligence']);

export async function upsertCandidate(row: Record<string, unknown>): Promise<void> {
  try {
    const columns = CANDIDATE_COLUMNS.filter((c) => c in row);
    const values = columns.map((c) => (CANDIDATE_JSON_COLUMNS.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await pool.query(
      `INSERT INTO candidates (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
      values
    );
  } catch (error) {
    console.error('Error upserting candidate (dual-write):', error);
  }
}

export async function patchCandidate(id: number, fields: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  try {
    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = columns.map((c) => (CANDIDATE_JSON_COLUMNS.has(c) && fields[c] !== null && fields[c] !== undefined ? JSON.stringify(fields[c]) : fields[c]));
    await pool.query(`UPDATE candidates SET ${setClause} WHERE id = $${columns.length + 1}`, [...values, id]);
  } catch (error) {
    console.error('Error patching candidate (dual-write):', error);
  }
}

export async function deleteCandidateMirror(id: number): Promise<void> {
  try {
    await pool.query('DELETE FROM candidates WHERE id = $1', [id]);
  } catch (error) {
    console.error('Error deleting candidate (dual-write):', error);
  }
}

// ==================== real writes (write-cutover completion plan, Phase A) ====================
// This service is now the write-authority for `candidates` - these are genuine INSERT/DELETE
// against this service's own database (its own SERIAL sequence assigns the id), not dual-write
// targets. Ported from the monolith's own src/db.ts's createCandidate/deleteCandidate: same
// storage convention (skills/previous_companies/certifications as delimited strings, kept in sync
// with the real skills_array projection), same NULL-as-literal-string handling the column
// defaults use, same null-byte stripping (Postgres rejects raw NUL bytes in text columns).
// dualWrite.upsertCandidate does NOT fire here (unlike the
// monolith's own version) - this service IS the target that hook used to reach; the monolith's own
// copy is kept fresh in the other direction instead, via services/monolithClient.ts's
// mirrorAndNotifyCandidateCreate, called by the route handler after this returns.
import type { CandidateCreatePayload } from './services/candidatePayload.js';

function joinList(val: string[] | undefined | null, sep = ', '): string | null {
  if (val === undefined || val === null) return null;
  return val.length === 0 ? null : val.join(sep);
}

// Postgres rejects raw NUL bytes in text columns.
const NUL_BYTE = String.fromCharCode(0);
function stripNulBytes(val: unknown): unknown {
  return typeof val === 'string' ? val.split(NUL_BYTE).join('') : val;
}

export async function createCandidate(payload: CandidateCreatePayload): Promise<CandidateRow | null> {
  try {
    const skillsArrayValue = Array.isArray(payload.skills) ? payload.skills.map((s) => String(s).trim()).filter(Boolean) : [];

    const cleanParams = [
      payload.company_id,
      payload.name,
      payload.email,
      payload.phone,
      joinList(payload.skills, ', '),
      payload.primary_skills,
      payload.secondary_skills,
      payload.years_of_experience,
      payload.current_location,
      payload.preferred_location,
      payload.current_company,
      joinList(payload.previous_companies, '; '),
      payload.current_job_title,
      payload.industry_domain,
      payload.education,
      payload.highest_qualification,
      payload.graduation_year,
      payload.university,
      joinList(payload.certifications, '; '),
      payload.projects,
      payload.technical_tools,
      payload.languages_known,
      payload.current_ctc,
      payload.expected_ctc,
      payload.notice_period,
      payload.willingness_to_relocate,
      payload.linkedin_url,
      payload.github_or_portfolio_url,
      payload.resume_summary,
      payload.resume_text,
      payload.ai_confidence_score,
      payload.resume_file_path || 'NULL',
      payload.extraction_status || 'success',
      payload.candidate_hash || 'NULL',
      payload.resume_embedding || null,
    ].map(stripNulBytes);

    cleanParams.push(skillsArrayValue);
    cleanParams.push(payload.confidence_profile ? JSON.stringify(payload.confidence_profile) : null);
    cleanParams.push(payload.work_history !== undefined ? JSON.stringify(payload.work_history) : null);
    cleanParams.push(payload.project_entries !== undefined ? JSON.stringify(payload.project_entries) : null);

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
    return result.rows[0] || null;
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

export async function getCandidates(companyId: number): Promise<CandidateRow[]> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE company_id = $1 ORDER BY created_at DESC', [companyId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidates:', error);
    return [];
  }
}

// Remaining-monolith migration, Item 1 - GET /api/jobs (list) fan-out. Job-service calls this
// to get the total candidate pool count, ported verbatim from the monolith's own countCandidates.
export async function countCandidates(companyId: number): Promise<number> {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM candidates WHERE company_id = $1', [companyId]);
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    console.error('Error counting candidates:', error);
    return 0;
  }
}

// Ported from the monolith's src/db.ts's getCandidatesForJobScoring, unchanged - the bounded,
// recall-first pre-filter (candidates whose skills_array overlaps the job's required_skills sort
// first, real overlap via the GIN-indexed skills_array column this mirror already carries) ahead
// of the live-scoring engine. Job Service calls this for its GET /jobs/:id real cutover
// (remaining-monolith migration, Step 4) - the exact same query, same LIMIT default, same
// ordering, just served from this service's own database instead of the monolith's.
export async function getCandidatesForJobScoring(companyId: number, requiredSkills: string[] | undefined, limit: number = 1500): Promise<CandidateRow[]> {
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
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidates for job scoring:', error);
    return [];
  }
}

export async function getCandidateById(id: number, companyId: number): Promise<CandidateRow | null> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate by id:', error);
    return null;
  }
}

// Remaining-monolith migration, Step 6 - ported from the monolith's own src/db.ts's
// getCandidatesByIds, unchanged. matching-decision-service's own GET /api/matches/queue/:job_id
// real cutover needs exactly this shape: a bounded set of candidates by id (its own shortlisted
// swipe rows), not the full company list - same reasoning as the original's own comment ("instead
// of pulling every one of the company's candidates into memory and filtering in JS").
export async function getCandidatesByIds(ids: number[], companyId: number): Promise<CandidateRow[]> {
  if (ids.length === 0) return [];
  try {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(`SELECT * FROM candidates WHERE company_id = $1 AND id IN (${placeholders})`, [companyId, ...ids]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidates by ids:', error);
    return [];
  }
}

// Remaining-monolith migration, Item 4 - candidate-analytics cross-service read.
// Fetches a single candidate by account_id (unscoped by company, matching the monolith's own
// cross-company semantics for analytics). Called from candidate-service's analytics orchestration.
export async function getCandidateByAccountId(accountId: number): Promise<CandidateRow | null> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE candidate_account_id = $1', [accountId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate by account_id:', error);
    return null;
  }
}

// Ported from the monolith's src/db.ts, unchanged - parses the delimited-string columns into real
// arrays. This service's own getCandidates/getCandidateById above deliberately return the RAW row
// (internal.routes.ts's documented contract, zero real callers today - see that file's header
// comment) - this function exists for the NEW public routes (Step 3a) that must match the
// monolith's original API response shape exactly, applied at the route layer, not here, so
// internal.routes.ts's existing behavior is completely unaffected.
export function mapRowToCandidate(row: CandidateRow): Candidate {
  const parseList = (val: string | null, sep = ', '): string[] => {
    if (val === undefined || val === null) return [];
    const str = String(val).trim();
    if (str === '' || str.toLowerCase() === 'null') return [];
    return str.split(sep).map((s: string) => s.trim()).filter((s: string) => s);
  };

  const { skills_array, ...rest } = row;
  return {
    ...rest,
    skills: parseList(row.skills, ', '),
    previous_companies: parseList(row.previous_companies, '; '),
    certifications: parseList(row.certifications, '; '),
  };
}

export const db = {
  healthCheck,
  upsertCandidate,
  patchCandidate,
  deleteCandidateMirror,
  getCandidates,
  getCandidateById,
  getCandidatesByIds,
  getCandidatesForJobScoring,
  countCandidates,
  createCandidate,
  deleteCandidate,
  // internal.routes.ts calls db.query(...) directly for a handful of ad-hoc reads
  // (/internal/candidates/count, /internal/candidates/by-ids). db.query was never on this
  // object - every one of those call sites threw "db.query is not a function", caught by the
  // route handler and reported as a generic 500. Confirmed live: chat-service's
  // getAllCandidates() calls /internal/candidates/by-ids and was failing the same way.
  query: (text: string, params?: unknown[]) => pool.query(text, params),
};

export { pool };
