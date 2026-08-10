import { logger } from '../utils/logger.js';

export async function extractTextFromFile(fileBuffer: Buffer, fileName: string): Promise<string> {
  try {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    // Simplified text extraction (real implementation would use pdf-parse, docx, etc.)
    if (ext === 'pdf' || ext === 'docx' || ext === 'doc' || ext === 'txt') {
      // For now, return placeholder text
      // Real implementation would use library-specific extraction
      const text = fileBuffer.toString('utf-8', 0, Math.min(1000, fileBuffer.length));
      logger.debug({ fileName, length: text.length }, 'Text extracted from file');
      return text;
    }

    throw new Error(`Unsupported file type: ${ext}`);
  } catch (error) {
    logger.error({ err: (error as Error).message, fileName }, 'File extraction failed');
    throw error;
  }
}
