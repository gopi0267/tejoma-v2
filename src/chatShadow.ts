/**
 * Shadow-validation for Chat Service (Batch 17), following the same discipline as
 * src/shadowRead.ts / src/jdParserShadow.ts / src/candidateShadow.ts (Phase 11 section 12's
 * methodology), with one necessary difference from all three: chat replies are LLM-generated
 * text (temperature 0.3) - two independent calls with an identical prompt will not produce
 * byte-identical wording even when both sides are working correctly. Comparing `reply` strictly
 * would report false-positive "divergence" on every single request, which would make this
 * mechanism worthless (real problems would drown in expected noise).
 *
 * What this compares instead: the `sources` array - which knowledge-base chunks were retrieved
 * (source_type, source_id, and score rounded to avoid float-noise false positives). That part IS
 * deterministic (same query text, same knowledge base, same embedding model, same cosine-
 * similarity math) - a real divergence there means the two services' knowledge bases have drifted
 * apart, which is exactly the kind of problem this mechanism exists to catch. HTTP status is also
 * compared. The generated `reply` text itself is intentionally never compared.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_CHAT_ENABLED must be exactly 'true').
 *   2. Never affects the response already sent to the real user - only ever invoked via
 *      `res.on('finish', ...)`, strictly after the monolith's own response has already gone out.
 *   3. Never throws. A shadow-call failure is logged at warn, not error.
 */
import { logger } from './utils/logger.js';

export const SHADOW_CHAT_ENABLED = process.env.SHADOW_CHAT_ENABLED === 'true';

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 20000; // real Gemini calls - more generous than the other shadow modules

interface ChatSource {
  source_type: string;
  source_id: number;
  relevance: number;
}

function normalizeSources(sources: ChatSource[]): string[] {
  return sources
    .map((s) => `${s.source_type}:${s.source_id}:${s.relevance.toFixed(2)}`)
    .sort();
}

/**
 * Re-issues the same chat request against Chat Service and compares the retrieved sources (never
 * the generated reply text - see header comment) to what the monolith already computed. Accepts
 * the caller's already-verified access_token cookie value, forwarded so the shadow call passes
 * Chat Service's own requireAuth exactly as a real proxied request through API Gateway would.
 */
export async function shadowChat(message: string, history: unknown, monolithStatus: number, monolithSources: ChatSource[], accessToken: string): Promise<void> {
  if (!SHADOW_CHAT_ENABLED) return;
  if (!CHAT_SERVICE_URL) {
    logger.warn('SHADOW_CHAT_ENABLED is true but CHAT_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${CHAT_SERVICE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `access_token=${accessToken}` },
      body: JSON.stringify({ message, history }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status !== monolithStatus) {
      logger.error(
        { monolithStatus, chatServiceStatus: response.status },
        'SHADOW-VALIDATION DIVERGENCE: monolith and chat-service disagreed on the HTTP status for this chat request'
      );
      return;
    }

    if (!response.ok) {
      // Both sides agree it's an error case (e.g. both 400 on an empty message) - nothing further
      // to compare, and not a divergence.
      return;
    }

    const body = await response.json();
    const monolithNormalized = normalizeSources(monolithSources);
    const chatServiceNormalized = normalizeSources(body.sources || []);

    if (JSON.stringify(monolithNormalized) !== JSON.stringify(chatServiceNormalized)) {
      logger.error(
        { monolithSources: monolithNormalized, chatServiceSources: chatServiceNormalized },
        'SHADOW-VALIDATION DIVERGENCE: monolith and chat-service retrieved different knowledge-base sources for the same question'
      );
      return;
    }

    logger.debug('Shadow-validation agreement: chat-service retrieved the same sources as the monolith');
  } catch (error: any) {
    logger.warn({ err: error?.message }, 'Shadow-validation call to chat-service failed - comparison skipped');
  }
}
