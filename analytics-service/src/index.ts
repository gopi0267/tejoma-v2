/**
 * Analytics Service process entry point. The ONLY file that calls app.listen() - see
 * identity-service/src/index.ts's header comment for the exact bug this pattern avoids.
 */
import { app } from './server.js';
import { logger } from './utils/logger.js';
import { PORT } from './config/env.js';
import { db } from './db.js';
import { initializeEventSubscriber, closeEventSubscriber, setUnsubscribe } from './services/eventSubscriber.js';
import { handleJobCreated, handleSwiped, handleDecisionChanged, handleCandidateUpdated } from './services/eventHandlers.js';

let server: any;

async function start() {
  try {
    await db.initializeSchema();
    logger.info('Analytics schema initialized');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize analytics schema, continuing anyway');
  }

  server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'analytics-service listening');
  });

  // Initialize event subscriber (CQRS write model population) - non-blocking
  initializeEventSubscriber(
    handleJobCreated,
    handleSwiped,
    handleDecisionChanged,
    handleCandidateUpdated
  )
    .then((unsubscribe) => {
      setUnsubscribe(unsubscribe);
      logger.info('Analytics event subscriber initialized');
    })
    .catch((error) => {
      logger.warn({ err: error }, 'Failed to initialize event subscriber, service will use monolith fallback');
    });

  async function shutdown(signal: string) {
    logger.info({ signal }, 'analytics-service shutting down');
    await closeEventSubscriber();
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
