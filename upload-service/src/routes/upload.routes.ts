import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { storageService } from '../services/storageService.js';
import { resumeExtractorClient } from '../services/resumeExtractorClient.js';
import { dualWriteClient } from '../services/dualWriteClient.js';
import { logger } from '../utils/logger.js';
import { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES, RESUME_SERVICE_ENABLED } from '../config/env.js';

interface AuthRequest extends Request {
  user?: { user_id: number; company_id: number; role: string };
  file?: Express.Multer.File;
  requestId?: string;
}

const router = Router();

function requireAuth(req: AuthRequest, res: Response, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }

  const token = authHeader.slice(7);
  try {
    // For now, accept any token in dev mode - production will validate JWT properly
    if (!token) throw new Error('Empty token');
    req.user = { user_id: 1, company_id: 1, role: 'recruiter' };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.post('/uploads', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.company_id;
    const candidateId = req.body.candidate_id ? parseInt(req.body.candidate_id) : null;
    const recruiterId = req.body.recruiter_id ? parseInt(req.body.recruiter_id) : null;

    if (!candidateId && !recruiterId) {
      return res.status(400).json({ error: 'Either candidate_id or recruiter_id required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, size, mimetype, buffer } = req.file;

    if (size > MAX_FILE_SIZE_BYTES) {
      return res.status(413).json({ error: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes` });
    }

    if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
      return res.status(415).json({ error: `File type ${mimetype} not allowed` });
    }

    const fileType = req.body.file_type || 'resume';

    // Upload to storage (S3 or mock for now)
    const storageKey = await storageService.uploadFile(buffer, companyId, originalname);

    // Create upload record
    const upload = await db.createUpload({
      company_id: companyId,
      candidate_id: candidateId,
      recruiter_id: recruiterId,
      file_name: originalname,
      file_type: fileType,
      mime_type: mimetype,
      file_size_bytes: size,
      storage_key: storageKey,
      upload_status: 'uploaded',
      error_message: null,
      file_hash: null,
      virus_scan_status: 'pending',
      virus_scan_timestamp: null,
    });

    if (!upload) {
      return res.status(500).json({ error: 'Failed to create upload record' });
    }

    // Fire-and-forget: dual-write to monolith
    dualWriteClient.createUpload(upload).catch((err) => {
      logger.warn({ err: (err as Error).message, uploadId: upload.id }, 'Failed to dual-write upload');
    });

    // Fire-and-forget: queue resume extraction if it's a resume
    if (fileType === 'resume' && RESUME_SERVICE_ENABLED) {
      resumeExtractorClient.queueExtraction(upload.id, companyId, candidateId).catch((err) => {
        logger.warn({ err: (err as Error).message, uploadId: upload.id }, 'Failed to queue resume extraction');
      });
    }

    logger.info({ uploadId: upload.id, fileName: originalname }, 'File uploaded successfully');

    res.status(201).json({
      id: upload.id,
      upload_id: upload.id.toString(),
      status: 'uploaded',
      storage_key: upload.storage_key,
      created_at: upload.created_at,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, requestId: req.requestId }, 'Upload failed');
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.get('/uploads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.company_id;
    const uploadId = parseInt(req.params.id, 10);

    if (isNaN(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID' });
    }

    const upload = await db.getUploadById(uploadId, companyId);
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    res.json(upload);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Get upload failed');
    res.status(500).json({ error: 'Failed to get upload' });
  }
});

export default router;
