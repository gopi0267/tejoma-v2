/**
 * Staff auth verification for Analytics Service - verifies RS256 tokens issued by Identity Service.
 * Identity Service has completed its cutover to RS256. This middleware verifies tokens using
 * Identity Service's public key (injected from IDENTITY_JWT_PUBLIC_KEY environment variable).
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';
import { logger } from '../utils/logger.js';

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

// Debug: Log key info at load time
if (!IDENTITY_JWT_PUBLIC_KEY) {
  console.error('[AUTH.MIDDLEWARE] ERROR: IDENTITY_JWT_PUBLIC_KEY is empty at module load time!');
} else {
  console.error(`[AUTH.MIDDLEWARE] IDENTITY_JWT_PUBLIC_KEY loaded at startup, length: ${IDENTITY_JWT_PUBLIC_KEY.length}`);
}

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
      logger.error({ keyLength: 0 }, 'FATAL: IDENTITY_JWT_PUBLIC_KEY not set');
      return null;
    }
    logger.error({ keyLength: IDENTITY_JWT_PUBLIC_KEY.length, tokenLength: token.length }, 'DEBUG: About to verify token');
    const result = jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as AccessTokenPayload;
    logger.error({ userId: result.user_id }, 'DEBUG: Token verified successfully');
    return result;
  } catch (err: any) {
    logger.error({ error: err.message, code: err.code, name: err.name }, 'DEBUG: JWT verification error');
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Debug-Middleware', 'requireAuth-running');

  const token = extractToken(req);
  if (!token) {
    res.setHeader('X-Debug-Token', 'not-found');
    logger.error('No token in request');
    return res.status(401).json({ error: 'Authentication required' });
  }

  res.setHeader('X-Debug-Token', 'found');
  logger.error({ tokenLength: token.length }, 'Token found, about to verify');
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.setHeader('X-Debug-Verify', 'failed');
    logger.error('Token verification returned null');
    return res.status(401).json({ error: 'Invalid or expired session', debug: 'middleware-executed' });
  }

  res.setHeader('X-Debug-Verify', 'success');
  logger.error({ userId: payload.user_id }, 'Token verified successfully');
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
