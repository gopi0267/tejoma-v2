/**
 * Internal RAG indexing API for Phase D Item 8 - services call this endpoint
 * to index candidates/jobs in the knowledge base for chat RAG retrieval
 *
 * In future, services will index locally (when RAG_INDEXING_CUTOVER_ENABLED=true),
 * but for now this monolith endpoint coordinates indexing across the platform.
 *
 * No JWT auth (network-boundary trusted, used by services only via MONOLITH_INTERNAL_URL).
 */
import { Router } from 'express';
import { indexCandidate, indexCandidateInBackground, indexJob, indexJobInBackground, removeCandidateFromIndex, removeJobFromIndex } from '../rag.service.js';

const router = Router();

// Index a candidate (fire-and-forget background, never blocks the caller)
router.post('/index-candidate', async (req, res) => {
  try {
    const { candidate } = req.body;
    if (!candidate || typeof candidate.id !== 'number') {
      return res.status(400).json({ error: 'candidate object with id is required' });
    }
    indexCandidateInBackground(candidate);
    res.json({ success: true });
  } catch (error) {
    console.error('[internal/rag] index-candidate error:', error);
    res.status(500).json({ error: 'Failed to queue candidate indexing' });
  }
});

// Index a job (fire-and-forget background, never blocks the caller)
router.post('/index-job', async (req, res) => {
  try {
    const { job } = req.body;
    if (!job || typeof job.id !== 'number') {
      return res.status(400).json({ error: 'job object with id is required' });
    }
    indexJobInBackground(job);
    res.json({ success: true });
  } catch (error) {
    console.error('[internal/rag] index-job error:', error);
    res.status(500).json({ error: 'Failed to queue job indexing' });
  }
});

// Remove candidate from index
router.post('/remove-candidate', async (req, res) => {
  try {
    const { candidateId } = req.body;
    if (typeof candidateId !== 'number') {
      return res.status(400).json({ error: 'candidateId is required' });
    }
    await removeCandidateFromIndex(candidateId);
    res.json({ success: true });
  } catch (error) {
    console.error('[internal/rag] remove-candidate error:', error);
    res.status(500).json({ error: 'Failed to remove candidate from index' });
  }
});

// Remove job from index
router.post('/remove-job', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (typeof jobId !== 'number') {
      return res.status(400).json({ error: 'jobId is required' });
    }
    await removeJobFromIndex(jobId);
    res.json({ success: true });
  } catch (error) {
    console.error('[internal/rag] remove-job error:', error);
    res.status(500).json({ error: 'Failed to remove job from index' });
  }
});

export default router;
