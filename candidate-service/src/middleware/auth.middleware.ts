/**
 * Candidate auth verification for Candidate Service - verifies the exact token
 * src/utils/tokens.ts's signCandidateAccessToken issues today (HS256, shared JWT_SECRET), not a
 * JWKS scheme. See config/env.ts's header comment for why (candidate auth hasn't cut over to
 * Identity Service yet).
 *
 * Unlike the monolith's src/api/candidate-profile.routes.ts etc. (which gate per-route because
 * they're mounted at a shared '/api' prefix alongside staff-only routers), this entire service
 * serves candidate-facing routes exclusively - a blanket router.use(requireCandidateAuth) is
 * correct here and simpler, with no risk of 401ing a staff request that was never going to arrive.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from '../config/env.js';

export interface CandidateTokenPayload {
  candidate_id: number;
  email: string | null;
  phone: string | null;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      candidate?: CandidateTokenPayload;
    }
  }
}

const CANDIDATE_ACCESS_TOKEN_COOKIE = 'candidate_access_token';

function extractToken(req: Request): string | null {
  const cookieToken = (req as any).cookies?.[CANDIDATE_ACCESS_TOKEN_COOKIE];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function verifyCandidateAccessToken(token: string): CandidateTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as CandidateTokenPayload;
  } catch {
    return null;
  }
}

/** Verifies the candidate access token (cookie, or Authorization header as a fallback) and attaches req.candidate. */
export function requireCandidateAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
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
