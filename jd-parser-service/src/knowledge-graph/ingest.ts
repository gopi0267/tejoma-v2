/**
 * Ingestion of Phase 3 JD profiles and Phase 4 candidate profiles into instance facts.
 *
 * THE INVARIANT THIS FILE EXISTS TO ENFORCE
 * An instance fact says something about ONE job or ONE candidate inside ONE tenant. It can never
 * become a global statement. "This candidate demonstrates Kubernetes" must not drift into
 * "Kubernetes is required" or "Kubernetes RELATED_TO this candidate's other skills" - so ingestion
 * only ever emits `InstanceFact`, never `GraphEdge`, and the global graph passed in is treated as
 * read-only. The type system carries the guarantee; a test asserts the object is unmutated.
 *
 * Concepts that do not resolve to a curated node are REPORTED, not created. Minting a global
 * concept because one JD mentioned a word is how an ontology fills with noise, and it would let
 * untrusted tenant text define shared knowledge.
 */

import type { InstanceFact, GraphProvenance } from './contract.js';
import {
  GRAPH_ENGINE_VERSION, GRAPH_SCHEMA_VERSION, ONTOLOGY_VERSION,
} from './contract.js';
import type { KnowledgeGraph } from './graph.js';

export interface IngestResult {
  facts: InstanceFact[];
  /** Surfaces the graph could not resolve. Reported for ontology review, never auto-created. */
  unresolved: { surface: string; from: string }[];
  resolved: number;
}

const prov = (
  source_type: GraphProvenance['source_type'], field: string, text: string,
  derivation: GraphProvenance['derivation'], confidence: GraphProvenance['confidence'],
  sourceId: string, intelligenceHash: string | null,
): GraphProvenance => ({
  source_type, source_id: sourceId, source_field: field, source_text: text,
  derivation, confidence, created_by: 'kg.ingest',
  graph_schema_version: GRAPH_SCHEMA_VERSION,
  ontology_version: ONTOLOGY_VERSION,
  engine_version: GRAPH_ENGINE_VERSION,
  intelligence_hash: intelligenceHash,
});

/** Phase 3 requirement level -> instance predicate. EXCLUDED stays negative, never dropped. */
const JD_PREDICATE: Record<string, InstanceFact['predicate'] | null> = {
  MANDATORY: 'REQUIRES',
  STRONGLY_PREFERRED: 'PREFERS',
  PREFERRED: 'PREFERS',
  OPTIONAL: 'PREFERS',
  EXCLUDED: 'EXCLUDES',
  // A mention with no requirement force is not a requirement. Emitting one would manufacture a
  // demand the employer never made - the exact failure Phase 3 works to avoid.
  CONTEXTUAL: null,
  INFORMATIONAL: null,
};

/** Confidence carried from the profile's own evidence, never re-derived optimistically. */
const JD_CONFIDENCE: Record<string, GraphProvenance['confidence']> = {
  MANDATORY: 'EXPLICIT', STRONGLY_PREFERRED: 'EXPLICIT', PREFERRED: 'EXPLICIT',
  OPTIONAL: 'EXPLICIT', EXCLUDED: 'EXPLICIT',
};

interface JdProfileLike {
  job_id?: number | null;
  role_family?: string | null;
  requirements?: { subject: string; level: string; provenance?: { source_field?: string } }[];
  intelligence_hash?: string;
}

