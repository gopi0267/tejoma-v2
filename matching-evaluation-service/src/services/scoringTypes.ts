// Mirrors the shape of the monolith's src/matching/services.ts's MatchScoreResult - this service
// only ever reads `.feature_vector` from it (see learningToRank.ts), so `breakdown` is left
// loosely typed rather than duplicating the monolith's large MatchBreakdown type for a field never
// accessed here.
export interface MatchScoreResult {
  feature_score: number;
  embedding_score: number;
  ml_score: number;
  final_score: number;
  breakdown: unknown;
  summary: string;
  feature_vector?: number[];
}
