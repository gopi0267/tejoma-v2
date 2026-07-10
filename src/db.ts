/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PostgreSQL Database Layer for Tejoma Recruiting
 */

import pkg from 'pg';
import { config } from 'dotenv';
import { User, Company, Candidate, Job, Swipe, MatchScore, ModelVersion, DailyStat } from './types.js';

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

export async function getOrCreateCompany(name: string): Promise<Company | null> {
  try {
    const existing = await pool.query('SELECT * FROM companies WHERE name = $1', [name]);
    if (existing.rows[0]) return existing.rows[0];
    const created = await pool.query(
      `INSERT INTO companies (name, industry, plan, seats_limit, is_active)
       VALUES ($1, 'Technology', 'starter', 5, true) RETURNING *`,
      [name]
    );
    return created.rows[0];
  } catch (error) {
    console.error('Error getting/creating company:', error);
    return null;
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

// CANDIDATES
export async function getCandidates(): Promise<Candidate[]> {
  try {
    const result = await pool.query('SELECT * FROM candidates ORDER BY created_at DESC');
    return result.rows.map(mapRowToCandidate);
  } catch (error) {
    console.error('Error fetching candidates:', error);
    return [];
  }
}

export async function getCandidateById(id: number): Promise<Candidate | null> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE id = $1', [id]);
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error fetching candidate by id:', error);
    return null;
  }
}

export async function getCandidateByHash(hash: string): Promise<Candidate | null> {
  try {
    const result = await pool.query('SELECT * FROM candidates WHERE candidate_hash = $1', [hash]);
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error fetching candidate by hash:', error);
    return null;
  }
}


export async function getCandidatesByIds(ids: number[]): Promise<Candidate[]> {
  if (ids.length === 0) return [];
  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(`SELECT * FROM candidates WHERE id IN (${placeholders})`, ids);
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
       (name, email, phone, skills, primary_skills, secondary_skills, years_of_experience, 
        current_location, preferred_location, current_company, previous_companies, current_job_title, 
        industry_domain, education, highest_qualification, graduation_year, university, certifications, 
        projects, technical_tools, languages_known, current_ctc, expected_ctc, notice_period, 
        willingness_to_relocate, linkedin_url, github_or_portfolio_url, resume_summary, resume_text, 
        ai_confidence_score, resume_file_path, extraction_status, candidate_hash, resume_embedding) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34) 
       RETURNING *`,
      cleanParams
    );
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error creating candidate:', error);
    return null;
  }
}

export async function updateCandidate(id: number, updates: Partial<Candidate>): Promise<Candidate | null> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        let mappedValue = value;
        if (key === 'skills' && Array.isArray(value)) mappedValue = value.join(', ');
        else if (key === 'previous_companies' && Array.isArray(value)) mappedValue = value.join('; ');
        else if (key === 'certifications' && Array.isArray(value)) mappedValue = value.join('; ');

        values.push(mappedValue);
        paramIndex++;
      }
    }

    if (fields.length === 0) return getCandidateById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE candidates SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] ? mapRowToCandidate(result.rows[0]) : null;
  } catch (error) {
    console.error('Error updating candidate:', error);
    return null;
  }
}

// JOBS
export async function getJobs(): Promise<Job[]> {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE status = \'open\' ORDER BY created_at DESC');
    return result.rows;
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return [];
  }
}

export async function getJobById(id: number): Promise<Job | null> {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching job by id:', error);
    return null;
  }
}

export async function getJobsByCompanyId(companyId: number): Promise<Job[]> {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE company_id = $1 AND status = \'open\' ORDER BY created_at DESC', [companyId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching jobs by company:', error);
    return [];
  }
}

export async function createJob(job: Omit<Job, 'id' | 'created_at' | 'updated_at'>): Promise<Job | null> {
  try {
    const result = await pool.query(
      `INSERT INTO jobs 
       (company_id, title, description, required_skills, experience_years, location, salary_min, salary_max, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
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
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating job:', error);
    return null;
  }
}

export async function updateJobStatus(id: number, status: 'open' | 'closed' | 'on_hold'): Promise<Job | null> {
  try {
    const result = await pool.query(
      'UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating job status:', error);
    return null;
  }
}

// SWIPES - CRITICAL FUNCTIONS
export async function getSwipes(): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes ORDER BY timestamp DESC');
    return result.rows.map(row => ({
      ...row,
      action: Number(row.action)
    }));
  } catch (error) {
    console.error('Error fetching swipes:', error);
    return [];
  }
}

export async function getSwipesByJobId(jobId: number): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE job_id = $1 ORDER BY timestamp DESC', [jobId]);
    return result.rows.map(row => ({
      ...row,
      action: Number(row.action)
    }));
  } catch (error) {
    console.error('Error fetching swipes by job:', error);
    return [];
  }
}

export async function getSwipesByRecruiterId(recruiterId: number): Promise<Swipe[]> {
  try {
    const result = await pool.query('SELECT * FROM swipes WHERE recruiter_id = $1 ORDER BY timestamp DESC', [recruiterId]);
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
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: number;
  match_score: number;
  used_for_training?: boolean;
}): Promise<Swipe | null> {
  try {
    console.log('📝 recordSwipe called with:', swipe);
    
    const result = await pool.query(
      `INSERT INTO swipes (recruiter_id, candidate_id, job_id, action, match_score, used_for_training, timestamp) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
       RETURNING *`,
      [
        swipe.recruiter_id,
        swipe.candidate_id,
        swipe.job_id,
        swipe.action,
        swipe.match_score,
        swipe.used_for_training || false
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

// MATCH SCORES
export async function getMatchScores(jobId: number, candidateId: number): Promise<MatchScore | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM match_scores WHERE job_id = $1 AND candidate_id = $2 ORDER BY created_at DESC LIMIT 1',
      [jobId, candidateId]
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
      `INSERT INTO match_scores (job_id, candidate_id, feature_score, embedding_score, ml_score, final_score, rank) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [score.job_id, score.candidate_id, score.feature_score, score.embedding_score, score.ml_score, score.final_score, score.rank]
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


export async function deleteJob(jobId: number): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM match_scores WHERE job_id = $1', [jobId]);
    await client.query('DELETE FROM swipes WHERE job_id = $1', [jobId]);

    const result = await client.query('DELETE FROM jobs WHERE id = $1', [jobId]);

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
  getOrCreateCompany,
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
  getJobs,
  getJobById,
  getJobsByCompanyId,
  createJob,
  deleteJob,
  updateJobStatus,
  getSwipes,
  getSwipesByJobId,
  getSwipesByRecruiterId,
  recordSwipe,
  getUnusedSwipesForTraining,
  markSwipesAsUsedForTraining,
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