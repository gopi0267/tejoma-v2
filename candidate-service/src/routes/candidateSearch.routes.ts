/**
 * Recruiter-facing candidate search / talent database - ported from the monolith's
 * src/api/candidate-search.routes.ts (Remaining-monolith migration, Step 5). Reads
 * candidate_accounts globally (no company_id filter - see db.ts's CANDIDATE_SEARCH_BASE_WHERE and
 * the original Phase 7 plan for why that's the intended design), while every recruiter-personal
 * list (saved/recently-viewed) and the company-scoped shortlist stay strictly scoped to req.user's
 * own company/user id.
 *
 * GET /candidate-search/tab/shortlisted is now a real cutover (remaining-monolith migration, Item 2):
 * orchestrates matching-decision-service's latest-per-pair endpoint, candidate-core-service's
 * candidate data, and this service's own candidate_accounts, fused with the same response shape the
 * monolith's getShortlistedCandidateAccounts used to return. Same production pattern as the
 * job-service's orchestrations (Step 4, Item 1).
 * Every other route here is a genuine cutover against this service's own database plus two real
 * cross-service calls (identity-service for last_active, matching-scoring-service for heuristic-tier ranking).
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/staffAuth.middleware.js';
import { rankCandidatesForJob } from '../services/matchingScoringServiceClient.js';
import { getCandidateAccountsLastActiveBulk } from '../services/identityServiceClient.js';
import { getCandidatesByIds } from '../services/candidateCoreServiceClient.js';
import { getShortlistedSwipes } from '../services/matchingDecisionServiceClient.js';
import { logger } from '../utils/logger.js';
import type { CandidateAccount, Job, Candidate } from '../types.js';

const router = Router();
// Path-scoped, unlike this service's other routers' blanket router.use(requireCandidateAuth) -
// those are safe unscoped because every OTHER router mounted at '/api' in server.ts serves the
// same candidate-self-service auth domain. This router is the first to serve a different (staff)
// auth domain under the same '/api' mount point, so an unscoped router.use() here would wrongly
// try to apply staff auth to every other router's paths too, if this router were ever mounted
// before them. Scoping to '/candidate-search' - and mounting this router FIRST in server.ts, ahead
// of the blanket-auth routers - keeps both auth domains correctly isolated: requests for any other
// '/api/candidate-*' path never match this router's own routes or middleware and fall through
// via next() to the router that actually owns them.
router.use('/candidate-search', requireAuth, requireRole('recruiter', 'admin'));

const PROFILE_FIELDS_FOR_STRENGTH = ['headline', 'skills', 'years_of_experience', 'location', 'education', 'summary', 'current_company', 'notice_period'] as const;

function computeProfileStrength(candidate: any): { percent: number; missing: string[] } {
  const labels: Record<(typeof PROFILE_FIELDS_FOR_STRENGTH)[number], string> = {
    headline: 'Add a headline',
    skills: 'Add Skills',
    years_of_experience: 'Add years of experience',
    location: 'Add Location',
    education: 'Add Education',
    summary: 'Add a resume summary',
    current_company: 'Add current company',
    notice_period: 'Add notice period',
  };
  const values = [candidate.name, ...PROFILE_FIELDS_FOR_STRENGTH.map((f) => candidate[f])];
  const filled = values.filter((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim()))).length;
  const missing = PROFILE_FIELDS_FOR_STRENGTH.filter((f) => {
    const v = candidate[f];
    return !(Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim()));
  }).map((f) => labels[f]);
  return { percent: Math.round((filled / values.length) * 100), missing };
}

// Never exposes password_hash, OTP data, tokens, or any internal/audit/notification data - an
// explicit allow-list, not a passthrough of the raw row.
function toSearchResultShape(candidate: CandidateAccount & { match_score?: number }, lastActive: string | null | undefined, saved: boolean) {
  return {
    id: candidate.id,
    name: candidate.name,
    headline: candidate.headline,
    skills: candidate.skills || [],
    years_of_experience: candidate.years_of_experience,
    location: candidate.location,
    current_company: candidate.current_company || null,
    education: candidate.education,
    certifications: candidate.certifications || [],
    tools: candidate.tools || [],
    languages: candidate.languages || [],
    notice_period: candidate.notice_period || null,
    current_ctc: candidate.current_ctc || null,
    expected_ctc: candidate.expected_ctc || null,
    open_to_work: candidate.open_to_work ?? true,
    profile_strength: computeProfileStrength(candidate),
    profile_updated_at: candidate.updated_at,
    last_active: lastActive || null,
    match_score: candidate.match_score ?? null,
    saved,
  };
}

function toProfileViewShape(candidate: CandidateAccount, lastActive: string | null | undefined) {
  return {
    id: candidate.id,
    name: candidate.name,
    headline: candidate.headline,
    skills: candidate.skills || [],
    years_of_experience: candidate.years_of_experience,
    location: candidate.location,
    current_company: candidate.current_company || null,
    education: candidate.education,
    certifications: candidate.certifications || [],
    tools: candidate.tools || [],
    languages: candidate.languages || [],
    notice_period: candidate.notice_period || null,
    current_ctc: candidate.current_ctc || null,
    expected_ctc: candidate.expected_ctc || null,
    summary: candidate.summary,
    open_to_work: candidate.open_to_work ?? true,
    profile_strength: computeProfileStrength(candidate),
    profile_updated_at: candidate.updated_at,
    last_active: lastActive || null,
  };
}

// Ported from matching-scoring-service's src/matching/matchingApi.ts (Step 2) - deduplicated
// synthetic-object adapters, unchanged behavior. Fields with no home on candidate_accounts are
// simply left undefined, which computeMatchFeatures/computeFeatureScore already handle gracefully.
function toSyntheticCandidateFromAccount(c: CandidateAccount): Candidate {
  return {
    skills: c.skills || [],
    years_of_experience: c.years_of_experience,
    current_location: c.location,
    current_job_title: c.headline,
    resume_text: c.summary,
  } as unknown as Candidate;
}

function toSyntheticJobFromQuery(filters: { skills?: string[]; location?: string; jobTitle?: string; q?: string; minExperience?: number }): Job {
  return {
    required_skills: filters.skills || [],
    location: filters.location || '',
    title: filters.jobTitle || filters.q || '',
    description: filters.q || '',
    experience_years: filters.minExperience || 0,
  } as unknown as Job;
}

const searchQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  skills: z.string().optional(), // comma-separated
  location: z.string().optional(),
  currentCompany: z.string().optional(),
  jobTitle: z.string().optional(),
  education: z.string().optional(),
  certifications: z.string().optional(), // comma-separated
  tools: z.string().optional(), // comma-separated
  languages: z.string().optional(), // comma-separated
  noticePeriod: z.string().optional(),
  minExperience: z.coerce.number().min(0).optional(),
  maxExperience: z.coerce.number().min(0).optional(),
  openToWork: z.coerce.boolean().optional(),
  minProfileStrength: z.coerce.number().min(0).max(100).optional(),
});

function splitCsv(v?: string): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

async function rankAndRespond(
  req: any, res: any, candidates: CandidateAccount[],
  filters: ReturnType<typeof searchQuerySchema.parse> | null, page: number, pageSize: number,
  dbFilters: Parameters<typeof db.countCandidateSearchResults>[0]
) {
  const savedIds = await db.getSavedCandidateAccountIds(req.user!.user_id);
  const lastActiveMap = await getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));

  const hasQuery = filters && (filters.q || filters.skills || filters.jobTitle || filters.location);
  let ranked: (CandidateAccount & { match_score?: number })[];
  if (hasQuery) {
    const syntheticJob = toSyntheticJobFromQuery({
      skills: splitCsv(filters!.skills),
      location: filters!.location,
      jobTitle: filters!.jobTitle,
      q: filters!.q,
      minExperience: filters!.minExperience,
    });
    const syntheticCandidates = candidates.map(toSyntheticCandidateFromAccount);
    const rankedResult = await rankCandidatesForJob(syntheticJob, syntheticCandidates);
    ranked = candidates
      .map((c, i) => ({ ...c, match_score: rankedResult[i].match_score }))
      .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
  } else {
    ranked = candidates;
  }

  let shaped = ranked.map((c) => toSearchResultShape(c, lastActiveMap.get(c.id), savedIds.has(c.id)));
  if (filters?.minProfileStrength !== undefined) {
    shaped = shaped.filter((c) => c.profile_strength.percent >= filters.minProfileStrength!);
  }

  const total = filters?.minProfileStrength !== undefined
    ? shaped.length
    : await db.countCandidateSearchResults(dbFilters);

  const start = (page - 1) * pageSize;
  const pageItems = shaped.slice(start, start + pageSize);

  res.json({ candidates: pageItems, total, page, pageSize });
}

// ==================== SEARCH ====================
router.get('/candidate-search', async (req, res) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const dbFilters = {
      q: q.q,
      skills: splitCsv(q.skills),
      location: q.location,
      currentCompany: q.currentCompany,
      jobTitle: q.jobTitle,
      education: q.education,
      certifications: splitCsv(q.certifications),
      tools: splitCsv(q.tools),
      languages: splitCsv(q.languages),
      noticePeriod: q.noticePeriod,
      minExperience: q.minExperience,
      maxExperience: q.maxExperience,
      openToWork: q.openToWork,
    };
    const candidates = await db.searchCandidateAccounts(dbFilters);
    await rankAndRespond(req, res, candidates, q, q.page, q.pageSize, dbFilters);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Candidate search error');
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== TALENT PIPELINE TABS ====================
router.get('/candidate-search/tab/all', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '25'), 10)));
    const candidates = await db.searchCandidateAccounts({});
    await rankAndRespond(req, res, candidates, null, page, pageSize, {});
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Candidate pipeline (all) error');
    res.status(500).json({ error: 'Failed to load candidates' });
  }
});

router.get('/candidate-search/tab/saved', async (req, res) => {
  try {
    const candidates = await db.getSavedCandidateAccounts(req.user!.user_id);
    const lastActiveMap = await getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));
    const shaped = candidates.map((c) => toSearchResultShape(c, lastActiveMap.get(c.id), true));
    res.json({ candidates: shaped, total: shaped.length });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Saved candidates error');
    res.status(500).json({ error: 'Failed to load saved candidates' });
  }
});

router.get('/candidate-search/tab/recently-viewed', async (req, res) => {
  try {
    const candidates = await db.getRecentlyViewedCandidateAccounts(req.user!.user_id);
    const savedIds = await db.getSavedCandidateAccountIds(req.user!.user_id);
    const lastActiveMap = await getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));
    const shaped = candidates.map((c) => toSearchResultShape(c, lastActiveMap.get(c.id), savedIds.has(c.id)));
    res.json({ candidates: shaped, total: shaped.length });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Recently viewed candidates error');
    res.status(500).json({ error: 'Failed to load recently viewed candidates' });
  }
});

router.get('/candidate-search/tab/shortlisted', async (req, res) => {
  try {
    // Remaining-monolith migration, Item 2 - real cutover: orchestrate swipes + candidate data
    const shortlistedSwipes = await getShortlistedSwipes(req.user!.company_id);
    if (shortlistedSwipes.length === 0) {
      return res.json({ candidates: [], total: 0 });
    }

    // Extract unique candidate_ids from swipes
    const candidateIds = [...new Set(shortlistedSwipes.map(s => s.candidate_id))];

    // Get candidate core data (includes candidate_account_id)
    const candidateMap = await getCandidatesByIds(candidateIds);

    // Extract candidate_account_ids and get accounts
    const accountIds: number[] = [];
    for (const candidate of candidateMap.values()) {
      if (candidate.candidate_account_id !== null && candidate.candidate_account_id !== undefined) {
        accountIds.push(candidate.candidate_account_id);
      }
    }
    const accounts = await db.getCandidateAccountsByIds(accountIds);
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    // Merge: swipe + candidate + account, keeping latest per account (DISTINCT ON ca.id)
    const accountToLatestSwipe = new Map<number, any>();
    for (const swipe of shortlistedSwipes) {
      const candidate = candidateMap.get(swipe.candidate_id);
      if (!candidate || !candidate.candidate_account_id) continue;

      const accountId = candidate.candidate_account_id;
      const account = accountMap.get(accountId);
      if (!account) continue;

      // Keep only the most recent swipe per account
      if (!accountToLatestSwipe.has(accountId) ||
          new Date(swipe.created_at) > new Date(accountToLatestSwipe.get(accountId).created_at)) {
        accountToLatestSwipe.set(accountId, { ...account, shortlisted_at: swipe.created_at });
      }
    }

    const mergedCandidates = Array.from(accountToLatestSwipe.values());
    const savedIds = await db.getSavedCandidateAccountIds(req.user!.user_id);
    const lastActiveMap = await getCandidateAccountsLastActiveBulk(mergedCandidates.map((c: CandidateAccount) => c.id));
    const shaped = mergedCandidates.map((c: CandidateAccount) => toSearchResultShape(c, lastActiveMap.get(c.id), savedIds.has(c.id)));
    res.json({ candidates: shaped, total: shaped.length });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Shortlisted candidates error');
    res.status(502).json({ error: 'Upstream shortlist data is currently unavailable. Please try again.' });
  }
});

// ==================== SAVE / REMOVE ====================
router.post('/candidate-search/:candidateAccountId/save', async (req, res) => {
  try {
    const candidateAccountId = parseInt(req.params.candidateAccountId, 10);
    if (!Number.isFinite(candidateAccountId)) return res.status(400).json({ error: 'Invalid candidate id' });
    const ok = await db.saveCandidateForRecruiter(req.user!.user_id, req.user!.company_id, candidateAccountId);
    if (!ok) return res.status(500).json({ error: 'Failed to save candidate' });
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Save candidate error');
    res.status(500).json({ error: 'Failed to save candidate' });
  }
});

router.delete('/candidate-search/:candidateAccountId/save', async (req, res) => {
  try {
    const candidateAccountId = parseInt(req.params.candidateAccountId, 10);
    if (!Number.isFinite(candidateAccountId)) return res.status(400).json({ error: 'Invalid candidate id' });
    await db.removeSavedCandidate(req.user!.user_id, candidateAccountId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Remove saved candidate error');
    res.status(500).json({ error: 'Failed to remove saved candidate' });
  }
});

// ==================== PROFILE VIEW ====================
// Must be registered after the more specific /candidate-search/tab/* and
// /candidate-search/:id/save routes so Express doesn't treat "tab" or an id segment ambiguously -
// Express matches in registration order, and this is the most generic path of the group.
router.get('/candidate-search/:candidateAccountId', async (req, res) => {
  try {
    const candidateAccountId = parseInt(req.params.candidateAccountId, 10);
    if (!Number.isFinite(candidateAccountId)) return res.status(400).json({ error: 'Invalid candidate id' });

    const candidates = await db.searchCandidateAccounts({}, 10000);
    const candidate = candidates.find((c) => c.id === candidateAccountId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found or not visible' });

    await db.recordCandidateProfileView(req.user!.user_id, req.user!.company_id, candidateAccountId);
    const lastActiveMap = await getCandidateAccountsLastActiveBulk([candidateAccountId]);
    res.json({ candidate: toProfileViewShape(candidate, lastActiveMap.get(candidateAccountId)) });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Candidate profile view error');
    res.status(500).json({ error: 'Failed to load candidate profile' });
  }
});

export default router;
