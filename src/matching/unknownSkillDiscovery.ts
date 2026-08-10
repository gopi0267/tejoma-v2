// Enterprise AI Matching Architecture, Phase 4 - Unknown Skill Discovery (architecture doc §5).
//
// A taxonomy that only grows when a human notices a gap always lags the industry. This module
// lets the Skill Intelligence Platform (Phase 1) notice its own blind spots and close them,
// mostly without a human in the loop - implementing the document's 7-stage pipeline:
//   1. Detection      - detectUnresolvedTokens()
//   2. Classification  - classifyToken() (LLM zero-shot, reuses the existing Gemini integration)
//   3. Semantic understanding - findNearestNeighbors() (reuses the existing BERT embedding service)
//   4. Relationship discovery - proposeRelationship()
//   5. Human verification (optional, confidence-gated) - discoverUnknownSkill()'s auto-promote branch
//   6. Knowledge base update - promoteToSkillNode()
//   7. Future automatic recognition - falls out for free: once a token is promoted to a real
//      skill_node, canonicalizeSkill() (Phase 1) finds it on every later parse, so nothing in this
//      module needs to re-detect it.
//
// CONFIDENCE, NEVER FROM AN LLM'S SELF-REPORTED NUMBER. Classification asks Gemini a binary
// question (is this a skill, yes/no) plus a category pick - never a confidence score. The actual
// confidence used to gate auto-promotion is computed from two concrete, real signals: the
// candidate skill's embedding similarity to its nearest already-known skill, and how many
// independent documents have now mentioned it (mirrors the architecture doc's own "confidence
// rising as more independent instances corroborate" language, and the exact "never trust a
// self-reported level alone" discipline already applied to Skill Proficiency's design). A token
// with zero embedding evidence and only one sighting NEVER auto-promotes, regardless of what
// classification says - matching this project's established "uncertainty resolves toward the
// safer estimate" pattern from the Confidence Architecture (Phase 1).
//
// THIS MODULE DOES NOT RUN BY DEFAULT ON THE HOT PATH. It's invoked as a background,
// fire-and-forget call after candidate/job creation (see discoverUnknownSkillsInBackground and
// its call sites in candidate.routes.ts/job.routes.ts) - never blocks or fails the request that
// triggered it, same resilience pattern already used for embedding indexing
// (embeddingIndex.ts's indexCandidateEmbeddingInBackground).

import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding } from '../algorithms/bert-embeddings.js';
import { cosineSimilarity } from '../utils/embeddings.js';
import { canonicalizeSkills, CATEGORY_TO_DOMAIN, domainFor } from './skillIntelligence.js';
import type { SkillDiscoveryNeighbor, SkillDiscoveryProposal, SkillDiscoveryStatus, SkillNode, SkillRelationshipType } from '../types.js';

// Same model parser.service.ts confirmed is actually reachable on the available API key(s) today
// (every other tier returns 404/429) - reused here rather than services.ts's gemini-3.5-flash,
// which parser.service.ts's own comment suggests may not currently be reachable at all.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('GEMINI_API_KEY is not defined - Unknown Skill Discovery will queue every candidate token for manual review instead of classifying');
      return null;
    }
    aiClient = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  }
  return aiClient;
}

// Confidence-gated automation threshold - "a tunable operating point, not fixed" per the
// architecture doc. Deliberately conservative: 0.75 requires a genuinely close semantic neighbor
// (or a moderately close one corroborated by several independent sightings) before auto-adding
// anything to the shared taxonomy without a human looking at it.
export const AUTO_PROMOTE_THRESHOLD = 0.75;
const NEIGHBOR_TOP_K = 5;
// Below this, a nearest neighbor is too dissimilar to responsibly name a relationship to at all -
// still recorded in nearest_neighbors for transparency, just not turned into a proposed edge.
const MIN_RELATIONSHIP_SIMILARITY = 0.5;
const MENTION_BONUS_PER_SIGHTING = 0.05;
const MENTION_BONUS_CAP = 0.2;

