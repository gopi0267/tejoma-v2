/**
 * Candidate Applications - Real cutover (no longer proxies to monolith)
 * Applications are derived from candidate_decisions (candidate swipes/applies)
 * with job details fetched from job-service.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireCandidateAuth);

async function getApplicationsForCandidate(candidateAccountId: number) {
  try {
    const decisions = await db.getCandidateDecisions(candidateAccountId);

    if (!decisions || decisions.length === 0) {
      return { applications: [] };
    }

    const applications = decisions.map((d: any) => ({
      id: d.id,
      jobId: d.job_id,
      jobTitle: d.job_title,
      companyName: d.company_name,
      companyLogo: d.company_logo_url,
      status: d.decision_type === 'apply' ? 'applied' : (d.action === 1 ? 'interested' : 'rejected'),
      appliedAt: d.timestamp,
    }));

    return { applications };
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Error fetching applications');
    throw error;
  }
}

async function getApplicationForCandidate(candidateAccountId: number, jobId: number) {
  try {
    const decision = await db.getLatestCandidateDecision(candidateAccountId, jobId);

    if (!decision) {
      return { error: 'Application not found', status: 404 };
    }

    return {
      id: decision.id,
      jobId: decision.job_id,
      jobTitle: decision.job_title,
      companyName: decision.company_name,
      companyLogo: decision.company_logo_url,
      status: decision.decision_type === 'apply' ? 'applied' : (decision.action === 1 ? 'interested' : 'rejected'),
      appliedAt: decision.timestamp,
    };
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Error fetching application');
    throw error;
  }
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
    if (result.status === 404) {
      return res.status(404).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load application');
    res.status(500).json({ error: 'Failed to load application' });
  }
});

export default router;
