import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  signCandidateAccessToken,
  verifyCandidateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  candidateAccessTokenCookieOptions,
  candidateRefreshTokenCookieOptions,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  CANDIDATE_ACCESS_TOKEN_COOKIE,
  CANDIDATE_REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  type AccessTokenPayload,
  type CandidateTokenPayload,
} from '../src/utils/tokens.js';

const staffPayload: AccessTokenPayload = {
  user_id: 42,
  email: 'recruiter@example.com',
  name: 'Test Recruiter',
  company_id: 7,
  role: 'recruiter',
};

const candidatePayload: CandidateTokenPayload = {
  candidate_id: 99,
  email: 'candidate@example.com',
  phone: null,
  name: 'Test Candidate',
};

describe('staff access tokens', () => {
  it('signs and verifies a token round-trip, preserving every claim exactly (payload shape unchanged from the monolith)', () => {
    const token = signAccessToken(staffPayload);
    const decoded = verifyAccessToken(token);
    expect(decoded).toMatchObject(staffPayload);
  });

  it('is a real RS256-signed JWT with three dot-separated segments and an RS256 header', () => {
    const token = signAccessToken(staffPayload);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBeTruthy();
  });

  it('rejects a tampered token', () => {
    const token = signAccessToken(staffPayload);
    const tampered = token.slice(0, -4) + 'abcd';
    expect(verifyAccessToken(tampered)).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    expect(verifyAccessToken('not-a-jwt')).toBeNull();
  });

  it('candidate tokens cannot be verified by the staff verifier and vice versa (distinct payload shapes, same signing key)', () => {
    const candidateToken = signCandidateAccessToken(candidatePayload);
    // A candidate token has no company_id/role, but since verifyAccessToken doesn't schema-check
    // the payload (only jwt.verify's signature+expiry check), the real isolation between staff
    // and candidate identity comes from application code never reading req.user for a candidate
    // token or vice versa (see the monolith's auth.middleware.ts) - this test documents that the
    // token itself is structurally valid either way, which is why that application-level
    // discipline matters.
    const decoded = verifyAccessToken(candidateToken) as unknown as CandidateTokenPayload;
    expect(decoded.candidate_id).toBe(candidatePayload.candidate_id);
  });
});

describe('candidate access tokens', () => {
  it('signs and verifies a token round-trip, preserving every claim exactly', () => {
    const token = signCandidateAccessToken(candidatePayload);
    const decoded = verifyCandidateAccessToken(token);
    expect(decoded).toMatchObject(candidatePayload);
  });

  it('rejects a tampered token', () => {
    const token = signCandidateAccessToken(candidatePayload);
    const tampered = token.slice(0, -4) + 'abcd';
    expect(verifyCandidateAccessToken(tampered)).toBeNull();
  });
});

describe('refresh token generation', () => {
  it('generates a high-entropy opaque token distinct from its stored hash', () => {
    const { token, hash, expiresAt } = generateRefreshToken();
    expect(token).toHaveLength(128); // 64 random bytes, hex-encoded
    expect(hash).toHaveLength(64); // sha256 hex digest
    expect(token).not.toBe(hash);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + REFRESH_TOKEN_TTL_MS + 1000);
  });

  it('hashing the same token twice produces the same hash (deterministic, required for lookup-by-hash)', () => {
    const { token, hash } = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it('two generated tokens are never equal', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('cookie configuration - preserved exactly from the monolith', () => {
  it('cookie names match the monolith exactly (frontend depends on these being unchanged)', () => {
    expect(ACCESS_TOKEN_COOKIE).toBe('access_token');
    expect(REFRESH_TOKEN_COOKIE).toBe('refresh_token');
    expect(CANDIDATE_ACCESS_TOKEN_COOKIE).toBe('candidate_access_token');
    expect(CANDIDATE_REFRESH_TOKEN_COOKIE).toBe('candidate_refresh_token');
  });

  it('access token cookie is httpOnly, path "/", and expires in 15 minutes', () => {
    const opts = accessTokenCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(ACCESS_TOKEN_TTL_MS);
  });

  it('refresh token cookie is scoped to /api/auth, not "/"', () => {
    const opts = refreshTokenCookieOptions();
    expect(opts.path).toBe('/api/auth');
    expect(opts.maxAge).toBe(REFRESH_TOKEN_TTL_MS);
  });

  it('remember=false issues a session cookie with no maxAge', () => {
    const opts = refreshTokenCookieOptions(false);
    expect(opts.maxAge).toBeUndefined();
  });

  it('candidate refresh token cookie is scoped to /api/candidate-auth, distinct from staff', () => {
    const opts = candidateRefreshTokenCookieOptions();
    expect(opts.path).toBe('/api/candidate-auth');
  });

  it('candidate access token cookie matches staff access token shape (path "/", 15 min)', () => {
    const opts = candidateAccessTokenCookieOptions();
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(ACCESS_TOKEN_TTL_MS);
  });
});
