/**
 * JWT issuance/verification and refresh-token primitives for Identity Service.
 *
 * Ported from the monolith's src/utils/tokens.ts (see that file) with exactly one substantive
 * change: access tokens are signed with RS256 (asymmetric, via config/keys.ts) instead of HS256
 * (a single shared symmetric secret) - the completion identified and explained in this service's
 * README.md and Batch 1's findings. Every payload shape, cookie name, cookie path, TTL, and the
 * refresh-token generation/hashing scheme are unchanged, byte-for-byte, from the monolith -
 * required by Phase 1's "final platform must behave exactly the same" rule and Phase 11 section
 * 4's success criteria (every existing auth flow byte-identical pre/post migration).
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { CookieOptions } from 'express';
import { jwtKeyPair } from '../config/keys.js';

export const ACCESS_TOKEN_TTL = '15m';
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export interface AccessTokenPayload {
  user_id: number;
  email: string | null;
  name: string;
  company_id: number;
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, jwtKeyPair.privateKey, {
    algorithm: 'RS256',
    expiresIn: ACCESS_TOKEN_TTL,
    keyid: jwtKeyPair.kid,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, jwtKeyPair.publicKey, { algorithms: ['RS256'] }) as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are high-entropy random strings, not JWTs - unchanged from the monolith. We
 * hash them with SHA-256 (fast + deterministic) before storing so a DB leak doesn't hand out
 * live sessions - bcrypt isn't used here because its per-hash salt makes lookup-by-hash
 * impossible, and that slow-hashing property only matters for low-entropy human secrets
 * (passwords/OTPs), not a 64-byte random token.
 */
export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(64).toString('hex');
  const hash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  return { token, hash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function baseCookieOptions(): Pick<CookieOptions, 'httpOnly' | 'secure' | 'sameSite'> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  };
}

export function accessTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/', maxAge: ACCESS_TOKEN_TTL_MS };
}

/**
 * When `remember` is false, the cookie is issued with no maxAge/expires at all, making it a
 * session cookie the browser discards on close - unchanged from the monolith's "Remember session
 * for 30 days" checkbox behavior.
 */
export function refreshTokenCookieOptions(remember: boolean = true): CookieOptions {
  const base: CookieOptions = { ...baseCookieOptions(), path: '/api/auth' };
  return remember ? { ...base, maxAge: REFRESH_TOKEN_TTL_MS } : base;
}

export function clearAuthCookies(res: import('express').Response) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
}

// ==================== CANDIDATE SESSIONS ====================
// A fully parallel token/cookie pair for candidates, who must not belong to a company - unchanged
// from the monolith's design (see src/utils/tokens.ts's own comment on this). AccessTokenPayload
// above is left untouched (company_id remains required for every staff claim); reusing it here
// would mean a fake company_id or a breaking nullable change across the entire existing backend.

export const CANDIDATE_ACCESS_TOKEN_COOKIE = 'candidate_access_token';
export const CANDIDATE_REFRESH_TOKEN_COOKIE = 'candidate_refresh_token';

export interface CandidateTokenPayload {
  candidate_id: number;
  email: string | null;
  phone: string | null;
  name: string;
}

export function signCandidateAccessToken(payload: CandidateTokenPayload): string {
  return jwt.sign(payload, jwtKeyPair.privateKey, {
    algorithm: 'RS256',
    expiresIn: ACCESS_TOKEN_TTL,
    keyid: jwtKeyPair.kid,
  });
}

export function verifyCandidateAccessToken(token: string): CandidateTokenPayload | null {
  try {
    return jwt.verify(token, jwtKeyPair.publicKey, { algorithms: ['RS256'] }) as CandidateTokenPayload;
  } catch {
    return null;
  }
}

export function candidateAccessTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/', maxAge: ACCESS_TOKEN_TTL_MS };
}

export function candidateRefreshTokenCookieOptions(remember: boolean = true): CookieOptions {
  const base: CookieOptions = { ...baseCookieOptions(), path: '/api/candidate-auth' };
  return remember ? { ...base, maxAge: REFRESH_TOKEN_TTL_MS } : base;
}

export function clearCandidateAuthCookies(res: import('express').Response) {
  res.clearCookie(CANDIDATE_ACCESS_TOKEN_COOKIE, { path: '/' });
  res.clearCookie(CANDIDATE_REFRESH_TOKEN_COOKIE, { path: '/api/candidate-auth' });
}
