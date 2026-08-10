/**
 * Identity Service process entry point. The ONLY file that calls app.listen() - kept separate
 * from server.ts (which only defines and exports the Express app) specifically so tests can
 * import { app } from server.ts and drive it in-process via supertest without ever triggering a
 * real network listener. This is the fix for a real bug found while validating this batch:
 * esbuild's --format=cjs output replaces `import.meta` with an empty object, so a runtime
 * `import.meta.url`-based "is this the entry point" check (the first approach tried here) always
 * evaluates false in the built artifact - silently, since nothing throws, it just never binds a
 * port. This file/module-separation pattern avoids that class of bug entirely rather than trying
 * to detect the entry point at runtime.
 */
import { app } from './server.js';
import { logger } from './utils/logger.js';
import { closePool } from './db.js';
import { PORT } from './config/env.js';

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, 'identity-service listening');
});

// Graceful shutdown - required for zero-downtime rolling/blue-green deploys (Phase 5(infra)
// section 3's preStop-hook expectation): stop accepting new connections, let in-flight requests
// finish, then close the database pool, before the process actually exits.
async function shutdown(signal: string) {
  logger.info({ signal }, 'identity-service shutting down');
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs longer than the deploy tooling's grace period.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
