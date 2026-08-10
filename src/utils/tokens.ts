import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { CookieOptions } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are high-entropy random strings, not JWTs. We hash them with SHA-256
 * (fast + deterministic) before storing so a DB leak doesn't hand out live sessions -
 * bcrypt isn't used here because its per-hash salt makes lookup-by-hash impossible, and
 * that slow-hashing property only matters for low-entropy human secrets (passwords/OTPs).
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
 * When `remember` is false, the cookie is issued with no maxAge/expires at all, making it
 * a session cookie the browser discards on close - this is what makes the login screen's
 * "Remember session for 30 days" checkbox actually do something instead of always
 * persisting for 30 days regardless of the user's choice.
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
// A fully parallel token/cookie pair for candidates, who - per the approved Marketplace
// Blueprint - must not belong to a company. AccessTokenPayload above is left untouched
// (its company_id is required and embedded in every staff route's req.user!.company_id
// reads); reusing it here would mean either a fake company_id or a breaking nullable
// change across the entire existing backend. Distinct cookie names let a candidate
// session and a staff session coexist in the same browser without collisions.

export const CANDIDATE_ACCESS_TOKEN_COOKIE = 'candidate_access_token';
export const CANDIDATE_REFRESH_TOKEN_COOKIE = 'candidate_refresh_token';

export interface CandidateTokenPayload {
  candidate_id: number;
  company_id: number;
  email: string | null;
  phone: string | null;
  name: string;
}

export function signCandidateAccessToken(payload: CandidateTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyCandidateAccessToken(token: string): CandidateTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as CandidateTokenPayload;
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
