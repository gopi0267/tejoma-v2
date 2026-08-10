// Ported byte-identical from the monolith's src/matching/reasoning/semanticReasoning.ts (Batch 26).
// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 1: Semantic Reasoning.
//
// Resolves a raw piece of text ("LLM", "worked with transformers") to a canonical skill_nodes
// row, three tiers deep, never guessing past what the graph actually supports:
//   1. Exact match on skill_nodes.canonical_name
//   2. Alias match on skill_nodes.aliases[] (both handled by the existing db.findSkillNodeByAlias
//      / canonicalizeSkill primitive from Phase 1 - reused here, not reimplemented)
//   3. Embedding nearest-neighbor over skill_nodes.embedding (populated by Phase 4's
//      backfillSkillNodeEmbeddings), same generateEmbedding + cosineSimilarity pattern already
//      proven in unknownSkillDiscovery.ts's findNearestNeighbors - reused rather than
//      reimplemented, scoped down to "best single match" instead of a top-K neighbor list.
// If none of the three tiers resolve, this returns null - it never fabricates a resolution.
//
// No Gemini call here. The original Phase 9 spec allowed one ("Gemini, is 'LangMem' close to
// 'LangChain'?"), but the embedding-neighbor tier already answers exactly that question
// deterministically and auditably (a numeric similarity score against a real stored vector) -
// adding an LLM call on top would make this LESS auditable, not more, which cuts against this
// whole phase's own design principle (§5.1 Decision 4/12: every conclusion must carry an
// inspectable evidence chain). Skipped as a deliberate scope correction, not an oversight.

import { db } from '../../db.js';
import { generateEmbedding } from '../../algorithms/bert-embeddings.js';
import { cosineSimilarity } from '../../utils/vectorMath.js';
import type { EvidenceStep } from '../../types.js';

// Below unknownSkillDiscovery's 0.5 RELATED_TO-proposal bar on purpose: that threshold answers
// "are these two DIFFERENT skills related enough to link", this answers the stricter "is this
// basically the SAME skill, just phrased differently" - matching the spec's own worked example
// (0.81 similarity -> confidence 0.8).
const EMBEDDING_NEIGHBOR_MIN_SIMILARITY = 0.75;

export type SemanticResolutionMethod = 'exact' | 'alias' | 'embedding_neighbor';

export interface SemanticInference {
  originalText: string;
  resolvedTo: string;
  skillNodeId: number;
  method: SemanticResolutionMethod;
  confidence: number;
  reasoning: string;
  evidenceChain: EvidenceStep[];
}

export async function semanticallyResolve(inputText: string): Promise<SemanticInference | null> {
  const trimmed = (inputText || '').trim();
  if (!trimmed) return null;

  const direct = await db.findSkillNodeByAlias(trimmed);
  if (direct) {
    const isExact = direct.canonical_name.toLowerCase() === trimmed.toLowerCase();
    const method: SemanticResolutionMethod = isExact ? 'exact' : 'alias';
    const confidence = isExact ? 1.0 : 0.95;
    return {
      originalText: trimmed,
      resolvedTo: direct.canonical_name,
      skillNodeId: direct.id,
      method,
      confidence,
      reasoning: isExact
        ? `"${trimmed}" is the canonical name of a known skill.`
        : `"${trimmed}" is a known alias of "${direct.canonical_name}".`,
      evidenceChain: [
        {
          step: 1,
          statement: isExact
            ? `"${trimmed}" matches skill_nodes.canonical_name exactly`
            : `"${trimmed}" matches an entry in skill_nodes.aliases for "${direct.canonical_name}"`,
          source: 'skill_graph',
          edge: null,
          verified: true,
        },
      ],
    };
  }

  const embedding = await generateEmbedding(trimmed);
  if (!embedding) return null;

  const allNodes = await db.getAllSkillNodes();
  const withEmbeddings = allNodes.filter((n) => Array.isArray(n.embedding) && n.embedding!.length > 0);
  if (withEmbeddings.length === 0) return null;

  let best: { node: (typeof withEmbeddings)[number]; similarity: number } | null = null;
  for (const node of withEmbeddings) {
    const similarity = cosineSimilarity(embedding, node.embedding!);
    if (!best || similarity > best.similarity) best = { node, similarity };
  }
  if (!best || best.similarity < EMBEDDING_NEIGHBOR_MIN_SIMILARITY) return null;

  return {
    originalText: trimmed,
    resolvedTo: best.node.canonical_name,
    skillNodeId: best.node.id,
    method: 'embedding_neighbor',
    confidence: Number((best.similarity * 0.9).toFixed(4)),
    reasoning: `"${trimmed}" has no exact/alias match, but its embedding is a close neighbor (similarity ${best.similarity.toFixed(2)}) of "${best.node.canonical_name}".`,
    evidenceChain: [
      {
        step: 1,
        statement: `"${trimmed}" embedding nearest neighbor is "${best.node.canonical_name}" (cosine similarity ${best.similarity.toFixed(4)})`,
        source: 'skill_graph_embeddings',
        edge: null,
        verified: true,
      },
    ],
  };
}
