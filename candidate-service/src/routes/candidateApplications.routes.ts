/**
 * Candidate Applications - Real cutover (no longer proxies to monolith)
 * Applications are derived from candidate_decisions (candidate swipes/applies)
 * with job details fetched from job-service.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { hydrateJobsForRows } from '../services/jobHydration.js';

const router = Router();
router.use(requireCandidateAuth);

function statusForDecision(d: any): string {
  if (d.decision_type === 'apply') return 'applied';
  return Number(d.action) === 1 ? 'interested' : 'rejected';
}

async function getApplicationsForCandidate(candidateAccountId: number) {
  const decisions = await db.getCandidateDecisions(candidateAccountId);
  if (!decisions || decisions.length === 0) {
    return { applications: [] };
  }

  const jobsById = await hydrateJobsForRows(decisions);

  const applications = decisions.map((d: any) => {
    const job = jobsById.get(d.job_id) as any;
    return {
      id: d.id,
      jobId: d.job_id,
      jobTitle: job?.title ?? null,
      companyName: job?.company_name ?? null,
      companyLogo: job?.company_logo_url ?? null,
      location: job?.location ?? null,
      status: statusForDecision(d),
      appliedAt: d.timestamp,
    };
  });

  return { applications };
}

async function getApplicationForCandidate(candidateAccountId: number, jobId: number) {
  const decision = await db.getLatestCandidateDecision(candidateAccountId, jobId);
  if (!decision) return null;

  const jobsById = await hydrateJobsForRows([decision]);
  const job = jobsById.get(decision.job_id) as any;

  return {
    id: decision.id,
    jobId: decision.job_id,
    jobTitle: job?.title ?? null,
    companyName: job?.company_name ?? null,
    companyLogo: job?.company_logo_url ?? null,
    location: job?.location ?? null,
    status: statusForDecision(decision),
    appliedAt: decision.timestamp,
  };
}

router.get('/candidate-applications', async (req, res) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;
    const result = await getApplicationsForCandidate(candidateAccountId);
    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load applications');
    res.status(500).json({ error: 'Failed to load applications' });
  }
});

router.get('/candidate-applications/:jobId', async (req, res) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const result = await getApplicationForCandidate(candidateAccountId, jobId);
    if (!result) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load application');
    res.status(500).json({ error: 'Failed to load application' });
  }
});

export default router;
