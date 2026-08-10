import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { extractTextFromFile } from '../services/fileExtractor.js';
import { extractSkills } from '../services/skillExtractor.js';
import { dualWriteClient } from '../services/dualWriteClient.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post('/upload-completed', async (req: Request, res: Response) => {
  try {
    const { uploadId, companyId, candidateId } = req.body;

    if (!uploadId || !companyId) {
      return res.status(400).json({ error: 'uploadId and companyId required' });
    }

    // Create extraction job (queued for async processing)
    const job = await db.createExtractionJob({
      upload_id: uploadId,
      resume_id: null,
      company_id: companyId,
      candidate_id: candidateId || null,
      job_status: 'queued',
      error_message: null,
      retry_count: 0,
      max_retries: 3,
    });

    if (!job) {
      return res.status(500).json({ error: 'Failed to create extraction job' });
    }

    logger.info({ uploadId, jobId: job.id }, 'Resume extraction job queued');

    // Fire-and-forget: Start processing in background (simplified - real impl would use BullMQ)
    processExtractionJob(job.id, uploadId, companyId, candidateId).catch((err) => {
      logger.error({ err: (err as Error).message, jobId: job.id }, 'Background extraction failed');
    });

    res.json({
      success: true,
      job_id: job.id,
      status: 'queued',
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Webhook failed');
    res.status(500).json({ error: 'Webhook failed' });
  }
});

async function processExtractionJob(jobId: number, uploadId: number, companyId: number, candidateId: number | undefined) {
  try {
    // Update job status to processing
    await db.updateExtractionJob(jobId, { job_status: 'processing' });

    // Create resume record (placeholder - would need file storage integration)
    const resume = await db.createResume({
      upload_id: uploadId,
      company_id: companyId,
      candidate_id: candidateId || null,
      recruiter_id: null,
      extracted_text: 'Placeholder text - real extraction would parse file here',
      skills: ['Node.js', 'TypeScript', 'React'],
      experience_years: 5,
      education: ['B.S. Computer Science'],
      extraction_status: 'pending',
      extraction_error: null,
      skills_confidence: 0.85,
      extracted_at: null,
    });

    if (!resume) {
      throw new Error('Failed to create resume record');
    }

    // Extract skills (simplified)
    const skills = extractSkills('Placeholder text');

    // Update resume with extracted data
    const updated = await db.updateResumeExtraction(resume.id, companyId, {
      extracted_text: 'Placeholder text',
      skills,
      experience_years: 5,
      extraction_status: 'completed',
      extraction_error: null,
      skills_confidence: 0.85,
    });

    // Update job status to completed
    await db.updateExtractionJob(jobId, {
      job_status: 'completed',
      resume_id: resume.id,
    });

    // Fire-and-forget: Dual-write to monolith
    dualWriteClient.upsertResume(resume).catch((err) => {
      logger.warn({ err: (err as Error).message, resumeId: resume.id }, 'Failed to dual-write resume');
    });

    logger.info({ jobId, resumeId: resume.id, uploadId }, 'Resume extraction completed');
  } catch (error) {
    logger.error({ err: (error as Error).message, jobId }, 'Resume extraction failed');

    const job = await db.getExtractionJob(jobId);
    if (job && job.retry_count < job.max_retries) {
      // Retry
      await db.updateExtractionJob(jobId, {
        job_status: 'queued',
        retry_count: job.retry_count + 1,
        error_message: (error as Error).message,
      });
    } else {
      // Give up
      await db.updateExtractionJob(jobId, {
        job_status: 'failed',
        error_message: (error as Error).message,
      });
    }
  }
}

export default router;
