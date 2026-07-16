import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { calculateMatchScore } from '../services.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

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
  skills: z.string().optional(), // comma-separated
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  sortBy: z.enum(['latest_decision', 'oldest_decision', 'highest_score', 'lowest_score', 'name_asc', 'name_desc']).optional(),
});

// GET /api/recruiter-review - paginated, filtered, searched, sorted latest-decision list, plus
// company-wide summary stats for the dashboard cards (unfiltered - matches the existing
// Analytics.tsx convention of summary cards reflecting the whole dataset, not the current filter).
router.get('/recruiter-review', async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const companyId = req.user!.company_id;

    const [{ rows, totalRecords }, stats] = await Promise.all([
      db.getRecruiterReviewList(companyId, {
        search: q.search,
        jobId: q.jobId,
        decision: q.decision,
        recruiterId: q.recruiterId,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        minExperience: q.minExperience,
        maxExperience: q.maxExperience,
        skills: q.skills ? q.skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        minScore: q.minScore,
        maxScore: q.maxScore,
        sortBy: q.sortBy,
        page: q.page,
        pageSize: q.pageSize,
      }),
      db.getRecruiterReviewStats(companyId),
    ]);

    const acceptanceRate = stats.totalReviewed > 0 ? Number(((stats.accepted / stats.totalReviewed) * 100).toFixed(1)) : 0;
    const rejectionRate = stats.totalReviewed > 0 ? Number(((stats.rejected / stats.totalReviewed) * 100).toFixed(1)) : 0;

    res.json({
      data: rows,
      page: q.page,
      pageSize: q.pageSize,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / q.pageSize)),
      stats: {
        totalReviewed: stats.totalReviewed,
        accepted: stats.accepted,
        rejected: stats.rejected,
        saved: stats.saved,
        acceptanceRate,
        rejectionRate,
        avgMatchScore: stats.avgMatchScore,
        today: stats.today,
        thisWeek: stats.thisWeek,
        thisMonth: stats.thisMonth,
      },
    });
  } catch (error: any) {
    console.error('Failed to load recruiter review list:', error);
    res.status(500).json({ error: 'Failed to load recruiter review list: ' + error.message });
  }
});

// GET /api/recruiter-review/:candidateId/:jobId - full detail for the drawer/modal.
router.get('/recruiter-review/:candidateId/:jobId', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const candidateId = parseInt(req.params.candidateId);
    const jobId = parseInt(req.params.jobId);
    if (isNaN(candidateId) || isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid candidate or job ID' });
    }

    const detail = await db.getRecruiterReviewDetail(candidateId, jobId, companyId);
    if (!detail) {
      return res.status(404).json({ error: 'Candidate or job not found' });
    }
    res.json(detail);
  } catch (error: any) {
    console.error('Failed to load recruiter review detail:', error);
    res.status(500).json({ error: 'Failed to load recruiter review detail: ' + error.message });
  }
});

const notesSchema = z.object({
  note: z.string().trim().min(1).max(5000),
});

// POST /api/recruiter-review/:id/notes - :id is the swipe id shown in the main list row
// (the latest decision for that candidate+job pair). Upserts one note per pair per tenant.
router.post('/recruiter-review/:id/notes', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const parsed = notesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid note', details: parsed.error.flatten() });
    }

    const swipe = await db.getSwipeById(id, companyId);
    if (!swipe) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    const note = await db.upsertRecruiterNote({
      companyId,
      candidateId: swipe.candidate_id,
      jobId: swipe.job_id,
      note: parsed.data.note,
      userId: req.user!.user_id,
    });
    if (!note) {
      return res.status(500).json({ error: 'Failed to save note' });
    }
    res.json(note);
  } catch (error: any) {
    console.error('Failed to save recruiter note:', error);
    res.status(500).json({ error: 'Failed to save recruiter note: ' + error.message });
  }
});

const decisionSchema = z.object({
  action: z.enum(['accepted', 'rejected', 'saved']),
  reason: z.string().trim().max(1000).optional(),
});

// PATCH /api/recruiter-review/:id/decision - :id is again the swipe id of the current latest
// decision for a pair. Records a brand NEW swipe row (never updates/deletes the old one) so the
// full audit history the Recruiter Review page depends on is preserved, exactly like every
// other decision already does via POST /swipes.
router.patch('/recruiter-review/:id/decision', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid decision payload', details: parsed.error.flatten() });
    }

    const existingSwipe = await db.getSwipeById(id, companyId);
    if (!existingSwipe) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    const candidate = await db.getCandidateById(existingSwipe.candidate_id, companyId);
    const job = await db.getJobById(existingSwipe.job_id, companyId);
    if (!candidate || !job) {
      return res.status(404).json({ error: 'Candidate or job no longer exists' });
    }

    // Reuses the existing, untouched AI Matching Engine - same function POST /swipes calls -
    // so the new decision carries a fresh, current score rather than the (possibly stale) one
    // from the original swipe.
    const scoreData = await calculateMatchScore(job, candidate, { skipGeminiSummary: true });
    const actionValue = parsed.data.action === 'accepted' ? 1 : parsed.data.action === 'rejected' ? 0 : 0.5;

    const newSwipe = await db.recordSwipe({
      company_id: companyId,
      recruiter_id: req.user!.user_id,
      candidate_id: existingSwipe.candidate_id,
      job_id: existingSwipe.job_id,
      action: actionValue,
      match_score: scoreData.final_score,
      used_for_training: false,
      reason: parsed.data.reason ?? null,
      breakdown: scoreData.breakdown,
    });
    if (!newSwipe) {
      return res.status(500).json({ error: 'Failed to record decision change' });
    }

    broadcastEvent('recruiter-review-decision-changed', {
      candidate_id: existingSwipe.candidate_id,
      job_id: existingSwipe.job_id,
      action: actionValue,
    });

    res.json(newSwipe);
  } catch (error: any) {
    console.error('Failed to change decision:', error);
    res.status(500).json({ error: 'Failed to change decision: ' + error.message });
  }
});

export default router;
