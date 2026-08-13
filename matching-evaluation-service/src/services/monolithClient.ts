// Stub - monolith was decommissioned 2026-08-13
export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith is unavailable`);
  }
}

export async function getPlatformStats(companyId: number) {
  return { candidateCount: 0, jobCount: 0 };
}

export async function getDashboard(companyId: number) {
  throw new MonolithProxyError(503, { error: 'Monolith unavailable' });
}

export async function getJobAnalytics(jobId: number, companyId: number) {
  throw new MonolithProxyError(503, { error: 'Monolith unavailable' });
}

export async function getRecruiterProfile(companyId: number) {
  throw new MonolithProxyError(503, { error: 'Monolith unavailable' });
}

export async function getSkills(companyId: number) {
  throw new MonolithProxyError(503, { error: 'Monolith unavailable' });
}

export async function mirrorAndNotifyCandidateCreate(candidate: any) {
  // no-op
}

export async function mirrorDeleteCandidate(id: number, companyId: number) {
  // no-op
}

export async function bulkUploadCandidates(candidates: any[], companyId: number) {
  throw new MonolithProxyError(503, { error: 'Bulk upload unavailable' });
}

export async function importCandidates(candidates: any[], companyId: number) {
  throw new MonolithProxyError(503, { error: 'Import unavailable' });
}

export async function mirrorAndNotifyJobCreate(job: any) {
  // no-op
}

export async function mirrorAndNotifyJobUpdate(job: any) {
  // no-op
}

export async function mirrorDeleteJob(id: number, companyId: number) {
  // no-op
}

export async function mirrorAndNotifySwipe(swipe: any, opts?: any) {
  // no-op
}

export async function getRecruiterMatches(companyId: number, jobId: number, userId: number) {
  throw new MonolithProxyError(503, { error: 'Recruiter matches unavailable' });
}

export async function mirrorAndNotifyRecruiterNote(note: any) {
  // no-op
}

export async function mirrorAndNotifyDetailedScore(score: any) {
  // no-op
}

export async function getRecruiterReviewList(companyId: number, data: any) {
  throw new MonolithProxyError(503, { error: 'Recruiter review unavailable' });
}

export async function promoteSkillNode(input: any) {
  return null;
}

export const monolithClient = {
  get: async () => ({ data: {} }),
};
