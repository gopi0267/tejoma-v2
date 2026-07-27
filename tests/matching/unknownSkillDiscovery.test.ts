import { describe, it, expect } from 'vitest';
import { normalizeToken, proposeRelationship, computeConfidence, AUTO_PROMOTE_THRESHOLD } from '../../src/matching/unknownSkillDiscovery.js';
import type { SkillDiscoveryNeighbor } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 4 - Unknown Skill Discovery. Pure functions, no DB/
// network dependency - detectUnresolvedTokens/classifyToken/findNearestNeighbors/
// discoverUnknownSkill/promoteToSkillNode/backfillSkillNodeEmbeddings need a real DB and/or the
// Python ML service and are covered by the integration test pass instead.

function makeNeighbor(overrides: Partial<SkillDiscoveryNeighbor> = {}): SkillDiscoveryNeighbor {
  return { skillNodeId: 1, canonicalName: 'LangChain', similarity: 0.6, ...overrides };
}

describe('normalizeToken', () => {
  it('lowercases and trims', () => {
    expect(normalizeToken('  LangMem  ')).toBe('langmem');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeToken('Model   Context   Protocol')).toBe('model context protocol');
  });

  it('is stable under repeated normalization (idempotent)', () => {
    const once = normalizeToken('GraphRAG');
    expect(normalizeToken(once)).toBe(once);
  });
});

describe('proposeRelationship', () => {
  it('proposes RELATED_TO the top neighbor when similarity clears the minimum bar', () => {
    const result = proposeRelationship([makeNeighbor({ skillNodeId: 42, similarity: 0.6 })]);
    expect(result).toEqual({ type: 'RELATED_TO', relatedSkillId: 42 });
  });

  it('never proposes a relationship below the minimum similarity - insufficient evidence to name one', () => {
    const result = proposeRelationship([makeNeighbor({ similarity: 0.3 })]);
    expect(result).toBeNull();
  });

  it('returns null when there are no neighbors at all', () => {
    expect(proposeRelationship([])).toBeNull();
  });

  it('never proposes PARENT_OF - embedding similarity alone cannot responsibly claim a hierarchy', () => {
    const result = proposeRelationship([makeNeighbor({ similarity: 0.99 })]);
    expect(result?.type).toBe('RELATED_TO');
  });
});

describe('computeConfidence', () => {
  it('is 0 with no neighbors and only one sighting - never auto-promotes on zero evidence', () => {
    const confidence = computeConfidence([], 1);
    expect(confidence).toBe(0);
    expect(confidence).toBeLessThan(AUTO_PROMOTE_THRESHOLD);
  });

  it('scales with the top neighbor similarity', () => {
    const low = computeConfidence([makeNeighbor({ similarity: 0.3 })], 1);
    const high = computeConfidence([makeNeighbor({ similarity: 0.9 })], 1);
    expect(high).toBeGreaterThan(low);
  });

  it('rises with repeated independent sightings, but the bonus is capped', () => {
    const oneSighting = computeConfidence([makeNeighbor({ similarity: 0.5 })], 1);
    const manySightings = computeConfidence([makeNeighbor({ similarity: 0.5 })], 20);
    expect(manySightings).toBeGreaterThan(oneSighting);
    expect(manySightings).toBeLessThanOrEqual(1);
  });

  it('a very high neighbor similarity alone can clear the auto-promote threshold', () => {
    const confidence = computeConfidence([makeNeighbor({ similarity: 1.0 })], 1);
    expect(confidence).toBeGreaterThanOrEqual(AUTO_PROMOTE_THRESHOLD);
  });

  it('a middling similarity needs mention-count corroboration to clear the threshold', () => {
    const single = computeConfidence([makeNeighbor({ similarity: 0.7 })], 1);
    const corroborated = computeConfidence([makeNeighbor({ similarity: 0.7 })], 10);
    expect(single).toBeLessThan(AUTO_PROMOTE_THRESHOLD);
    expect(corroborated).toBeGreaterThanOrEqual(AUTO_PROMOTE_THRESHOLD);
  });

  it('never exceeds 1 or drops below 0', () => {
    expect(computeConfidence([makeNeighbor({ similarity: 1.0 })], 1000)).toBeLessThanOrEqual(1);
    expect(computeConfidence([makeNeighbor({ similarity: -1 })], 0)).toBeGreaterThanOrEqual(0);
  });
});