export function ingestJobProfile(
  graph: KnowledgeGraph, profile: JdProfileLike, tenantId: string,
): IngestResult {
  const facts: InstanceFact[] = [];
  const unresolved: { surface: string; from: string }[] = [];
  const seen = new Set<string>();
  const subjectId = String(profile.job_id ?? 'unknown');
  const hash = profile.intelligence_hash ?? null;

  for (const r of profile.requirements ?? []) {
    const predicate = JD_PREDICATE[r.level];
    if (!predicate) continue;
    const { node } = graph.resolve(r.subject);
    if (!node) { unresolved.push({ surface: r.subject, from: 'requirement' }); continue; }
    // Deduplicated by (predicate, object): a JD naming Python twice at the same level is one fact.
    const key = `${predicate}|${node.node_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      subject_kind: 'JOB', subject_id: subjectId, tenant_id: tenantId,
      predicate, object_id: node.node_id, qualifier: r.level,
      provenance: prov('JD_INTELLIGENCE', r.provenance?.source_field ?? 'requirements',
        r.subject, 'EXPLICIT', JD_CONFIDENCE[r.level] ?? 'MEDIUM', subjectId, hash),
    });
  }

  if (profile.role_family) {
    const { node } = graph.resolve(profile.role_family, 'ROLE_FAMILY');
    if (node) {
      facts.push({
        subject_kind: 'JOB', subject_id: subjectId, tenant_id: tenantId,
        predicate: 'HAS_ROLE_FAMILY', object_id: node.node_id, qualifier: null,
        provenance: prov('JD_INTELLIGENCE', 'role_family', profile.role_family,
          'DERIVED', 'HIGH', subjectId, hash),
      });
    } else unresolved.push({ surface: profile.role_family, from: 'role_family' });
  }
  return { facts, unresolved, resolved: facts.length };
}

/**
 * Candidate assertion -> predicate.
 *
 * DECLARED and MENTIONED become CLAIMS; only DEMONSTRATED/VERIFIED become DEMONSTRATES. That split
 * is Phase 4's central distinction and it must survive into the graph - collapsing them here would
 * undo the entire evidence model one layer later.
 */
const CANDIDATE_PREDICATE: Record<string, InstanceFact['predicate'] | null> = {
  DEMONSTRATED: 'DEMONSTRATES',
  VERIFIED: 'DEMONSTRATES',
  DECLARED: 'CLAIMS',
  MENTIONED: 'CLAIMS',
  INFERRED: null,   // an engine judgement is not a candidate assertion
  NEGATED: null,    // handled separately below as an explicit exclusion
};

interface CandidateProfileLike {
  candidate_id?: number | null;
  role_family?: string | null;
  evidence_role_family?: string | null;
  skills?: { skill: string; assertion: string; evidence_strength: string; depth: string }[];
  domains?: { domain: string }[];
  intelligence_hash?: string;
}

export function ingestCandidateProfile(
  graph: KnowledgeGraph, profile: CandidateProfileLike, tenantId: string,
): IngestResult {
  const facts: InstanceFact[] = [];
  const unresolved: { surface: string; from: string }[] = [];
  const seen = new Set<string>();
  const subjectId = String(profile.candidate_id ?? 'unknown');
  const hash = profile.intelligence_hash ?? null;

  for (const s of profile.skills ?? []) {
    const { node } = graph.resolve(s.skill);
    if (!node) { unresolved.push({ surface: s.skill, from: 'skill' }); continue; }

    // A denial is recorded as a negative fact, not silently dropped: "I have not used Kubernetes"
    // is information a later phase needs, and losing it would let the skill be re-inferred.
    const predicate = s.assertion === 'NEGATED' ? 'EXCLUDES' : CANDIDATE_PREDICATE[s.assertion];
    if (!predicate) continue;
    const key = `${predicate}|${node.node_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    facts.push({
      subject_kind: 'CANDIDATE', subject_id: subjectId, tenant_id: tenantId,
      predicate, object_id: node.node_id,
      // The qualifier carries Phase 4's evidence grading verbatim so nothing is re-graded here.
      qualifier: `${s.depth}/${s.evidence_strength}`,
      provenance: prov('CANDIDATE_INTELLIGENCE', 'skills', s.skill, 'EXPLICIT',
        s.assertion === 'DEMONSTRATED' ? 'HIGH' : 'MEDIUM', subjectId, hash),
    });
  }

  const family = profile.evidence_role_family ?? profile.role_family;
  if (family) {
    const { node } = graph.resolve(family, 'ROLE_FAMILY');
    if (node) {
      facts.push({
        subject_kind: 'CANDIDATE', subject_id: subjectId, tenant_id: tenantId,
        predicate: 'HAS_ROLE_FAMILY', object_id: node.node_id, qualifier: null,
        provenance: prov('CANDIDATE_INTELLIGENCE', 'evidence_role_family', family,
          'DERIVED', 'MEDIUM', subjectId, hash),
      });
    } else unresolved.push({ surface: family, from: 'role_family' });
  }

  for (const d of profile.domains ?? []) {
    const { node } = graph.resolve(d.domain, 'DOMAIN');
    if (!node) { unresolved.push({ surface: d.domain, from: 'domain' }); continue; }
    const key = `IN_DOMAIN|${node.node_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      subject_kind: 'CANDIDATE', subject_id: subjectId, tenant_id: tenantId,
      predicate: 'IN_DOMAIN', object_id: node.node_id, qualifier: null,
      provenance: prov('CANDIDATE_INTELLIGENCE', 'domains', d.domain, 'EXPLICIT', 'HIGH', subjectId, hash),
    });
  }
  return { facts, unresolved, resolved: facts.length };
}

/**
 * Merge fact sets idempotently. Identity is (tenant, subject_kind, subject, predicate, object), so
 * re-ingesting the same profile any number of times converges on the same set - §30's requirement
 * expressed as a property of the key rather than of a de-duplication pass.
 */
export function mergeFacts(existing: InstanceFact[], incoming: InstanceFact[]): InstanceFact[] {
  const key = (f: InstanceFact) =>
    `${f.tenant_id}|${f.subject_kind}|${f.subject_id}|${f.predicate}|${f.object_id}`;
  const out = new Map(existing.map((f) => [key(f), f]));
  for (const f of incoming) if (!out.has(key(f))) out.set(key(f), f);
  return [...out.values()];
}

/** Tenant-scoped read. The ONLY supported way to retrieve instance facts. */
export function factsForTenant(facts: InstanceFact[], tenantId: string): InstanceFact[] {
  return facts.filter((f) => f.tenant_id === tenantId);
}
