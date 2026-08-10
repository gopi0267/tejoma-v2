/**
 * New in Batch 9 - the tracing seam for Tier 0. Not a port (the monolith has no equivalent -
 * confirmed by grep: no requestId/X-Request-Id/genReqId anywhere in src/).
 *
 * IMPLEMENTATION NOTE, per the required methodology - scoped deliberately narrow:
 *   Problem: once the API Gateway (Batch 12) and other Tier 0 services exist, a single user
 *     action can span multiple services/processes, and today there is no way to correlate the
 *     log lines each one emits for the same originating request.
 *   Why it exists now, not later: the correlation ID has to be generated (or forwarded) at every
 *     hop from day one, or historical logs from services built before it existed are never
 *     correlatable - it's cheap to add now and expensive to retrofit.
 *   Impact if skipped: no full distributed tracing infrastructure exists yet in this stack (the
 *     user's current EC2 Docker Compose stack runs Prometheus/Grafana for metrics, no
 *     Jaeger/Tempo/OTel collector for traces) - so this is deliberately NOT a full OpenTelemetry
 *     integration (spans, exporters, a collector to receive them). Building that now would be
 *     infrastructure with no backend to receive it, contradicting the explicit instruction not to
 *     over-build ahead of real need.
 *   Minimum change: generate (or forward, if a future Gateway already set one) a single
 *     X-Request-Id per request, attach it to req, feed it to pino-http as genReqId so every log
 *     line for this request already carries it, and echo it back as a response header. This is
 *     the exact seam a real tracing system (or the Gateway) plugs into later without any log
 *     format change.
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
  res.setHeader('X-Request-Id', requestId);
  next();
}
