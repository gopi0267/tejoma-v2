/**
 * Ported from the monolith's src/api/candidate-resume.routes.ts - byte-identical request/response
 * contracts. The permanent-file endpoints (POST/GET /candidate-resume/file) no longer touch a
 * local db.ts directly - the file pointer (resume_file_path/resume_original_filename/
 * resume_file_uploaded_at) lives on candidate_accounts, monolith-authoritative until cutover, so
 * these call the monolith's new /internal/resume/* API instead (services/monolithClient.ts).
 * File storage itself goes through services/storage (StorageAdapter.ts's header comment).
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { parseResume } from '../services/parser.service.js';
import { extractTextFromFile } from '../services/textExtraction.js';
import { storageAdapter } from '../services/storage/LocalDiskStorageAdapter.js';
import { getCandidateResumeFile, updateCandidateResumeFile, MonolithProxyError } from '../services/monolithClient.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { resumeParseLimiter } from '../middleware/rateLimit.middleware.js';
import { TEMP_UPLOAD_DIR } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { resumeParseCount, resumeParseDuration } from '../utils/metrics.js';

const router = Router();

const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  dest: `${TEMP_UPLOAD_DIR}/`,
  limits: { fileSize: 10 * 1024 * 1024 }, // matches the recruiter path's 10MB cap
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_RESUME_MIME_TYPES.has(file.mimetype));
  },
});

router.post('/candidate-resume/parse', requireCandidateAuth, resumeParseLimiter, upload.single('file'), async (req, res) => {
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  const start = process.hrtime.bigint();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const resumeText = await extractTextFromFile(req.file.path, req.file.originalname);
    if (!resumeText.trim()) {
      throw new Error('Extracted resume text is empty.');
    }

    const parsed = await parseResume(resumeText, { maxRetries: 3, fallbackToRegex: false, signal: controller.signal });

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    resumeParseCount.inc({ caller: 'candidate', outcome: 'gemini_success' });
    resumeParseDuration.observe({ caller: 'candidate' }, Number(process.hrtime.bigint() - start) / 1e9);

    if (!res.headersSent) {
      res.json({ success: true, data: parsed });
    }
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    resumeParseCount.inc({ caller: 'candidate', outcome: 'error' });
    logger.error({ err: error.message }, 'Error in /candidate-resume/parse');
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

router.post('/candidate-resume/file', requireCandidateAuth, resumeParseLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const candidateId = req.candidate!.candidate_id;
    let existing;
    try {
      existing = await getCandidateResumeFile(candidateId);
    } catch (error) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (error instanceof MonolithProxyError && error.status === 404) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      throw error;
    }

    const storedPath = await storageAdapter.store(req.file.path, candidateId, req.file.originalname);

    // Replace, not accumulate - a candidate has exactly one resume file on record at a time.
    if (existing.resume_file_path) {
      await storageAdapter.delete(existing.resume_file_path);
    }

    const updated = await updateCandidateResumeFile(candidateId, {
      resume_file_path: storedPath,
      resume_original_filename: req.file.originalname,
      resume_file_uploaded_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      resume_original_filename: updated.resume_original_filename,
      resume_file_uploaded_at: (updated as any).resume_file_uploaded_at,
    });
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error({ err: error.message }, 'Error in POST /candidate-resume/file');
    const status = error instanceof MonolithProxyError ? 502 : 500;
    res.status(status).json({ error: error.message || 'Failed to upload resume' });
  }
});

// The file path is looked up server-side from the caller's own auth token, never accepted as a
// request parameter - a candidate can only ever retrieve their own resume.
router.get('/candidate-resume/file', requireCandidateAuth, async (req, res) => {
  try {
    const candidateId = req.candidate!.candidate_id;
    const candidate = await getCandidateResumeFile(candidateId);
    if (!candidate.resume_file_path || !storageAdapter.exists(candidate.resume_file_path)) {
      return res.status(404).json({ error: 'No resume file on record' });
    }
    res.download(storageAdapter.resolveForDownload(candidate.resume_file_path), candidate.resume_original_filename || 'resume');
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error in GET /candidate-resume/file');
    const status = error instanceof MonolithProxyError ? 502 : 500;
    res.status(status).json({ error: 'Failed to retrieve resume' });
  }
});

export default router;
