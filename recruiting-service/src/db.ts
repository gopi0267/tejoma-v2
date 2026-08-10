/**
 * PostgreSQL connection pool and data-access functions for Recruiting Service's own database
 * (Batch 19 domain audit) - recruiter_notifications, moved out of the monolith's shared database.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention, same
 * server-side ownership scoping - every query below is scoped by (user_id, company_id) in its
 * WHERE clause, never trusting a route param alone) with one adjustment: user_id/company_id/
 * match_id have no FK here (migrations/001_initial_schema.up.sql's header comment explains why).
 * No dual-write back to the monolith from here - this service's own routes only ever read/write
 * its own database, exactly like every other Tier 0 service.
 */
import pkg from 'pg';
import type { RecruiterNotification } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_recruiting_service',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('recruiting-service PostgreSQL pool error:', err);
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

export async function getRecruiterNotifications(userId: number, companyId: number): Promise<RecruiterNotification[]> {
  try {
    const result = await pool.query(
      `SELECT id, user_id, company_id, match_id, type, title, message, read_at, created_at
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
      `UPDATE recruiter_notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND company_id = $3 AND read_at IS NULL`,
      [id, userId, companyId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error marking recruiter notification read:', error);
    return false;
  }
}

export async function markAllRecruiterNotificationsRead(userId: number, companyId: number): Promise<number> {
  try {
    const result = await pool.query(
      `UPDATE recruiter_notifications SET read_at = NOW() WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL`,
      [userId, companyId]
    );
    return result.rowCount ?? 0;
  } catch (error) {
    console.error('Error marking all recruiter notifications read:', error);
    return 0;
  }
}

export const db = {
  healthCheck,
  getRecruiterNotifications,
  getRecruiterUnreadNotificationCount,
  markRecruiterNotificationRead,
  markAllRecruiterNotificationsRead,
};

export { pool };
