/**
 * Public, gateway-routed candidate CRUD - ported from the monolith's src/api/candidate.routes.ts.
 * GET/POST/DELETE routes are real cutovers to this service's own database.
 * Bulk-upload and import still proxy through monolithClient (legacy, unimplemented).
 */
import { Router } from 'express';
import { db, mapRowToCandidate } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { candidatePayloadFromExtracted } from '../services/candidatePayload.js';
import { refreshRecruiterReviewViewForCandidates } from '../services/matchingDecisionServiceClient.js';
import { logger } from '../utils/logger.js';
import type { Candidate } from '../types.js';
import { getResumeDetail } from './candidates/getResumeDetail.js';
import { CANDIDATE_RESUME_CUTOVER_ENABLED } from '../config/env.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

function handleProxyError(error: unknown, res: import('express').Response, fallbackMessage: string) {
  logger.error({ err: (error as Error)?.message }, fallbackMessage);
  res.status(500).json({ error: fallbackMessage });
}

router.get('/candidates', async (req, res) => {
  const rows = await db.getCandidates(req.user!.company_id);
  res.json(rows.map(mapRowToCandidate));
});

router.get('/candidates/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await db.getCandidateById(id, req.user!.company_id);
  if (!row) return res.status(404).json({ error: 'Candidate not found' });
  res.json(mapRowToCandidate(row));
});

router.get('/candidates/:id/resume', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid candidate ID' });
    }

    if (!CANDIDATE_RESUME_CUTOVER_ENABLED) {
      return res.status(404).json({ error: 'Resume endpoint not yet available' });
    }

    const resume = await getResumeDetail(id, req.user!.company_id);
    if (!resume) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json(resume);
  } catch (error) {
    logger.error({ err: (error as Error)?.message }, 'Failed to get candidate resume');
    res.status(500).json({ error: 'Failed to retrieve resume' });
  }
});

router.post('/candidates', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and Email are required' });
    }
    const payload = candidatePayloadFromExtracted(req.body, req.user!.company_id);
    const created = await db.createCandidate(payload);
    if (!created) {
      return res.status(500).json({ error: 'Failed to create candidate' });
    }

    const { indexCandidateInBackground } = await import('../rag.service.js');
    const mappedCandidate = mapRowToCandidate(created);
    indexCandidateInBackground(mappedCandidate);

    refreshRecruiterReviewViewForCandidates([created.id]);

    res.status(201).json(mappedCandidate);
  } catch (error) {
    logger.error({ err: (error as Error)?.message }, 'Failed to create candidate');
    res.status(500).json({ error: 'Failed to create candidate' });
  }
});

router.delete('/candidates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const companyId = req.user!.company_id;
    const deleted = await db.deleteCandidate(id, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const { removeCandidateFromIndex } = await import('../rag.service.js');
    removeCandidateFromIndex(id).catch(() => {});

    refreshRecruiterReviewViewForCandidates([id]);

    res.status(204).send();
  } catch (error) {
    logger.error({ err: (error as Error)?.message }, 'Failed to delete candidate');
    res.status(500).json({ error: 'Failed to delete candidate' });
  }
});

router.post('/bulk-upload-candidates', (_req, res) => {
  res.status(503).json({ error: 'Bulk upload not available' });
});

router.post('/candidates/import', (_req, res) => {
  res.status(503).json({ error: 'Import not available' });
});

export default router;
