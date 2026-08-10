import { logger } from '../utils/logger.js';
import { STORAGE_TYPE } from '../config/env.js';

export const storageService = {
  async uploadFile(buffer: Buffer, companyId: number, fileName: string): Promise<string> {
    try {
      const ext = fileName.split('.').pop() || 'bin';
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);

      // For now, return a mock storage key
      // In production, this would upload to S3 or Azure Blob
      const storageKey = `uploads/company-${companyId}/${timestamp}-${randomId}.${ext}`;

      logger.info({ storageKey, fileName, size: buffer.length }, 'File storage key generated');

      return storageKey;
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'Storage upload failed');
      throw error;
    }
  },
};
