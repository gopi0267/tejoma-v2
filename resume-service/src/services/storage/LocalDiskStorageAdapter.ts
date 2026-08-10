/**
 * Local-disk implementation of StorageAdapter - byte-for-byte the same behavior as the monolith's
 * candidate-resume.routes.ts today (same filename pattern, same directory, same
 * mkdir-then-rename sequence). See StorageAdapter.ts's header comment for why this is the only
 * adapter implemented right now.
 */
import fs from 'fs';
import path from 'path';
import type { StorageAdapter } from './StorageAdapter.js';
import { RESUME_STORAGE_DIR } from '../../config/env.js';

export class LocalDiskStorageAdapter implements StorageAdapter {
  async store(tempFilePath: string, candidateId: number, originalFilename: string): Promise<string> {
    fs.mkdirSync(RESUME_STORAGE_DIR, { recursive: true });
    const ext = path.extname(originalFilename) || '';
    const storedFilename = `candidate-${candidateId}-${Date.now()}${ext}`;
    const storedPath = path.join(RESUME_STORAGE_DIR, storedFilename);
    fs.renameSync(tempFilePath, storedPath);
    return storedPath;
  }

  async delete(storageKey: string): Promise<void> {
    if (fs.existsSync(storageKey)) {
      fs.unlinkSync(storageKey);
    }
  }

  exists(storageKey: string): boolean {
    return fs.existsSync(storageKey);
  }

  resolveForDownload(storageKey: string): string {
    return path.resolve(storageKey);
  }
}

export const storageAdapter = new LocalDiskStorageAdapter();
