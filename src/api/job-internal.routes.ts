/**
 * Internal reverse-mirror endpoints for Job Service (remaining-monolith migration, Step 4).
 * Job Service now does its own writes locally (POST /api/jobs, PUT /api/jobs/:id, DELETE /api/jobs/:id)
 * and mirro back to the monolith so other still-monolith surfaces (recruiter-review.routes.ts,
 * candidate-search.routes.ts) keep seeing fresh job data. Same network-boundary trust model
 * every other /internal/* endpoint documents: no JWT, gated by network boundary.
 *
 * Two endpoints remain active:
 * - POST /jobs/mirror-and-notify: Job-service calls this after writing a new/updated job
 * - POST /jobs/mirror-delete: Job-service calls this after deleting a job
 *
 * All other endpoints (GET /jobs list, POST /jobs create, PUT /jobs/:id update, DELETE /jobs/:id)
 * are dead code (job-service uses its own local implementations).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { removeJobFromIndex } from '../rag.service.js';
import { discoverUnknownSkillsInBackground } from '../skillDiscoveryServiceShadow.js';
import { computeReasoningForJobInBackground } from '../reasoningServiceShadow.js';
import { publishRealtimeEvent } from '../realtimeBroadcast.js';
import type { Job } from '../types.js';

const router = Router();

function jobDiscoveryContext(job: Job): string {
  return [job.title, job.description].filter((t) => t && t.trim()).join('. ');
}

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


export default router;
