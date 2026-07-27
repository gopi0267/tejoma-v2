import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import * as pdf from 'pdf-parse';
import WordExtractor from 'word-extractor';
import { parseResume } from '../../parser.service.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB - generous for a resume, rejects abuse
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_RESUME_MIME_TYPES.has(file.mimetype));
  },
});

// Helper function to extract text from various file formats
export async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const extension = path.extname(originalName).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);

  if (extension === '.pdf') {
    const pdfLib = (pdf.default || pdf) as any;
    // Support newer pdf-parse 2.x class structure
    if (pdfLib.PDFParse) {
      const parser = new pdfLib.PDFParse({ data: fileBuffer });
      const pdfData = await parser.getText();
      return pdfData.text || '';
    } else {
      // Fallback for legacy pdf-parse 1.x function structure
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

router.post('/parse-resume', upload.single('file'), async (req, res) => {
  // If the browser disconnects (closed tab, its own fetch timeout, etc.), actually cancel the
  // in-flight Gemini call instead of leaving it running orphaned in the background.
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

    // Clean up temporary upload file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (!res.headersSent) {
      res.json({ success: true, data: parsed });
    }
  } catch (error: any) {
    // Ensure file is deleted if error occurs
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error in /parse-resume:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

export default router;
