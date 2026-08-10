// Mirrors the root project's src/utils/logger.ts convention exactly (see that file). Duplicated
// here rather than imported, per Phase 9(domain analysis) section 4's monorepo strategy: each
// independently-deployable service owns its own copy of small cross-cutting utilities until a
// real, evidenced need for a shared internal package exists (Phase 10 section 4) - premature
// extraction into a shared library before a second consumer needs it would be exactly the kind
// of "build ahead of evidence" this architecture series has consistently avoided.
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
