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
  console.error('upload-service PostgreSQL pool error:', err);
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

// ==================== uploads ====================

export interface Upload {
  id: number;
  company_id: number;
  candidate_id: number | null;
  recruiter_id: number | null;
  file_name: string;
  file_type: string;
  mime_type: string | null;
  file_size_bytes: number;
  storage_key: string;
  upload_status: string;
  error_message: string | null;
  file_hash: string | null;
  virus_scan_status: string | null;
  virus_scan_timestamp: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function createUpload(upload: Omit<Upload, 'id' | 'created_at' | 'updated_at'>): Promise<Upload | null> {
  try {
    const result = await pool.query(
      `INSERT INTO uploads (
        company_id, candidate_id, recruiter_id, file_name, file_type, mime_type,
        file_size_bytes, storage_key, upload_status, file_hash, virus_scan_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        upload.company_id,
        upload.candidate_id,
        upload.recruiter_id,
        upload.file_name,
        upload.file_type,
        upload.mime_type,
        upload.file_size_bytes,
        upload.storage_key,
        upload.upload_status,
        upload.file_hash,
        upload.virus_scan_status,
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error creating upload:', error);
    return null;
  }
}

export async function getUploadById(id: number, companyId: number): Promise<Upload | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM uploads WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching upload:', error);
    return null;
  }
}

export async function updateUploadStatus(
  id: number,
  companyId: number,
  status: string,
  errorMessage?: string
): Promise<Upload | null> {
  try {
    const result = await pool.query(
      `UPDATE uploads
       SET upload_status = $1, error_message = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4
       RETURNING *`,
      [status, errorMessage || null, id, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating upload status:', error);
    return null;
  }
}

export async function updateVirusScanStatus(
  id: number,
  companyId: number,
  scanStatus: string
): Promise<Upload | null> {
  try {
    const result = await pool.query(
      `UPDATE uploads
       SET virus_scan_status = $1, virus_scan_timestamp = NOW(), updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [scanStatus, id, companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating virus scan status:', error);
    return null;
  }
}

export async function getUploadsByCandidate(candidateId: number, companyId: number): Promise<Upload[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM uploads
       WHERE candidate_id = $1 AND company_id = $2
       ORDER BY created_at DESC`,
      [candidateId, companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching candidate uploads:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  closePool,
  createUpload,
  getUploadById,
  updateUploadStatus,
  updateVirusScanStatus,
  getUploadsByCandidate,
};

export { pool };
