/**
 * Auth verification for Resume Service - handles both staff and candidate auth.
 * Both verify RS256 tokens issued by Identity Service using its public key.
 *
 * The candidate path previously verified against the legacy symmetric JWT_SECRET, which no longer
 * matches anything Identity Service issues - see requireCandidateAuth below.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';

// ==================== STAFF AUTH ====================

export interface AccessTokenPayload {
  user_id: number;
  email: string | null;
  name: string;
  company_id: number;
  role: string;
}

// Mirrors identity-service's CandidateTokenPayload EXACTLY (utils/tokens.ts). It previously
// declared company_id, which the issuer has never put in a candidate token - candidates are not
// company-scoped in this architecture (candidate_accounts is global; candidate-search reads it
// with no company filter). req.candidate.company_id was therefore always undefined, and any code
// trusting it silently wrote NULL. candidate-service's copy of this type is already correct.
export interface CandidateTokenPayload {
  candidate_id: number;
  email: string | null;
  phone: string | null;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      candidate?: CandidateTokenPayload;
    }
  }
}

const ACCESS_TOKEN_COOKIE = 'access_token';
const CANDIDATE_ACCESS_TOKEN_COOKIE = 'candidate_access_token';

function extractToken(req: Request, cookieName: string): string | null {
  const cookieToken = (req as any).cookies?.[cookieName];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req, ACCESS_TOKEN_COOKIE);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as AccessTokenPayload;
    next();
  } catch (err) {
    const error = err as Error;
    console.error('[auth] JWT verification failed:', {
      message: error.message,
      keyLength: IDENTITY_JWT_PUBLIC_KEY?.length || 0,
      hasKey: !!IDENTITY_JWT_PUBLIC_KEY,
      tokenPreview: token.substring(0, 50)
    });
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

const ROLE_HIERARCHY: Record<string, string[]> = {
  superadmin: ['superadmin', 'admin', 'recruiter', 'candidate'],
};

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const effectiveRoles = ROLE_HIERARCHY[req.user.role] || [req.user.role];
    const allowed = effectiveRoles.some((r) => allowedRoles.includes(r));
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

// ==================== CANDIDATE AUTH ====================
// Fully separate from requireAuth/requireRole above - a candidate session is never a req.user,
// mirroring the monolith's own auth.middleware.ts convention exactly.

export function requireCandidateAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req, CANDIDATE_ACCESS_TOKEN_COOKIE);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    // RS256 with Identity Service's public key - NOT the legacy symmetric JWT_SECRET.
    // Candidate auth completed its cutover to Identity Service, which now issues RS256 tokens;
    // requireAuth above (line ~57) was migrated to IDENTITY_JWT_PUBLIC_KEY at the time but this
    // candidate path was missed, so it kept verifying against the old shared secret and rejected
    // every real candidate token. Effect: all three candidate resume endpoints
    // (POST /api/candidate-resume/parse, POST+GET /api/candidate-resume/file) returned 401,
    // i.e. candidate resume upload/parse/download was entirely unusable.
    const payload = jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as CandidateTokenPayload;

    // A valid signature alone does not prove this is a CANDIDATE token - Identity Service signs
    // staff tokens with the same key. Without this check a recruiter token would authenticate as
    // a candidate and operate with candidate_id undefined. Same guard applied to
    // candidate-service's requireCandidateAuth earlier in this audit.
    if (typeof payload?.candidate_id !== 'number') {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.candidate = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
