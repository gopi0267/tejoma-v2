/**
 * Recruiter Review surface (Remaining-monolith migration, Step 6; notes/decision-change/
 * detailed-score cut over to real writes in the write-cutover completion plan, Phase D). Only two
 * routes still proxy to the monolith:
 *
 * - GET /recruiter-review (list): a single SQL query joins `swipes` (this service's own table)
 *   with `candidates`, `jobs`, `users`, and `recruiter_notes` - four tables now living in FOUR
 *   different physical databases (candidate-core-service, job-service, identity-service, this
 *   service itself). Filtering/sorting/full-text search operate on the joined columns
 *   (candidate name/skills, job title, etc.), which can't be pushed down across a cross-database
 *   boundary - a real cutover would mean fetching every candidate/job up front and filtering in
 *   memory, defeating the query's own SQL-level pagination and correctness. A genuine, structural
 *   limit, not a "fix later" gap - see the plan's own Context section.
 * - GET /recruiter-review/:candidateId/:jobId (detail): NOW A REAL CUTOVER (remaining-monolith
 *   migration, Item 3). Orchestrates candidate-core-service + job-service + local swipes + ported
 *   explainability module (computeMatchExplanation, with fire-and-forget reads from the monolith's
 *   career_trajectories and reasoning_conclusions tables).
 *
 * POST .../notes, POST .../detailed-score, and PATCH .../decision all write locally now, then
 * await (but never fail the response on) a mirror call into the monolith's own copy - same
 * reverse-mirror shape as matches.routes.ts's POST /swipes (Phase C). PATCH .../decision reuses
 * db.recordSwipe directly (a decision change IS a new swipe row, per the monolith's own
 * changeRecruiterReviewDecision) and monolithClient.mirrorAndNotifySwipe with
 * `source: 'decision-change'` to get the right broadcast event without a retrain enqueue.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import * as jobServiceClient from '../services/jobServiceClient.js';
import * as candidateCoreServiceClient from '../services/candidateCoreServiceClient.js';
import * as matchingScoringServiceClient from '../services/matchingScoringServiceClient.js';
import * as monolithClient from '../services/monolithClient.js';
import { generateRubricReport } from '../rubric-scoring.service.js';
import { computeMatchExplanation } from '../matching/explainability/computeExplanation.js';
import { logger } from '../utils/logger.js';
import { RECRUITER_REVIEW_LIST_CUTOVER_ENABLED } from '../config/env.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

function respondToProxyError(res: any, error: unknown, fallbackMessage: string) {
  if (error instanceof monolithClient.MonolithProxyError) {
    if (error.status === 404) return res.status(404).json(error.body);
    if (error.status === 400 || error.status === 422) return res.status(error.status).json(error.body);
  } else {
    logger.error({ err: (error as Error).message }, fallbackMessage);
  }
  res.status(502).json({ error: 'Upstream recruiter review data is currently unavailable. Please try again.' });
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
  jobId: z.coerce.number().int().positive().optional(),
  decision: z.enum(['accepted', 'rejected', 'saved']).optional(),
  recruiterId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minExperience: z.coerce.number().min(0).optional(),
  maxExperience: z.coerce.number().min(0).optional(),
  skills: z.string().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  sortBy: z.enum(['latest_decision', 'oldest_decision', 'highest_score', 'lowest_score', 'name_asc', 'name_desc']).optional(),
});

router.get('/recruiter-review', async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const companyId = req.user!.company_id;

    // Remaining-monolith migration, Item 5 - CQRS cutover flag for recruiter-review list
    if (RECRUITER_REVIEW_LIST_CUTOVER_ENABLED) {
      // Read from materialized view (real cutover)
      const viewResult = await db.getRecruiterReviewListFromView(companyId, parsed.data);
      // Transform to match monolith response format
      return res.json({
        data: viewResult.rows,
        page: parsed.data.page || 1,
        pageSize: parsed.data.pageSize || 25,
        totalRecords: viewResult.total,
        totalPages: Math.max(1, Math.ceil(viewResult.total / (parsed.data.pageSize || 25))),
        stats: {
          totalReviewed: 0,
          accepted: 0,
          rejected: 0,
          saved: 0,
          acceptanceRate: 0,
          rejectionRate: 0,
          avgMatchScore: 0,
          today: 0,
          thisWeek: 0,
          thisMonth: 0,
        },
      });
    }

    // Fall back to monolith proxy (default behavior)
    const result = await monolithClient.getRecruiterReviewList(companyId, parsed.data);
    res.json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load recruiter review list');
  }
});

router.get('/recruiter-review/:candidateId/:jobId', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const candidateId = parseInt(req.params.candidateId, 10);
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(candidateId) || Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid candidate or job ID' });
    }

    // Remaining-monolith migration, Item 3 - real cutover: orchestrate candidate + job + swipes
    // + explainability module. All data is already owned locally or by other Tier 0 services.
    const [candidateRow, jobRow, swipeHistory] = await Promise.all([
      candidateCoreServiceClient.getCandidateById(candidateId, companyId),
      jobServiceClient.getJobById(jobId, companyId),
      db.getSwipeHistoryForPair(candidateId, jobId, companyId),
    ]);

    if (!candidateRow || !jobRow) {
      return res.status(404).json({ error: 'Candidate or job not found' });
    }

    // Get the latest swipe/recruiter notes if available
    const latestSwipe = swipeHistory[0] ?? null;
    const recruiterNote = latestSwipe
      ? await db.getRecruiterNote(companyId, candidateId, jobId)
      : null;
    const detailedScore = latestSwipe
      ? await db.getDetailedScoringReport(companyId, candidateId, jobId)
      : null;

    // Compute explainability (non-fatal - returns sparser explanation on monolith read failure)
    const explanation = await computeMatchExplanation(candidateRow, jobRow, swipeHistory).catch((err) => {
      logger.warn({ err: (err as Error).message, candidateId, jobId }, 'Failed to compute match explanation - returning without explanation');
      return null;
    });

    res.json({
      candidate: candidateRow,
      job: jobRow,
      latestSwipe,
      recruiterNote,
      detailedScore: detailedScore?.report ?? null,
      detailedScoreGeneratedAt: detailedScore?.generated_at ?? null,
      swipeHistory,
      explanation,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load recruiter review detail');
    res.status(502).json({ error: 'Recruiter review detail is currently unavailable. Please try again.' });
  }
});

const notesSchema = z.object({
  note: z.string().trim().min(1).max(5000),
});

// POST /recruiter-review/:id/notes - :id is the swipe id shown in the main list row (the latest
// decision for that candidate+job pair, resolved via this service's own swipes table - real since
// Phase C). Upserts one note per pair per tenant; no other side effects.
router.post('/recruiter-review/:id/notes', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const parsed = notesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid note', details: parsed.error.flatten() });
    }

    const swipe = await db.getSwipeById(id, companyId);
    if (!swipe) return res.status(404).json({ error: 'Decision not found' });

    const saved = await db.recordRecruiterNote({
      companyId, candidateId: swipe.candidate_id, jobId: swipe.job_id, note: parsed.data.note, userId: req.user!.user_id,
    });
    if (!saved) return res.status(500).json({ error: 'Failed to save note' });

    await monolithClient.mirrorAndNotifyRecruiterNote(saved);

    // Remaining-monolith migration, Item 5 - CQRS: update view row's note (fire-and-forget).
    db.patchRecruiterReviewViewNote(swipe.candidate_id, swipe.job_id, parsed.data.note);

    res.json(saved);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to save recruiter note');
    res.status(500).json({ error: 'Failed to save recruiter note' });
  }
});

// POST /recruiter-review/:candidateId/:jobId/detailed-score - generates a fresh rubric report via
// Gemini (rubric-scoring.service.ts, ported from the monolith unchanged), independent of the real
// matching engine, and persists it (upsert - one row per candidate+job). Only runs on this
// explicit call, never implicitly when the detail panel is opened.
router.post('/recruiter-review/:candidateId/:jobId/detailed-score', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const candidateId = parseInt(req.params.candidateId, 10);
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(candidateId) || Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid candidate or job ID' });
    }

    const [candidate, job] = await Promise.all([
      candidateCoreServiceClient.getCandidateById(candidateId, companyId),
      jobServiceClient.getJobById(jobId, companyId),
    ]);
    if (!candidate || !job) return res.status(404).json({ error: 'Candidate or job not found' });

    const report = await generateRubricReport(job, candidate);
    const saved = await db.recordDetailedScoringReport({ companyId, candidateId, jobId, report, generatedBy: req.user!.user_id });
    if (!saved) return res.status(500).json({ error: 'Failed to save the detailed scoring report' });

    await monolithClient.mirrorAndNotifyDetailedScore(saved);
    res.json({ detailedScore: saved.report, detailedScoreGeneratedAt: saved.generated_at });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to generate detailed scoring report');
    res.status(500).json({ error: 'Failed to generate detailed scoring report' });
  }
});

const decisionSchema = z.object({
  action: z.enum(['accepted', 'rejected', 'saved']),
  reason: z.string().trim().max(1000).optional(),
});

// PATCH /recruiter-review/:id/decision - :id is again the swipe id of the current latest decision
// for a pair. Records a brand NEW swipe row (never updates/deletes the old one) so the full audit
// history the Recruiter Review page depends on is preserved, exactly like every other decision
// already does via POST /swipes - reuses db.recordSwipe directly rather than a separate function.
router.patch('/recruiter-review/:id/decision', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.user_id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid decision payload', details: parsed.error.flatten() });
    }

    const existingSwipe = await db.getSwipeById(id, companyId);
    if (!existingSwipe) return res.status(404).json({ error: 'Decision not found' });

    const [candidate, job] = await Promise.all([
      candidateCoreServiceClient.getCandidateById(existingSwipe.candidate_id, companyId),
      jobServiceClient.getJobById(existingSwipe.job_id, companyId),
    ]);
    if (!candidate || !job) return res.status(404).json({ error: 'Candidate or job no longer exists' });

    // Reuses the existing, untouched AI Matching Engine (matching-scoring-service, over HTTP) -
    // same client POST /swipes calls - so the new decision carries a fresh, current score rather
    // than the (possibly stale) one from the original swipe.
    const scoreData = await matchingScoringServiceClient.scoreCandidateForJob(job, candidate);
    const actionValue = parsed.data.action === 'accepted' ? 1 : parsed.data.action === 'rejected' ? 0 : 0.5;

    const newSwipe = await db.recordSwipe({
      company_id: companyId,
      recruiter_id: userId,
      candidate_id: existingSwipe.candidate_id,
      job_id: existingSwipe.job_id,
      action: actionValue,
      match_score: scoreData.final_score,
      used_for_training: false,
      reason: parsed.data.reason ?? null,
      breakdown: scoreData.breakdown,
    });
    if (!newSwipe) return res.status(500).json({ error: 'Failed to record decision change' });

    await monolithClient.mirrorAndNotifySwipe(newSwipe, { source: 'decision-change' });

    // Remaining-monolith migration, Item 5 - CQRS: refresh view row with new decision (fire-and-forget).
    db.upsertRecruiterReviewViewRow({
      candidate_id: existingSwipe.candidate_id,
      job_id: existingSwipe.job_id,
      company_id: companyId,
      candidate_name: candidate.name,
      candidate_email: candidate.email,
      candidate_phone: candidate.phone,
      candidate_skills: candidate.skills?.join(', '),
      candidate_location: candidate.current_location,
      candidate_years_exp: candidate.years_of_experience,
      candidate_company: candidate.current_company,
      job_title: job.title,
      job_location: job.location,
      job_company_name: job.company_name,
      recruiter_id: userId,
      latest_action: actionValue,
      latest_decision_date: new Date(),
      match_score: scoreData.final_score,
      reason: parsed.data.reason ?? null,
    });

    res.json(newSwipe);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to change decision');
    res.status(500).json({ error: 'Failed to change decision' });
  }
});

export default router;
