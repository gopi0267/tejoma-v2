/**
 * JD Parser Service Express app - Tier 0 (Batch 15). Mirrors every other Tier 0 service's
 * middleware ordering and security defaults exactly.
 *
 * This module defines and exports the Express `app` only - it never binds a port, for the exact
 * same reason every other service's server.ts documents - index.ts is the sole process entry
 * point.
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
import jdParserRoutes from './routes/jdParser.routes.js';
import jdUnderstandingRoutes from './routes/jdUnderstanding.routes.js';
import candidateUnderstandingRoutes from './routes/candidateUnderstanding.routes.js';
import knowledgeGraphRoutes from './routes/knowledgeGraph.routes.js';
import evidenceRoutes from './routes/evidence.routes.js';
import matchIntelligenceRoutes from './routes/matchIntelligence.routes.js';
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
app.use(express.json({ limit: '1mb' })); // the 50,000-char text cap (jdParser.routes.ts) fits comfortably under this
app.use(requestIdMiddleware);
app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId! }));
app.use(metricsMiddleware);

app.use('/', healthRoutes);
app.use('/api', jdParserRoutes);
// Phase 3. Mounted alongside the parser, not in front of it: the existing extraction contract is
// untouched, so a fault in the understanding engine cannot degrade JD parsing.
app.use('/api', jdUnderstandingRoutes);
// Phase 4. Stateless like the JD engine: it takes a candidate record as an argument and never
// queries for one, so it cannot widen any caller's access to candidate data.
app.use('/api', candidateUnderstandingRoutes);
// Phase 5. Read-only query surface over a graph built at module load from curated sources; there
// is no mutation endpoint, so no request can alter shared knowledge.
app.use('/api', knowledgeGraphRoutes);
// Phase 6. Stateless like Phases 3-5: it evaluates the job and candidate profiles the caller
// supplies and queries nothing. It is on no matching path and returns no score, so it can neither
// change production ranking nor be mistaken for a ranking signal.
app.use('/api', evidenceRoutes);
// Phase 7. Shadow-only semantic matching: it reasons over the Phase 3-6 profiles the caller supplies
// and returns a decomposed Match Intelligence Profile. It reads no production score and writes
// nothing, so matching-scoring-service remains the sole authority for ranking.
app.use('/api', matchIntelligenceRoutes);

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
