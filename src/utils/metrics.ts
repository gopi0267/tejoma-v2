// Prometheus metrics - default Node process metrics (event loop lag, memory, GC, etc.) plus
// basic HTTP request duration/count histograms. Purely additive/observability - nothing here
// affects request handling logic.
import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const httpRequestCount = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip the SSE stream - it's a single long-lived "request" that would otherwise report a
  // multi-hour duration and never increment the counter until the connection closes.
  if (req.path === '/api/realtime/stream') return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // req.route is only populated once Express has matched a route; fall back to path for 404s.
    const route = (req.route?.path as string) || req.path;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestCount.inc(labels);
  });
  next();
}
