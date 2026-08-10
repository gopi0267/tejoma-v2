import type { Job } from './types.js';
import { embedText } from './utils/embeddings.js';
import { logger } from './utils/logger.js';

const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || 'http://localhost:3006';

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
    const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/knowledge-base/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: job.company_id, source_type: 'job', source_id: job.id, content, embedding }),
    });
    if (!response.ok) {
      throw new Error(`Monolith returned ${response.status}`);
    }
  } catch (err) {
    logger.warn({ err }, `Failed to index job ${job.id} to monolith knowledge base`);
  }
}

export async function removeJobFromIndex(jobId: number): Promise<void> {
  try {
    const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/knowledge-base/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: 'job', source_id: jobId }),
    });
    if (!response.ok) {
      throw new Error(`Monolith returned ${response.status}`);
    }
  } catch (err) {
    logger.warn({ err }, `Failed to remove job ${jobId} from monolith knowledge base`);
  }
}

export function indexJobInBackground(job: Job): void {
  indexJob(job).catch((err) => logger.warn({ err }, `RAG index failed for job ${job.id}`));
}
