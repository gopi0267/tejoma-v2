/**
 * Staff auth verification for Matching Scoring Service - verifies the exact token
 * src/utils/tokens.ts's signAccessToken issues today (HS256, shared JWT_SECRET), not the
 * RS256/JWKS scheme platform-governance-service uses. Identical pattern to
 * matching-evaluation-service's/analytics-service's own middleware/auth.middleware.ts, copied
 * verbatim - only gates this service's new ML admin routes (/ml/*); /internal/* stays
 * network-boundary-trusted, unauthenticated.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';

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
    // RS256 against Identity Service's public key. This previously verified the monolith's
    // HS256/shared-JWT_SECRET token, but staff auth cut over to Identity Service, which signs
    // RS256 - so every real staff token was rejected and this service's entire gateway-routed
    // staff surface answered 401 to logged-in admins.
    const payload = jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as AccessTokenPayload;

    // Staff and candidate tokens share a signing key, so require the staff-shaped claims -
    // a candidate token must not satisfy requireAuth with company_id undefined.
    if (typeof payload?.user_id !== 'number' || typeof payload?.company_id !== 'number') return null;

    return payload;
  } catch {
    return null;
  }
}

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
