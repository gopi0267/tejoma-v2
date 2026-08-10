import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { Upload } from '../db.js';

const TIMEOUT_MS = 5000;

export const dualWriteClient = {
  async createUpload(upload: Upload): Promise<void> {
    if (!MONOLITH_INTERNAL_URL) {
      logger.debug('Monolith internal URL not configured, skipping dual-write');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/uploads/create`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upload),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn({ status: response.status, uploadId: upload.id }, 'Failed to dual-write upload to monolith');
      } else {
        logger.info({ uploadId: upload.id }, 'Upload dual-written to monolith');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn({ uploadId: upload.id }, 'Dual-write request timed out');
      } else {
        logger.warn({ err: (error as Error).message, uploadId: upload.id }, 'Failed to dual-write upload');
      }
    }
  },
};
