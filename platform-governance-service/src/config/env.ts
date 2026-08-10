/**
 * Startup environment validation for Platform Governance Service - imported first (before
 * anything else) by server.ts so misconfiguration is caught before the process ever accepts a
 * request. Mirrors identity-service/src/config/env.ts's fail-fast convention exactly (see that
 * file) - re-implemented here, not imported, since each Tier 0 service is an independently
 * deployable unit with its own dependency tree (Phase 9(domain analysis) section 4's monorepo
 * strategy, already established).
 *
 * IDENTITY_SERVICE_URL is required (not optional) because this service's staff-auth verification
 * (src/middleware/staffAuth.middleware.ts) has no local fallback - unlike the graceful-null
 * cross-service enrichment clients elsewhere in this series (tenantDirectoryClient.ts,
 * marketplaceClient.ts), a service that cannot verify who is calling it cannot safely serve any
 * of its superadmin-gated routes at all. Requiring it at startup surfaces a misconfiguration
 * immediately, not as a wall of runtime 401s.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4002', 10);
export const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || '';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'IDENTITY_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for platform-governance-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
