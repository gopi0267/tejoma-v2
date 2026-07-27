// Enterprise AI Matching Architecture, Phase 2 - Hybrid Retrieval, behind a clean abstraction.
//
// Per the architecture's own principle: "production systems never rely on one retrieval
// strategy." Three lanes run over the SAME already-fetched candidate pool (no new DB round-trips
// per strategy - the pool comes from db.getCandidatesForJobScoring, Phase 0's structured
// pre-filter, unchanged) and are fused with Reciprocal Rank Fusion:
//   - StructuredSkillOverlapStrategy: exact skill-set Jaccard (reuses src/algorithms/jaccard.ts,
//     unmodified - the same math computeMatchFeatures already uses for the heuristic score).
//   - SemanticFacetStrategy: cosine similarity over the Phase 1 skills_embedding facet, via the
//     VectorSearchProvider abstraction below - IN-MEMORY today because pgvector is not installed
//     (see migration-pgvector-embeddings.sql), but callers never talk to the provider directly,
//     so swapping in a real ANN-backed provider later requires changing exactly one line
//     (which provider hybridRetrieveCandidates constructs), nothing about the strategy interface,
//     the fusion logic, or anything above this module.
//   - GraphExpandedSkillStrategy: uses the Phase 1 skill graph (canonicalizeSkill + typed edges)
//     to catch candidates whose skills are related-but-not-identical to what the JD asks for.
//
// This module does not change what any existing surface returns - it is called only when a
// caller explicitly opts in (see matchingApi.ts's `retrieval` option), never by default.

import { db } from '../db.js';
import { jaccardSimilarity } from '../algorithms/jaccard.js';
import { cosineSimilarity } from '../utils/embeddings.js';
import { canonicalizeSkill } from './skillIntelligence.js';
import type { Candidate, Job, SkillNode } from '../types.js';

export interface RetrievalResult<T> {
  item: T;
  rank: number; // 1-based, within this strategy's own ordering
  score: number; // strategy-specific relevance, 0-1, diagnostic only - not compared cross-strategy
}

export interface RetrievalStrategy<TQuery, TItem> {
  readonly name: string;
  rank(query: TQuery, pool: TItem[]): Promise<RetrievalResult<TItem>[]>;
}

// ==================== VECTOR SEARCH ABSTRACTION (the pgvector swap point) ====================

export interface VectorSearchProvider {
  readonly name: string;
  // Ranks `pool` by cosine similarity of each item's `embedding` to `queryVector`. Items with no
  // embedding are ranked last (similarity 0), never dropped - matches this architecture's
  // recall-first, never-hard-exclude principle established in Phase 0.
  rankBySimilarity<T>(queryVector: number[], pool: Array<{ item: T; embedding: number[] | null }>): Array<{ item: T; similarity: number }>;
}

// The only implementation today. A future PgVectorSearchProvider (issuing `ORDER BY embedding
// <=> query` against the vector(384) columns migration-pgvector-embeddings.sql already defines)
// would implement this exact interface - every strategy and orchestrator below depends on
// VectorSearchProvider, never on this class directly.
export class InMemoryCosineVectorSearchProvider implements VectorSearchProvider {
  readonly name = 'in_memory_cosine';

  rankBySimilarity<T>(queryVector: number[], pool: Array<{ item: T; embedding: number[] | null }>): Array<{ item: T; similarity: number }> {
    return pool
      .map(({ item, embedding }) => ({ item, similarity: embedding && embedding.length > 0 ? cosineSimilarity(queryVector, embedding) : 0 }))
      .sort((a, b) => b.similarity - a.similarity);
  }
}

function toRankedResults<T>(sorted: Array<{ item: T; score: number }>): RetrievalResult<T>[] {
  return sorted.map((entry, i) => ({ item: entry.item, rank: i + 1, score: entry.score }));
}

// ==================== STRATEGY 1: STRUCTURED SKILL OVERLAP (keyword-equivalent, exact) ====================

export class StructuredSkillOverlapStrategy implements RetrievalStrategy<Job, Candidate> {
  readonly name = 'structured_skill_overlap';

  async rank(job: Job, pool: Candidate[]): Promise<RetrievalResult<Candidate>[]> {
    const required = job.required_skills || [];
    const scored = pool.map((candidate) => ({ item: candidate, score: jaccardSimilarity(required, candidate.skills || []) / 100 }));
    scored.sort((a, b) => b.score - a.score);
    return toRankedResults(scored);
  }
}

// ==================== STRATEGY 2: SEMANTIC FACET SIMILARITY ====================

export class SemanticFacetStrategy implements RetrievalStrategy<Job, Candidate> {
  readonly name = 'semantic_facet';
  constructor(private readonly provider: VectorSearchProvider = new InMemoryCosineVectorSearchProvider()) {}

  async rank(job: Job, pool: Candidate[]): Promise<RetrievalResult<Candidate>[]> {
    if (!job.skills_embedding || job.skills_embedding.length === 0) {
      // No query vector to compare against - every candidate ties at rank order received,
      // score 0. Never throws; the fusion stage below simply gets no signal from this lane.
      return toRankedResults(pool.map((item) => ({ item, score: 0 })));
    }
    const ranked = this.provider.rankBySimilarity(
      job.skills_embedding,
      pool.map((c) => ({ item: c, embedding: c.skills_embedding ?? null }))
    );
    return toRankedResults(ranked.map((r) => ({ item: r.item, score: r.similarity })));
  }
}

