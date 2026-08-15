/**
 * Knowledge graph construction, validation and query.
 *
 * §37 - GRAPH DATABASE DECISION, ANSWERED WITH THE MEASUREMENT IN evaluate.ts
 * Neither Neo4j nor a new PostgreSQL table is introduced, for three reasons:
 *
 *  1. SIZE. The graph is ~250 nodes and ~600 edges. Every query this phase exposes - neighbours,
 *     typed neighbours, bounded path discovery, subgraph extraction - runs in microseconds over an
 *     in-memory adjacency index. A graph database earns its operational cost at a scale this is
 *     three orders of magnitude below.
 *  2. REPRODUCIBILITY. The global graph is a pure function of (dictionary, ontology version, engine
 *     version). It is derived knowledge, not accumulated state, so persisting it would store a
 *     cache rather than a source of truth - and a cache that can drift from its inputs.
 *  3. THE INSPECTION. `skill_nodes`/`skill_edges` already exist in FIVE databases and have already
 *     drifted (183/186/186/187 nodes, 484/485 edges), with smoketest rows sitting in production.
 *     A sixth copy would repeat exactly the failure the inspection uncovered. Those tables are left
 *     untouched; this layer does not read, write or migrate them.
 *
 * If a future phase needs mutable, tenant-scoped graph facts at volume, the decision should be
 * revisited on its own evidence - the query surface below is deliberately storage-agnostic.
 */

import { createHash } from 'node:crypto';
import { SKILL_DICTIONARY } from '../jd-parser/dictionaries/skills.dictionary.js';
import {
  ACYCLIC_TYPES, GRAPH_ENGINE_VERSION, GRAPH_SCHEMA_VERSION, ONTOLOGY_VERSION,
  RELATIONSHIP_CONTRACTS, SYMMETRIC_TYPES,
  type AliasKind, type GraphEdge, type GraphNode, type GraphProvenance, type NodeType,
  type RelationshipType, type ValidationIssue,
} from './contract.js';
import {
  CATEGORY_CLASS_EDGES, CURATED_FACTS, NON_MERGEABLE, ONTOLOGY_NODES,
} from './ontology.js';

const VALID_FROM = '2026-08-14';

/**
 * Identity normalization. Case and surrounding whitespace are folded; internal punctuation is NOT,
 * because that is what keeps C, C++ and C# three concepts and Node.js distinct from Node JS only
 * where the dictionary says otherwise. Stripping punctuation here would collapse them silently.
 */
export const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const nodeId = (type: NodeType, name: string): string => `${type}:${normalize(name)}`;
export const edgeId = (from: string, type: RelationshipType, to: string): string =>
  `${from}|${type}|${to}`;

const prov = (
  source_type: GraphProvenance['source_type'], derivation: GraphProvenance['derivation'],
  confidence: GraphProvenance['confidence'], created_by: string,
  extra: Partial<GraphProvenance> = {},
): GraphProvenance => ({
  source_type, source_id: null, source_field: null, source_text: null,
  derivation, confidence, created_by,
  graph_schema_version: GRAPH_SCHEMA_VERSION,
  ontology_version: ONTOLOGY_VERSION,
  engine_version: GRAPH_ENGINE_VERSION,
  ...extra,
});

export interface BuildResult {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  /** Aliases -> node_id. Never populated from similarity; see resolve(). */
  aliasIndex: Map<string, { node_id: string; kind: AliasKind }>;
  rejected: { fact: string; reason: string }[];
  issues: ValidationIssue[];
}

export class KnowledgeGraph {
  readonly nodes: Map<string, GraphNode>;
  readonly edges: Map<string, GraphEdge>;
  readonly aliasIndex: Map<string, { node_id: string; kind: AliasKind }>;
  readonly rejected: { fact: string; reason: string }[];
  readonly issues: ValidationIssue[];
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly inc = new Map<string, GraphEdge[]>();

