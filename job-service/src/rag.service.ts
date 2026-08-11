import type { Job } from './types.js';
import { embedText } from './utils/embeddings.js';
import { logger } from './utils/logger.js';
import { db } from './db.js';

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://localhost:4006';

function buildJobChunk(j: Job): string {
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

export async function indexJob(job: Job): Promise<void> {
  const content = buildJobChunk(job);
  if (!content.trim()) return;
  const embedding = await embedText(content);

  try {
    await db.query(
      `INSERT INTO knowledge_base_chunks (company_id, source_type, source_id, content, embedding)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_type, source_id) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         updated_at = CURRENT_TIMESTAMP`,
      [job.company_id, 'job', job.id, content, embedding]
    );

    // Mirror to chat-service (fire-and-forget)
    fetch(`${CHAT_SERVICE_URL}/internal/knowledge-base/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: job.company_id, source_type: 'job', source_id: job.id, content, embedding }),
    }).catch((err) => logger.warn({ err }, `Failed to mirror job ${job.id} to chat-service`));
  } catch (err) {
    logger.warn({ err }, `Failed to index job ${job.id} to local knowledge base`);
  }
}

export async function removeJobFromIndex(jobId: number): Promise<void> {
  try {
    await db.query(
      `DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2`,
      ['job', jobId]
    );

    // Mirror deletion to chat-service (fire-and-forget)
    fetch(`${CHAT_SERVICE_URL}/internal/knowledge-base/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: 'job', source_id: jobId }),
    }).catch((err) => logger.warn({ err }, `Failed to mirror job ${jobId} deletion to chat-service`));
  } catch (err) {
    logger.warn({ err }, `Failed to remove job ${jobId} from local knowledge base`);
  }
}

export function indexJobInBackground(job: Job): void {
  indexJob(job).catch((err) => logger.warn({ err }, `RAG index failed for job ${job.id}`));
}
