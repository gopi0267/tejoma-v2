/**
 * Identity Service Express app - Tier 0 (Phase 11/12). Mirrors the root project's server.ts
 * middleware ordering and security defaults (see that file): env validation first (fails fast
 * before anything else runs), Helmet, CORS restricted to configured origins, cookie-parser,
 * structured request logging, Prometheus metrics, then routes, then the error handler last.
 *
 * This module defines and exports the Express `app` only - it never binds a port. Binding a port
 * and wiring process signal handlers is index.ts's job, kept in a separate file specifically so
 * this module can be safely imported multiple times (e.g. by multiple test files) without a real
 * network listener being created each time. See index.ts's own comment for the bug this fixes.
 *
 * This batch adds staff login/refresh/logout/logout-all/me (Batch 4). Candidate routes, OTP,
 * password reset, and Google OAuth are added in later batches.
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
import jwksRoutes from './routes/jwks.routes.js';
import authRoutes from './routes/auth.routes.js';
import candidateAuthRoutes from './routes/candidate-auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import internalRoutes from './routes/internal.routes.js';
import { IS_PRODUCTION } from './config/env.js';

const app = express();

app.disable('x-powered-by');

if (IS_PRODUCTION) {
  // Trust the first hop's X-Forwarded-* headers (reverse proxy / load balancer / API Gateway) -
  // needed for accurate req.ip and for Express to correctly recognize the connection as secure
  // when TLS is terminated upstream. Same reasoning as the root project's server.ts.
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
app.use('/', jwksRoutes);
// Mounted under /api so this service's real paths (/api/auth/login, etc.) are byte-identical to
// the monolith's today (Phase 1's zero-frontend-change requirement) - the Gateway (built in a
// later batch) can reverse-proxy /api/auth/* straight through with no path rewriting needed.
// Health/JWKS stay unprefixed at the service root, matching the orchestrator-level convention
// (a liveness probe hits /live directly, never through the public API namespace).
app.use('/api', authRoutes);
app.use('/api', candidateAuthRoutes);
// Batch 21 - staff user management (admin CRUD on recruiters within their own company). Same
// requireAuth/requireRole gate as authRoutes itself - see users.routes.ts's header comment.
app.use('/api', usersRoutes);
// Not mounted under /api - internal, service-to-service only (see internal.routes.ts's header
// comment), same convention as platform-governance-service's/tenant-directory-service's own
// /internal/* routes.
app.use('/', internalRoutes);

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// Error handler - last, per Express convention. Mirrors the root project's
// src/middleware/error.middleware.ts contract (never leak stack traces in production).
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err?.message, stack: err?.stack, path: req.path, method: req.method }, 'Unhandled request error');
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: IS_PRODUCTION ? 'Internal server error' : err?.message || 'Internal server error',
  });
});

export { app };
