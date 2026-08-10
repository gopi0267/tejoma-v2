/**
 * Internal, service-to-service endpoints for Job Service's write/list proxy (remaining-monolith
 * migration, Step 4). Same network-boundary trust model as every other /internal/* endpoint - no
 * JWT, API Gateway's proxy.ts already 404s /internal/* unconditionally.
 *
 * Job Service's own public GET /api/jobs/:id is a REAL cutover (own DB read + candidate-core-
 * service's candidate pool + matching-scoring-service's ranking - no monolith call at all). Its
 * OTHER routes (list, create, update, delete) proxy here instead: GET /jobs (list) needs swipe-
 * count aggregation from matching-decision-service (not cut over until Step 6) and candidate
 * totals from candidate-core-service, and writes must keep flowing through the monolith so every
 * other still-monolith surface reading `jobs` directly (swipe.routes.ts,
 * recruiter-review.routes.ts, candidate-search.routes.ts) keeps seeing fresh data. Same "move the
 * edge first, migrate authority later" shape as Step 1/3a/3c.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { removeJobFromIndex, indexJobInBackground } from '../rag.service.js';
import { indexJobEmbeddingInBackground } from '../matching/embeddingIndex.js';
import { discoverUnknownSkillsInBackground } from '../skillDiscoveryServiceShadow.js';
import { computeReasoningForJobInBackground } from '../reasoningServiceShadow.js';
import { publishRealtimeEvent } from '../realtimeBroadcast.js';
import { getEnrichedJobsList, createJobWithSideEffects, updateJobWithSideEffects, jobDiscoveryContext } from './job.routes.js';
import type { Job } from '../types.js';

const router = Router();

// Write-cutover completion plan, Phase B - Job Service now performs the real INSERT/UPDATE/DELETE
// itself (own database, own id sequence); these two endpoints are the reverse of the create/
// update/delete endpoints above: mirror the already-written/-deleted row into this table (db.ts's
// mirrorUpsertJob/mirrorDeleteJob, explicit id, never re-running this table's own sequence) and
// re-fire the exact same background side effects createJobWithSideEffects/
// updateJobWithSideEffects/deleteJob always fired. The mirror-upsert itself is awaited (the caller
// needs it durable before its own response returns) but the side effects below stay exactly as
// fire-and-forget as they always were.
router.post('/jobs/mirror-and-notify', async (req, res) => {
  try {
    const { job, isCreate } = req.body as { job: Job; isCreate: boolean };
    if (!job || typeof job.id !== 'number') {
      return res.status(400).json({ error: 'job (with a real id) is required' });
    }
    await db.mirrorUpsertJob(job);

    if (isCreate) await publishRealtimeEvent('job-created', { job_id: job.id, title: job.title });
    // Item 7: Indexing now done by job-service, skip here to avoid double-indexing
    // indexJobInBackground(job);
    // indexJobEmbeddingInBackground(job);
    discoverUnknownSkillsInBackground(job.required_skills, jobDiscoveryContext(job), 'jd');
    computeReasoningForJobInBackground(job.id, job.required_skills, job.optional_skills);

    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/job] mirror-and-notify error:', error);
    res.status(500).json({ error: 'Failed to mirror job: ' + error.message });
  }
});

router.post('/jobs/mirror-delete', async (req, res) => {
  try {
    const { id, companyId } = req.body as { id: number; companyId: number };
    if (typeof id !== 'number' || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'a valid id and companyId are required' });
    }
    await db.mirrorDeleteJob(id, companyId);
    removeJobFromIndex(id).catch((err) => console.error(`RAG unindex failed for job ${id}:`, err.message));
    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/job] mirror-delete error:', error);
    res.status(500).json({ error: 'Failed to mirror job deletion: ' + error.message });
  }
});

router.get('/jobs', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
    const jobs = await getEnrichedJobsList(companyId);
    res.json({ jobs });
  } catch (error: any) {
    console.error('[internal/job] list error:', error);
    res.status(500).json({ error: 'Failed to load jobs: ' + error.message });
  }
});

router.post('/jobs', async (req, res) => {
  try {
    const { job, companyId } = req.body as { job: any; companyId: number };
    if (!job || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'job and companyId are required' });
    }
    const created = await createJobWithSideEffects(companyId, job);
    if (created === 'invalid') {
      return res.status(400).json({ error: 'Missing required job creation parameters' });
    }
    res.status(201).json({ job: created });
  } catch (error: any) {
    console.error('[internal/job] create error:', error);
    res.status(500).json({ error: 'Failed to create job: ' + error.message });
  }
});

router.put('/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { job, companyId } = req.body as { job: any; companyId: number };
    if (Number.isNaN(id) || !job || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'a valid id, job, and companyId are required' });
    }
    const updated = await updateJobWithSideEffects(id, companyId, job);
    if (!updated) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: updated });
  } catch (error: any) {
    console.error('[internal/job] update error:', error);
    res.status(500).json({ error: 'Failed to update job: ' + error.message });
  }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const companyId = Number(req.query.companyId);
    if (Number.isNaN(id) || !Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'a valid id and companyId are required' });
    }
    const deleted = await db.deleteJob(id, companyId);
    if (!deleted) return res.status(404).json({ error: 'Job not found or could not be deleted' });
    removeJobFromIndex(id).catch((err) => console.error(`RAG unindex failed for job ${id}:`, err.message));
    res.status(204).send();
  } catch (error: any) {
    console.error('[internal/job] delete error:', error);
    res.status(500).json({ error: 'Failed to delete job: ' + error.message });
  }
});

export default router;
