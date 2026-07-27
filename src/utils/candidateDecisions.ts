// Shared by CandidateJobDiscovery.tsx and CandidateJobDetail.tsx so the POST /candidate-decisions
// call isn't duplicated across both screens.
export type DecisionType = 'swipe_right' | 'swipe_left' | 'apply';

export async function postCandidateDecision(jobId: number, decisionType: DecisionType): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/candidate-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, decision_type: decisionType }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Failed to record decision' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error - please try again' };
  }
}