const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORY_TO_DOMAIN));

export function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ==================== STAGE 1: DETECTION ====================
// Any raw skill string that canonicalizeSkill (Phase 1) can't resolve - no exact match, no known
// alias - is a candidate for discovery. Blank/whitespace-only entries are never candidates.
export async function detectUnresolvedTokens(rawSkills: string[]): Promise<string[]> {
  const cleaned = (rawSkills || []).map((s) => (s || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const resolved = await canonicalizeSkills(cleaned);
  return cleaned.filter((_, i) => resolved[i] === null);
}

// ==================== STAGE 2: CLASSIFICATION ====================
export interface ClassificationResult {
  isSkill: boolean;
  category: string | null;
}

const CLASSIFICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isSkill: { type: Type.BOOLEAN },
    category: { type: Type.STRING, nullable: true },
  },
  required: ['isSkill'],
};

// Cloud Gemini calls hit transient network/429/503 blips that succeed on an immediate retry -
// the same observation parser.service.ts's own retry logic is built around. This call is much
// smaller/cheaper than a full resume parse, so a short, bounded retry (not parser.service.ts's
// full 3-retry/3-minute budget) is enough.
const MAX_CLASSIFICATION_RETRIES = 2;
const CLASSIFICATION_RETRY_DELAY_MS = 750;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns null (never throws) if Gemini is unreachable/unconfigured or every retry fails -
// callers must treat a null classification as "unknown, not as false" and never auto-promote on
// it (see discoverUnknownSkill).
export async function classifyToken(rawToken: string, contextText: string): Promise<ClassificationResult | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  for (let attempt = 0; attempt <= MAX_CLASSIFICATION_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Term: "${rawToken}"\nSurrounding resume/job-description context: "${(contextText || '').slice(0, 500)}"\n\nIs this term a real, named technical skill, tool, technology, framework, protocol, or professional methodology - the kind of thing that belongs in a skills taxonomy? Answer false for company names, generic buzzwords, or formatting artifacts. If true, classify it into exactly one of these categories: ${Array.from(KNOWN_CATEGORIES).join(', ')}.`,
        config: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: CLASSIFICATION_SCHEMA },
      });
      const text = response.text;
      if (!text) return null;
      const parsed = JSON.parse(text) as { isSkill?: boolean; category?: string | null };
      const category = parsed.category && KNOWN_CATEGORIES.has(parsed.category) ? parsed.category : null;
      return { isSkill: Boolean(parsed.isSkill), category };
    } catch (err: any) {
      if (attempt < MAX_CLASSIFICATION_RETRIES) {
        logger.debug({ err: err.message, rawToken, attempt }, 'Unknown Skill Discovery classification call failed, retrying');
        await sleep(CLASSIFICATION_RETRY_DELAY_MS);
        continue;
      }
      logger.debug({ err: err.message, rawToken }, 'Unknown Skill Discovery classification call failed after retries');
      return null;
    }
  }
  return null;
}

// ==================== STAGE 3: SEMANTIC UNDERSTANDING ====================
// Embeds the term + its surrounding context (not the bare term alone - context disambiguates a
// short, ambiguous token) and compares against every already-known skill node that has its own
// stored embedding (see backfillSkillNodeEmbeddings for populating those on already-seeded nodes).
export async function findNearestNeighbors(rawToken: string, contextText: string): Promise<SkillDiscoveryNeighbor[]> {
  const embedding = await generateEmbedding(`${rawToken}: ${contextText || ''}`.slice(0, 1000));
  if (!embedding) return [];

  const allNodes = await db.getAllSkillNodes();
  const withEmbeddings = allNodes.filter((n) => Array.isArray(n.embedding) && n.embedding!.length > 0);

  return withEmbeddings
    .map((n) => ({ skillNodeId: n.id, canonicalName: n.canonical_name, similarity: cosineSimilarity(embedding, n.embedding!) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, NEIGHBOR_TOP_K);
}

// ==================== STAGE 4: RELATIONSHIP DISCOVERY ====================
// RELATED_TO only, deliberately never PARENT_OF - a discovered term's place in the hierarchy
// isn't something embedding similarity alone can responsibly claim (skillIntelligence.ts's own
// PARENT_OF edges are mechanically derived from the dictionary's category tags, not inferred from
// similarity). RELATED_TO ("known alternative/adjacent, no hierarchy claimed") is exactly the
// relationship type this evidence supports.
export function proposeRelationship(neighbors: SkillDiscoveryNeighbor[]): { type: SkillRelationshipType; relatedSkillId: number } | null {
  const top = neighbors[0];
  if (!top || top.similarity < MIN_RELATIONSHIP_SIMILARITY) return null;
  return { type: 'RELATED_TO', relatedSkillId: top.skillNodeId };
}

// ==================== CONFIDENCE ====================
export function computeConfidence(neighbors: SkillDiscoveryNeighbor[], mentionCount: number): number {
  const neighborScore = neighbors[0]?.similarity ?? 0;
  const mentionBonus = Math.min(MENTION_BONUS_CAP, Math.max(0, mentionCount - 1) * MENTION_BONUS_PER_SIGHTING);
  return Math.max(0, Math.min(1, neighborScore * 0.8 + mentionBonus));
}

// ==================== STAGE 6: KNOWLEDGE BASE UPDATE ====================
async function promoteToSkillNode(input: {
  rawToken: string;
  proposedCategory: string | null;
  confidence: number;
  relationshipType: SkillRelationshipType | null;
  relatedSkillId: number | null;
}): Promise<SkillNode | null> {
  const category = input.proposedCategory ?? 'general';
  const node = await db.upsertSkillNode({
    canonical_name: input.rawToken,
    category,
    technology_domain: domainFor(category),
    aliases: [input.rawToken],
    is_emerging: true,
    source: 'unknown_skill_discovery',
    confidence: input.confidence,
  });
  if (node && input.relationshipType && input.relatedSkillId) {
    // Bidirectional, same convention already used for RELATED_TO_GROUPS seeding (Phase 1).
    await db.upsertSkillEdge(node.id, input.relatedSkillId, input.relationshipType, input.confidence, 'unknown_skill_discovery');
    await db.upsertSkillEdge(input.relatedSkillId, node.id, input.relationshipType, input.confidence, 'unknown_skill_discovery');
  }
  return node;
}

// ==================== ORCHESTRATION (stages 1-6, per token) ====================
export interface DiscoveryOutcome {
  status: SkillDiscoveryStatus;
  proposalId: number;
  promotedSkillNodeId: number | null;
}

export async function discoverUnknownSkill(rawToken: string, contextText: string, sourceType: 'resume' | 'jd'): Promise<DiscoveryOutcome | null> {
  const normalized = normalizeToken(rawToken);
  if (!normalized) return null;

  const existing = await db.getSkillDiscoveryProposalByToken(normalized);

  if (existing) {
    if (existing.status === 'rejected' || existing.status === 'not_a_skill') {
      // Never reclassify a token already ruled out (by a reviewer or by the pipeline itself) -
      // just record that it was seen again, without spending another LLM/embedding call on it.
      await db.updateSkillDiscoveryProposal(existing.id, { mention_count: existing.mention_count + 1 });
      return { status: existing.status, proposalId: existing.id, promotedSkillNodeId: null };
    }
    if (existing.status === 'pending') {
      const newMentionCount = existing.mention_count + 1;
      const newConfidence = computeConfidence(existing.nearest_neighbors ?? [], newMentionCount);
      const canAutoPromote = existing.is_skill === true && newConfidence >= AUTO_PROMOTE_THRESHOLD;
      if (canAutoPromote) {
        const node = await promoteToSkillNode({
          rawToken: existing.raw_token, proposedCategory: existing.proposed_category, confidence: newConfidence,
          relationshipType: existing.proposed_relationship_type, relatedSkillId: existing.proposed_related_skill_id,
        });
        await db.updateSkillDiscoveryProposal(existing.id, {
          mention_count: newMentionCount, confidence: newConfidence, status: 'auto_promoted', promoted_skill_node_id: node?.id ?? null,
        });
        return { status: 'auto_promoted', proposalId: existing.id, promotedSkillNodeId: node?.id ?? null };
      }
      await db.updateSkillDiscoveryProposal(existing.id, { mention_count: newMentionCount, confidence: newConfidence });
      return { status: 'pending', proposalId: existing.id, promotedSkillNodeId: null };
    }
    // 'auto_promoted' / 'approved' - a real skill_node already exists for this token, so
    // detectUnresolvedTokens would no longer flag it on a later parse. Reaching here at all means
    // this call raced an earlier one for the same token; nothing more to do.
    return { status: existing.status, proposalId: existing.id, promotedSkillNodeId: existing.promoted_skill_node_id };
  }

  // First sighting - run the full pipeline. Classification and embedding search have no shared
  // dependency, so they run concurrently.
  const [classification, neighbors] = await Promise.all([
    classifyToken(rawToken, contextText),
    findNearestNeighbors(rawToken, contextText),
  ]);

  if (classification !== null && classification.isSkill === false) {
    const created = await db.createSkillDiscoveryProposal({
      raw_token: rawToken, normalized_token: normalized, source_type: sourceType, context_text: (contextText || '').slice(0, 1000),
      is_skill: false, proposed_category: null, nearest_neighbors: neighbors,
      proposed_relationship_type: null, proposed_related_skill_id: null, confidence: 0, status: 'not_a_skill',
    });
    return created ? { status: 'not_a_skill', proposalId: created.id, promotedSkillNodeId: null } : null;
  }

  const relationship = proposeRelationship(neighbors);
  const confidence = computeConfidence(neighbors, 1);
  // Never auto-promote on a null (unreachable/unconfigured) classification - an unclassified
  // token hasn't been verified as an actual skill at all, regardless of how similar its embedding
  // looks to something else. Queues for review instead.
  const canAutoPromote = classification !== null && classification.isSkill === true && confidence >= AUTO_PROMOTE_THRESHOLD;

  const created = await db.createSkillDiscoveryProposal({
    raw_token: rawToken, normalized_token: normalized, source_type: sourceType, context_text: (contextText || '').slice(0, 1000),
    is_skill: classification?.isSkill ?? null, proposed_category: classification?.category ?? null,
    nearest_neighbors: neighbors,
    proposed_relationship_type: relationship?.type ?? null, proposed_related_skill_id: relationship?.relatedSkillId ?? null,
    confidence, status: canAutoPromote ? 'auto_promoted' : 'pending',
  });
  if (!created) return null;

  if (canAutoPromote) {
    const node = await promoteToSkillNode({
      rawToken, proposedCategory: classification!.category, confidence,
      relationshipType: relationship?.type ?? null, relatedSkillId: relationship?.relatedSkillId ?? null,
    });
    await db.updateSkillDiscoveryProposal(created.id, { promoted_skill_node_id: node?.id ?? null });
    return { status: 'auto_promoted', proposalId: created.id, promotedSkillNodeId: node?.id ?? null };
  }

  return { status: 'pending', proposalId: created.id, promotedSkillNodeId: null };
}

// ==================== TOP-LEVEL ENTRY POINTS ====================
// Sequential, not parallel, per token - deliberately bounds concurrent LLM/embedding calls per
// ingestion event so one resume with many unrecognized tokens can't fire dozens of concurrent
// Gemini/embedding requests at once.
//
// Tier 0 migration (Batch 27) - return type widened from Promise<void> to Promise<DiscoveryOutcome[]>,
// purely additive: every existing call site (discoverUnknownSkillsInBackground below) already
// discards the return value via .catch()-only chaining, so this changes nothing about real
// behavior. Added so src/skillDiscoveryServiceShadow.ts can log this service's own real outcomes
// alongside matching-skill-discovery-service's independently-computed ones for operator comparison,
// without a second, duplicate call into this pipeline (which would double-count mention_count on
// any token this call already touched - a real data-integrity risk, not just redundant work).
export async function discoverUnknownSkills(rawSkills: string[], contextText: string, sourceType: 'resume' | 'jd'): Promise<DiscoveryOutcome[]> {
  const unresolved = await detectUnresolvedTokens(rawSkills);
  const outcomes: DiscoveryOutcome[] = [];
  for (const token of unresolved) {
    try {
      const outcome = await discoverUnknownSkill(token, contextText, sourceType);
      if (outcome) outcomes.push(outcome);
    } catch (err: any) {
      logger.warn({ err: err.message, token }, 'Unknown Skill Discovery pipeline failed for one token');
    }
  }
  return outcomes;
}

// Fire-and-forget wrapper for use in request handlers - discovery must never block or fail a
// candidate/job creation response, same resilience pattern as embeddingIndex.ts's
// indexCandidateEmbeddingInBackground.
export function discoverUnknownSkillsInBackground(rawSkills: string[], contextText: string, sourceType: 'resume' | 'jd'): void {
  discoverUnknownSkills(rawSkills, contextText, sourceType).catch((err) => logger.warn({ err: err.message }, 'Unknown Skill Discovery background run failed'));
}

// ==================== STAGE 5: HUMAN VERIFICATION (manual path) ====================
export async function approveProposal(proposalId: number, reviewerId: number): Promise<SkillNode | null> {
  const proposal = await db.getSkillDiscoveryProposalById(proposalId);
  if (!proposal || proposal.status !== 'pending') return null;
  const node = await promoteToSkillNode({
    rawToken: proposal.raw_token, proposedCategory: proposal.proposed_category,
    confidence: proposal.confidence ?? AUTO_PROMOTE_THRESHOLD, // a human explicitly approved it - treat as at least the auto-promote bar
    relationshipType: proposal.proposed_relationship_type, relatedSkillId: proposal.proposed_related_skill_id,
  });
  await db.updateSkillDiscoveryProposal(proposalId, {
    status: 'approved', promoted_skill_node_id: node?.id ?? null, reviewed_at: new Date().toISOString(), reviewed_by: reviewerId,
  });
  return node;
}

export async function rejectProposal(proposalId: number, reviewerId: number): Promise<SkillDiscoveryProposal | null> {
  const proposal = await db.getSkillDiscoveryProposalById(proposalId);
  if (!proposal || proposal.status !== 'pending') return null;
  return db.updateSkillDiscoveryProposal(proposalId, { status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewerId });
}

// ==================== OPERATIONAL: BACKFILL ====================
// One-time (or periodically re-run) task, same category as skillIntelligence.ts's
// computeCooccurrenceEdges - not part of any live request path. Embeds every skill_nodes row that
// doesn't yet have one, so findNearestNeighbors has something real to compare newly-discovered
// terms against (every node seeded before this phase has embedding = null until this runs).
export async function backfillSkillNodeEmbeddings(): Promise<{ embedded: number; skipped: number }> {
  const allNodes = await db.getAllSkillNodes();
  let embedded = 0;
  let skipped = 0;
  for (const node of allNodes) {
    if (Array.isArray(node.embedding) && node.embedding.length > 0) {
      skipped++;
      continue;
    }
    const embedding = await generateEmbedding(`${node.canonical_name} (${node.category})`);
    if (embedding) {
      await db.updateSkillNodeEmbedding(node.id, embedding);
      embedded++;
    } else {
      skipped++;
    }
  }
  logger.info({ embedded, skipped }, 'Skill node embedding backfill complete');
  return { embedded, skipped };
}
