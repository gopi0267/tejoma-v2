/**
 * Candidate auth verification for Candidate Service - verifies RS256 tokens issued by Identity Service.
 * Candidate auth has completed its cutover to Identity Service. This middleware verifies tokens
 * using Identity Service's public key (injected from IDENTITY_JWT_PUBLIC_KEY environment variable).
 *
 * Unlike the monolith's src/api/candidate-profile.routes.ts etc. (which gate per-route because
 * they're mounted at a shared '/api' prefix alongside staff-only routers), this entire service
 * serves candidate-facing routes exclusively - a blanket router.use(requireCandidateAuth) is
 * correct here and simpler, with no risk of 401ing a staff request that was never going to arrive.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_JWT_PUBLIC_KEY } from '../config/env.js';

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
    const payload = jwt.verify(token, IDENTITY_JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as CandidateTokenPayload;

    // Signature validity alone does not make this a CANDIDATE token. Identity Service signs both
    // candidate and staff access tokens with the same RS256 key, so a recruiter/admin token
    // verifies here perfectly well - it simply carries user_id/role/company_id instead of
    // candidate_id. Without this check every candidate route accepted staff tokens, then ran its
    // queries with candidate_account_id = undefined and answered 200 with an empty list, so an
    // authorization failure was indistinguishable from "this candidate has no data".
    // Confirmed by test: a recruiter token returned 200 {"decisions":[]} on
    // /api/candidate-decisions where it must return 401.
    if (typeof payload?.candidate_id !== 'number') return null;

    return payload;
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
