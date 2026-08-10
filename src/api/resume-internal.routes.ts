/**
 * Internal, service-to-service endpoints for Resume Service (Batch 18) - the candidate's resume
 * file pointer (resume_file_path/resume_original_filename/resume_file_uploaded_at), the one thing
 * Resume Service needs that still lives on candidate_accounts (monolith-authoritative until
 * cutover - Candidate Service, Batch 16, only mirrors these columns via dual-write). Mirrors the
 * trust model every other Tier 0 service's /internal/* already documents: no JWT here, gated by
 * network boundary (API Gateway's proxy.ts already 404s /internal/* unconditionally).
 *
 * Both handlers wrap the exact existing db.ts functions (getCandidateAccountById,
 * updateCandidateProfile) the monolith's own candidate-resume.routes.ts already calls - same
 * queries, same dual-write (updateCandidateProfile already mirrors whatever columns changed
 * generically, since Batch 16). Nothing here is new business logic.
 */
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/candidate/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid candidate id' });
    }
    const candidate = await db.getCandidateAccountById(id);
    if (!candidate) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({
      resume_file_path: candidate.resume_file_path ?? null,
      resume_original_filename: candidate.resume_original_filename ?? null,
    });
  } catch (error) {
    console.error('[internal/resume] get candidate resume file error:', error);
    res.status(500).json({ error: 'Failed to load resume file record' });
  }
});

router.patch('/candidate/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid candidate id' });
    }
    const { resume_file_path, resume_original_filename, resume_file_uploaded_at } = req.body;
    if (!resume_file_path || !resume_original_filename || !resume_file_uploaded_at) {
      return res.status(400).json({ error: 'resume_file_path, resume_original_filename, and resume_file_uploaded_at are required' });
    }

    const updated = await db.updateCandidateProfile(id, {
      resume_file_path,
      resume_original_filename,
      resume_file_uploaded_at,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({
      resume_file_path: updated.resume_file_path ?? null,
      resume_original_filename: updated.resume_original_filename ?? null,
      resume_file_uploaded_at: updated.resume_file_uploaded_at ?? null,
    });
  } catch (error) {
    console.error('[internal/resume] update candidate resume file error:', error);
    res.status(500).json({ error: 'Failed to save resume file record' });
  }
});

export default router;
