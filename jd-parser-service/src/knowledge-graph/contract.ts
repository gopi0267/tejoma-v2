/**
 * TEJOMA Phase 5 - Knowledge Graph contract.
 *
 * WHAT THE INSPECTION FOUND, AND WHY IT SHAPES EVERYTHING BELOW
 * Five databases already carry `skill_nodes` / `skill_edges`. They are not a semantic graph:
 * 484 of 485 edges are `COMMONLY_WITH` produced by `computed_cooccurrence`, and the single
 * remaining edge is `FRAMEWORK_OF` between two nodes literally named "Smoketest Skill Batch33".
 * The five copies have also drifted apart - 183 / 186 / 186 / 187 nodes and 484 / 485 edges - so
 * none of them is authoritative.
 *
 * Co-occurrence is a correlation signal, not meaning. "Python appears near Docker in 27% of
 * postings" says nothing about whether one IS_A, ENABLES or DEPENDS_ON the other, and the brief is
 * explicit that statistical similarity must never become graph truth. So the semantic layer this
 * phase is asked for genuinely does not exist yet, while a sixth copy of the node table would make
 * the drift problem strictly worse.
 *
 * THE RESULTING DESIGN
 *   identity      - reused from the curated 174-entry dictionary that already seeds 171 of those
 *                   nodes. One source of truth for "what is a concept", not a new taxonomy.
 *   semantics     - NEW. Typed, directed, constraint-checked, provenance-bearing relationships.
 *   persistence   - none. See the note on §37 in graph.ts: the graph is a pure function of
 *                   (dictionary version, ontology version, engine version), so it is reproducible
 *                   rather than mutable state, and adding a sixth table is the one thing the
 *                   inspection says not to do.
 *
 * NO LLM. Same reasoning as Phases 3 and 4, and sharper here: a generative model asked for
 * relationships produces fluent ontology that nobody can trace, which is precisely the
 * unverifiable graph fact this contract exists to make impossible.
 */

export const GRAPH_SCHEMA_VERSION = 1;
export const ONTOLOGY_VERSION = 1;
export const GRAPH_ENGINE_VERSION = 1;

// ==================== NODE TYPES ====================

/**
 * Only the node types the existing data model and the declared Phase 6/7 consumers actually need.
 * The brief lists ~20 candidates; introducing all of them would create empty categories nothing
 * populates, and an empty node type is indistinguishable from a broken ingestion.
 *
 * TECHNOLOGY_CLASS exists so IS_A has a legal target: "FastAPI IS_A backend framework" needs the
 * class to be a node, not a string.
 */
