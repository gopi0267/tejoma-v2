// Ported from the monolith's src/matching/retrieval.ts - byte-identical logic. Confirmed dormant:
// hybridRetrieveCandidates is only invoked when a caller sets matchingApi.ts's `retrieval` option,
// which no real caller anywhere in the repository ever does (grep -rn "retrieval: {" src returns
// zero hits).
//
// Uses this service's own narrowed DynamicWeightingJob/DynamicWeightingCandidate types instead of
// the monolith's full Job/Candidate.
import { db } from '../db.js';
import { jaccardSimilarity } from '../algorithms/jaccard.js';
import { cosineSimilarity } from '../utils/embeddings.js';
import { canonicalizeSkill } from './skillIntelligence.js';
import type { DynamicWeightingCandidate, DynamicWeightingJob, SkillNode } from '../types.js';

export interface RetrievalResult<T> {
  item: T;
  rank: number;
  score: number;
}

export interface RetrievalStrategy<TQuery, TItem> {
  readonly name: string;
  rank(query: TQuery, pool: TItem[]): Promise<RetrievalResult<TItem>[]>;
}

export interface VectorSearchProvider {
  readonly name: string;
  rankBySimilarity<T>(queryVector: number[], pool: Array<{ item: T; embedding: number[] | null }>): Array<{ item: T; similarity: number }>;
}

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

export class StructuredSkillOverlapStrategy implements RetrievalStrategy<DynamicWeightingJob, DynamicWeightingCandidate> {
  readonly name = 'structured_skill_overlap';

  async rank(job: DynamicWeightingJob, pool: DynamicWeightingCandidate[]): Promise<RetrievalResult<DynamicWeightingCandidate>[]> {
    const required = job.required_skills || [];
    const scored = pool.map((candidate) => ({ item: candidate, score: jaccardSimilarity(required, candidate.skills || []) / 100 }));
    scored.sort((a, b) => b.score - a.score);
    return toRankedResults(scored);
  }
}

export class SemanticFacetStrategy implements RetrievalStrategy<DynamicWeightingJob, DynamicWeightingCandidate> {
  readonly name = 'semantic_facet';
  constructor(private readonly provider: VectorSearchProvider = new InMemoryCosineVectorSearchProvider()) {}

  async rank(job: DynamicWeightingJob, pool: DynamicWeightingCandidate[]): Promise<RetrievalResult<DynamicWeightingCandidate>[]> {
    if (!job.skills_embedding || job.skills_embedding.length === 0) {
      return toRankedResults(pool.map((item) => ({ item, score: 0 })));
    }
    const ranked = this.provider.rankBySimilarity(
      job.skills_embedding,
      pool.map((c) => ({ item: c, embedding: c.skills_embedding ?? null }))
    );
    return toRankedResults(ranked.map((r) => ({ item: r.item, score: r.similarity })));
  }
}

export class GraphExpandedSkillStrategy implements RetrievalStrategy<DynamicWeightingJob, DynamicWeightingCandidate> {
  readonly name = 'graph_expanded_skill';

  async rank(job: DynamicWeightingJob, pool: DynamicWeightingCandidate[]): Promise<RetrievalResult<DynamicWeightingCandidate>[]> {
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

export interface HybridRetrievalOptions {
  limit?: number;
  provider?: VectorSearchProvider;
}

export interface HybridRetrievalResult {
  candidate: DynamicWeightingCandidate;
  fusedScore: number;
  contributingStrategies: string[];
}

export async function hybridRetrieveCandidates(job: DynamicWeightingJob, pool: DynamicWeightingCandidate[], options: HybridRetrievalOptions = {}): Promise<HybridRetrievalResult[]> {
  if (pool.length === 0) return [];

  const strategies: RetrievalStrategy<DynamicWeightingJob, DynamicWeightingCandidate>[] = [
    new StructuredSkillOverlapStrategy(),
    new SemanticFacetStrategy(options.provider),
    new GraphExpandedSkillStrategy(),
  ];

  const rankings = await Promise.all(strategies.map((s) => s.rank(job, pool)));
  const fused = reciprocalRankFusion(rankings, strategies.map((s) => s.name), (c) => c.id);

  const results: HybridRetrievalResult[] = fused.map((f) => ({ candidate: f.item, fusedScore: f.fusedScore, contributingStrategies: f.contributingStrategies }));
  return options.limit ? results.slice(0, options.limit) : results;
}
