/**
 * Ported from the monolith's src/api/upload.routes.ts's POST /parse-resume - byte-identical
 * contract. Purely stateless (extract text, parse, delete temp file) - no DB interaction, no
 * monolith proxy call needed.
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { parseResume } from '../services/parser.service.js';
import { extractTextFromFile } from '../services/textExtraction.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { TEMP_UPLOAD_DIR } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { resumeParseCount, resumeParseDuration } from '../utils/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  dest: `${TEMP_UPLOAD_DIR}/`,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_RESUME_MIME_TYPES.has(file.mimetype));
  },
});

router.post('/parse-resume', upload.single('file'), async (req, res) => {
  // If the browser disconnects (closed tab, its own fetch timeout, etc.), actually cancel the
  // in-flight Gemini call instead of leaving it running orphaned in the background.
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

    resumeParseCount.inc({ caller: 'recruiter', outcome: 'gemini_success' });
    resumeParseDuration.observe({ caller: 'recruiter' }, Number(process.hrtime.bigint() - start) / 1e9);

    if (!res.headersSent) {
      res.json({ success: true, data: parsed });
    }
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    resumeParseCount.inc({ caller: 'recruiter', outcome: 'error' });
    logger.error({ err: error.message }, 'Error in /parse-resume');
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

export default router;
