/**
 * Staff auth verification for Candidate Service - verifies RS256 staff access tokens issued by
 * Identity Service, using IDENTITY_JWT_PUBLIC_KEY (the same key this service's
 * auth.middleware.ts already verifies candidate tokens with - same keypair, different token
 * shape, so no new env var is needed).
 *
 * This originally verified the monolith's HS256/shared-JWT_SECRET token. Staff auth has since
 * cut over to Identity Service and RS256, so that check rejected every real staff token - see
 * verifyAccessToken below.
 *
 * New in Remaining-monolith migration, Step 5 - only gates the new candidate-search.routes.ts
 * (recruiter/admin-facing); every other route in this service stays candidate-self-service-only,
 * gated by the pre-existing requireCandidateAuth.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';

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
    // RS256 against Identity Service's public key. This previously verified against the shared
    // symmetric JWT_SECRET, matching what the MONOLITH used to issue - but staff auth completed
    // its cutover to Identity Service, which signs RS256. Every real staff token was therefore
    // rejected here, and the only routes this middleware guards are the recruiter-facing
    // candidate-search surface, so GET /api/candidate-search (the recruiter Candidate Search /
    // talent database screen) returned 401 for every logged-in recruiter and admin.
    const payload = jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as StaffAccessTokenPayload;

    // Staff and candidate tokens share a signing key, so require the staff-shaped claims -
    // otherwise a candidate token would satisfy requireAuth and reach a recruiter-only screen
    // with company_id undefined. requireRole below would still reject it, but this fails closed
    // one layer earlier and does not depend on role being present.
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
