/**
 * Mirrors every other Tier 0 service's requestId.middleware.ts (Batch 9's tracing seam), with one
 * difference worth noting: the Gateway is the TRUE edge of the system (Phase 2(technical) section
 * 3) - most real client requests will have no incoming X-Request-Id at all, so this is usually
 * the point where a request's correlation id is actually born, not just forwarded. Every
 * downstream service already respects an incoming header over generating its own (see their own
 * copies of this file), so setting req.headers here (not just req.requestId/the response header)
 * is what makes the freshly-generated id actually propagate through http-proxy-middleware's
 * forwarded request - proxy.ts relies on this.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId = (typeof incoming === 'string' && incoming.trim()) || crypto.randomUUID();
  req.requestId = requestId;
  req.headers[REQUEST_ID_HEADER] = requestId; // ensures the proxied request carries it even when freshly generated
  res.setHeader('X-Request-Id', requestId);
  next();
}
