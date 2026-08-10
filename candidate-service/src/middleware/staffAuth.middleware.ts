/**
 * Staff auth verification for Candidate Service - verifies the exact token
 * src/utils/tokens.ts's signAccessToken issues today (HS256, shared JWT_SECRET), not the
 * RS256/JWKS scheme platform-governance-service uses. Identical pattern to
 * matching-scoring-service's/matching-evaluation-service's own middleware/auth.middleware.ts,
 * copied verbatim - reuses the same JWT_SECRET constant this service's existing
 * auth.middleware.ts already verifies candidate tokens with (same shared secret, different token
 * shape), so no new env var is needed.
 *
 * New in Remaining-monolith migration, Step 5 - only gates the new candidate-search.routes.ts
 * (recruiter/admin-facing); every other route in this service stays candidate-self-service-only,
 * gated by the pre-existing requireCandidateAuth.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from '../config/env.js';

export interface StaffAccessTokenPayload {
  user_id: number;
  email: string | null;
  name: string;
  company_id: number;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: StaffAccessTokenPayload;
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

function verifyAccessToken(token: string): StaffAccessTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as StaffAccessTokenPayload;
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
