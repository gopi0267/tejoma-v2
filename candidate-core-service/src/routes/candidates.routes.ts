/**
 * Public, gateway-routed candidate CRUD - ported from the monolith's src/api/candidate.routes.ts.
 * GET routes are a real cutover since Step 3a. POST/DELETE are now ALSO a real cutover
 * (write-cutover completion plan, Phase A): this service performs the real INSERT/DELETE against
 * its own database, then awaits (but never fails the response on) a call to the monolith's new
 * mirror-and-notify/mirror-delete endpoints, which upsert the row into the monolith's own
 * `candidates` table by explicit id and re-fire the exact same six background side effects
 * (RAG/embedding indexing, unknown-skill discovery, project intelligence, career trajectory,
 * reasoning) createCandidateWithSideEffects always fired. The monolith's own copy has to stay
 * fresh because recruiter-review.routes.ts's list/detail views (staying monolith-local - a
 * deliberate scope boundary, not a gap) read `candidates` directly. bulk-upload/import still
 * proxy to the monolith unchanged - out of scope for this phase.
 */
import { Router } from 'express';
import { db, mapRowToCandidate } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { mirrorAndNotifyCandidateCreate, mirrorDeleteCandidate, bulkUploadCandidates, importCandidates, MonolithProxyError } from '../services/monolithClient.js';
import { candidatePayloadFromExtracted } from '../services/candidatePayload.js';
import { refreshRecruiterReviewViewForCandidates } from '../services/matchingDecisionServiceClient.js';
import { logger } from '../utils/logger.js';
import type { Candidate } from '../types.js';
import { getResumeDetail } from './candidates/getResumeDetail.js';
import { CANDIDATE_RESUME_CUTOVER_ENABLED } from '../config/env.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

function handleProxyError(error: unknown, res: import('express').Response, fallbackMessage: string) {
  if (error instanceof MonolithProxyError) {
    return res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json(error.body?.error ? error.body : { error: fallbackMessage });
  }
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

    // Item 7: Index locally before mirroring
    const { indexCandidateInBackground } = await import('../rag.service.js');
    const mappedCandidate = mapRowToCandidate(created);
    indexCandidateInBackground(mappedCandidate);

    await mirrorAndNotifyCandidateCreate(created);

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter review view (fire-and-forget).
    // Was calling refreshRecruiterReviewViewForCandidate (singular) - undefined, since the
    // actual exported function is plural and takes an array. That ReferenceError was uncaught,
    // which is what turned this fire-and-forget call into a hard failure of the whole request.
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

    // Item 7: Remove from RAG index
    const { removeCandidateFromIndex } = await import('../rag.service.js');
    removeCandidateFromIndex(id).catch(() => {});

    await mirrorDeleteCandidate(id, companyId);

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter review view (fire-and-forget).
    refreshRecruiterReviewViewForCandidates([id]);

    res.status(204).send();
  } catch (error) {
    logger.error({ err: (error as Error)?.message }, 'Failed to delete candidate');
    res.status(500).json({ error: 'Failed to delete candidate' });
  }
});

router.post('/bulk-upload-candidates', async (req, res) => {
  try {
    const candidates: Partial<Candidate>[] = req.body;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'No candidate data provided' });
    }
    const result = await bulkUploadCandidates(candidates, req.user!.company_id);
    res.status(201).json(result);
  } catch (error) {
    handleProxyError(error, res, 'Bulk upload failed');
  }
});

router.post('/candidates/import', async (req, res) => {
  try {
    const { candidates } = req.body;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'No candidates provided' });
    }
    const result = await importCandidates(candidates, req.user!.company_id);
    res.status(201).json(result);
  } catch (error) {
    handleProxyError(error, res, 'Failed to import candidates');
  }
});

export default router;
