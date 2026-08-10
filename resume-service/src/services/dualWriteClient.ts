import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { Resume } from '../db.js';

const TIMEOUT_MS = 5000;

export const dualWriteClient = {
  async upsertResume(resume: Resume): Promise<void> {
    if (!MONOLITH_INTERNAL_URL) {
      logger.debug('Monolith internal URL not configured, skipping dual-write');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/resumes/create`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resume),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn({ status: response.status, resumeId: resume.id }, 'Failed to dual-write resume to monolith');
      } else {
        logger.info({ resumeId: resume.id }, 'Resume dual-written to monolith');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn({ resumeId: resume.id }, 'Dual-write request timed out');
      } else {
        logger.warn({ err: (error as Error).message, resumeId: resume.id }, 'Failed to dual-write resume');
      }
    }
  },
};
