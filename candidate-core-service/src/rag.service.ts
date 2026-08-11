import type { Candidate } from './types.js';
import { embedText } from './utils/embeddings.js';
import { logger } from './utils/logger.js';
import { db } from './db.js';

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://localhost:4006';

function buildCandidateChunk(c: Candidate): string {
  const skills = Array.isArray(c.skills) ? c.skills.join(', ') : '';
  return [
    `Candidate: ${c.name || 'Unknown'}.`,
    c.current_job_title ? `Current role: ${c.current_job_title}${c.current_company ? ` at ${c.current_company}` : ''}.` : '',
    c.years_of_experience ? `Experience: ${c.years_of_experience}.` : '',
    skills ? `Skills: ${skills}.` : '',
    c.current_location ? `Current location: ${c.current_location}.` : '',
    c.resume_summary ? `Summary: ${c.resume_summary}` : '',
  ].filter(Boolean).join(' ');
}

export async function indexCandidate(candidate: Candidate): Promise<void> {
  const content = buildCandidateChunk(candidate);
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
      [candidate.company_id, 'candidate', candidate.id, content, embedding]
    );

    // Mirror to chat-service (fire-and-forget)
    fetch(`${CHAT_SERVICE_URL}/internal/knowledge-base/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: candidate.company_id, source_type: 'candidate', source_id: candidate.id, content, embedding }),
    }).catch((err) => logger.warn({ err }, `Failed to mirror candidate ${candidate.id} to chat-service`));
  } catch (err) {
    logger.warn({ err }, `Failed to index candidate ${candidate.id} to local knowledge base`);
  }
}

export async function removeCandidateFromIndex(candidateId: number): Promise<void> {
  try {
    await db.query(
      `DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2`,
      ['candidate', candidateId]
    );

    // Mirror deletion to chat-service (fire-and-forget)
    fetch(`${CHAT_SERVICE_URL}/internal/knowledge-base/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: 'candidate', source_id: candidateId }),
    }).catch((err) => logger.warn({ err }, `Failed to mirror candidate ${candidateId} deletion to chat-service`));
  } catch (err) {
    logger.warn({ err }, `Failed to remove candidate ${candidateId} from local knowledge base`);
  }
}

export function indexCandidateInBackground(candidate: Candidate): void {
  indexCandidate(candidate).catch((err) => logger.warn({ err }, `RAG index failed for candidate ${candidate.id}`));
}
