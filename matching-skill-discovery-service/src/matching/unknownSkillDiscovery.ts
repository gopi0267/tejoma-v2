// Ported from the monolith's src/matching/unknownSkillDiscovery.ts (Batch 27). Enterprise AI
// Matching Architecture, Phase 4 - Unknown Skill Discovery (architecture doc §5).
//
// A taxonomy that only grows when a human notices a gap always lags the industry. This module
// lets the Skill Intelligence Platform notice its own blind spots and close them, mostly without a
// human in the loop - implementing the document's 7-stage pipeline:
//   1. Detection      - detectUnresolvedTokens()
//   2. Classification  - classifyToken() (LLM zero-shot, reuses the existing Gemini integration)
//   3. Semantic understanding - findNearestNeighbors() (reuses the existing BERT embedding service)
//   4. Relationship discovery - proposeRelationship()
//   5. Human verification (optional, confidence-gated) - discoverUnknownSkill()'s auto-promote branch
//   6. Knowledge base update - promoteToSkillNode()
//   7. Future automatic recognition - falls out for free once a token is promoted.
//
// ONE deliberate divergence from the monolith's original, and only one: promoteToSkillNode no
// longer writes skill_nodes/skill_edges locally (db.upsertSkillNode/upsertSkillEdge here are
// dual-write TARGETS only, never called by this service's own logic - see db.ts's header comment).
// It instead proxies the write to the monolith's new /internal/skill-discovery/promote endpoint,
// which wraps the monolith's own UNCHANGED db.upsertSkillNode/upsertSkillEdge. Every other line of
// business logic - detection, classification, confidence, relationship proposal, the pipeline's
// branching - is byte-identical to the monolith's original.
//
// CONFIDENCE, NEVER FROM AN LLM'S SELF-REPORTED NUMBER - see computeConfidence.

import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding } from '../algorithms/bert-embeddings.js';
import { cosineSimilarity } from '../utils/vectorMath.js';
import { canonicalizeSkills, CATEGORY_TO_DOMAIN, domainFor } from './skillLookup.js';
import { monolithClient } from '../services/monolithClient.js';
import { GEMINI_API_KEY } from '../config/env.js';
import type { SkillDiscoveryNeighbor, SkillDiscoveryProposal, SkillDiscoveryStatus, SkillNode, SkillRelationshipType } from '../types.js';

const GEMINI_MODEL = 'gemini-flash-lite-latest';

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    if (!GEMINI_API_KEY) {
      logger.warn('GEMINI_API_KEY is not defined - Unknown Skill Discovery will queue every candidate token for manual review instead of classifying');
      return null;
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  }
  return aiClient;
}

export const AUTO_PROMOTE_THRESHOLD = 0.75;
const NEIGHBOR_TOP_K = 5;
const MIN_RELATIONSHIP_SIMILARITY = 0.5;
const MENTION_BONUS_PER_SIGHTING = 0.05;
const MENTION_BONUS_CAP = 0.2;

const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORY_TO_DOMAIN));

export function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ==================== STAGE 1: DETECTION ====================
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

const MAX_CLASSIFICATION_RETRIES = 2;
const CLASSIFICATION_RETRY_DELAY_MS = 750;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
// Divergence from the monolith's original: proxies to the monolith instead of writing
// skill_nodes/skill_edges locally - see this file's header comment.
async function promoteToSkillNode(input: {
  rawToken: string;
  proposedCategory: string | null;
  confidence: number;
  relationshipType: SkillRelationshipType | null;
  relatedSkillId: number | null;
}): Promise<SkillNode | null> {
  return monolithClient.promoteSkillNode(input);
}

// ==================== ORCHESTRATION (stages 1-6, per token) ====================
export interface DiscoveryOutcome {
  status: SkillDiscoveryStatus;
  proposalId: number;
  promotedSkillNodeId: number | null;
}

