import './config/env.js';
import { PORT } from './config/env.js';
import { pool } from './db.js';
import { logger } from './utils/logger.js';
import { httpServer, io } from './server.js';
import { subscribeToRedisEvents } from './services/redisSubscriber.js';

const server = httpServer.listen(PORT, async () => {
  try {
    const result = await pool.query('SELECT 1');
    logger.info(`Notifications Service listening on port ${PORT}`);

    // Subscribe to Redis events
    await subscribeToRedisEvents(io);
    logger.info('Redis event subscriber initialized');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Database connection failed');
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await pool.end();
    io.close();
    logger.info('Notifications Service shut down');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(async () => {
    await pool.end();
    io.close();
    logger.info('Notifications Service shut down');
    process.exit(0);
  });
});
