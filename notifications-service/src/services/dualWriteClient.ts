import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { Notification } from '../db.js';

const TIMEOUT_MS = 5000;

export const dualWriteClient = {
  async upsertNotification(notification: Notification): Promise<void> {
    if (!MONOLITH_INTERNAL_URL) {
      logger.debug('Monolith internal URL not configured, skipping dual-write');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/notifications/create`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn({ status: response.status, notificationId: notification.id }, 'Failed to dual-write notification to monolith');
      } else {
        logger.info({ notificationId: notification.id }, 'Notification dual-written to monolith');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn({ notificationId: notification.id }, 'Dual-write request timed out');
      } else {
        logger.warn({ err: (error as Error).message, notificationId: notification.id }, 'Failed to dual-write notification');
      }
    }
  },
};