/**
 * `skipPromotion` (new parameter, not in the monolith's original signature - additive only):
 * when true, every branch that would otherwise call promoteToSkillNode (and therefore reach out to
 * the monolith to create a REAL skill_nodes/skill_edges row) still computes and records the exact
 * same status/confidence in this service's own skill_discovery_proposals row, but skips the actual
 * external write. Used ONLY by the shadow-validation entry point (routes/skillDiscovery.routes.ts's
 * POST /internal/discover) - classification is a non-deterministic LLM call, so an independent
 * shadow computation could otherwise decide to auto-promote when the monolith's own real,
 * authoritative run did not, causing a real, uncoordinated side effect from what must be a
 * comparison-only path (the same "shadow calls never affect real behavior" rule every other shadow
 * module in this migration follows). The real, human-triggered approveProposal path below never
 * sets this - an explicit admin approval is always meant to promote for real.
 */
export async function discoverUnknownSkill(rawToken: string, contextText: string, sourceType: 'resume' | 'jd', skipPromotion = false): Promise<DiscoveryOutcome | null> {
  const normalized = normalizeToken(rawToken);
  if (!normalized) return null;

  const existing = await db.getSkillDiscoveryProposalByToken(normalized);

  if (existing) {
    if (existing.status === 'rejected' || existing.status === 'not_a_skill') {
      await db.updateSkillDiscoveryProposal(existing.id, { mention_count: existing.mention_count + 1 });
      return { status: existing.status, proposalId: existing.id, promotedSkillNodeId: null };
    }
    if (existing.status === 'pending') {
      const newMentionCount = existing.mention_count + 1;
      const newConfidence = computeConfidence(existing.nearest_neighbors ?? [], newMentionCount);
      const canAutoPromote = existing.is_skill === true && newConfidence >= AUTO_PROMOTE_THRESHOLD;
      if (canAutoPromote) {
        const node = skipPromotion
          ? null
          : await promoteToSkillNode({
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
    return { status: existing.status, proposalId: existing.id, promotedSkillNodeId: existing.promoted_skill_node_id };
  }

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
    const node = skipPromotion
      ? null
      : await promoteToSkillNode({
          rawToken, proposedCategory: classification!.category, confidence,
          relationshipType: relationship?.type ?? null, relatedSkillId: relationship?.relatedSkillId ?? null,
        });
    await db.updateSkillDiscoveryProposal(created.id, { promoted_skill_node_id: node?.id ?? null });
    return { status: 'auto_promoted', proposalId: created.id, promotedSkillNodeId: node?.id ?? null };
  }

  return { status: 'pending', proposalId: created.id, promotedSkillNodeId: null };
}

// ==================== TOP-LEVEL ENTRY POINT ====================
// Sequential, not parallel, per token - deliberately bounds concurrent LLM/embedding calls per
// ingestion event, same as the monolith's original.
export async function discoverUnknownSkills(rawSkills: string[], contextText: string, sourceType: 'resume' | 'jd', skipPromotion = false): Promise<DiscoveryOutcome[]> {
  const unresolved = await detectUnresolvedTokens(rawSkills);
  const outcomes: DiscoveryOutcome[] = [];
  for (const token of unresolved) {
    try {
      const outcome = await discoverUnknownSkill(token, contextText, sourceType, skipPromotion);
      if (outcome) outcomes.push(outcome);
    } catch (err: any) {
      logger.warn({ err: err.message, token }, 'Unknown Skill Discovery pipeline failed for one token');
    }
  }
  return outcomes;
}

// ==================== STAGE 5: HUMAN VERIFICATION (manual path) ====================
// Never skips promotion - an explicit admin approval via POST /api/skills/discovery/:id/approve
// always promotes for real.
export async function approveProposal(proposalId: number, reviewerId: number): Promise<SkillNode | null> {
  const proposal = await db.getSkillDiscoveryProposalById(proposalId);
  if (!proposal || proposal.status !== 'pending') return null;
  const node = await promoteToSkillNode({
    rawToken: proposal.raw_token, proposedCategory: proposal.proposed_category,
    confidence: proposal.confidence ?? AUTO_PROMOTE_THRESHOLD,
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
