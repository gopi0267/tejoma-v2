// Ported verbatim from the monolith's src/utils/embeddings.ts - same model, same retry logic,
// same dimensions. Duplicated, not shared, per this series' established monorepo convention
// (small cross-cutting logic is copied rather than shared prematurely).
import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from '../config/env.js';

// Only gemini-embedding-001 is confirmed to work on the available API key (text-embedding-004
// and embedding-001 both 404 - not available on this key/API version). Truncated to 768 dims
// via outputDimensionality (Gemini's embeddings support Matryoshka truncation) to keep the
// plain-array cosine-similarity search over knowledge_base_chunks fast, since there's no
// pgvector/ANN index on this database.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function embedText(text: string): Promise<number[]> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
        throw new Error('Embedding API returned no vector');
      }
      return values;
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.error?.code;
      const isRetryable = status === 429 || status === 503 || status === 500 || /overloaded|unavailable/i.test(String(err?.message));
      if (isRetryable && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

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
