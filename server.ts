/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { IS_PRODUCTION } from './src/config/env.js'; // must be imported first - validates config and fails fast before anything else runs
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createServer as createViteServer } from 'vite';
import { registerApiRoutes } from './src/api/index.js';
import { clients } from './src/realtime.js';
import { logger } from './src/utils/logger.js';
import { globalLimiter, authLimiter } from './src/middleware/rateLimit.middleware.js';
import { errorHandler } from './src/middleware/error.middleware.js';

const app = express();
const PORT = 3006;

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

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3006',
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

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);

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

// ============================================================================
// ALL API ROUTES BEFORE VITE MIDDLEWARE
// ============================================================================
registerApiRoutes(app);


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
    console.log('Starting in production mode...');
    // The production bundle (dist/server.cjs) is CommonJS, so __dirname is a real, working
    // native global here (it points at dist/, where esbuild wrote server.cjs and vite wrote
    // the built SPA side by side) - no need to derive it, and the old import.meta.url-based
    // derivation didn't work anyway (import.meta is empty once esbuild bundles to cjs format).
    const distPath = __dirname;
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Must be registered last so it can catch errors from every layer above it.
  app.use(errorHandler);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

startServer();
