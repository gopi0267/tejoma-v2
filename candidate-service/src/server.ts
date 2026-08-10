/**
 * Candidate Service Express app - Tier 0 (Batch 16). Mirrors every other Tier 0 service's
 * middleware ordering and security defaults exactly.
 *
 * This module defines and exports the Express `app` only - it never binds a port; index.ts is
 * the sole process entry point.
 */
import './config/env.js'; // must be imported first - validates config and fails fast before anything else runs
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { registry, metricsMiddleware } from './utils/metrics.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import healthRoutes from './routes/health.routes.js';
import internalRoutes from './routes/internal.routes.js';
import candidateProfileRoutes from './routes/candidateProfile.routes.js';
import candidateJobsRoutes from './routes/candidateJobs.routes.js';
import candidateApplicationsRoutes from './routes/candidateApplications.routes.js';
import candidateDecisionsRoutes from './routes/candidateDecisions.routes.js';
import candidateMatchesRoutes from './routes/candidateMatches.routes.js';
import candidateAnalyticsRoutes from './routes/candidateAnalytics.routes.js';
import candidateNotificationsRoutes from './routes/candidateNotifications.routes.js';
import candidateSearchRoutes from './routes/candidateSearch.routes.js';
import { IS_PRODUCTION } from './config/env.js';

const app = express();

app.disable('x-powered-by');

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false, // this service serves no HTML/browser content, only a JSON API
  })
);

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3006')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId! }));
app.use(metricsMiddleware);

app.use('/', healthRoutes);
// Internal routes (no auth required - network boundary enforced by API Gateway)
app.use('/internal', internalRoutes);
// All mounted at '/api' - same full public paths the frontend already calls today, so API
// Gateway's pathFilter-based routing (no prefix stripping) forwards them unchanged.
//
// candidateSearchRoutes is mounted FIRST, ahead of every other router below - it's the only one
// serving staff auth (candidateSearch.routes.ts's own header comment) rather than this service's
// usual candidate-self-service auth, and every router below applies its own requireCandidateAuth
// as a blanket, unscoped router.use() (safe until now, since they all shared the same auth
// domain). Mounting candidateSearchRoutes first means its own path-scoped ('/candidate-search')
// middleware is the only thing that ever sees those requests; every other '/api/candidate-*' path
// falls through via next() to the router that actually owns it, unaffected.
app.use('/api', candidateSearchRoutes);
app.use('/api', candidateProfileRoutes);
app.use('/api', candidateJobsRoutes);
app.use('/api', candidateApplicationsRoutes);
app.use('/api', candidateDecisionsRoutes);
app.use('/api', candidateMatchesRoutes);
app.use('/api', candidateAnalyticsRoutes);
app.use('/api', candidateNotificationsRoutes);

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err?.message, stack: err?.stack, path: req.path, method: req.method }, 'Unhandled request error');
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: IS_PRODUCTION ? 'Internal server error' : err?.message || 'Internal server error',
  });
});

export { app };