  constructor(b: BuildResult) {
    this.nodes = b.nodes; this.edges = b.edges; this.aliasIndex = b.aliasIndex;
    this.rejected = b.rejected; this.issues = b.issues;
    for (const e of b.edges.values()) {
      if (!this.out.has(e.from_id)) this.out.set(e.from_id, []);
      if (!this.inc.has(e.to_id)) this.inc.set(e.to_id, []);
      this.out.get(e.from_id)!.push(e);
      this.inc.get(e.to_id)!.push(e);
    }
  }

  // ---------------------------------------------------------------- queries

  getNode(id: string): GraphNode | undefined { return this.nodes.get(id); }

  /**
   * Resolve a surface string to a canonical node.
   *
   * Exact normalized match, then the curated alias index. There is no fuzzy fallback, no edit
   * distance and no embedding lookup - an unknown string returns UNRESOLVED rather than the
   * nearest-looking concept, because a wrong merge is far more damaging than a miss.
   */
  resolve(surface: string, type?: NodeType): { node: GraphNode | null; kind: AliasKind } {
    const n = normalize(surface);
    if (type) {
      const direct = this.nodes.get(nodeId(type, n));
      if (direct) return { node: direct, kind: 'EXACT_ALIAS' };
    }
    for (const t of ['TECHNOLOGY', 'CAPABILITY', 'TECHNOLOGY_CLASS', 'ROLE_FAMILY', 'DOMAIN', 'EVIDENCE_TYPE'] as NodeType[]) {
      const hit = this.nodes.get(nodeId(t, n));
      if (hit) return { node: hit, kind: 'EXACT_ALIAS' };
    }
    const alias = this.aliasIndex.get(n);
    if (alias) return { node: this.nodes.get(alias.node_id) ?? null, kind: alias.kind };
    return { node: null, kind: 'UNRESOLVED' };
  }

  /** Outgoing edges, optionally filtered by type. Symmetric types also answer from the far side. */
  neighbors(id: string, type?: RelationshipType): GraphEdge[] {
    const forward = (this.out.get(id) ?? []).filter((e) => !type || e.type === type);
    const backward = (this.inc.get(id) ?? [])
      .filter((e) => SYMMETRIC_TYPES.has(e.type) && (!type || e.type === type))
      .map((e) => ({ ...e, from_id: e.to_id, to_id: e.from_id }));
    return [...forward, ...backward];
  }

  /**
   * Bounded path discovery. maxDepth is capped so a malicious or accidental query cannot walk the
   * graph unboundedly - resource exhaustion is an explicit Phase 5 security concern.
   */
  findPaths(fromId: string, toId: string, maxDepth = 4): GraphEdge[][] {
    const depth = Math.min(maxDepth, 6);
    const results: GraphEdge[][] = [];
    const walk = (cur: string, path: GraphEdge[], seen: Set<string>) => {
      if (path.length >= depth || results.length >= 50) return;
      for (const e of this.neighbors(cur)) {
        if (seen.has(e.to_id)) continue;
        const next = [...path, e];
        if (e.to_id === toId) { results.push(next); continue; }
        walk(e.to_id, next, new Set([...seen, e.to_id]));
      }
    };
    walk(fromId, [], new Set([fromId]));
    return results;
  }

