/**
 * Phase 5 metrics on the service's existing Prometheus registry.
 *
 * Labels are drawn only from closed enums - node type, relationship type, rejection reason. Job
 * ids, candidate ids, tenant ids and raw skill text are never labels: a tenant_id label would leak
 * customer identity into the metrics store, and raw skill text is unbounded by construction.
 */
import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from '../utils/metrics.js';

export const kgEntityResolution = new Counter({
  name: 'kg_entity_resolution_total',
  help: 'Entity resolution attempts, by outcome',
  labelNames: ['outcome'] as const,   // resolved | unresolved
  registers: [registry],
});

export const kgEntityMergeRejected = new Counter({
  name: 'kg_entity_merge_rejected_total',
  help: 'Attempted merges blocked by the non-mergeable guard',
  registers: [registry],
});

export const kgRelationshipCreated = new Counter({
  name: 'kg_relationship_created_total',
  help: 'Edges admitted to the graph, by relationship type',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const kgRelationshipRejected = new Counter({
  name: 'kg_relationship_rejected_total',
  help: 'Candidate edges rejected, by reason',
  labelNames: ['reason'] as const,    // contract | cycle | unknown_concept | self_loop
  registers: [registry],
});

export const kgCycleRejected = new Counter({
  name: 'kg_cycle_rejected_total',
  help: 'Edges rejected because they would close a cycle in an acyclic relationship type',
  registers: [registry],
});

export const kgProvenanceFailure = new Counter({
  name: 'kg_provenance_failure_total',
  help: 'Graph facts rejected for incomplete provenance',
  registers: [registry],
});

export const kgGraphValidationFailure = new Counter({
  name: 'kg_graph_validation_failure_total',
  help: 'Structural audit failures detected at build time',
  labelNames: ['kind'] as const,      // invalid_edge | orphan | cycle | duplicate_identity
  registers: [registry],
});

export const kgIngestionFailure = new Counter({
  name: 'kg_ingestion_failure_total',
  help: 'Ingestion runs that failed',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const kgIngestionUnresolved = new Counter({
  name: 'kg_ingestion_unresolved_total',
  help: 'Surfaces ingestion could not resolve to a curated concept, by origin field',
  labelNames: ['origin'] as const,    // requirement | skill | role_family | domain
  registers: [registry],
});

export const kgQueryLatency = new Histogram({
  name: 'kg_query_latency_seconds',
  help: 'Graph query wall time, by operation',
  labelNames: ['operation'] as const,
  buckets: [0.00001, 0.0001, 0.001, 0.01, 0.1, 1],
  registers: [registry],
});

export const kgIngestionLatency = new Histogram({
  name: 'kg_ingestion_latency_seconds',
  help: 'Wall time to ingest one intelligence profile',
  buckets: [0.0001, 0.001, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

/** Graph shape, refreshed at build. Gauges because the graph is rebuilt, not accumulated. */
export const kgNodes = new Gauge({
  name: 'kg_nodes', help: 'Nodes in the built graph, by type',
  labelNames: ['node_type'] as const, registers: [registry],
});

export const kgEdges = new Gauge({
  name: 'kg_edges', help: 'Edges in the built graph, by relationship type',
  labelNames: ['type'] as const, registers: [registry],
});
