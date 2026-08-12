/**
 * Auth verification for Resume Service - handles both staff and candidate auth.
 * Staff auth uses RS256 tokens from Identity Service.
 * Candidate auth still uses HS256 (legacy monolith tokens).
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { JWT_SECRET, IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';

// ==================== STAFF AUTH ====================

export interface AccessTokenPayload {
  user_id: number;
  email: string | null;
  name: string;
  company_id: number;
  role: string;
}

export interface CandidateTokenPayload {
  candidate_id: number;
  company_id: number;
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
    req.candidate = jwt.verify(token, JWT_SECRET) as CandidateTokenPayload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
