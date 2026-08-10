/**
 * HTTP client for the monolith's /internal/skill-discovery/* API (Batch 27) - the one write this
 * service doesn't own. skill_nodes/skill_edges remain the monolith's authoritative tables (same
 * contract matching-reasoning-service established in Batch 26); this service's own promotion logic
 * proxies the actual write here instead of calling its own (dual-write-target-only) db.upsertSkillNode.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount, monolithProxyDuration } from '../utils/metrics.js';
import type { SkillRelationshipType } from '../types.js';

const REQUEST_TIMEOUT_MS = 10000;

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/skill-discovery${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      throw new MonolithProxyError(res.status, body);
    }
    monolithProxyCount.inc({ target, outcome: 'success' });
    return body as T;
  } catch (error) {
    if (!(error instanceof MonolithProxyError)) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
      // Raw network/timeout failures must also surface as MonolithProxyError - see
      // recruiting-service's monolithClient.ts (Batch 19) for the exact bug this avoids.
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

export interface PromotedSkillNode {
  id: number;
  canonical_name: string;
  category: string;
  technology_domain: string | null;
  aliases: string[];
  popularity_score: number;
  confidence: number;
  is_deprecated: boolean;
  is_emerging: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

/**
 * Wraps the monolith's own, unchanged db.upsertSkillNode/db.upsertSkillEdge (via a new
 * /internal/skill-discovery/promote route) - the actual skill-graph write this service never
 * performs itself. Returns null (never throws) on failure - the caller already has its own
 * proposal row safely stored regardless of whether promotion succeeds, same resilience contract
 * the monolith's own promoteToSkillNode has always had (its db.upsertSkillNode/upsertSkillEdge
 * calls already catch and log internally, returning null rather than throwing).
 */
export async function promoteSkillNode(input: {
  rawToken: string;
  proposedCategory: string | null;
  confidence: number;
  relationshipType: SkillRelationshipType | null;
  relatedSkillId: number | null;
}): Promise<PromotedSkillNode | null> {
  try {
    const result = await call<{ skill_node: PromotedSkillNode | null }>('promote', '/promote', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.skill_node;
  } catch (error: any) {
    logger.warn({ err: error?.message, rawToken: input.rawToken }, 'Promotion proxy call to monolith failed');
    return null;
  }
}

export const monolithClient = { promoteSkillNode };
