/**
 * Health/readiness/liveness - simpler than every other Tier 0 service's, since the Gateway has no
 * database of its own to check (config/env.ts's header comment). /health does a best-effort,
 * short-timeout check of each upstream's own /health endpoint purely for operator visibility - a
 * slow/unreachable upstream must never make the Gateway report itself unhealthy (the Gateway
 * process itself is fine; routing to a degraded upstream is the upstream's problem, surfaced
 * per-request as a 502/504, not as this service's own health status).
 */
import { Router } from 'express';
import { IDENTITY_SERVICE_URL, PLATFORM_GOVERNANCE_SERVICE_URL, JD_PARSER_SERVICE_URL, CANDIDATE_SERVICE_URL, CHAT_SERVICE_URL, RESUME_SERVICE_URL, RECRUITING_SERVICE_URL, ANALYTICS_SERVICE_URL, MATCHING_EVALUATION_SERVICE_URL, MATCHING_SCORING_SERVICE_URL, CANDIDATE_CORE_SERVICE_URL, JOB_SERVICE_URL, MATCHING_DECISION_SERVICE_URL, MONOLITH_URL } from '../config/env.js';

const router = Router();
const UPSTREAM_HEALTH_TIMEOUT_MS = 1500;

async function checkUpstream(name: string, baseUrl: string): Promise<{ name: string; status: 'ok' | 'down' }> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(UPSTREAM_HEALTH_TIMEOUT_MS) });
    return { name, status: response.ok ? 'ok' : 'down' };
  } catch {
    return { name, status: 'down' };
  }
}

router.get('/health', async (_req, res) => {
  const upstreams = await Promise.all([
    checkUpstream('identity-service', IDENTITY_SERVICE_URL),
    checkUpstream('platform-governance-service', PLATFORM_GOVERNANCE_SERVICE_URL),
    checkUpstream('jd-parser-service', JD_PARSER_SERVICE_URL),
    checkUpstream('candidate-service', CANDIDATE_SERVICE_URL),
    checkUpstream('chat-service', CHAT_SERVICE_URL),
    checkUpstream('resume-service', RESUME_SERVICE_URL),
    checkUpstream('recruiting-service', RECRUITING_SERVICE_URL),
    checkUpstream('analytics-service', ANALYTICS_SERVICE_URL),
    checkUpstream('matching-evaluation-service', MATCHING_EVALUATION_SERVICE_URL),
    checkUpstream('matching-scoring-service', MATCHING_SCORING_SERVICE_URL),
    checkUpstream('candidate-core-service', CANDIDATE_CORE_SERVICE_URL),
    checkUpstream('job-service', JOB_SERVICE_URL),
    checkUpstream('matching-decision-service', MATCHING_DECISION_SERVICE_URL),
    checkUpstream('monolith', MONOLITH_URL),
  ]);
  res.status(200).json({
    status: 'ok',
    service: 'api-gateway',
    upstreams,
    timestamp: new Date().toISOString(),
  });
});

router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/ready', (_req, res) => {
  // No local dependency (no database) - if the process is up and configured (config/env.ts's
  // fail-fast already guaranteed valid upstream URLs at startup), it's ready to route traffic.
  res.status(200).json({ status: 'ready' });
});

export default router;
