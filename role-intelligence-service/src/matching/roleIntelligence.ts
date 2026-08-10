// Ported from the monolith's src/matching/roleIntelligence.ts (Batch 29) - read-only functions
// only (getRoleProfile, getAllRoleProfiles, matchRoleByTitle), byte-identical logic. The write-side
// (ROLE_SEEDS, seedRoleProfiles, buildRoleEmbeddingText) is NOT ported - it stays on the monolith,
// unchanged, still the sole writer (see db.ts's header comment).
//
// Resolves an arbitrary JD title (e.g. "Platform Engineer II") to the closest known role profile
// by embedding cosine similarity - the primitive a future phase's "compensate for incomplete job
// descriptions" logic would call. Returns null if no role profile has an embedding yet (e.g. the
// embedding service was unavailable during seeding) or if the title itself can't be embedded.

import { db } from '../db.js';
import { generateEmbedding } from '../algorithms/bert-embeddings.js';
import { cosineSimilarity } from '../utils/vectorMath.js';
import type { RoleProfile } from '../types.js';

export async function getRoleProfile(roleKey: string): Promise<RoleProfile | null> {
  return db.getRoleProfileByKey(roleKey);
}

export async function getAllRoleProfiles(): Promise<RoleProfile[]> {
  return db.getAllRoleProfiles();
}

export async function matchRoleByTitle(title: string): Promise<{ role: RoleProfile; similarity: number } | null> {
  if (!title || !title.trim()) return null;

  const titleEmbedding = await generateEmbedding(title);
  if (!titleEmbedding) return null;

  const roles = await db.getAllRoleProfiles();
  let best: { role: RoleProfile; similarity: number } | null = null;
  for (const role of roles) {
    if (!role.embedding || role.embedding.length === 0) continue;
    const similarity = cosineSimilarity(titleEmbedding, role.embedding);
    if (!best || similarity > best.similarity) {
      best = { role, similarity };
    }
  }
  return best;
}
