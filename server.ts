/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { IS_PRODUCTION } from './src/config/env.js'; // must be imported first - validates config and fails fast before anything else runs
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createServer as createViteServer } from 'vite';
import { registerApiRoutes } from './src/api/index.js';
import candidateInternalRoutes from './src/api/candidate-internal.routes.js';
import chatInternalRoutes from './src/api/chat-internal.routes.js';
import resumeInternalRoutes from './src/api/resume-internal.routes.js';
import matchingEvaluationInternalRoutes from './src/api/matching-evaluation-internal.routes.js';
import skillDiscoveryInternalRoutes from './src/api/skill-discovery-internal.routes.js';
import matchingScoringInternalRoutes from './src/api/matching-scoring-internal.routes.js';
import candidateCoreInternalRoutes from './src/api/candidate-core-internal.routes.js';
import jobInternalRoutes from './src/api/job-internal.routes.js';
import candidateSearchInternalRoutes from './src/api/candidate-search-internal.routes.js';
import matchingDecisionInternalRoutes from './src/api/matching-decision-internal.routes.js';
import { clients, initializeRealtimeSubscription, closeRealtimeSubscription } from './src/realtime.js';
import { logger } from './src/utils/logger.js';
import { globalLimiter, authLimiter } from './src/middleware/rateLimit.middleware.js';
import { errorHandler } from './src/middleware/error.middleware.js';
import { registry, metricsMiddleware } from './src/utils/metrics.js';
import { db } from './src/db.js';
import { closeRetrainQueue } from './src/queue/retrainQueue.js';

const app = express();
const PORT = 3006;

// Belt-and-suspenders on top of Helmet's default hidePoweredBy - makes the intent explicit.
app.disable('x-powered-by');

if (IS_PRODUCTION) {
  // Trust the first hop's X-Forwarded-* headers (reverse proxy / load balancer). Needed for
  // accurate req.ip (used by the rate limiters and refresh-token IP logging) and for Express
  // to correctly recognize the connection as secure when TLS is terminated upstream.
  app.set('trust proxy', 1);
}

// CSP is only enabled in production. In dev, Vite's HMR client injects inline scripts that a
// CSP would block. In production, the built SPA doesn't need that, but SwipeInterface.tsx
// does render one inline <style> block, hence 'unsafe-inline' on style-src specifically.
app.use(helmet({
  contentSecurityPolicy: IS_PRODUCTION
    ? {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      }
    : false,
}));

// FRONTEND_URL supports a comma-separated list (e.g. an apex + www domain in production) -
// defaults to today's single-origin behavior when only one value is set.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3006')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 1 ? allowedOrigins : allowedOrigins[0],
  credentials: true,
}));

// Deliberately not logging full req/res headers (default pino-http behavior) - that was
// dumping cookies, including session cookies, straight into the log stream.
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/api/realtime/stream' },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, id: req.id }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use(metricsMiddleware);

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);

// Unauthenticated by Prometheus convention - scraped by the prometheus service over the
// internal Docker network only, never routed through Nginx to the public internet.
app.get('/api/metrics', async (_req, res) => {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

app.get('/api/realtime/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);

  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

// Candidate Service (Batch 16) internal API - network-boundary trusted (no JWT), matching every
// other Tier 0 service's /internal/* convention. API Gateway's proxy.ts already 404s /internal/*
// unconditionally; Candidate Service calls this directly via MONOLITH_INTERNAL_URL, never
// through the Gateway. See src/api/candidate-internal.routes.ts's header comment.
app.use('/internal/candidate', candidateInternalRoutes);
// Chat Service (Batch 17) internal API - same network-boundary trust model as above. See
// src/api/chat-internal.routes.ts's header comment.
app.use('/internal/chat', chatInternalRoutes);
// Resume Service (Batch 18) internal API - same network-boundary trust model as above. See
// src/api/resume-internal.routes.ts's header comment.
app.use('/internal/resume', resumeInternalRoutes);
// Recruiting Service (Batch 19) - now fully migrated: owns its own matches orchestration.
// /internal/recruiting endpoint removed - no longer needed as recruiting-service cutover is complete.
// Analytics Service (Batch 22) - fully migrated: CANDIDATE_ANALYTICS_CUTOVER_ENABLED=true.
// /internal/analytics endpoint removed - analytics-service uses its own read model.
// Matching Evaluation Service (Batch 24) internal API - same network-boundary trust model as
// above. See src/api/matching-evaluation-internal.routes.ts's header comment.
app.use('/internal/matching-evaluation', matchingEvaluationInternalRoutes);
// Matching Skill Discovery Service (Batch 27) internal API - same network-boundary trust model as
// above. See src/api/skill-discovery-internal.routes.ts's header comment.
app.use('/internal/skill-discovery', skillDiscoveryInternalRoutes);
// Matching Scoring Service's ML admin surface (remaining-monolith migration, Step 1) internal API
// - same network-boundary trust model as above. See src/api/matching-scoring-internal.routes.ts's
// header comment.
app.use('/internal/matching-scoring', matchingScoringInternalRoutes);
// Candidate Core Service's write proxy (remaining-monolith migration, Step 3a) internal API - same
// network-boundary trust model as above. See src/api/candidate-core-internal.routes.ts's header
// comment.
app.use('/internal/candidate-core', candidateCoreInternalRoutes);
// Job Service's write/list proxy (remaining-monolith migration, Step 4) internal API - same
// network-boundary trust model as above. See src/api/job-internal.routes.ts's header comment.
app.use('/internal/job', jobInternalRoutes);
// Candidate Service's candidate-search shortlist proxy (remaining-monolith migration, Step 5)
// internal API - same network-boundary trust model as above. See
// src/api/candidate-search-internal.routes.ts's header comment.
app.use('/internal/candidate-search', candidateSearchInternalRoutes);
// Matching Decision Service's swipe/recruiter-review write proxy (remaining-monolith migration,
// Step 6) internal API - same network-boundary trust model as above. See
// src/api/matching-decision-internal.routes.ts's header comment.
app.use('/internal/matching-decision', matchingDecisionInternalRoutes);

// ============================================================================
// ALL API ROUTES BEFORE VITE MIDDLEWARE
// ============================================================================
registerApiRoutes(app);

// Redirect root `/` to `/candidate` to show the landing page with Candidate/Recruiter role selection.
// This is the entry point for new users before they choose their role (Candidate → /candidate, Recruiter → /).
app.get('/', (req, res) => {
  res.redirect(301, '/candidate');
});

// ============================================================================
// START SERVER
// ============================================================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Starting in development mode...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Starting in production mode (API-only, SPA served by nginx)...');
    // Phase D Item 1: Frontend extraction - monolith is now API-only in production.
    // nginx serves the SPA from /app/dist directly, removing that responsibility from here.
  }

  // Must be registered last so it can catch errors from every layer above it.
  app.use(errorHandler);

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    // Initialize Redis subscription for real-time events from services.
    initializeRealtimeSubscription().catch(err => {
      logger.warn({ err }, 'Failed to initialize realtime subscription');
    });
  });

  // Lets in-flight requests finish and closes the DB pool cleanly on container stop/restart,
  // instead of connections being dropped mid-request.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await closeRealtimeSubscription();
      await closeRetrainQueue();
      await db.closeConnection();
      console.log('Shutdown complete.');
      process.exit(0);
    });
    // Force-exit if connections haven't drained within 10s.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
