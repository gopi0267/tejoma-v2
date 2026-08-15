/**
 * Phase 5 Knowledge Graph query API.
 *
 * READ-ONLY BY CONSTRUCTION. There is no mutation endpoint: the global graph is a pure function of
 * the curated dictionary and ontology, so "writing" to it would mean editing a reviewed source file
 * and redeploying. That removes an entire class of risk the brief asks about - unauthorised graph
 * mutation, malicious ontology updates, privilege escalation into shared knowledge - because no
 * request can change what the graph asserts.
 *
 * Ingestion returns tenant-scoped instance facts to the caller and persists nothing, so one
 * tenant's request cannot deposit facts another tenant could read.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { buildKnowledgeGraph, auditGraph } from '../knowledge-graph/graph.js';
import { ingestJobProfile, ingestCandidateProfile } from '../knowledge-graph/ingest.js';
import {
  GRAPH_ENGINE_VERSION, GRAPH_SCHEMA_VERSION, ONTOLOGY_VERSION, RELATIONSHIP_CONTRACTS,
} from '../knowledge-graph/contract.js';
import {
  kgEdges, kgEntityResolution, kgIngestionFailure, kgIngestionLatency, kgIngestionUnresolved,
  kgNodes, kgQueryLatency, kgRelationshipCreated, kgGraphValidationFailure,
} from '../knowledge-graph/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

/**
 * Built once at module load. The graph is immutable and deterministic, so a per-request rebuild
 * would burn 5 ms to produce a byte-identical result.
 */
const graph = buildKnowledgeGraph();
const audit = auditGraph(graph);
for (const [t, n] of Object.entries(audit.by_node_type)) kgNodes.set({ node_type: t }, n);
for (const [t, n] of Object.entries(audit.by_edge_type)) {
  kgEdges.set({ type: t }, n);
  kgRelationshipCreated.inc({ type: t }, n);
}
for (const kind of ['invalid_edge', 'orphan', 'cycle', 'duplicate_identity'] as const) {
  const count = kind === 'invalid_edge' ? audit.invalid_edges.length
    : kind === 'orphan' ? audit.orphan_nodes.length
      : kind === 'cycle' ? audit.cycles.length : audit.duplicate_identities.length;
  if (count > 0) kgGraphValidationFailure.inc({ kind }, count);
}
logger.info({
  nodes: audit.nodes, edges: audit.edges, invalid: audit.invalid_edges.length,
  cycles: audit.cycles.length, fingerprint: graph.fingerprint().slice(0, 23),
}, 'knowledge graph built');

const MAX_DEPTH = 4;
const timed = <T>(op: string, fn: () => T): T => {
  const t = process.hrtime.bigint();
  const r = fn();
  kgQueryLatency.observe({ operation: op }, Number(process.hrtime.bigint() - t) / 1e9);
  return r;
};

/** Graph shape and versions - lets a consumer pin the exact knowledge it reasoned against. */
router.get('/graph/meta', (_req, res) => {
  res.json({
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    engine_version: GRAPH_ENGINE_VERSION,
    fingerprint: graph.fingerprint(),
    nodes: audit.nodes, edges: audit.edges,
    by_node_type: audit.by_node_type, by_edge_type: audit.by_edge_type,
    relationship_contracts: RELATIONSHIP_CONTRACTS,
  });
});

/** Resolve a surface string to a canonical concept. Fails closed - never a nearest match. */
router.get('/graph/resolve', (req, res) => {
  const surface = String(req.query.q ?? '');
  if (!surface || surface.length > 200) {
    return res.status(400).json({ error: 'q is required and must be at most 200 characters.' });
  }
  const r = timed('resolve', () => graph.resolve(surface));
  kgEntityResolution.inc({ outcome: r.node ? 'resolved' : 'unresolved' });
  res.json({ surface, resolved: !!r.node, alias_kind: r.kind, node: r.node ?? null });
});

