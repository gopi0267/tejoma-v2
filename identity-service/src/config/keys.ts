/**
 * RS256 signing key management for Identity Service.
 *
 * Resolves the HS256-vs-JWKS architectural gap identified in Batch 1 (see identity-service/
 * README.md): the monolith's src/utils/tokens.ts signs with HS256 (a single shared symmetric
 * secret), which has no public key and therefore cannot back a JWKS endpoint. Phase 2(technical)
 * section 3's "JWT verified via cached JWKS" design requires an asymmetric algorithm - this
 * module is that completion, not a new architectural decision.
 *
 * Production: the private/public key PEM pair is REQUIRED via environment variables
 * (IDENTITY_JWT_PRIVATE_KEY / IDENTITY_JWT_PUBLIC_KEY), sourced from AWS Secrets Manager by the
 * deployment platform (Phase 5(infrastructure) sections 7/15) - never generated at runtime in
 * production, since a regenerated key on every restart would invalidate every token issued
 * before that restart and break every other service's cached JWKS.
 *
 * Development: if the env vars are not set, an ephemeral RSA-2048 keypair is generated at
 * startup. This is real, functional RS256 signing - not a mock - it just does not persist across
 * restarts, which is an acceptable and clearly logged trade-off for local development only. The
 * IS_PRODUCTION check below makes this impossible to hit in production, mirroring the existing
 * fail-fast convention in src/config/env.ts.
 */
import crypto from 'crypto';
import { IS_PRODUCTION } from './env.js';

export interface JwtKeyPair {
  privateKey: string;
  publicKey: string;
  /** Stable across restarts for a given key (derived from the public key itself), so a
   *  consumer's cached JWKS entry keeps matching this key without needing separate config. */
  kid: string;
}

function deriveKid(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

function normalizePem(value: string): string {
  // Environment variable systems (including AWS Secrets Manager -> ECS/EKS env injection)
  // commonly deliver a multi-line PEM with literal "\n" sequences rather than real newlines.
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

function loadFromEnv(): JwtKeyPair | null {
  const rawPrivate = process.env.IDENTITY_JWT_PRIVATE_KEY;
  const rawPublic = process.env.IDENTITY_JWT_PUBLIC_KEY;
  if (!rawPrivate || !rawPublic) return null;

  const privateKey = normalizePem(rawPrivate);
  const publicKey = normalizePem(rawPublic);
  return { privateKey, publicKey, kid: deriveKid(publicKey) };
}

function generateEphemeralKeyPair(): JwtKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid: deriveKid(publicKey) };
}

function loadKeyPair(): JwtKeyPair {
  const fromEnv = loadFromEnv();
  if (fromEnv) return fromEnv;

  if (IS_PRODUCTION) {
    console.error(
      '\nFATAL: IDENTITY_JWT_PRIVATE_KEY / IDENTITY_JWT_PUBLIC_KEY are not set. Refusing to ' +
        'start in production without a persisted RS256 signing key (AWS Secrets Manager - see ' +
        'Phase 5(infrastructure) sections 7/15).\n'
    );
    process.exit(1);
  }

  console.warn(
    '\n⚠ IDENTITY_JWT_PRIVATE_KEY / IDENTITY_JWT_PUBLIC_KEY not set - generating an ' +
      'ephemeral RSA-2048 keypair for local development. Tokens issued this run will fail ' +
      'verification after a restart. This path is unreachable in production (see the ' +
      'IS_PRODUCTION check above).\n'
  );
  return generateEphemeralKeyPair();
}

export const jwtKeyPair: JwtKeyPair = loadKeyPair();

/** Converts the RSA public key to JWK (JSON Web Key) format for the /.well-known/jwks.json
 *  endpoint, using Node's built-in crypto export - no third-party JWK library needed. */
export function publicKeyToJwk(publicKeyPem: string, kid: string): Record<string, string> {
  const keyObject = crypto.createPublicKey(publicKeyPem);
  const jwk = keyObject.export({ format: 'jwk' }) as Record<string, string>;
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}
