import { RESUME_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const TIMEOUT_MS = 5000;

export const resumeExtractorClient = {
  async queueExtraction(uploadId: number, companyId: number, candidateId: number | null): Promise<void> {
    if (!RESUME_SERVICE_URL) {
      logger.debug('Resume service URL not configured, skipping extraction');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${RESUME_SERVICE_URL}/webhook/upload-completed`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, companyId, candidateId }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn({ status: response.status, uploadId }, 'Failed to queue resume extraction');
      } else {
        logger.info({ uploadId }, 'Resume extraction queued');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn({ uploadId }, 'Resume service request timed out');
      } else {
        logger.warn({ err: (error as Error).message, uploadId }, 'Failed to queue resume extraction');
      }
    }
  },
};
