// Mirrors identity-service/platform-governance-service/tenant-directory-service's
// src/utils/logger.ts exactly. Duplicated per Phase 9(domain analysis) section 4's monorepo
// strategy.
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino(
  isProduction
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        level: process.env.LOG_LEVEL || 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
);