  /**
   * Concepts reachable within `depth` hops, WITH the path that justified each one.
   *
   * The path is returned rather than a flat set on purpose: "FastAPI relates to Backend
   * Engineering" is only meaningful alongside the IS_A -> PART_OF chain that produced it. A
   * consumer that wants only direct facts filters on path length 1. Nothing here is stored as an
   * edge - transitive derivation stays a query result, never a materialised fact.
   */
  expand(id: string, depth = 2): { node_id: string; via: GraphEdge[] }[] {
    const out: { node_id: string; via: GraphEdge[] }[] = [];
    const seen = new Set([id]);
    let frontier: { node_id: string; via: GraphEdge[] }[] = [{ node_id: id, via: [] }];
    for (let d = 0; d < Math.min(depth, 4); d++) {
      const next: typeof frontier = [];
      for (const f of frontier) {
        for (const e of this.neighbors(f.node_id)) {
          if (seen.has(e.to_id)) continue;
          seen.add(e.to_id);
          const entry = { node_id: e.to_id, via: [...f.via, e] };
          out.push(entry); next.push(entry);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Every node/edge reachable from a seed set - the subgraph a later phase would reason over. */
  subgraph(ids: string[], depth = 2): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodeIds = new Set(ids);
    const edges = new Map<string, GraphEdge>();
    for (const id of ids) {
      for (const r of this.expand(id, depth)) {
        nodeIds.add(r.node_id);
        for (const e of r.via) edges.set(e.edge_id, e);
      }
    }
    return {
      nodes: [...nodeIds].map((i) => this.nodes.get(i)).filter((n): n is GraphNode => !!n),
      edges: [...edges.values()],
    };
  }

  /** Stable digest over the whole graph - the reproducibility check for §25. */
  fingerprint(): string {
    const parts = [
      `schema:${GRAPH_SCHEMA_VERSION}`, `ontology:${ONTOLOGY_VERSION}`, `engine:${GRAPH_ENGINE_VERSION}`,
      ...[...this.nodes.keys()].sort(),
      ...[...this.edges.keys()].sort(),
    ];
    return 'sha256:' + createHash('sha256').update(parts.join('\n')).digest('hex');
  }
}

// ==================== BUILD ====================

/**
 * Deterministic construction. Insertion order never affects the result: nodes and edges are keyed
 * by stable ids, so building twice - or from two concurrent callers - yields the same graph. That
 * is what makes idempotency and concurrency properties of the design rather than of a lock.
 */
export function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const aliasIndex = new Map<string, { node_id: string; kind: AliasKind }>();
  const rejected: { fact: string; reason: string }[] = [];
  const issues: ValidationIssue[] = [];

  const addNode = (
    name: string, type: NodeType, aliases: { alias: string; kind: AliasKind }[],
    provenance: GraphProvenance,
  ): GraphNode => {
    const id = nodeId(type, name);
    const existing = nodes.get(id);
    if (existing) return existing;   // idempotent by construction
    const node: GraphNode = {
      node_id: id, canonical_name: name, node_type: type, normalized_name: normalize(name),
      aliases, provenance, valid_from: VALID_FROM, valid_to: null, status: 'ACTIVE',
    };
    nodes.set(id, node);
    for (const a of aliases) {
      const key = normalize(a.alias);
      const prior = aliasIndex.get(key);
      if (prior && prior.node_id !== id) {
        // Two concepts claiming one surface form. Neither wins - the alias is dropped and the
        // collision recorded, because silently picking one is how a false merge enters a graph.
        issues.push({ path: `alias:${a.alias}`, problem: `collides between ${prior.node_id} and ${id}` });
        aliasIndex.delete(key);
        continue;
      }
      if (!nodes.has(nodeId(type, a.alias))) aliasIndex.set(key, { node_id: id, kind: a.kind });
    }
    return node;
  };

  // ---- 1. concepts from the curated ontology vocabulary
  for (const seed of ONTOLOGY_NODES) {
    addNode(seed.name, seed.type,
      [{ alias: seed.name, kind: 'EXACT_ALIAS' },
        ...(seed.aliases ?? []).map((a) => ({ alias: a, kind: 'ONTOLOGY_ALIAS' as AliasKind }))],
      prov('CURATED_ONTOLOGY', 'ONTOLOGY', 'VALIDATED', 'ontology.seed'));
  }

  // ---- 2. technologies from the dictionary that already seeds the existing skill_nodes tables
  for (const entry of SKILL_DICTIONARY) {
    addNode(entry.canonical, 'TECHNOLOGY',
      entry.aliases.map((a) => ({
        alias: a,
        // The canonical spelling is an exact form; every other surface is a curated human decision
        // recorded in the dictionary, which is what makes 'Postgres' -> PostgreSQL validated rather
        // than guessed.
        kind: (normalize(a) === normalize(entry.canonical) ? 'EXACT_ALIAS' : 'VALIDATED_ALIAS') as AliasKind,
      })),
      prov('CURATED_DICTIONARY', 'DERIVED', 'VALIDATED', 'dictionary.import',
        { source_field: 'category', source_text: entry.category }));
  }

  // ---- edge insertion with full contract + cycle checking
  const addEdge = (
    fromName: string, fromType: NodeType | null, type: RelationshipType,
    toName: string, toType: NodeType | null, provenance: GraphProvenance, label: string,
  ): boolean => {
    // TYPE-DIRECTED RESOLUTION. A name can legitimately denote several kinds of thing: the
    // dictionary carries "Machine Learning" as a TECHNOLOGY (category ai_ml) while the ontology
    // also defines it as a CAPABILITY and a ROLE_FAMILY. Resolving by first-match rejected correct
    // facts like "machine learning PART_OF Machine Learning" because the source resolved to the
    // technology. Each endpoint is therefore resolved against the types its contract permits, which
    // makes the relationship itself disambiguate the name.
    const contractTypes = RELATIONSHIP_CONTRACTS[type];
    const from = fromType ? nodes.get(nodeId(fromType, fromName))
      : findTyped(nodes, fromName, contractTypes.from);
    const to = toType ? nodes.get(nodeId(toType, toName))
      : findTyped(nodes, toName, contractTypes.to);
    if (!from) { rejected.push({ fact: label, reason: `unknown source concept "${fromName}"` }); return false; }
    if (!to) { rejected.push({ fact: label, reason: `unknown target concept "${toName}"` }); return false; }

    const contract = RELATIONSHIP_CONTRACTS[type];
    if (!contract.from.includes(from.node_type)) {
      rejected.push({ fact: label, reason: `${type} illegal from ${from.node_type}` }); return false;
    }
    if (!contract.to.includes(to.node_type)) {
      rejected.push({ fact: label, reason: `${type} illegal to ${to.node_type}` }); return false;
    }
    if (from.node_id === to.node_id) {
      rejected.push({ fact: label, reason: 'self-loop' }); return false;
    }
    const id = edgeId(from.node_id, type, to.node_id);
    if (edges.has(id)) return true;   // idempotent

    if (ACYCLIC_TYPES.has(type) && createsCycle(edges, from.node_id, to.node_id, type)) {
      rejected.push({ fact: label, reason: `would create a ${type} cycle` }); return false;
    }
    edges.set(id, {
      edge_id: id, from_id: from.node_id, to_id: to.node_id, type,
      provenance, valid_from: VALID_FROM, valid_to: null, status: 'ACTIVE',
    });
    return true;
  };

  // ---- 3. class edges derived mechanically from dictionary categories
  for (const entry of SKILL_DICTIONARY) {
    const map = CATEGORY_CLASS_EDGES[entry.category];
    if (!map) continue;
    const p = prov('CURATED_DICTIONARY', 'DERIVED', 'HIGH', 'ontology.category_map',
      { source_field: 'category', source_text: entry.category });
    if (map.is_a) addEdge(entry.canonical, 'TECHNOLOGY', 'IS_A', map.is_a, 'TECHNOLOGY_CLASS', p,
      `${entry.canonical} IS_A ${map.is_a}`);
    for (const cap of map.used_for ?? []) {
      addEdge(entry.canonical, 'TECHNOLOGY', 'USED_FOR', cap, 'CAPABILITY', p,
        `${entry.canonical} USED_FOR ${cap}`);
    }
  }

  // ---- 4. curated facts, each carrying its own rationale as provenance text
  for (const f of CURATED_FACTS) {
    addEdge(f.from, f.from_type ?? null, f.type, f.to, f.to_type ?? null,
      prov('CURATED_ONTOLOGY', 'ONTOLOGY', 'VALIDATED', 'ontology.curated_fact',
        { source_text: f.rationale }),
      `${f.from} ${f.type} ${f.to}`);
  }

  // ---- 5. non-mergeable guard: assert the pairs really are distinct nodes
  for (const [a, b] of NON_MERGEABLE) {
    const ra = findAny(nodes, a), rb = findAny(nodes, b);
    if (ra && rb && ra.node_id === rb.node_id) {
      issues.push({ path: `non_mergeable:${a}/${b}`, problem: 'concepts collapsed into one node' });
    }
    for (const [x, y] of [[ra, b], [rb, a]] as const) {
      if (!x) continue;
      if (x.aliases.some((al) => normalize(al.alias) === normalize(y))) {
        issues.push({ path: `non_mergeable:${a}/${b}`, problem: `"${y}" is an alias of ${x.node_id}` });
      }
    }
  }

  return new KnowledgeGraph({ nodes, edges, aliasIndex, rejected, issues });
}

/** Resolve a name against an ordered set of permitted types - used by type-directed edge insertion. */
function findTyped(
  nodes: Map<string, GraphNode>, name: string, types: readonly NodeType[],
): GraphNode | undefined {
  const n = normalize(name);
  for (const t of types) {
    const hit = nodes.get(nodeId(t, n));
    if (hit) return hit;
  }
  return undefined;
}

function findAny(nodes: Map<string, GraphNode>, name: string): GraphNode | undefined {
  const n = normalize(name);
  for (const t of ['TECHNOLOGY', 'CAPABILITY', 'TECHNOLOGY_CLASS', 'ROLE_FAMILY', 'DOMAIN', 'EVIDENCE_TYPE'] as NodeType[]) {
    const hit = nodes.get(nodeId(t, n));
    if (hit) return hit;
  }
  return undefined;
}

/** Would from->to close a loop within this relationship type? Walks the existing edges of that type. */
function createsCycle(
  edges: Map<string, GraphEdge>, fromId: string, toId: string, type: RelationshipType,
): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges.values()) {
    if (e.type !== type) continue;
    if (!adj.has(e.from_id)) adj.set(e.from_id, []);
    adj.get(e.from_id)!.push(e.to_id);
  }
  const stack = [toId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return false;
}

// ==================== AUDIT ====================

export interface GraphAudit {
  nodes: number;
  edges: number;
  by_node_type: Record<string, number>;
  by_edge_type: Record<string, number>;
  rejected: number;
  issues: ValidationIssue[];
  orphan_nodes: string[];
  /** Vocabulary concepts with no global edge - expected, they are instance-fact targets. */
  vocabulary_nodes_unlinked: string[];
  invalid_edges: string[];
  missing_provenance: number;
  cycles: string[];
  duplicate_identities: string[];
  /** Same name, different node types. Expected and legal; resolved by type-directed lookup. */
  cross_type_polysemy: string[];
}

/** Full structural audit. Every count in §45 is produced here rather than asserted by hand. */
export function auditGraph(g: KnowledgeGraph): GraphAudit {
  const byNode: Record<string, number> = {};
  const byEdge: Record<string, number> = {};
  for (const n of g.nodes.values()) byNode[n.node_type] = (byNode[n.node_type] ?? 0) + 1;
  for (const e of g.edges.values()) byEdge[e.type] = (byEdge[e.type] ?? 0) + 1;

  const connected = new Set<string>();
  for (const e of g.edges.values()) { connected.add(e.from_id); connected.add(e.to_id); }

  const invalid: string[] = [];
  let missingProv = 0;
  for (const e of g.edges.values()) {
    const c = RELATIONSHIP_CONTRACTS[e.type];
    const from = g.nodes.get(e.from_id), to = g.nodes.get(e.to_id);
    // Referential integrity: an edge whose endpoint is absent is the half-valid state §33 forbids.
    if (!from || !to) { invalid.push(`${e.edge_id}: dangling endpoint`); continue; }
    if (!c.from.includes(from.node_type) || !c.to.includes(to.node_type)) {
      invalid.push(`${e.edge_id}: violates ${e.type} contract`);
    }
    if (!e.provenance || !e.provenance.derivation || !e.provenance.confidence
      || !e.provenance.created_by) missingProv++;
  }
  for (const n of g.nodes.values()) {
    if (!n.provenance || !n.provenance.derivation || !n.provenance.confidence) missingProv++;
  }

  // Cycles among the acyclic types, detected on the finished graph rather than only at insertion.
  const cycles: string[] = [];
  for (const type of ACYCLIC_TYPES) {
    const adj = new Map<string, string[]>();
    for (const e of g.edges.values()) {
      if (e.type !== type) continue;
      if (!adj.has(e.from_id)) adj.set(e.from_id, []);
      adj.get(e.from_id)!.push(e.to_id);
    }
    const state = new Map<string, 0 | 1 | 2>();
    const dfs = (id: string, path: string[]): void => {
      state.set(id, 1);
      for (const n of adj.get(id) ?? []) {
        if (state.get(n) === 1) cycles.push(`${type}: ${[...path, id, n].join(' -> ')}`);
        else if (!state.has(n)) dfs(n, [...path, id]);
      }
      state.set(id, 2);
    };
    for (const id of adj.keys()) if (!state.has(id)) dfs(id, []);
  }

  // DUPLICATE IDENTITY means two nodes of the SAME type sharing a normalized name - that is a real
  // resolution defect, because nothing could then choose between them.
  //
  // The same name across DIFFERENT types is not a duplicate: "Machine Learning" is genuinely a
  // dictionary skill, a capability and a role family, and forcing those into one node would be a
  // false merge of three distinct concepts. Cross-type polysemy is reported separately and resolved
  // by the type-directed lookup rather than treated as corruption.
  const byNorm = new Map<string, string[]>();
  for (const n of g.nodes.values()) {
    const key = `${n.node_type}|${n.normalized_name}`;
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key)!.push(n.node_id);
  }
  const polysemyMap = new Map<string, string[]>();
  for (const n of g.nodes.values()) {
    if (!polysemyMap.has(n.normalized_name)) polysemyMap.set(n.normalized_name, []);
    polysemyMap.get(n.normalized_name)!.push(n.node_type);
  }

