/**
 * Staff auth verification for JD Parser Service - verifies the exact token
 * src/utils/tokens.ts's signAccessToken issues today (HS256, shared JWT_SECRET), NOT the
 * RS256/JWKS scheme platform-governance-service's staffAuth.middleware.ts uses. See
 * config/env.ts's header comment for why: staff auth has not cut over to Identity Service yet, so
 * every real session cookie in production is still monolith-issued today. requireAuth/requireRole
 * below are a direct, behavior-preserving port of src/middleware/auth.middleware.ts's
 * staff-side pair (candidate auth is out of scope - JD parsing is recruiter/admin only, both in
 * the monolith's route today and here).
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from '../config/env.js';

export interface AccessTokenPayload {
  user_id: number;
  email: string | null;
  name: string;
  company_id: number;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

const ACCESS_TOKEN_COOKIE = 'access_token';

function extractToken(req: Request): string | null {
  const cookieToken = (req as any).cookies?.[ACCESS_TOKEN_COOKIE];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
  } catch {
    return null;
  }
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

// Identical to src/middleware/auth.middleware.ts's ROLE_HIERARCHY - duplicated, not imported, per
// Phase 9(domain analysis) section 4's monorepo strategy.
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
