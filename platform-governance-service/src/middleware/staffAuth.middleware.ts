/**
 * Staff auth verification for Platform Governance Service - a genuinely NEW piece, not a port:
 * this is the first Tier 0 service other than Identity Service itself to verify a staff access
 * token, so it is also the first real consumer of the JWKS endpoint built in identity-service
 * Batch 2 (src/routes/jwks.routes.ts) and the RS256 signing decision that endpoint exists to
 * serve. That decision is validated here, not revisited - Phase 2(technical) section 3 already
 * specified exactly this: "every other service fetches and caches this once, verifying tokens
 * locally without a per-request call back to Identity Service."
 *
 * Contract mirrored exactly from identity-service/src/middleware/auth.middleware.ts's requireAuth
 * /requireRole (same cookie name, same Authorization-header fallback, same ROLE_HIERARCHY, same
 * response shapes) - so a request rejected by Identity Service's own requireAuth would be
 * rejected identically here, and a superadmin token accepted there is accepted here.
 *
 * Uses jwks-rsa (the standard library for this exact pattern: fetch a JWKS document, cache
 * signing keys by `kid`, verify a JWT against the matching key) rather than a hand-rolled
 * fetch+cache, and jsonwebtoken (already a dependency across this series) for verification.
 * cacheMaxAge matches Identity Service's own Cache-Control: max-age=300 on that endpoint exactly,
 * so this service's local cache and Identity Service's own stated cache lifetime agree.
 */
import jwt from 'jsonwebtoken';
import jwksClient, { type SigningKey } from 'jwks-rsa';
import type { Request, Response, NextFunction } from 'express';
import { IDENTITY_SERVICE_URL } from '../config/env.js';
import type { AccessTokenPayload } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

const ACCESS_TOKEN_COOKIE = 'access_token';

const client = IDENTITY_SERVICE_URL
  ? jwksClient({
      jwksUri: `${IDENTITY_SERVICE_URL}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 5 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    })
  : null;

function getSigningKey(header: jwt.JwtHeader, callback: (err: Error | null, key?: string) => void) {
  if (!client) {
    callback(new Error('Identity Service JWKS client not configured'));
    return;
  }
  client.getSigningKey(header.kid, (err, key?: SigningKey) => {
    if (err || !key) {
      callback(err || new Error('No matching signing key found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/** Verifies a staff access token issued by Identity Service, against Identity Service's own published JWKS. Attaches req.user on success. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!client) {
    // IDENTITY_SERVICE_URL is required at startup (config/env.ts) precisely so this branch is
    // unreachable in a correctly configured deployment - kept as a defensive 503 rather than a
    // crash, matching this series' "never let a request handler throw an unhandled exception"
    // discipline.
    return res.status(503).json({ error: 'Authentication temporarily unavailable' });
  }

  jwt.verify(token, getSigningKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err || !decoded) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.user = decoded as AccessTokenPayload;
    next();
  });
}

// Identical to identity-service/src/middleware/auth.middleware.ts's ROLE_HIERARCHY - duplicated,
// not imported, per Phase 9(domain analysis) section 4's monorepo strategy (see that file's own
// comment on why small cross-cutting logic is copied rather than shared prematurely).
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
