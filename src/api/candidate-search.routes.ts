import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { parseExperienceYears } from '../matching/parseCandidateFields.js';
import { rankCandidatesForJob, toSyntheticCandidateFromAccount, toSyntheticJobFromQuery } from '../matching/matchingApi.js';
import type { CandidateAccount } from '../types.js';

// Phase 7: recruiter-facing candidate search / talent database. A brand-new, standalone file -
// swipe.routes.ts, recruiter-review.routes.ts, candidate-auth.routes.ts, candidate-resume.routes.ts
// are never touched. Reads candidate_accounts globally (no company_id filter - see
// db.ts's CANDIDATE_SEARCH_BASE_WHERE and the Phase 7 plan for why that's the intended design),
// while every recruiter-personal list (saved/recently-viewed) and the company-scoped shortlist
// stay strictly scoped to req.user's own company/user id.
const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

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
  const lastActiveMap = await db.getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));

  const hasQuery = filters && (filters.q || filters.skills || filters.jobTitle || filters.location);
  let ranked: (CandidateAccount & { match_score?: number })[];
  if (hasQuery) {
    // Enterprise AI Matching Architecture, Phase 0: routed through the Unified Matching API's
    // shared adapters/entry point instead of this file's own (previously near-duplicated) copy.
    // tier: 'heuristic' preserves this endpoint's exact existing scoring behavior - computeMatch
    // Features/computeFeatureScore only, no ML ensemble, no embeddings - unchanged from before
    // this refactor. See matchingApi.ts's module doc for why upgrading this to the full pipeline
    // is deliberately deferred, not done as a side effect of unifying the code path.
    const syntheticJob = toSyntheticJobFromQuery({
      skills: splitCsv(filters!.skills),
      location: filters!.location,
      jobTitle: filters!.jobTitle,
      q: filters!.q,
      minExperience: filters!.minExperience,
    });
    const syntheticCandidates = candidates.map(toSyntheticCandidateFromAccount);
    const rankedResult = await rankCandidatesForJob(syntheticJob, syntheticCandidates, { tier: 'heuristic' });
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

  // Accurate total, independent of searchCandidateAccounts' in-memory ranking-set safety cap
  // (previously the reported total silently maxed out at that cap, and pages beyond it returned
  // nothing even when more real matches existed - see db.ts's countCandidateSearchResults doc
  // comment). Falls back to the post-filter in-memory count only when minProfileStrength is set,
  // since that filter has no SQL-expressible equivalent and must run in application code either
  // way - the existing profile-strength business logic itself is unchanged.
  const total = filters?.minProfileStrength !== undefined
    ? shaped.length
    : await db.countCandidateSearchResults(dbFilters);

  const start = (page - 1) * pageSize;
  const pageItems = shaped.slice(start, start + pageSize);

  res.json({ candidates: pageItems, total, page, pageSize });
}

// ==================== SEARCH (Module 1, 2, 5) ====================
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
    console.error('Candidate search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== TALENT PIPELINE TABS (Module 7) ====================
router.get('/candidate-search/tab/all', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '25'), 10)));
    const candidates = await db.searchCandidateAccounts({});
    await rankAndRespond(req, res, candidates, null, page, pageSize, {});
  } catch (error) {
    console.error('Candidate pipeline (all) error:', error);
    res.status(500).json({ error: 'Failed to load candidates' });
  }
});

router.get('/candidate-search/tab/saved', async (req, res) => {
  try {
    const candidates = await db.getSavedCandidateAccounts(req.user!.user_id);
    const lastActiveMap = await db.getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));
    const shaped = candidates.map((c) => toSearchResultShape(c, lastActiveMap.get(c.id), true));
    res.json({ candidates: shaped, total: shaped.length });
  } catch (error) {
    console.error('Saved candidates error:', error);
    res.status(500).json({ error: 'Failed to load saved candidates' });
  }
});

router.get('/candidate-search/tab/recently-viewed', async (req, res) => {
  try {
    const candidates = await db.getRecentlyViewedCandidateAccounts(req.user!.user_id);
    const savedIds = await db.getSavedCandidateAccountIds(req.user!.user_id);
    const lastActiveMap = await db.getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));
    const shaped = candidates.map((c) => toSearchResultShape(c, lastActiveMap.get(c.id), savedIds.has(c.id)));
    res.json({ candidates: shaped, total: shaped.length });
  } catch (error) {
    console.error('Recently viewed candidates error:', error);
    res.status(500).json({ error: 'Failed to load recently viewed candidates' });
  }
});

router.get('/candidate-search/tab/shortlisted', async (req, res) => {
  try {
    const candidates = await db.getShortlistedCandidateAccounts(req.user!.company_id);
    const savedIds = await db.getSavedCandidateAccountIds(req.user!.user_id);
    const lastActiveMap = await db.getCandidateAccountsLastActiveBulk(candidates.map((c) => c.id));
    const shaped = candidates.map((c) => toSearchResultShape(c, lastActiveMap.get(c.id), savedIds.has(c.id)));
    res.json({ candidates: shaped, total: shaped.length });
  } catch (error) {
    console.error('Shortlisted candidates error:', error);
    res.status(500).json({ error: 'Failed to load shortlisted candidates' });
  }
});

// ==================== SAVE / REMOVE (Module 6) ====================
router.post('/candidate-search/:candidateAccountId/save', async (req, res) => {
  try {
    const candidateAccountId = parseInt(req.params.candidateAccountId, 10);
    if (!Number.isFinite(candidateAccountId)) return res.status(400).json({ error: 'Invalid candidate id' });
    const ok = await db.saveCandidateForRecruiter(req.user!.user_id, req.user!.company_id, candidateAccountId);
    if (!ok) return res.status(500).json({ error: 'Failed to save candidate' });
    res.json({ success: true });
  } catch (error) {
    console.error('Save candidate error:', error);
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
    console.error('Remove saved candidate error:', error);
    res.status(500).json({ error: 'Failed to remove saved candidate' });
  }
});

// ==================== PROFILE VIEW (Module 4) ====================
// Must be registered after the more specific /candidate-search/tab/* and /candidate-search/:id/save
// routes so Express doesn't treat "tab" or an id segment ambiguously - Express matches in
// registration order, and this is the most generic path of the group.
router.get('/candidate-search/:candidateAccountId', async (req, res) => {
  try {
    const candidateAccountId = parseInt(req.params.candidateAccountId, 10);
    if (!Number.isFinite(candidateAccountId)) return res.status(400).json({ error: 'Invalid candidate id' });

    const candidates = await db.searchCandidateAccounts({}, 10000);
    const candidate = candidates.find((c) => c.id === candidateAccountId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found or not visible' });

    await db.recordCandidateProfileView(req.user!.user_id, req.user!.company_id, candidateAccountId);
    const lastActive = await db.getCandidateAccountLastActive(candidateAccountId);
    res.json({ candidate: toProfileViewShape(candidate, lastActive) });
  } catch (error) {
    console.error('Candidate profile view error:', error);
    res.status(500).json({ error: 'Failed to load candidate profile' });
  }
});

export default router;
