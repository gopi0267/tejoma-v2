/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BERT (Sentence-Transformer) embeddings client - HTTP client to
 * python-services/matching-ml-service, which runs all-MiniLM-L6-v2 persistently so no model
 * reload happens per call. Embeddings are meant to be generated ONCE per candidate/job (at
 * creation time) and stored in Postgres - see wiring in src/db.ts / src/api/candidate.routes.ts
 * / src/api/job.routes.ts. Real-time match scoring should never call embedText() directly; it
 * should read the already-stored vector and compare with cosineSimilarity (src/utils/vectorMath
 * equivalent - see src/utils/embeddings.ts's cosineSimilarity for the vector-math function).
 */
import { logger } from '../utils/logger.js';

const ML_SERVICE_URL = process.env.MATCHING_ML_SERVICE_URL || 'http://localhost:8009';
const EMBED_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generates a 384-dim BERT embedding for a piece of text (resume text or job description).
 * Returns null (never throws) if the ML service is unreachable - callers should treat a null
 * embedding as "not available yet" and fall back to non-BERT signals, not fail the request.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const res = await fetch(`${ML_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      logger.warn({ status: res.status }, 'BERT embedding request returned non-OK status');
      return null;
    }
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.debug({ err: err.message }, 'Matching ML service unavailable for embedding generation');
    return null;
  }
}

/** Batch variant - used for bulk resume import so N candidates cost 1 HTTP round-trip, not N. */
export async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  const nonEmpty = texts.map((t) => (t && t.trim() ? t : null));
  if (nonEmpty.every((t) => t === null)) return texts.map(() => null);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS * 4);

  try {
    const res = await fetch(`${ML_SERVICE_URL}/embed/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: nonEmpty.map((t) => t || '') }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return texts.map(() => null);
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings.map((e, i) => (nonEmpty[i] === null ? null : e));
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.debug({ err: err.message }, 'Matching ML service unavailable for batch embedding generation');
    return texts.map(() => null);
  }
}
