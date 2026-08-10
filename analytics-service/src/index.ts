/**
 * Analytics Service process entry point. The ONLY file that calls app.listen() - see
 * identity-service/src/index.ts's header comment for the exact bug this pattern avoids.
 */
import { app } from './server.js';
import { logger } from './utils/logger.js';
import { PORT } from './config/env.js';
import { db } from './db.js';

async function start() {
  try {
    await db.initializeSchema();
    logger.info('Analytics schema initialized');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize analytics schema, continuing anyway');
  }

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'analytics-service listening');
  });

  async function shutdown(signal: string) {
    logger.info({ signal }, 'analytics-service shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  logger.error({ err: error }, 'Failed to start analytics-service');
  process.exit(1);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'analytics-service shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