// ==================== STRATEGY 3: GRAPH-EXPANDED SKILL MATCH ====================

// Canonicalizes the job's required skills and expands each one hop via the Phase 1 skill graph
// (RELATED_TO / FRAMEWORK_OF / COMMONLY_WITH / PARENT_OF), catching candidates whose skills are
// related-but-not-identical to what the JD literally asks for - the concrete, graph-aware
// counterpart to the exact-string StructuredSkillOverlapStrategy above.
export class GraphExpandedSkillStrategy implements RetrievalStrategy<Job, Candidate> {
  readonly name = 'graph_expanded_skill';

  async rank(job: Job, pool: Candidate[]): Promise<RetrievalResult<Candidate>[]> {
    const expandedSkillNames = await this.buildExpandedSkillSet(job.required_skills || []);
    const scored = pool.map((candidate) => ({
      item: candidate,
      score: expandedSkillNames.size === 0 ? 0 : jaccardSimilarity(Array.from(expandedSkillNames), candidate.skills || []) / 100,
    }));
    scored.sort((a, b) => b.score - a.score);
    return toRankedResults(scored);
  }

  private async buildExpandedSkillSet(requiredSkills: string[]): Promise<Set<string>> {
    const expanded = new Set<string>();
    for (const raw of requiredSkills) {
      expanded.add(raw);
      const node = await canonicalizeSkill(raw);
      if (!node) continue;
      expanded.add(node.canonical_name);
      for (const alias of node.aliases) expanded.add(alias);

      const relatedTypes: Array<'RELATED_TO' | 'FRAMEWORK_OF' | 'COMMONLY_WITH' | 'PARENT_OF'> = ['RELATED_TO', 'FRAMEWORK_OF', 'COMMONLY_WITH', 'PARENT_OF'];
      for (const relationshipType of relatedTypes) {
        const edges = await db.getSkillEdgesFrom(node.id, relationshipType);
        for (const edge of edges) {
          const neighbor = await this.getNodeById(edge.to_skill_id);
          if (neighbor) {
            expanded.add(neighbor.canonical_name);
            for (const alias of neighbor.aliases) expanded.add(alias);
          }
        }
      }
    }
    return expanded;
  }

  private nodeCache = new Map<number, SkillNode | null>();
  private async getNodeById(id: number): Promise<SkillNode | null> {
    if (this.nodeCache.has(id)) return this.nodeCache.get(id)!;
    const node = await db.getSkillNodeById(id);
    this.nodeCache.set(id, node);
    return node;
  }
}

// ==================== FUSION ====================

// Standard Reciprocal Rank Fusion: score(item) = sum over every ranking that contains it of
// 1/(k + rank). k=60 is the conventional default from the original RRF literature - large enough
// that a single strategy's #1 pick doesn't automatically dominate, small enough that rank order
// still matters more than raw presence.
export function reciprocalRankFusion<T>(
  rankings: RetrievalResult<T>[][],
  strategyNames: string[],
  getId: (item: T) => number,
  k: number = 60
): Array<{ item: T; fusedScore: number; contributingStrategies: string[] }> {
  const byId = new Map<number, { item: T; fusedScore: number; contributingStrategies: string[] }>();

  rankings.forEach((ranking, strategyIndex) => {
    for (const result of ranking) {
      const id = getId(result.item);
      const contribution = 1 / (k + result.rank);
      const existing = byId.get(id);
      if (existing) {
        existing.fusedScore += contribution;
        existing.contributingStrategies.push(strategyNames[strategyIndex]);
      } else {
        byId.set(id, { item: result.item, fusedScore: contribution, contributingStrategies: [strategyNames[strategyIndex]] });
      }
    }
  });

  return Array.from(byId.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}

// ==================== ORCHESTRATOR ====================

export interface HybridRetrievalOptions {
  limit?: number;
  provider?: VectorSearchProvider;
}

export interface HybridRetrievalResult {
  candidate: Candidate;
  fusedScore: number;
  contributingStrategies: string[];
}

// Runs all three strategies over the SAME pool (no additional DB fetches beyond what the caller
// already fetched) and fuses them. Union, not intersection, by construction - RRF naturally
// includes any candidate ranked by ANY strategy, matching the architecture's explicit "why
// fusion, not intersection" reasoning (a strong match on one strategy survives even if another
// strategy misses it entirely).
export async function hybridRetrieveCandidates(job: Job, pool: Candidate[], options: HybridRetrievalOptions = {}): Promise<HybridRetrievalResult[]> {
  if (pool.length === 0) return [];

  const strategies: RetrievalStrategy<Job, Candidate>[] = [
    new StructuredSkillOverlapStrategy(),
    new SemanticFacetStrategy(options.provider),
    new GraphExpandedSkillStrategy(),
  ];

  const rankings = await Promise.all(strategies.map((s) => s.rank(job, pool)));
  const fused = reciprocalRankFusion(rankings, strategies.map((s) => s.name), (c) => c.id);

  const results: HybridRetrievalResult[] = fused.map((f) => ({ candidate: f.item, fusedScore: f.fusedScore, contributingStrategies: f.contributingStrategies }));
  return options.limit ? results.slice(0, options.limit) : results;
}
