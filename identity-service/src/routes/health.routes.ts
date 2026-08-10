/**
 * Health, readiness, and liveness endpoints - unauthenticated by design (container/orchestrator
 * health checks don't carry a session, matching the root project's src/api/health.routes.ts
 * convention).
 *
 * Three distinct endpoints, per Phase 11 section 4's requirement for both readiness and liveness
 * (the standard Kubernetes distinction the monolith's single combined /api/health endpoint never
 * needed as one process, but an orchestrated service does):
 *   - /health    : general status, includes dependency detail - for humans/dashboards.
 *   - /live      : liveness - is the process itself alive and able to respond at all. Never
 *                  checks the database; a slow/unreachable DB should not cause Kubernetes to kill
 *                  and restart a healthy process (that would make an outage worse, not better).
 *   - /ready     : readiness - can this instance actually serve traffic right now. Checks the
 *                  database, since Identity Service is genuinely non-functional without it.
 */
import { Router } from 'express';
import { healthCheck } from '../db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const dbOk = await healthCheck();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'down',
    service: 'identity-service',
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
