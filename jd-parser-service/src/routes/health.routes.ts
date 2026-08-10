// Simpler than every DB-owning Tier 0 service's health.routes.ts, for the same reason
// api-gateway's is simpler: no local dependency to check. The Python NLP tier is intentionally
// excluded from readiness (src/jd-parser/tiers/nlpTier.ts degrades gracefully by design - a down
// jd-nlp-service must never make this service report itself not-ready, since JD parsing still
// works, just without industry/department).
import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'jd-parser-service',
    timestamp: new Date().toISOString(),
  });
});

router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/ready', (_req, res) => {
  res.status(200).json({ status: 'ready' });
});

export default router;
