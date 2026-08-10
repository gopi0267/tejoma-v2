// Mirrors identity-service/src/utils/logger.ts and the root project's src/utils/logger.ts
// convention exactly. Duplicated per Phase 9(domain analysis) section 4's monorepo strategy - see
// identity-service's copy of this file for the full reasoning.
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
