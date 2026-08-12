import pkg from 'pg';
import { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } from './config/env.js';

const { Pool } = pkg;

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('resume-service PostgreSQL pool error:', err);
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

// ==================== resumes ====================

export interface Resume {
  id: number;
  upload_id: number;
  company_id: number;
  candidate_id: number | null;
  recruiter_id: number | null;
  extracted_text: string | null;
  skills: string[] | null;
  experience_years: number | null;
  education: string[] | null;
  extraction_status: string;
  extraction_error: string | null;
  skills_confidence: number;
  extracted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function createResume(resume: Omit<Resume, 'id' | 'created_at' | 'updated_at'>): Promise<Resume | null> {
  try {
    const result = await pool.query(
      `INSERT INTO resume_service.resumes (
        upload_id, company_id, candidate_id, recruiter_id, extracted_text, skills,
        experience_years, education, extraction_status, skills_confidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        resume.upload_id,
        resume.company_id,
        resume.candidate_id,
        resume.recruiter_id,
        resume.extracted_text,
        resume.skills ? `{${resume.skills.join(',')}}` : null,
        resume.experience_years,
        resume.education ? `{${resume.education.map((e) => `"${e}"`).join(',')}}` : null,
        resume.extraction_status,
        resume.skills_confidence,
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error creating resume:', error);
    return null;
  }
}

export async function getResumeByUploadId(uploadId: number, companyId: number): Promise<Resume | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM resume_service.resumes WHERE upload_id = $1 AND company_id = $2',
      [uploadId, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching resume:', error);
    return null;
  }
}

export async function updateResumeExtraction(
  id: number,
  companyId: number,
  data: Partial<Resume>
): Promise<Resume | null> {
  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.extracted_text !== undefined) {
      updates.push(`extracted_text = $${paramCount++}`);
      values.push(data.extracted_text);
    }
    if (data.skills !== undefined) {
      updates.push(`skills = $${paramCount++}`);
      values.push(data.skills ? `{${data.skills.join(',')}}` : null);
    }
    if (data.experience_years !== undefined) {
      updates.push(`experience_years = $${paramCount++}`);
      values.push(data.experience_years);
    }
    if (data.extraction_status !== undefined) {
      updates.push(`extraction_status = $${paramCount++}`);
      values.push(data.extraction_status);
    }
    if (data.extraction_error !== undefined) {
      updates.push(`extraction_error = $${paramCount++}`);
      values.push(data.extraction_error);
    }
    if (data.skills_confidence !== undefined) {
      updates.push(`skills_confidence = $${paramCount++}`);
      values.push(data.skills_confidence);
    }

    updates.push(`extracted_at = CURRENT_TIMESTAMP`);
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, companyId);

    const result = await pool.query(
      `UPDATE resume_service.resumes
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
       RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating resume extraction:', error);
    return null;
  }
}

export async function getResumesByCandidate(candidateId: number, companyId: number): Promise<Resume[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM resume_service.resumes
       WHERE candidate_id = $1 AND company_id = $2
       ORDER BY created_at DESC`,
      [candidateId, companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate resumes:', error);
    return [];
  }
}

// ==================== extraction jobs ====================

export interface ExtractionJob {
  id: number;
  upload_id: number;
  resume_id: number | null;
  company_id: number;
  candidate_id: number | null;
  job_status: string;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

export async function createExtractionJob(job: Omit<ExtractionJob, 'id' | 'created_at' | 'updated_at' | 'started_at' | 'completed_at'>): Promise<ExtractionJob | null> {
  try {
    const result = await pool.query(
      `INSERT INTO resume_service.resume_extraction_jobs (
        upload_id, resume_id, company_id, candidate_id, job_status, retry_count, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [job.upload_id, job.resume_id, job.company_id, job.candidate_id, job.job_status, job.retry_count, job.max_retries]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error creating extraction job:', error);
    return null;
  }
}

export async function getExtractionJob(jobId: number): Promise<ExtractionJob | null> {
  try {
    const result = await pool.query('SELECT * FROM resume_service.resume_extraction_jobs WHERE id = $1', [jobId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching extraction job:', error);
    return null;
  }
}

export async function updateExtractionJob(
  jobId: number,
  data: Partial<ExtractionJob>
): Promise<ExtractionJob | null> {
  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.job_status !== undefined) {
      updates.push(`job_status = $${paramCount++}`);
      values.push(data.job_status);
    }
    if (data.error_message !== undefined) {
      updates.push(`error_message = $${paramCount++}`);
      values.push(data.error_message);
    }
    if (data.retry_count !== undefined) {
      updates.push(`retry_count = $${paramCount++}`);
      values.push(data.retry_count);
    }
    if (data.resume_id !== undefined) {
      updates.push(`resume_id = $${paramCount++}`);
      values.push(data.resume_id);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    if (data.job_status === 'processing' && !data.started_at) {
      updates.push(`started_at = CURRENT_TIMESTAMP`);
    }
    if ((data.job_status === 'completed' || data.job_status === 'failed') && !data.completed_at) {
      updates.push(`completed_at = CURRENT_TIMESTAMP`);
    }

    values.push(jobId);

    const result = await pool.query(
      `UPDATE resume_service.resume_extraction_jobs
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating extraction job:', error);
    return null;
  }
}

// ==================== candidate_resume_files ====================
// Item 5: Candidate resume file metadata (migrated from monolith candidate_accounts)

export interface CandidateResumeFile {
  id: number;
  candidate_id: number;
  company_id: number;
  resume_file_path: string | null;
  resume_original_filename: string | null;
  resume_file_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCandidateResumeFile(candidateId: number): Promise<CandidateResumeFile | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM resume_service.candidate_resume_files WHERE candidate_id = $1',
      [candidateId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching candidate resume file:', error);
    return null;
  }
}

// company_id dropped from the signature: a candidate token carries no company_id (see
// auth.middleware.ts's CandidateTokenPayload), so the caller never had a real value to pass.
// The column stays on the table, nullable, for the recruiter-side upload path which does know one.
export async function upsertCandidateResumeFile(candidateId: number, data: {
  resume_file_path?: string | null;
  resume_original_filename?: string | null;
  resume_file_uploaded_at?: string | null;
}): Promise<CandidateResumeFile | null> {
  try {
    const result = await pool.query(
      `INSERT INTO resume_service.candidate_resume_files
       (candidate_id, resume_file_path, resume_original_filename, resume_file_uploaded_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       -- Existing values are qualified with the table name. Unqualified, Postgres rejects them
       -- inside ON CONFLICT DO UPDATE as "column reference ... is ambiguous", since the name could
       -- resolve to either the target row or the proposed EXCLUDED row.
       ON CONFLICT (candidate_id) DO UPDATE SET
         resume_file_path = COALESCE($2, candidate_resume_files.resume_file_path),
         resume_original_filename = COALESCE($3, candidate_resume_files.resume_original_filename),
         resume_file_uploaded_at = COALESCE($4, candidate_resume_files.resume_file_uploaded_at),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [candidateId, data.resume_file_path, data.resume_original_filename, data.resume_file_uploaded_at]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error upserting candidate resume file:', error);
    return null;
  }
}

export const db = {
  healthCheck,
  closePool,
  createResume,
  getResumeByUploadId,
  updateResumeExtraction,
  getResumesByCandidate,
  createExtractionJob,
  getExtractionJob,
  updateExtractionJob,
  getCandidateResumeFile,
  upsertCandidateResumeFile,
};

export { pool };
