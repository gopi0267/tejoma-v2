// Ported from the monolith's src/utils/embeddings.ts - cosineSimilarity only, byte-identical.
// Used by this service's own querySimilarTrajectories (in-memory comparison over
// trajectory_embedding, pgvector remains uninstalled - same standing gap as the monolith).

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
