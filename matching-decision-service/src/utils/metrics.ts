// Mirrors every other Tier 0 service's src/utils/metrics.ts, scoped to this service's own
// registry.
import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'matching-decision-service' });
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

// Remaining-monolith migration, Step 6 - real-cutover routes fan out to job-service/candidate-
// core-service/matching-scoring-service; proxy routes call the monolith. Same multi-upstream
// labeling shape job-service introduced in Step 4, plus a dedicated monolith-proxy series
// matching every other proxying Tier 0 service's own convention.
export const upstreamProxyCount = new client.Counter({
  name: 'matching_decision_service_upstream_proxy_total',
  help: 'Calls from this service to an upstream API (excluding the monolith), by upstream, target, and outcome',
  labelNames: ['upstream', 'target', 'outcome'],
  registers: [registry],
});

export const upstreamProxyDuration = new client.Histogram({
  name: 'matching_decision_service_upstream_proxy_duration_seconds',
  help: 'Latency of calls from this service to an upstream API (excluding the monolith)',
  labelNames: ['upstream', 'target'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const monolithProxyCount = new client.Counter({
  name: 'matching_decision_service_monolith_proxy_total',
  help: 'Calls from this service to the monolith internal API, by target and outcome',
  labelNames: ['target', 'outcome'],
  registers: [registry],
});

export const monolithProxyDuration = new client.Histogram({
  name: 'matching_decision_service_monolith_proxy_duration_seconds',
  help: 'Latency of calls from this service to the monolith internal API',
  labelNames: ['target'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = (req.route?.path as string) || req.path;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestCount.inc(labels);
  });
  next();
}