export const NODE_TYPES = [
  'TECHNOLOGY',        // concrete named tooling: FastAPI, PostgreSQL, Kubernetes
  'TECHNOLOGY_CLASS',  // the kind a technology belongs to: backend framework, data store
  'CAPABILITY',        // something a person can do: API development, container orchestration
  'ROLE_FAMILY',       // Backend Engineering, Platform Engineering
  'DOMAIN',            // FinTech, Healthcare - industry context
  'EVIDENCE_TYPE',     // PRODUCTION_EXPERIENCE, PROJECT_EVIDENCE - shared with Phases 3/4
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

// ==================== RELATIONSHIP TYPES ====================

/**
 * Every type here has a defined semantic contract in RELATIONSHIP_CONTRACTS below. The brief lists
 * twenty candidates; a relationship with no contract is an invitation to arbitrary graph
 * construction, so only those with a stated meaning AND a legal type signature are admitted.
 */
export const RELATIONSHIP_TYPES = [
  'IS_A',            // subsumption: FastAPI IS_A backend framework
  'PART_OF',         // composition: Python Web Framework PART_OF Backend Engineering
  'USED_FOR',        // purpose: Kubernetes USED_FOR container orchestration
  'ENABLES',         // makes possible: container orchestration ENABLES cloud-native deployment
  'REQUIRES',        // hard dependency: Django REQUIRES Python
  'RELATED_TO',      // symmetric association, the weakest admissible claim
  'ALTERNATIVE_TO',  // substitutable for the same purpose: Flask ALTERNATIVE_TO FastAPI
  'BELONGS_TO',      // organisational: Backend Engineering BELONGS_TO Engineering
  'APPLIES_TO',      // a capability applies to a domain
  'DEMONSTRATED_BY', // capability DEMONSTRATED_BY evidence type - the Phase 6 hook
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Symmetric types are stored once and answered in both directions by the query layer. */
export const SYMMETRIC_TYPES: ReadonlySet<RelationshipType> =
  new Set(['RELATED_TO', 'ALTERNATIVE_TO']);

/**
 * Transitive types are the ones a FUTURE reasoning phase may chain. Declared here so Phase 7 does
 * not have to guess, and so this phase can prove it never materialises a chained edge as a fact.
 */
export const TRANSITIVE_TYPES: ReadonlySet<RelationshipType> = new Set(['IS_A', 'PART_OF']);

/** Types where a cycle is a semantic error rather than a legitimate mutual association. */
export const ACYCLIC_TYPES: ReadonlySet<RelationshipType> =
  new Set(['IS_A', 'PART_OF', 'REQUIRES', 'BELONGS_TO']);

// ==================== SEMANTIC CONTRACTS ====================

export interface RelationshipContract {
  type: RelationshipType;
  /** Legal source node types. An edge whose endpoints violate this is rejected. */
  from: readonly NodeType[];
  to: readonly NodeType[];
  meaning: string;
}

/**
 * The type signature of every legal edge. This is what stops "a ROLE IS_A a TECHNOLOGY" or "a
 * TECHNOLOGY REQUIRES a JOB" from ever being stored - the constraint lives in the contract rather
 * than in the caller's discipline.
 */
export const RELATIONSHIP_CONTRACTS: Record<RelationshipType, RelationshipContract> = {
  IS_A: { type: 'IS_A', from: ['TECHNOLOGY', 'TECHNOLOGY_CLASS', 'CAPABILITY'],
    to: ['TECHNOLOGY_CLASS', 'CAPABILITY'],
    meaning: 'the source is a kind of the target; the target subsumes the source' },
  // ROLE_FAMILY is a legal source because "Backend Engineering PART_OF Full Stack Engineering" is a
  // genuine containment claim; omitting it rejected a correct fact.
  PART_OF: { type: 'PART_OF', from: ['TECHNOLOGY_CLASS', 'CAPABILITY', 'ROLE_FAMILY'],
    to: ['CAPABILITY', 'ROLE_FAMILY'],
    meaning: 'the source is a component of the broader target' },
  USED_FOR: { type: 'USED_FOR', from: ['TECHNOLOGY', 'TECHNOLOGY_CLASS'],
    to: ['CAPABILITY'],
    meaning: 'the source is a means of achieving the target capability' },
  ENABLES: { type: 'ENABLES', from: ['TECHNOLOGY', 'CAPABILITY'],
    to: ['CAPABILITY'],
    meaning: 'the source makes the target capability practically attainable' },
  REQUIRES: { type: 'REQUIRES', from: ['TECHNOLOGY', 'CAPABILITY', 'ROLE_FAMILY'],
    to: ['TECHNOLOGY', 'CAPABILITY'],
    meaning: 'the source cannot function or be performed without the target' },
  RELATED_TO: { type: 'RELATED_TO', from: ['TECHNOLOGY', 'CAPABILITY', 'DOMAIN', 'ROLE_FAMILY'],
    to: ['TECHNOLOGY', 'CAPABILITY', 'DOMAIN', 'ROLE_FAMILY'],
    meaning: 'symmetric association with no stronger claim available' },
  ALTERNATIVE_TO: { type: 'ALTERNATIVE_TO', from: ['TECHNOLOGY'], to: ['TECHNOLOGY'],
    meaning: 'symmetric: either can serve the same purpose in the same class' },
  BELONGS_TO: { type: 'BELONGS_TO', from: ['ROLE_FAMILY', 'CAPABILITY'], to: ['ROLE_FAMILY'],
    meaning: 'organisational containment' },
  APPLIES_TO: { type: 'APPLIES_TO', from: ['CAPABILITY', 'TECHNOLOGY'], to: ['DOMAIN'],
    meaning: 'the source is meaningfully practised within the target domain' },
  DEMONSTRATED_BY: { type: 'DEMONSTRATED_BY', from: ['CAPABILITY', 'TECHNOLOGY'],
    to: ['EVIDENCE_TYPE'],
    meaning: 'the target kind of evidence would substantiate the source; Phase 6 consumes this' },
};

// ==================== IDENTITY / ALIASES ====================

/**
 * How an alias earned its place. The distinction is the whole defence against false merges: an
 * EXACT_ALIAS is a spelling, a VALIDATED_ALIAS is a curated human decision, and INFERRED_ALIAS -
 * which this phase never produces - would be a guess. Nothing here is created from embedding or
 * co-occurrence similarity.
 */
export const ALIAS_KINDS = [
  'EXACT_ALIAS',      // differs only by case/punctuation/whitespace
  'VALIDATED_ALIAS',  // curated in the dictionary: Postgres -> PostgreSQL
  'ONTOLOGY_ALIAS',   // asserted by a curated ontology fact
  'INFERRED_ALIAS',   // never emitted by this phase; reserved so consumers can reject it
  'UNRESOLVED',
] as const;
export type AliasKind = (typeof ALIAS_KINDS)[number];

// ==================== CONFIDENCE / PROVENANCE ====================

/** Ordinal evidence classes, as in Phases 3 and 4. No invented probabilities. */
export const GRAPH_CONFIDENCES = ['EXPLICIT', 'VALIDATED', 'HIGH', 'MEDIUM', 'LOW', 'UNRESOLVED'] as const;
export type GraphConfidence = (typeof GRAPH_CONFIDENCES)[number];

export const DERIVATIONS = ['EXPLICIT', 'DERIVED', 'ONTOLOGY', 'VALIDATED_EXTERNAL', 'INFERRED'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

export interface GraphProvenance {
  source_type: 'CURATED_DICTIONARY' | 'CURATED_ONTOLOGY' | 'JD_INTELLIGENCE' | 'CANDIDATE_INTELLIGENCE';
  source_id: string | null;
  source_field: string | null;
  source_text: string | null;
  derivation: Derivation;
  confidence: GraphConfidence;
  created_by: string;
  graph_schema_version: number;
  ontology_version: number;
  engine_version: number;
  /** Phase 2/3/4 lineage where the fact came from an intelligence profile. */
  intelligence_hash?: string | null;
}

// ==================== SCOPE ====================

/**
 * Global concepts are shared knowledge; instance facts belong to exactly one tenant and one entity.
 * Keeping them in different structures - rather than one table with a nullable tenant column - is
 * what makes cross-tenant leakage a type error instead of a missing WHERE clause.
 */
export interface GraphNode {
  node_id: string;              // stable: `${type}:${normalized_name}`
  canonical_name: string;
  node_type: NodeType;
  normalized_name: string;
  aliases: { alias: string; kind: AliasKind }[];
  provenance: GraphProvenance;
  valid_from: string;
  valid_to: string | null;
  status: 'ACTIVE' | 'DEPRECATED';
}

export interface GraphEdge {
  edge_id: string;              // stable: `${from}|${type}|${to}`
  from_id: string;
  to_id: string;
  type: RelationshipType;
  provenance: GraphProvenance;
  valid_from: string;
  valid_to: string | null;
  status: 'ACTIVE' | 'DEPRECATED';
}

/**
 * A fact about ONE job or ONE candidate. Deliberately a separate type from GraphEdge: a candidate
 * demonstrating Kubernetes must never be able to become a global statement about Kubernetes, and
 * the type system is a better guarantee of that than a code review.
 */
export interface InstanceFact {
  subject_kind: 'JOB' | 'CANDIDATE';
  subject_id: string;
  tenant_id: string;
  predicate: 'REQUIRES' | 'PREFERS' | 'EXCLUDES' | 'DEMONSTRATES' | 'CLAIMS' | 'HAS_ROLE_FAMILY' | 'IN_DOMAIN';
  object_id: string;            // a global node_id
  qualifier: string | null;     // requirement level or evidence strength, carried verbatim
  provenance: GraphProvenance;
}

export interface ValidationIssue { path: string; problem: string }
