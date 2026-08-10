/**
 * Matching Scoring Service Express app. Mirrors matching-evaluation-service's middleware ordering
 * and security defaults - this service now has a real, gateway-routed, staff-facing HTTP surface
 * (/ml/*, see routes/mlAdmin.routes.ts) alongside its original internal-only /internal/* surface,
 * so it needs real CORS/cookie handling, not the internal-only `cors({ origin: false })` default
 * every purely-shadow service in this migration uses.
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
import scoringRoutes from './routes/scoring.routes.js';
import matchingApiRoutes from './routes/matchingApi.routes.js';
import mlAdminRoutes from './routes/mlAdmin.routes.js';
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
app.use(express.json({ limit: '10mb' })); // a full candidate pool's resume_text/skills for one job can be large
app.use(requestIdMiddleware);
app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId! }));
app.use(metricsMiddleware);

app.use('/', healthRoutes);
app.use('/internal', scoringRoutes);
app.use('/internal', matchingApiRoutes);
app.use('/api', mlAdminRoutes);

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
