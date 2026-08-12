/**
 * Staff auth verification for Chat Service - verifies RS256 tokens
 * issued by Identity Service using the IDENTITY_JWT_PUBLIC_KEY from environment.
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
    return jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as AccessTokenPayload;
  } catch (err) {
    const error = err as Error;
    console.error('[auth] JWT verification failed:', {
      message: error.message,
      keyLength: IDENTITY_JWT_PUBLIC_KEY?.length || 0,
      hasKey: !!IDENTITY_JWT_PUBLIC_KEY,
      tokenPreview: token.substring(0, 50)
    });
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
