/**
 * API Gateway Express app - Tier 0 (Phase 11/12). Mirrors every other Tier 0 service's middleware
 * ordering and security defaults, with one deliberate omission worth flagging: NO body-parsing
 * middleware (no express.json()) anywhere in this app. http-proxy-middleware forwards the
 * incoming request by piping its raw body stream to the upstream - any body-parser placed before
 * it consumes that stream first, leaving nothing for the proxy to forward, silently breaking
 * every POST/PATCH with a body (login, registration, everything). Downstream services each parse
 * the body themselves once it arrives - parsing it twice, once here and once there, is not just
 * redundant but actively wrong for a proxy.
 *
 * This module defines and exports the Express `app` only - it never binds a port, for the same
 * reason every other service's server.ts documents - index.ts is the sole process entry point.
 */
import './config/env.js'; // must be imported first - validates config and fails fast before anything else runs
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { registry, metricsMiddleware } from './utils/metrics.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { mountProxyRoutes } from './proxy.js';
import healthRoutes from './routes/health.routes.js';
import { IS_PRODUCTION } from './config/env.js';

const app = express();

app.disable('x-powered-by');

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false, // the Gateway serves no HTML of its own - every response body is either JSON (health/metrics) or an upstream's own response, untouched
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

app.use(requestIdMiddleware);
app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId! }));
app.use(metricsMiddleware);

// Health/metrics are this Gateway's own concern, matched before any proxy rule.
app.use('/', healthRoutes);
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// Everything else: routed per proxy.ts's table, falling through to the monolith.
mountProxyRoutes(app);

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err?.message, stack: err?.stack, path: req.path, method: req.method }, 'Unhandled Gateway error');
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: IS_PRODUCTION ? 'Internal server error' : err?.message || 'Internal server error',
  });
});

export { app };
