// BGE-M3 + BGE-Reranker-v2-m3 HTTP client - talks to python-services/bge-retrieval-service, a
// deliberately separate service from matching-ml-service (see that service's own module docs for
// why). Same "return null, never throw" contract as src/algorithms/bert-embeddings.ts's
// generateEmbedding(), so a caller never needs a special case for "the BGE service isn't
// running" - which is the default state today, since nothing starts it automatically.
//
// Timeouts are generous and based on REAL measurements on this project's own CPU dev machine
// (see bgeShadowRetrieval.ts's module doc for the benchmark), not the sub-100ms figures a GPU
// deployment might hit - BGE_SERVICE_URL can point at a real GPU box later with no code change
// here, only faster real-world responses.

import { logger } from '../utils/logger.js';

const BGE_SERVICE_URL = process.env.BGE_SERVICE_URL || 'http://localhost:8010';
const EMBED_TIMEOUT_MS = 15_000;
const EMBED_BATCH_BASE_TIMEOUT_MS = 10_000;
const EMBED_BATCH_PER_ITEM_MS = 1_000;
const EMBED_BATCH_MAX_TIMEOUT_MS = 60_000;
const RERANK_BASE_TIMEOUT_MS = 10_000;
const RERANK_PER_PAIR_MS = 1_000;
const RERANK_MAX_TIMEOUT_MS = 120_000;

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BGE_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      logger.debug({ status: res.status, path }, 'BGE retrieval service returned non-OK status');
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.debug({ err: err.message, path }, 'BGE retrieval service unavailable');
    return null;
  }
}

export async function isBgeServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BGE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { modelsLoaded?: boolean };
    return Boolean(data.modelsLoaded);
  } catch {
    return false;
  }
}

/** 1024-dim BGE-M3 embedding for a single piece of text. Null if the service is unreachable. */
export async function embedWithBge(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  const result = await postJson<{ embedding: number[] }>('/embed', { text }, EMBED_TIMEOUT_MS);
  return result?.embedding ?? null;
}

/** Batch embedding - one HTTP round-trip for N texts instead of N. Null (not per-item) on failure. */
export async function embedBatchWithBge(texts: string[]): Promise<number[][] | null> {
  const nonEmpty = texts.filter((t) => t && t.trim());
  if (nonEmpty.length === 0) return null;
  const timeoutMs = Math.min(EMBED_BATCH_MAX_TIMEOUT_MS, EMBED_BATCH_BASE_TIMEOUT_MS + texts.length * EMBED_BATCH_PER_ITEM_MS);
  const result = await postJson<{ embeddings: number[][] }>('/embed/batch', { texts }, timeoutMs);
  return result?.embeddings ?? null;
}

/** Cross-encoder relevance scores for (query, document) pairs, same order as `documents`. Null on failure. */
export async function rerankWithBge(query: string, documents: string[]): Promise<number[] | null> {
  if (!query || documents.length === 0) return null;
  const timeoutMs = Math.min(RERANK_MAX_TIMEOUT_MS, RERANK_BASE_TIMEOUT_MS + documents.length * RERANK_PER_PAIR_MS);
  const result = await postJson<{ scores: number[] }>('/rerank', { query, documents }, timeoutMs);
  return result?.scores ?? null;
}
