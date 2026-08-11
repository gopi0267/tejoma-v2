/**
 * Health, readiness, and liveness endpoints.
 *
 * NOTE: analytics-service DOES own a database (tejoma_analytics) with 6 cache tables.
 * Therefore /health and /ready must verify database connectivity, not report unconditional success.
 *
 * Three distinct endpoints:
 *   - /health: general status - includes database status for human visibility
 *   - /live: liveness - just check process is alive (no database dependency)
 *   - /ready: readiness - MUST verify database, as service cannot serve traffic without it
 */
import { Router } from 'express';
import { healthCheck } from '../db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const dbOk = await healthCheck();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'down',
    service: 'analytics-service',
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
