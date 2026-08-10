/**
 * RAG indexing for jobs - Phase D Item 8 migration
 * Ported from monolith's src/rag.service.ts
 * Writes to knowledge_base_chunks for chat-service RAG retrieval
 */
import { db } from '../db.js';
import { embedText } from '../utils/embeddings.js';
import type { Job } from '../types.js';

function buildJobChunk(j: any): string {
  const skills = Array.isArray(j.required_skills) ? j.required_skills.join(', ') : '';
  return [
    `Open position: ${j.title}.`,
    j.status ? `Status: ${j.status}.` : '',
    j.experience_years ? `Requires ${j.experience_years}+ years of experience.` : '',
    skills ? `Required skills: ${skills}.` : '',
    j.location ? `Location: ${j.location}.` : '',
    (j.salary_min || j.salary_max) ? `Salary range: ${j.salary_min ?? '?'} - ${j.salary_max ?? '?'}.` : '',
    j.description ? `Description: ${j.description}` : '',
  ].filter(Boolean).join(' ');
}

export async function indexJob(job: any): Promise<void> {
  const content = buildJobChunk(job);
  if (!content.trim()) return;
  const embedding = await embedText(content);
  await db.upsertKnowledgeChunk({ company_id: job.company_id, source_type: 'job', source_id: job.id, content, embedding });
}

export async function removeJobFromIndex(jobId: number): Promise<void> {
  await db.deleteKnowledgeChunk('job', jobId);
}

export function indexJobInBackground(job: any): void {
  indexJob(job).catch((err) => console.error(`RAG index failed for job ${job.id}:`, err.message));
}
