/**
 * Job Service Express app - Tier 0. Mirrors matching-evaluation-service's middleware ordering and
 * security defaults - this service now has a real, gateway-routed, staff-facing HTTP surface
 * (/api/jobs*, see routes/jobs.routes.ts, Step 4 of the remaining-monolith migration) alongside
 * its original internal-only /internal/* surface, so it needs real CORS/cookie handling, not the
 * internal-only `cors({ origin: false })` default.
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
import jobsRoutes from './routes/jobs.routes.js';
import { IS_PRODUCTION } from './config/env.js';

const app = express();

app.disable('x-powered-by');

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false, // this service serves no HTML content, only a JSON API
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
app.use(express.json({ limit: '2mb' }));
app.use(requestIdMiddleware);
app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId! }));
app.use(metricsMiddleware);

app.use('/', healthRoutes);
app.use('/internal', internalRoutes);
app.use('/api', jobsRoutes);

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
