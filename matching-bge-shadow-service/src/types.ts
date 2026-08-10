// Ported from the monolith's src/types.ts. RankingEntry is byte-identical. BgeCandidateInput/
// BgeJobInput are deliberately narrower than the monolith's full Candidate/Job interfaces (dozens
// of fields) - only the fields candidateText()/jobText() in matching/bgeShadowRetrieval.ts
// actually read. This changes nothing about behavior: the monolith's caller (swipe.routes.ts)
// still serializes the FULL Candidate/Job objects over HTTP; any extra fields are simply ignored
// on receipt here, exactly as they always were ignored by the original functions' own destructuring.

export interface RankingEntry {
  candidateId: number;
  score: number;
}

export interface BgeCandidateInput {
  id: number;
  current_job_title?: string | null;
  skills?: string[] | null;
  resume_summary?: string | null;
  projects?: string | null;
}

export interface BgeJobInput {
  id: number;
  title: string;
  description: string;
  required_skills?: string[] | null;
}