  return {
    nodes: g.nodes.size,
    edges: g.edges.size,
    by_node_type: byNode,
    by_edge_type: byEdge,
    rejected: g.rejected.length,
    issues: g.issues,
    // ORPHAN means a concept the ontology defines but never relates to anything - a real quality
    // gap for a TECHNOLOGY, TECHNOLOGY_CLASS or CAPABILITY.
    //
    // DOMAIN, EVIDENCE_TYPE and ROLE_FAMILY nodes are different: they are the vocabulary that
    // INSTANCE facts point at (IN_DOMAIN, HAS_ROLE_FAMILY, and Phase 6's evidence hooks). A domain
    // with no global edge is not broken - asserting one just to connect it would be inventing
    // knowledge to satisfy a metric.
    orphan_nodes: [...g.nodes.values()]
      .filter((n) => !connected.has(n.node_id)
        && (n.node_type === 'TECHNOLOGY' || n.node_type === 'TECHNOLOGY_CLASS' || n.node_type === 'CAPABILITY'))
      .map((n) => n.node_id),
    vocabulary_nodes_unlinked: [...g.nodes.values()]
      .filter((n) => !connected.has(n.node_id)
        && (n.node_type === 'DOMAIN' || n.node_type === 'EVIDENCE_TYPE' || n.node_type === 'ROLE_FAMILY'))
      .map((n) => n.node_id),
    invalid_edges: invalid,
    missing_provenance: missingProv,
    cycles,
    duplicate_identities: [...byNorm.entries()].filter(([, v]) => v.length > 1).map(([k]) => k),
    cross_type_polysemy: [...polysemyMap.entries()].filter(([, v]) => v.length > 1)
      .map(([k, v]) => `${k} (${v.sort().join('/')})`),
  };
}
