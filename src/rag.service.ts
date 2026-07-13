import { db } from './db.js';
import { Candidate, Job } from './types.js';
import { embedText, cosineSimilarity } from './utils/embeddings.js';

// ==================== CHUNK TEXT BUILDERS ====================
// Each builder concatenates the fields a recruiter would actually ask about into one plain-text
// paragraph, which is what actually gets embedded. Keeping the wording natural (not just a raw
// field dump) makes semantic retrieval noticeably better than dumping "key: value" pairs.

function buildCandidateChunk(c: Candidate): string {
  const skills = Array.isArray(c.skills) ? c.skills.join(', ') : '';
  const prevCompanies = Array.isArray(c.previous_companies) ? c.previous_companies.join(', ') : '';
  const certifications = Array.isArray(c.certifications) ? c.certifications.join(', ') : '';

  return [
    `Candidate: ${c.name || 'Unknown'}.`,
    c.current_job_title ? `Current role: ${c.current_job_title}${c.current_company ? ` at ${c.current_company}` : ''}.` : '',
    c.years_of_experience ? `Experience: ${c.years_of_experience}.` : '',
    skills ? `Skills: ${skills}.` : '',
    c.primary_skills ? `Primary skills: ${c.primary_skills}.` : '',
    c.industry_domain ? `Industry/domain: ${c.industry_domain}.` : '',
    c.current_location ? `Current location: ${c.current_location}.` : '',
    c.preferred_location ? `Preferred location: ${c.preferred_location}.` : '',
    prevCompanies ? `Previous companies: ${prevCompanies}.` : '',
    c.highest_qualification ? `Education: ${c.highest_qualification}${c.university ? ` from ${c.university}` : ''}${c.graduation_year ? ` (${c.graduation_year})` : ''}.` : '',
    certifications ? `Certifications: ${certifications}.` : '',
    c.current_ctc ? `Current CTC: ${c.current_ctc}.` : '',
    c.expected_ctc ? `Expected CTC: ${c.expected_ctc}.` : '',
    c.notice_period ? `Notice period: ${c.notice_period}.` : '',
    c.willingness_to_relocate ? `Willing to relocate: ${c.willingness_to_relocate}.` : '',
    c.resume_summary ? `Summary: ${c.resume_summary}` : '',
  ].filter(Boolean).join(' ');
}

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

// ==================== INDEXING (write path) ====================

export async function indexCandidate(candidate: Candidate): Promise<void> {
  const content = buildCandidateChunk(candidate);
  if (!content.trim()) return;
  const embedding = await embedText(content);
  // Candidates have no company_id anywhere in this schema (see migration-31-cols.sql) - chunk
  // visibility intentionally mirrors that existing global visibility, not a new tenant boundary.
  await db.upsertKnowledgeChunk({ company_id: null, source_type: 'candidate', source_id: candidate.id, content, embedding });
}

export async function indexJob(job: Job): Promise<void> {
  const content = buildJobChunk(job);
  if (!content.trim()) return;
  const embedding = await embedText(content);
  await db.upsertKnowledgeChunk({ company_id: job.company_id, source_type: 'job', source_id: job.id, content, embedding });
}

export async function removeCandidateFromIndex(candidateId: number): Promise<void> {
  await db.deleteKnowledgeChunk('candidate', candidateId);
}

export async function removeJobFromIndex(jobId: number): Promise<void> {
  await db.deleteKnowledgeChunk('job', jobId);
}

// Indexing failures must never break the caller's actual request (creating a candidate/job
// should still succeed even if the embeddings API has a transient blip) - callers fire-and-log
// this instead of awaiting it inline in the request/response path.
export function indexCandidateInBackground(candidate: Candidate): void {
  indexCandidate(candidate).catch((err) => console.error(`RAG index failed for candidate ${candidate.id}:`, err.message));
}

export function indexJobInBackground(job: Job): void {
  indexJob(job).catch((err) => console.error(`RAG index failed for job ${job.id}:`, err.message));
}

// ==================== RETRIEVAL + ANSWER GENERATION (read path) ====================

export interface RetrievedChunk {
  source_type: string;
  source_id: number;
  content: string;
  score: number;
}

const TOP_K = 8;
const MIN_SIMILARITY = 0.3;

export async function retrieveRelevantChunks(query: string, companyId: number): Promise<RetrievedChunk[]> {
  const [queryEmbedding, chunks] = await Promise.all([
    embedText(query),
    db.getKnowledgeChunksForCompany(companyId),
  ]);

  return chunks
    .map((chunk) => ({
      source_type: chunk.source_type,
      source_id: chunk.source_id,
      content: chunk.content,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((c) => c.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

// ==================== BULK BACKFILL (existing data indexed before this feature shipped) ====================

export async function reindexAllCandidates(): Promise<{ indexed: number; failed: number }> {
  const candidates = await db.getCandidates();
  let indexed = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await indexCandidate(c);
      indexed++;
    } catch (err: any) {
      failed++;
      console.error(`Reindex failed for candidate ${c.id}:`, err.message);
    }
  }
  return { indexed, failed };
}

export async function reindexAllJobs(): Promise<{ indexed: number; failed: number }> {
  const jobs = await db.getJobs();
  let indexed = 0;
  let failed = 0;
  for (const j of jobs) {
    try {
      await indexJob(j);
      indexed++;
    } catch (err: any) {
      failed++;
      console.error(`Reindex failed for job ${j.id}:`, err.message);
    }
  }
  return { indexed, failed };
}
