// Precomputes and stores BERT embeddings for candidates/jobs, once, at creation time - so
// real-time match scoring (src/services.ts) never has to call the embedding model itself, just
// compare two already-stored vectors (fast, in-memory cosineSimilarity).
//
// Distinct from src/rag.service.ts's indexing (which uses Gemini embeddings of structured text
// summaries for chatbot retrieval, a different embedding space/purpose entirely) - this module
// is specifically for the raw resume-text/job-description semantic similarity used in matching.
import { db } from '../db.js';
import { Candidate, Job } from '../types.js';
import { generateEmbedding } from '../algorithms/bert-embeddings.js';
import { logger } from '../utils/logger.js';

export async function indexCandidateEmbedding(candidate: Candidate): Promise<void> {
  if (!candidate.resume_text || !candidate.resume_text.trim()) return;
  const embedding = await generateEmbedding(candidate.resume_text);
  if (!embedding) return; // ML service unavailable - leave resume_embedding null, matching falls back gracefully
  await db.updateCandidate(candidate.id, { resume_embedding: embedding });
}

export async function indexJobEmbedding(job: Job): Promise<void> {
  if (!job.description || !job.description.trim()) return;
  const embedding = await generateEmbedding(job.description);
  if (!embedding) return;
  await db.updateJobEmbedding(job.id, embedding);
}

// Fire-and-forget wrappers for use in request handlers - embedding generation must never block
// or fail a candidate/job creation response (same resilience pattern as rag.service.ts).
export function indexCandidateEmbeddingInBackground(candidate: Candidate): void {
  indexCandidateEmbedding(candidate).catch((err) => logger.warn({ err: err.message, candidateId: candidate.id }, 'BERT embedding indexing failed for candidate'));
}

export function indexJobEmbeddingInBackground(job: Job): void {
  indexJobEmbedding(job).catch((err) => logger.warn({ err: err.message, jobId: job.id }, 'BERT embedding indexing failed for job'));
}
