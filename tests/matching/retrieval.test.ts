import { describe, it, expect } from 'vitest';
import {
  reciprocalRankFusion,
  InMemoryCosineVectorSearchProvider,
  StructuredSkillOverlapStrategy,
  SemanticFacetStrategy,
  type RetrievalResult,
} from '../../src/matching/retrieval.js';
import type { Candidate, Job } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 2 - Hybrid Retrieval. reciprocalRankFusion,
// InMemoryCosineVectorSearchProvider, StructuredSkillOverlapStrategy, and SemanticFacetStrategy
// have no DB dependency and are tested directly here. GraphExpandedSkillStrategy and the
// hybridRetrieveCandidates orchestrator need a real skill graph and are covered by the
// integration test pass instead.

function makeCandidate(id: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id, company_id: 1, name: `Candidate ${id}`, email: '', phone: '', skills: [], primary_skills: '',
    secondary_skills: '', years_of_experience: '', current_location: '', preferred_location: '',
    current_company: '', previous_companies: [], current_job_title: '', industry_domain: '', education: '',
    highest_qualification: '', graduation_year: '', university: '', certifications: [], projects: '',
    technical_tools: '', languages_known: '', current_ctc: '', expected_ctc: '', notice_period: '',
    willingness_to_relocate: '', linkedin_url: '', github_or_portfolio_url: '', resume_summary: '',
    resume_text: '', ai_confidence_score: '',
    ...overrides,
  } as Candidate;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1, company_id: 1, title: 'Backend Engineer', description: '', required_skills: [],
    experience_years: 0, location: '', salary_min: 0, salary_max: 0, status: 'open', created_at: '', updated_at: '',
    ...overrides,
  } as Job;
}

describe('reciprocalRankFusion', () => {
  it('ranks an item that appears near the top of every strategy above one that only appears in one', () => {
    const rankingA: RetrievalResult<string>[] = [{ item: 'x', rank: 1, score: 0.9 }, { item: 'y', rank: 2, score: 0.5 }];
    const rankingB: RetrievalResult<string>[] = [{ item: 'x', rank: 1, score: 0.8 }];
    const fused = reciprocalRankFusion([rankingA, rankingB], ['a', 'b'], (item) => item.charCodeAt(0));
    expect(fused[0].item).toBe('x');
    expect(fused[0].contributingStrategies).toEqual(['a', 'b']);
  });

  it('is a union, not an intersection - an item ranked by only one strategy still appears', () => {
    const rankingA: RetrievalResult<string>[] = [{ item: 'x', rank: 1, score: 1 }];
    const rankingB: RetrievalResult<string>[] = [{ item: 'y', rank: 1, score: 1 }];
    const fused = reciprocalRankFusion([rankingA, rankingB], ['a', 'b'], (item) => item.charCodeAt(0));
    expect(fused.map((f) => f.item).sort()).toEqual(['x', 'y']);
  });

  it('returns an empty array when every input ranking is empty', () => {
    const fused = reciprocalRankFusion([[], []], ['a', 'b'], (item: string) => item.charCodeAt(0));
    expect(fused).toEqual([]);
  });

  it('records every contributing strategy name for an item ranked by more than one', () => {
    const rankingA: RetrievalResult<string>[] = [{ item: 'x', rank: 3, score: 0.1 }];
    const rankingB: RetrievalResult<string>[] = [{ item: 'x', rank: 1, score: 0.9 }];
    const rankingC: RetrievalResult<string>[] = [{ item: 'x', rank: 5, score: 0.05 }];
    const fused = reciprocalRankFusion([rankingA, rankingB, rankingC], ['structured', 'semantic', 'graph'], (item) => item.charCodeAt(0));
    expect(fused[0].contributingStrategies).toEqual(['structured', 'semantic', 'graph']);
  });
});

describe('InMemoryCosineVectorSearchProvider', () => {
  const provider = new InMemoryCosineVectorSearchProvider();

  it('ranks items with a higher cosine similarity to the query vector first', () => {
    const query = [1, 0, 0];
    const pool = [
      { item: 'far', embedding: [0, 1, 0] },
      { item: 'close', embedding: [0.9, 0.1, 0] },
    ];
    const ranked = provider.rankBySimilarity(query, pool);
    expect(ranked[0].item).toBe('close');
  });

  it('ranks items with no embedding last, at similarity 0, rather than dropping them (never a hard exclusion)', () => {
    const query = [1, 0, 0];
    const pool = [
      { item: 'no_embedding', embedding: null },
      { item: 'has_embedding', embedding: [1, 0, 0] },
    ];
    const ranked = provider.rankBySimilarity(query, pool);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].item).toBe('has_embedding');
    expect(ranked[1]).toEqual({ item: 'no_embedding', similarity: 0 });
  });
});

describe('StructuredSkillOverlapStrategy', () => {
  const strategy = new StructuredSkillOverlapStrategy();

  it('ranks a candidate with full skill overlap above one with none', async () => {
    const job = makeJob({ required_skills: ['Python', 'Django'] });
    const strong = makeCandidate(1, { skills: ['Python', 'Django'] });
    const weak = makeCandidate(2, { skills: ['Java'] });
    const ranked = await strategy.rank(job, [weak, strong]);
    expect(ranked[0].item.id).toBe(1);
    expect(ranked[0].rank).toBe(1);
  });

  it('has the "structured_skill_overlap" name used for RRF provenance', () => {
    expect(strategy.name).toBe('structured_skill_overlap');
  });
});

describe('SemanticFacetStrategy', () => {
  it('falls back to a neutral, non-throwing ranking when the job has no skills_embedding', async () => {
    const strategy = new SemanticFacetStrategy();
    const job = makeJob({ skills_embedding: null });
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const ranked = await strategy.rank(job, candidates);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('uses the injected VectorSearchProvider, not a hardcoded implementation (the pgvector swap point)', async () => {
    let called = false;
    const fakeProvider = {
      name: 'fake',
      rankBySimilarity: <T,>(_q: number[], pool: Array<{ item: T; embedding: number[] | null }>) => {
        called = true;
        return pool.map((p) => ({ item: p.item, similarity: 1 }));
      },
    };
    const strategy = new SemanticFacetStrategy(fakeProvider);
    const job = makeJob({ skills_embedding: [1, 0, 0] });
    await strategy.rank(job, [makeCandidate(1)]);
    expect(called).toBe(true);
  });
});
