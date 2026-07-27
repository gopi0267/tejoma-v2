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
  await db.updateCandidate(candidate.id, { resume_embedding: embedding }, candidate.company_id);
  // Enterprise AI Matching Architecture, Phase 1 - multi-facet embeddings, additive alongside the
  // whole-document resume_embedding above (which is unaffected by this call and is still what
  // src/services.ts reads for matching). Best-effort per facet: a missing/short text for one
  // facet simply leaves that one column null, exactly like the existing resume_embedding
  // resilience pattern - never blocks or fails candidate creation.
  await indexCandidateFacetEmbeddings(candidate);
}

export async function indexJobEmbedding(job: Job): Promise<void> {
  if (!job.description || !job.description.trim()) return;
  const embedding = await generateEmbedding(job.description);
  if (!embedding) return;
  await db.updateJobEmbedding(job.id, embedding);
  await indexJobFacetEmbeddings(job);
}

// ==================== MULTI-FACET EMBEDDINGS (Phase 1) ====================
// Same embedding model/service as the whole-document embeddings above (all-MiniLM-L6-v2 via
// python-services/matching-ml-service) - just called with narrower text slices. Not yet read by
// src/services.ts's scoring functions (Phase 2 work) - purely additive storage this phase.

function buildCandidateFacetTexts(candidate: Candidate): { skills: string; responsibilities: string; title: string } {
  return {
    skills: (candidate.skills || []).join(', '),
    responsibilities: [candidate.projects, candidate.resume_summary].filter((t) => t && t.trim()).join('. '),
    title: candidate.current_job_title || '',
  };
}

function buildJobFacetTexts(job: Job): { skills: string; responsibilities: string; title: string } {
  return {
    skills: (job.required_skills || []).join(', '),
    responsibilities: [...(job.responsibilities || []), job.job_summary].filter((t): t is string => Boolean(t && t.trim())).join('. '),
    title: job.title || '',
  };
}

export async function indexCandidateFacetEmbeddings(candidate: Candidate): Promise<void> {
  const texts = buildCandidateFacetTexts(candidate);
  const updates: Partial<Candidate> = {};

  if (texts.skills.trim()) {
    const embedding = await generateEmbedding(texts.skills);
    if (embedding) updates.skills_embedding = embedding;
  }
  if (texts.responsibilities.trim()) {
    const embedding = await generateEmbedding(texts.responsibilities);
    if (embedding) updates.responsibilities_embedding = embedding;
  }
  if (texts.title.trim()) {
    const embedding = await generateEmbedding(texts.title);
    if (embedding) updates.title_embedding = embedding;
  }

  if (Object.keys(updates).length > 0) {
    await db.updateCandidate(candidate.id, updates, candidate.company_id);
  }
}

export async function indexJobFacetEmbeddings(job: Job): Promise<void> {
  const texts = buildJobFacetTexts(job);
  const updates: Partial<Job> = {};

  if (texts.skills.trim()) {
    const embedding = await generateEmbedding(texts.skills);
    if (embedding) updates.skills_embedding = embedding;
  }
  if (texts.responsibilities.trim()) {
    const embedding = await generateEmbedding(texts.responsibilities);
    if (embedding) updates.responsibilities_embedding = embedding;
  }
  if (texts.title.trim()) {
    const embedding = await generateEmbedding(texts.title);
    if (embedding) updates.title_embedding = embedding;
  }

  if (Object.keys(updates).length > 0) {
    await db.updateJob(job.id, job.company_id, updates);
  }
}

// Fire-and-forget wrappers for use in request handlers - embedding generation must never block
// or fail a candidate/job creation response (same resilience pattern as rag.service.ts).
export function indexCandidateEmbeddingInBackground(candidate: Candidate): void {
  indexCandidateEmbedding(candidate).catch((err) => logger.warn({ err: err.message, candidateId: candidate.id }, 'BERT embedding indexing failed for candidate'));
}

export function indexJobEmbeddingInBackground(job: Job): void {
  indexJobEmbedding(job).catch((err) => logger.warn({ err: err.message, jobId: job.id }, 'BERT embedding indexing failed for job'));
}
