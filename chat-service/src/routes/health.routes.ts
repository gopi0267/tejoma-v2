// Mirrors identity-service/tenant-directory-service/candidate-service's health.routes.ts -
// this service owns a real database, so health/readiness are DB-backed.
import { Router } from 'express';
import { healthCheck } from '../db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const dbOk = await healthCheck();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'down',
    service: 'chat-service',
    db: dbOk ? 'ok' : 'down',
    timestamp: new Date().toISOString(),
  });
});

router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/ready', async (_req, res) => {
  const dbOk = await healthCheck();
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ready' : 'not_ready' });
});

export default router;