/** Typed neighbours of a concept. */
router.get('/graph/neighbors', (req, res) => {
  const surface = String(req.query.q ?? '');
  const type = req.query.type ? String(req.query.type) : undefined;
  if (!surface || surface.length > 200) return res.status(400).json({ error: 'q is required.' });
  if (type && !(type in RELATIONSHIP_CONTRACTS)) {
    return res.status(400).json({ error: 'unknown relationship type' });
  }
  const node = graph.resolve(surface).node;
  if (!node) { kgEntityResolution.inc({ outcome: 'unresolved' }); return res.status(404).json({ error: 'unresolved concept' }); }
  kgEntityResolution.inc({ outcome: 'resolved' });
  const edges = timed('neighbors', () => graph.neighbors(node.node_id, type as never));
  res.json({ node, edges });
});

/**
 * Concept expansion, each result carrying the path that justified it. Depth is clamped so a crafted
 * request cannot force an expensive traversal.
 */
router.get('/graph/expand', (req, res) => {
  const surface = String(req.query.q ?? '');
  const depth = Math.min(Math.max(parseInt(String(req.query.depth ?? '2'), 10) || 2, 1), MAX_DEPTH);
  if (!surface || surface.length > 200) return res.status(400).json({ error: 'q is required.' });
  const node = graph.resolve(surface).node;
  if (!node) return res.status(404).json({ error: 'unresolved concept' });
  const reached = timed('expand', () => graph.expand(node.node_id, depth));
  res.json({
    node, depth,
    // Explicitly labelled: these are DERIVED reachability results, not stored facts. A consumer
    // must not be able to mistake a two-hop path for an asserted edge.
    derivation: 'TRANSITIVE_QUERY_RESULT_NOT_A_STORED_EDGE',
    reached: reached.map((r) => ({ node: graph.getNode(r.node_id), via: r.via })),
  });
});

/** Bounded path discovery between two concepts. */
router.get('/graph/paths', (req, res) => {
  const from = String(req.query.from ?? ''), to = String(req.query.to ?? '');
  const depth = Math.min(Math.max(parseInt(String(req.query.depth ?? '4'), 10) || 4, 1), MAX_DEPTH);
  if (!from || !to || from.length > 200 || to.length > 200) {
    return res.status(400).json({ error: 'from and to are required.' });
  }
  const f = graph.resolve(from).node, t = graph.resolve(to).node;
  if (!f || !t) return res.status(404).json({ error: 'unresolved concept' });
  const paths = timed('paths', () => graph.findPaths(f.node_id, t.node_id, depth));
  res.json({ from: f, to: t, paths, derivation: 'TRANSITIVE_QUERY_RESULT_NOT_A_STORED_EDGE' });
});

/**
 * Ingest a Phase 3 or Phase 4 intelligence profile into tenant-scoped instance facts.
 *
 * Returns the facts; stores nothing. The tenant is taken from the authenticated token, never from
 * the request body - a caller cannot label its facts with someone else's tenant.
 */
router.post('/graph/ingest', (req, res) => {
  const started = process.hrtime.bigint();
  try {
    const body = req.body as { kind?: string; profile?: unknown };
    const tenantId = `tenant-${req.user?.company_id ?? 'unknown'}`;
    if (!body?.profile || (body.kind !== 'job' && body.kind !== 'candidate')) {
      kgIngestionFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({ error: 'kind must be "job" or "candidate" and profile is required.' });
    }
    const result = body.kind === 'job'
      ? ingestJobProfile(graph, body.profile as never, tenantId)
      : ingestCandidateProfile(graph, body.profile as never, tenantId);
    for (const u of result.unresolved) kgIngestionUnresolved.inc({ origin: u.from });
    kgIngestionLatency.observe(Number(process.hrtime.bigint() - started) / 1e9);
    res.json({ success: true, tenant_id: tenantId, ...result });
  } catch (error: unknown) {
    kgIngestionFailure.inc({ reason: 'internal_error' });
    logger.error({ err: error instanceof Error ? error.message : String(error) },
      'knowledge graph ingestion failed');
    res.status(500).json({ error: 'ingestion failed' });
  }
});

export default router;
