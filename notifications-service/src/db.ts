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
  console.error('notifications-service PostgreSQL pool error:', err);
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

// ==================== notifications ====================

export interface Notification {
  id: number;
  company_id: number;
  recipient_user_id: number;
  sender_user_id: number | null;
  notification_type: string;
  title: string;
  message: string | null;
  data: Record<string, unknown> | null;
  read_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function createNotification(notification: Omit<Notification, 'id' | 'created_at' | 'updated_at'>): Promise<Notification | null> {
  try {
    const result = await pool.query(
      `INSERT INTO notifications_service.notifications (
        company_id, recipient_user_id, sender_user_id, notification_type, title, message, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        notification.company_id,
        notification.recipient_user_id,
        notification.sender_user_id,
        notification.notification_type,
        notification.title,
        notification.message,
        notification.data ? JSON.stringify(notification.data) : null,
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

export async function getNotificationsByUser(userId: number, companyId: number, limit = 50): Promise<Notification[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications_service.notifications
       WHERE recipient_user_id = $1 AND company_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, companyId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return [];
  }
}

export async function markNotificationAsRead(notificationId: number, userId: number): Promise<Notification | null> {
  try {
    const result = await pool.query(
      `UPDATE notifications_service.notifications
       SET read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND recipient_user_id = $2
       RETURNING *`,
      [notificationId, userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return null;
  }
}

export async function deleteNotification(notificationId: number, userId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE notifications_service.notifications
       SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND recipient_user_id = $2`,
      [notificationId, userId]
    );
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error deleting notification:', error);
    return false;
  }
}

// ==================== socket connections ====================

export interface SocketConnection {
  id: number;
  socket_id: string;
  user_id: number;
  company_id: number;
  ip_address: string | null;
  user_agent: string | null;
  connected_at: Date;
  last_heartbeat: Date;
  disconnected_at: Date | null;
}

export async function createSocketConnection(connection: Omit<SocketConnection, 'id' | 'connected_at' | 'last_heartbeat' | 'disconnected_at'>): Promise<SocketConnection | null> {
  try {
    const result = await pool.query(
      `INSERT INTO notifications_service.socket_connections (
        socket_id, user_id, company_id, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [connection.socket_id, connection.user_id, connection.company_id, connection.ip_address, connection.user_agent]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error creating socket connection:', error);
    return null;
  }
}

export async function disconnectSocket(socketId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE notifications_service.socket_connections
       SET disconnected_at = CURRENT_TIMESTAMP
       WHERE socket_id = $1`,
      [socketId]
    );
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error disconnecting socket:', error);
    return false;
  }
}

export async function updateSocketHeartbeat(socketId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE notifications_service.socket_connections
       SET last_heartbeat = CURRENT_TIMESTAMP
       WHERE socket_id = $1`,
      [socketId]
    );
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error updating socket heartbeat:', error);
    return false;
  }
}

export async function getActiveSocketsByUser(userId: number): Promise<SocketConnection[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications_service.socket_connections
       WHERE user_id = $1 AND disconnected_at IS NULL`,
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching active sockets:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  closePool,
  createNotification,
  getNotificationsByUser,
  markNotificationAsRead,
  deleteNotification,
  createSocketConnection,
  disconnectSocket,
  updateSocketHeartbeat,
  getActiveSocketsByUser,
};

export { pool };
