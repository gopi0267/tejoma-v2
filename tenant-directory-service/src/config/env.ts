/**
 * Startup environment validation for Tenant Directory Service - mirrors identity-service/
 * platform-governance-service's fail-fast convention exactly.
 *
 * Unlike Platform Governance Service, this service has no staff-JWT-verified routes at all - it
 * exposes only /internal/* endpoints, meant to be called service-to-service and gated by network
 * boundary (VPC-internal routing / API Gateway not exposing /internal/* publicly - Phase
 * 5(infrastructure)), the same trust model already used by identity-service's
 * marketplaceClient.ts target and platform-governance-service's own /internal/company-requests/
 * by-identifier. So there is no IDENTITY_SERVICE_URL requirement here.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4003', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for tenant-directory-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
