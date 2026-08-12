import './config/env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import { logger } from './utils/logger.js';
import { IS_PRODUCTION } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

const app = express();

app.disable('x-powered-by');

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
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
app.use(express.json({ limit: '100kb' }));

// Request ID middleware
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  (req as any).requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', (req as any).requestId);
  next();
});

// Logging middleware
app.use(pinoHttp({ logger }));

app.use('/', healthRoutes);
app.use('/webhook', webhookRoutes);

app.get('/metrics', async (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err?.message, stack: err?.stack, path: req.path, method: req.method }, 'Unhandled request error');
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: IS_PRODUCTION ? 'Internal server error' : err?.message || 'Internal server error',
  });
});

export { app };
