/**
 * RS256 token generation for tests.
 *
 * Tests must issue tokens signed with the same RS256 private key that identity-service uses,
 * so job-service's auth middleware can verify them with IDENTITY_JWT_PUBLIC_KEY.
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load from repo root .env.local (docker-compose env_file)
// The service .env.local doesn't have identity keys, so load from parent
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentEnvPath = path.resolve(__dirname, '../../../.env.local');
config({ path: parentEnvPath });
// Also load local .env.local to get other service config if needed
config({ path: path.resolve(__dirname, '../../.env.local') });

function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

const PRIVATE_KEY = normalizePem(process.env.IDENTITY_JWT_PRIVATE_KEY || '');
const PUBLIC_KEY = normalizePem(process.env.IDENTITY_JWT_PUBLIC_KEY || '');

function deriveKid(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  throw new Error(
    `IDENTITY_JWT_PRIVATE_KEY and IDENTITY_JWT_PUBLIC_KEY must be set in .env.local for tests to generate valid RS256 tokens. ` +
    `Tried to load from: ${envPath}`
  );
}

const KID = deriveKid(PUBLIC_KEY);

export interface AccessTokenPayload {
  user_id: number;
  email: string;
  name: string;
  company_id: number;
  role: string;
}

export function generateAccessToken(payload: Partial<AccessTokenPayload>): string {
  const fullPayload: AccessTokenPayload = {
    user_id: payload.user_id || 1,
    email: payload.email || 'test@tejoma.com',
    name: payload.name || 'Test User',
    company_id: payload.company_id || 1,
    role: payload.role || 'recruiter',
  };

  return jwt.sign(fullPayload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '15m',
    keyid: KID,
  });
}

export function generateRecruiterToken(overrides?: Partial<AccessTokenPayload>): string {
  return generateAccessToken({
    user_id: 501,
    email: 'r@tejoma.com',
    name: 'Recruiter',
    company_id: 870,
    role: 'recruiter',
    ...overrides,
  });
}

export function generateCandidateToken(overrides?: Partial<AccessTokenPayload>): string {
  return generateAccessToken({
    user_id: 900,
    email: 'c@tejoma.com',
    name: 'Candidate',
    company_id: 870,
    role: 'candidate',
    ...overrides,
  });
}

export function generateAdminToken(overrides?: Partial<AccessTokenPayload>): string {
  return generateAccessToken({
    user_id: 100,
    email: 'admin@tejoma.com',
    name: 'Admin',
    company_id: 1,
    role: 'admin',
    ...overrides,
  });
}

export function verifyToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] }) as AccessTokenPayload;
  } catch {
    return null;
  }
}
