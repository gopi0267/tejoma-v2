/**
 * Matching Evaluation Service process entry point. The ONLY file that calls app.listen() - see
 * identity-service/src/index.ts's header comment for the exact bug this pattern avoids.
 */
import { app } from './server.js';
import { logger } from './utils/logger.js';
import { closePool } from './db.js';
import { PORT } from './config/env.js';

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, 'matching-evaluation-service listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'matching-evaluation-service shutting down');
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
