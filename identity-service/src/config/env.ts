/**
 * Startup environment validation for Identity Service - imported first (before anything else)
 * by server.ts so misconfiguration is caught before the process ever accepts a request, not
 * discovered later as a runtime failure. Mirrors the root project's src/config/env.ts fail-fast
 * convention (see that file) - re-implemented here, not imported, because this service is an
 * independently deployable unit with its own dependency tree and must not import from the
 * monolith's src/ tree.
 *
 * Scope note: JWT signing-key validation is intentionally NOT included yet. Identity Service's
 * signing key handling (RS256 keypair via Secrets Manager, replacing the monolith's HS256
 * shared-secret scheme - see this batch's accompanying finding) is introduced in the next batch
 * alongside the JWT signing/JWKS implementation itself, not here.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4001', 10);

export const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || '';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MATCHING_DECISION_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for identity-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
