import './config/env.js';
import express from 'express';
import { PORT } from './config/env.js';
import { pool } from './db.js';
import { logger } from './utils/logger.js';
import { app } from './server.js';

const server = app.listen(PORT, async () => {
  try {
    const result = await pool.query('SELECT 1');
    logger.info(`Upload Service listening on port ${PORT}`);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Database connection failed');
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await pool.end();
    logger.info('Upload Service shut down');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(async () => {
    await pool.end();
    logger.info('Upload Service shut down');
    process.exit(0);
  });
});
