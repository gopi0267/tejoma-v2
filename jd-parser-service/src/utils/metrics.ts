// Mirrors every other Tier 0 service's src/utils/metrics.ts, scoped to this service's own
// registry, plus two business-specific series (jdParseDuration/jdParseNlpAvailability) that don't
// exist elsewhere - this is the one Tier 0 service whose core job is a CPU/latency-sensitive
// pipeline rather than CRUD, so those two are worth their own series from day one rather than
// being inferred from the generic http_request_duration_seconds histogram alone.
import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'jd-parser-service' });
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

export const jdParseDuration = new client.Histogram({
  name: 'jd_parse_duration_seconds',
  help: 'Duration of the JD parsing pipeline itself (excludes HTTP overhead), by whether the NLP tier ran',
  labelNames: ['nlp_tier'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2],
  registers: [registry],
});

export const jdParseCount = new client.Counter({
  name: 'jd_parse_total',
  help: 'Total JD parse attempts, by outcome',
  labelNames: ['outcome'], // 'success' | 'validation_error' | 'error'
  registers: [registry],
});

export const jdParseNlpAvailability = new client.Counter({
  name: 'jd_parse_nlp_tier_total',
  help: 'JD parses, by whether the Python NLP tier was reachable - a sustained rise in "unavailable" indicates jd-nlp-service is degraded, not that JD parsing itself is failing (it degrades gracefully)',
  labelNames: ['available'], // 'true' | 'false'
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
