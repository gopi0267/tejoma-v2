/**
 * Internal, service-to-service endpoints for Chat Service (Batch 17) - candidate/job counts and
 * unscoped candidate/job lists, the two things POST /api/chat and POST /api/chat/reindex need
 * that this monolith still owns. Mirrors the trust model every other Tier 0 service's
 * /internal/* already documents: no JWT here, gated by network boundary (API Gateway's proxy.ts
 * already 404s /internal/* unconditionally; Chat Service calls this directly via
 * MONOLITH_INTERNAL_URL, never through the Gateway).
 *
 * Every handler is a thin wrapper around the EXACT db.ts functions the monolith's own
 * src/api/chat.routes.ts already calls (db.getCandidates/db.getJobs for counts,
 * db.getAllCandidatesUnscoped/db.getAllJobsUnscoped for reindex) - same queries, same company
 * scoping (or deliberate lack of it for the unscoped reads), same data. Nothing here is new
 * business logic; only the entry point moved from "call directly, in-process" to "trust the
 * network boundary, read companyId from the request."
 */
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/stats', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const [candidates, jobs] = await Promise.all([db.getCandidates(companyId), db.getJobs(companyId)]);
    res.json({ candidateCount: candidates.length, jobCount: jobs.length });
  } catch (error) {
    console.error('[internal/chat] stats error:', error);
    res.status(500).json({ error: 'Failed to compute platform stats' });
  }
});

router.get('/candidates-unscoped', async (_req, res) => {
  try {
    const candidates = await db.getAllCandidatesUnscoped();
    res.json({ candidates });
  } catch (error) {
    console.error('[internal/chat] candidates-unscoped error:', error);
    res.status(500).json({ error: 'Failed to load candidates' });
  }
});

router.get('/jobs-unscoped', async (_req, res) => {
  try {
    const jobs = await db.getAllJobsUnscoped();
    res.json({ jobs });
  } catch (error) {
    console.error('[internal/chat] jobs-unscoped error:', error);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// Item 7: RAG indexing endpoints for job-service and candidate-core-service
router.post('/knowledge-base/upsert', async (req, res) => {
  try {
    const { company_id, source_type, source_id, content, embedding } = req.body;
    if (!source_type || !source_id || !content || !embedding) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    await db.upsertKnowledgeChunk({ company_id, source_type, source_id, content, embedding });
    res.json({ success: true });
  } catch (error) {
    console.error('[internal/chat] knowledge-base upsert error:', error);
    res.status(500).json({ error: 'Failed to upsert knowledge chunk' });
  }
});

router.post('/knowledge-base/delete', async (req, res) => {
  try {
    const { source_type, source_id } = req.body;
    if (!source_type || !source_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    await db.deleteKnowledgeChunk(source_type, source_id);
    res.json({ success: true });
  } catch (error) {
    console.error('[internal/chat] knowledge-base delete error:', error);
    res.status(500).json({ error: 'Failed to delete knowledge chunk' });
  }
});

export default router;
