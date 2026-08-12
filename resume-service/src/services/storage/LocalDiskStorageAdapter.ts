/**
 * Local-disk implementation of StorageAdapter - same filename pattern and directory layout as the
 * monolith's candidate-resume.routes.ts. See StorageAdapter.ts's header comment for why this is
 * the only adapter implemented right now.
 *
 * store() no longer uses a bare rename. The monolith ran with both directories on one filesystem,
 * so renameSync was safe there; in the containerised deployment uploads/resumes is a bind mount
 * from the host while uploads/temp sits on the container's overlay filesystem - two different
 * devices. renameSync across devices fails with EXDEV, which made EVERY candidate resume upload
 * return 500 ("cross-device link not permitted") with nothing stored and no metadata written.
 * Verified against the running container: `df` showed uploads/resumes on C:\ and / on overlay.
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

    // Rename first - it is atomic and cheap when both paths share a filesystem. Fall back to
    // copy+unlink only on EXDEV (different devices), which is the documented Node behaviour for a
    // cross-device move. Any other error is a real failure and is rethrown rather than masked.
    try {
      fs.renameSync(tempFilePath, storedPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
      fs.copyFileSync(tempFilePath, storedPath);
      // The temp file is multer's; removing it is this function's job once the copy succeeded.
      // A failure to unlink must not fail the upload - the file is already safely stored.
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        /* temp cleanup is best-effort */
      }
    }

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
