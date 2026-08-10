/**
 * Shadow-validation for JD Parser Service (Batch 15), following the exact same discipline as
 * src/shadowRead.ts (Phase 11 section 12's methodology: extraction -> dual-write -> shadow-read
 * -> validate -> cutover -> rollback -> legacy removal). For a real parse request the monolith is
 * already handling, also ask jd-parser-service to parse the same text and compare results,
 * without ever using the new service's answer for anything user-facing.
 *
 * Lower a priori risk than shadowRead.ts's login comparison: src/jd-parser/ was extracted as a
 * verbatim file copy (jd-parser-service/src/jd-parser/), not a rewrite, so a divergence here most
 * likely means an environment difference (zod version, JD_NLP_SERVICE_URL reachability/latency
 * from the new service's network position) rather than a logic bug. Still worth running before
 * any real cutover - "the code is identical" is a claim this module actually verifies under real
 * traffic, not an assumption to trust blindly.
 *
 * HARD RULES - identical to src/dualWrite.ts's and src/shadowRead.ts's:
 *   1. Disabled by default (SHADOW_JD_PARSER_ENABLED must be exactly 'true').
 *   2. Never affects the response already sent to the real user - only ever invoked via
 *      `res.on('finish', ...)`, strictly after the monolith's own response has already gone out.
 *   3. Never throws. A shadow-call failure (timeout, service down) is logged at warn, not error -
 *      it says nothing about correctness, only that the comparison itself was incomplete.
 */
import { logger } from './utils/logger.js';
import type { JobDescriptionParseResult } from './jd-parser/types.js';

export const SHADOW_JD_PARSER_ENABLED = process.env.SHADOW_JD_PARSER_ENABLED === 'true';

const JD_PARSER_SERVICE_URL = process.env.JD_PARSER_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 5000;

// Fields excluded from equality comparison because they're expected to legitimately differ
// between a local function call and a network round-trip, not because they're unimportant.
const NON_COMPARABLE_TOP_LEVEL_KEYS = new Set(['parseTimeMs']);

function diffParsedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const mismatched: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) mismatched.push(key);
  }
  return mismatched;
}

/**
 * Re-runs the same JD parse against jd-parser-service and compares the result to what the
 * monolith already computed (and already responded to the real user with). Fire-and-forget by
 * design - call this without awaiting it.
 *
 * `accessToken` is the caller's own already-verified access_token cookie value (the monolith's
 * route already ran requireAuth before this is ever called) - forwarded as a Cookie header so the
 * shadow call passes jd-parser-service's own requireAuth exactly as a real proxied request
 * through API Gateway would (its config/env.ts's header comment: same HS256/JWT_SECRET scheme).
 */
export async function shadowParseJobDescription(sourceText: string, monolithResult: JobDescriptionParseResult, accessToken: string): Promise<void> {
  if (!SHADOW_JD_PARSER_ENABLED) return;
  if (!JD_PARSER_SERVICE_URL) {
    logger.warn('SHADOW_JD_PARSER_ENABLED is true but JD_PARSER_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${JD_PARSER_SERVICE_URL}/api/jobs/parse-description`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `access_token=${accessToken}`,
      },
      body: JSON.stringify({ text: sourceText }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Shadow-validation call to jd-parser-service returned a non-OK status - comparison skipped');
      return;
    }

    const body = (await response.json()) as { success: boolean; parsed: Record<string, unknown> };
    if (!body.success) {
      logger.error({ monolithParsed: monolithResult.parsed }, 'SHADOW-VALIDATION DIVERGENCE: jd-parser-service rejected text the monolith parsed successfully');
      return;
    }

    const mismatchedFields = diffParsedFields(monolithResult.parsed as unknown as Record<string, unknown>, body.parsed);
    const comparableMismatches = mismatchedFields.filter((f) => !NON_COMPARABLE_TOP_LEVEL_KEYS.has(f));

    if (comparableMismatches.length > 0) {
      logger.error(
        { mismatchedFields: comparableMismatches, monolith: monolithResult.parsed, jdParserService: body.parsed },
        'SHADOW-VALIDATION DIVERGENCE: monolith and jd-parser-service parsed the same text differently'
      );
      return;
    }

    logger.debug('Shadow-validation agreement: jd-parser-service matched the monolith for this parse');
  } catch (error: any) {
    logger.warn({ err: error?.message }, 'Shadow-validation call to jd-parser-service failed - comparison skipped for this parse');
  }
}
