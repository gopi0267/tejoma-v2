import type { Candidate } from './types.js';
import { embedText } from './utils/embeddings.js';
import { logger } from './utils/logger.js';

const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || 'http://localhost:3006';

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
    const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/knowledge-base/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: candidate.company_id, source_type: 'candidate', source_id: candidate.id, content, embedding }),
    });
    if (!response.ok) {
      throw new Error(`Monolith returned ${response.status}`);
    }
  } catch (err) {
    logger.warn({ err }, `Failed to index candidate ${candidate.id} to monolith knowledge base`);
  }
}

export async function removeCandidateFromIndex(candidateId: number): Promise<void> {
  try {
    const response = await fetch(`${MONOLITH_INTERNAL_URL}/internal/knowledge-base/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: 'candidate', source_id: candidateId }),
    });
    if (!response.ok) {
      throw new Error(`Monolith returned ${response.status}`);
    }
  } catch (err) {
    logger.warn({ err }, `Failed to remove candidate ${candidateId} from monolith knowledge base`);
  }
}

export function indexCandidateInBackground(candidate: Candidate): void {
  indexCandidate(candidate).catch((err) => logger.warn({ err }, `RAG index failed for candidate ${candidate.id}`));
}
