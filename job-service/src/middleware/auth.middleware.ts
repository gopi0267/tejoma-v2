/**
 * Staff auth verification for Job Service - verifies RS256 tokens issued by Identity Service.
 * Identity Service has completed its cutover to RS256. This middleware verifies tokens using
 * Identity Service's public key (injected from IDENTITY_JWT_PUBLIC_KEY environment variable).
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';

// Debug log on load
if (!IDENTITY_JWT_PUBLIC_KEY) {
  console.error('[STARTUP] IDENTITY_JWT_PUBLIC_KEY is not set!');
} else {
  console.log('[STARTUP] IDENTITY_JWT_PUBLIC_KEY loaded, length:', IDENTITY_JWT_PUBLIC_KEY.length);
}

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
    if (!IDENTITY_JWT_PUBLIC_KEY) {
      throw new Error('PUBLIC_KEY_NOT_SET');
    }
    return jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as AccessTokenPayload;
  } catch (err: any) {
    // Return error details in development only
    const details = process.env.NODE_ENV === 'production' ? '' : ` [${err.message}]`;
    console.error(`[auth verification failed]${details}`);
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
