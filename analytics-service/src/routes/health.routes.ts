// Simpler than every DB-owning Tier 0 service's health.routes.ts, for the same reason
// jd-parser-service's/api-gateway's are simpler: no local dependency to check - this service
// owns no database.
import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'analytics-service',
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
