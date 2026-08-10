/**
 * Ported from the monolith's src/middleware/auth.middleware.ts - staff (requireAuth,
 * requireRole) and candidate (requireCandidateAuth) slices. Logic is unchanged - only the import
 * source for verifyAccessToken/ACCESS_TOKEN_COOKIE differs (this service's own RS256-based
 * utils/tokens.ts, see Batch 2). Fully separate from each other, exactly as in the monolith - a
 * candidate session is never a req.user, and no candidate route reads req.user's role.
 */
import { Request, Response, NextFunction } from 'express';
import {
  verifyAccessToken,
  ACCESS_TOKEN_COOKIE,
  AccessTokenPayload,
  verifyCandidateAccessToken,
  CANDIDATE_ACCESS_TOKEN_COOKIE,
  CandidateTokenPayload,
} from '../utils/tokens.js';

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      candidate?: CandidateTokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/** Verifies the access token (cookie, or Authorization header as a fallback for API clients) and attaches req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.user = payload;
  next();
}

// 'superadmin' implicitly satisfies any check that would pass for a lower role.
const ROLE_HIERARCHY: Record<string, string[]> = {
  superadmin: ['superadmin', 'admin', 'recruiter', 'candidate'],
};

/** Must run after requireAuth. Rejects unless req.user.role is one of allowedRoles (or a role above it in the hierarchy). */
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

function extractCandidateToken(req: Request): string | null {
  const cookieToken = req.cookies?.[CANDIDATE_ACCESS_TOKEN_COOKIE];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/** Verifies the candidate access token (cookie, or Authorization header as a fallback) and attaches req.candidate. */
export function requireCandidateAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractCandidateToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = verifyCandidateAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.candidate = payload;
  next();
}
