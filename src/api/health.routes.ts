import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const JD_NLP_SERVICE_URL = process.env.JD_NLP_SERVICE_URL || 'http://localhost:8008';
const MATCHING_ML_SERVICE_URL = process.env.MATCHING_ML_SERVICE_URL || 'http://localhost:8009';
const SERVICE_CHECK_TIMEOUT_MS = 2000;

async function checkService(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(SERVICE_CHECK_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

// Unauthenticated by design (container/orchestrator health checks don't carry a session).
// Only DB connectivity is a hard failure (503) - the app is genuinely non-functional without
// it. The two Python microservices being down is reported as "degraded" but still 200, since
// the rest of the app already degrades gracefully without them (see src/jd-parser/tiers/nlpTier.ts
// and src/algorithms/ml-models.ts).
router.get('/health', async (_req, res) => {
  const [dbOk, jdNlpOk, matchingMlOk] = await Promise.all([
    db.healthCheck(),
    checkService(JD_NLP_SERVICE_URL),
    checkService(MATCHING_ML_SERVICE_URL),
  ]);

  const allHealthy = dbOk && jdNlpOk && matchingMlOk;
  const status = !dbOk ? 'down' : allHealthy ? 'ok' : 'degraded';

  res.status(dbOk ? 200 : 503).json({
    status,
    db: dbOk ? 'ok' : 'down',
    jdNlpService: jdNlpOk ? 'ok' : 'unreachable',
    matchingMlService: matchingMlOk ? 'ok' : 'unreachable',
    timestamp: new Date().toISOString(),
  });
});

export default router;
