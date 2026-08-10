/**
 * Ported from the monolith's src/algorithms/bert-embeddings.ts - generateEmbedding only
 * (byte-identical), the single function findNearestNeighbors needs. Calls
 * python-services/matching-ml-service directly, never through the monolith - same as
 * matching-reasoning-service's own copy of this client.
 */
import { logger } from '../utils/logger.js';
import { embeddingServiceCount } from '../utils/metrics.js';

const ML_SERVICE_URL = process.env.MATCHING_ML_SERVICE_URL || 'http://localhost:8009';
const EMBED_TIMEOUT_MS = 5000;

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
      embeddingServiceCount.inc({ outcome: 'error' });
      return null;
    }
    const data = (await res.json()) as { embedding: number[] };
    embeddingServiceCount.inc({ outcome: 'success' });
    return data.embedding;
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.debug({ err: err.message }, 'Matching ML service unavailable for embedding generation');
    embeddingServiceCount.inc({ outcome: 'error' });
    return null;
  }
}
