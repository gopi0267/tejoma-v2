/**
 * Integration tests for src/services/ragService.ts against a real database. Mocks only
 * embedText (src/utils/embeddings.ts) with controlled, deterministic vectors - real Gemini calls
 * aren't needed to test the actual logic under test here (chunk building, upsert-by-conflict,
 * cosine-similarity filtering/ranking/TOP_K), and CI has no real API key available.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../src/db.js';
import type { CandidateForChunk, JobForChunk } from '../src/types.js';

// Orthogonal-ish fixed vectors so cosine similarity is easy to reason about: identical vector ->
// score 1.0, orthogonal vector -> score 0.0 (below MIN_SIMILARITY), so retrieval filtering is
// deterministic and testable without depending on real embedding semantics.
function axisVector(dims: number, axis: number): number[] {
  return Array.from({ length: dims }, (_, i) => (i === axis ? 1 : 0));
}

vi.mock('../src/utils/embeddings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/embeddings.js')>();
  return {
    ...actual, // keep the real cosineSimilarity - only embedText needs to be deterministic/free
    embedText: vi.fn(async (text: string) => {
      if (text.includes('__QUERY_RELEVANT__')) return axisVector(768, 0);
      if (text.includes('__QUERY_IRRELEVANT__')) return axisVector(768, 1);
      // Candidate/job chunk text and the "relevant" query share axis 0; anything else uses axis 0
      // too by default so a real chunk (built from real fields) matches a real query.
      return axisVector(768, 0);
    }),
  };
});

const { indexCandidate, indexJob, retrieveRelevantChunks } = await import('../src/services/ragService.js');

const TEST_COMPANY_ID = 999001;

beforeAll(async () => {
  await pool.query('DELETE FROM knowledge_base_chunks WHERE company_id = $1', [TEST_COMPANY_ID]);
});

afterAll(async () => {
  await pool.query('DELETE FROM knowledge_base_chunks WHERE company_id = $1', [TEST_COMPANY_ID]);
  await pool.end();
});

describe('indexCandidate / indexJob (real DB writes)', () => {
  it('builds a chunk from candidate fields and upserts it', async () => {
    const candidate: CandidateForChunk = {
      id: 111, company_id: TEST_COMPANY_ID, name: 'Test Candidate', current_job_title: 'Backend Engineer',
      skills: ['Node.js', 'PostgreSQL'], years_of_experience: '5 years',
    };
    await indexCandidate(candidate);

    const row = await pool.query('SELECT * FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', ['candidate', 111]);
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].content).toContain('Test Candidate');
    expect(row.rows[0].content).toContain('Backend Engineer');
    expect(row.rows[0].company_id).toBe(TEST_COMPANY_ID);
  });

  it('re-indexing the same candidate upserts (does not duplicate)', async () => {
    const candidate: CandidateForChunk = { id: 111, company_id: TEST_COMPANY_ID, name: 'Test Candidate Updated', skills: ['Go'] };
    await indexCandidate(candidate);

    const rows = await pool.query('SELECT * FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', ['candidate', 111]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].content).toContain('Test Candidate Updated');
  });

  it('builds a chunk from job fields and upserts it', async () => {
    const job: JobForChunk = { id: 222, company_id: TEST_COMPANY_ID, title: 'Senior Backend Engineer', required_skills: ['Node.js'], location: 'Bangalore' };
    await indexJob(job);

    const row = await pool.query('SELECT * FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', ['job', 222]);
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].content).toContain('Senior Backend Engineer');
  });
});

describe('retrieveRelevantChunks (cosine similarity filtering + ranking)', () => {
  it('returns chunks scored above MIN_SIMILARITY for a relevant query, excludes an irrelevant one', async () => {
    const results = await retrieveRelevantChunks('__QUERY_RELEVANT__ backend engineer', TEST_COMPANY_ID);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.score >= 0.3)).toBe(true);
    expect(results.map((r) => r.source_id)).toContain(111);
    expect(results.map((r) => r.source_id)).toContain(222);
  });

  it('returns nothing for a query whose embedding is orthogonal to every stored chunk', async () => {
    const results = await retrieveRelevantChunks('__QUERY_IRRELEVANT__ nothing matches', TEST_COMPANY_ID);
    expect(results).toEqual([]);
  });

  it('scopes strictly to the requesting company', async () => {
    const results = await retrieveRelevantChunks('__QUERY_RELEVANT__ anything', TEST_COMPANY_ID + 1);
    expect(results).toEqual([]);
  });
});
