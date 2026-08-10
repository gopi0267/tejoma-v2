import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import * as pdf from 'pdf-parse';
import WordExtractor from 'word-extractor';
import { parseResume } from '../../parser.service.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { resumeParseLimiter } from '../middleware/rateLimit.middleware.js';
import { db } from '../db.js';

const router = Router();

async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const extension = path.extname(originalName).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);

  if (extension === '.pdf') {
    const pdfLib = (pdf.default || pdf) as any;
    if (pdfLib.PDFParse) {
      const parser = new pdfLib.PDFParse({ data: fileBuffer });
      const pdfData = await parser.getText();
      return pdfData.text || '';
    } else {
      const pdfData = await pdfLib(fileBuffer);
      return pdfData.text || '';
    }
  } else if (extension === '.docx' || extension === '.doc') {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(fileBuffer);
    return doc.getBody();
  } else if (extension === '.txt') {
    return fileBuffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${extension}`);
  }
}

// Reuses the exact same parsing pipeline the recruiter-facing /api/parse-resume route uses
// (extractTextFromFile + parseResume, both here, not duplicated) - only the route, auth
// gate, and rate limit are new. The recruiter route can't be reused directly: it applies a
// blanket requireAuth (staff access_token cookie), which a candidate session never holds.
const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // matches the recruiter path's 10MB cap
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_RESUME_MIME_TYPES.has(file.mimetype));
  },
});

router.post('/candidate-resume/parse', requireCandidateAuth, resumeParseLimiter, upload.single('file'), async (req, res) => {
  const controller = new AbortController();
  req.on('close', () => controller.abort());

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

    if (!res.headersSent) {
      res.json({ success: true, data: parsed });
    }
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error in /candidate-resume/parse:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// ==================== PERMANENT RESUME FILE: upload / update ====================
// Deliberately separate from /parse above: that route extracts text into profile fields and
// deletes the upload immediately, by design. This one just keeps a durable copy of the file
// itself (a candidate_accounts row can hold at most one) so it can be viewed/downloaded and
// replaced later - same endpoint serves first-time upload and "update" (a new upload here always
// replaces whatever was stored before). Files are saved outside the auto-deleted `uploads/`
// temp root, in `uploads/candidate-resumes/`, and are covered by the existing `uploads/*`
// .gitignore rule.
const RESUME_STORAGE_DIR = path.join('uploads', 'candidate-resumes');

router.post('/candidate-resume/file', requireCandidateAuth, resumeParseLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const candidateId = req.candidate!.candidate_id;
    const existing = await db.getCandidateAccountById(candidateId);
    if (!existing) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Profile not found' });
    }

    fs.mkdirSync(RESUME_STORAGE_DIR, { recursive: true });
    const ext = path.extname(req.file.originalname) || '';
    const storedFilename = `candidate-${candidateId}-${Date.now()}${ext}`;
    const storedPath = path.join(RESUME_STORAGE_DIR, storedFilename);
    fs.renameSync(req.file.path, storedPath);

    // Replace, not accumulate - a candidate has exactly one resume file on record at a time.
    if (existing.resume_file_path && fs.existsSync(existing.resume_file_path)) {
      fs.unlinkSync(existing.resume_file_path);
    }

    const updated = await db.updateCandidateProfile(candidateId, {
      resume_file_path: storedPath,
      resume_original_filename: req.file.originalname,
      resume_file_uploaded_at: new Date().toISOString(),
    });
    if (!updated) {
      return res.status(500).json({ error: 'Failed to save resume file record' });
    }

    res.json({
      success: true,
      resume_original_filename: updated.resume_original_filename,
      resume_file_uploaded_at: updated.resume_file_uploaded_at,
    });
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error in POST /candidate-resume/file:', error);
    res.status(500).json({ error: error.message || 'Failed to upload resume' });
  }
});

// ==================== PERMANENT RESUME FILE: view / download ====================
// The file path is looked up server-side from the caller's own auth token, never accepted as a
// request parameter - a candidate can only ever retrieve their own resume, and there is no way
// to reach another candidate's file through this route.
router.get('/candidate-resume/file', requireCandidateAuth, async (req, res) => {
  try {
    const candidateId = req.candidate!.candidate_id;
    const candidate = await db.getCandidateAccountById(candidateId);
    if (!candidate || !candidate.resume_file_path || !fs.existsSync(candidate.resume_file_path)) {
      return res.status(404).json({ error: 'No resume file on record' });
    }
    res.download(path.resolve(candidate.resume_file_path), candidate.resume_original_filename || 'resume');
  } catch (error) {
    console.error('Error in GET /candidate-resume/file:', error);
    res.status(500).json({ error: 'Failed to retrieve resume' });
  }
});

export default router;
