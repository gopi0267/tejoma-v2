/**
 * Phase 7 Semantic Matching & Reasoning Engine.
 *
 * Pipeline, per job x candidate:
 *   Phase 3 requirements ---> Phase 6 evidence assessment (authoritative; consumed, never recomputed)
 *                        ---> semantic route resolution over the Phase 5 graph (typed, not guessed)
 *                        ---> requirement satisfaction state
 *                        ---> composite OR-group resolution
 *                        ---> experience RELEVANCE (not career total)
 *                        ---> seniority / domain / location reasoning
 *                        ---> transferable-skill extraction
 *                        ---> double-count detection over evidence identity
 *                        ---> decomposed score
 *
 * The engine never reads or writes a production match score. It is a pure function of the two
 * profiles it is given plus the immutable graph.
 */

import { createHash } from 'node:crypto';
import {
  COMPONENT_WEIGHT, LEVEL_WEIGHT, MATCH_ENGINE_VERSION, MATCH_SCHEMA_VERSION, PENALTY,
  SATISFACTION_CREDIT, SATISFYING_ROUTES, TRANSFERABLE_ROUTES, UNKNOWN_STATES, NO_DEMAND_STATES,
  type Alignment, type Compatibility, type CompositeGroup, type ExperienceFit, type MatchConfidence,
  type MatchIntelligenceProfile, type MatchProvenance, type MatchValidationIssue, type OverallFit,
  type RequirementResult, type SatisfactionState, type ScoreComponent, type SemanticLink,
  type SemanticRoute, type TransferableSkill,
} from './contract.js';
import { assessRequirement, evaluateEvidence, type CandidateProfileLike, type JobProfileLike } from '../evidence/engine.js';
import type { EvidenceState } from '../evidence/contract.js';
import type { KnowledgeGraph } from '../knowledge-graph/graph.js';

// ==================== INPUT SHAPES ====================

/** Structural supersets of the Phase 3 / Phase 4 profiles, to avoid coupling to class identity. */
export interface JobProfileP7 extends JobProfileLike {
  role_title?: string | null;
  role_family?: string | null;
  seniority?: { seniority?: string | null };
  domain_requirements?: { subject: string; level: string; negated?: boolean }[];
  location_constraints?: { subject: string; level: string; negated?: boolean }[];
  work_constraints?: { subject: string; level: string; negated?: boolean }[];
  intelligence_hash?: string;
}

export interface CandidateProfileP7 extends CandidateProfileLike {
  current_role?: string | null;
  role_family?: string | null;
  evidence_role_family?: string | null;
  seniority?: { seniority?: string | null };
  experience?: { months: number | null; start: string | null; end: string | null;
    role?: string | null; organization?: string | null; ongoing?: boolean; context_type?: string }[];
  domains?: { domain: string; provenance?: { source_field: string; source_text: string; span: [number, number] | null } }[];
  intelligence_hash?: string;
}

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

// ==================== SEMANTIC ROUTE ====================

/**
 * Map a graph relationship to what it is allowed to PROVE.
 *
 * This is the §10 rule expressed as a table. RELATED_TO is deliberately absent from the satisfying
 * and transferable sets: "React" RELATED_TO "React Native" is true and tells you nothing about
 * whether someone who built a web dashboard can ship a mobile app. Treating adjacency as
 * satisfaction is the single largest source of false-positive matches in keyword systems.
 */
const RELATIONSHIP_ROUTE: Record<string, SemanticRoute> = {
  ALTERNATIVE_TO: 'EQUIVALENT',
  IS_A: 'SAME_FAMILY',
  USED_FOR: 'ENABLING',
  ENABLES: 'ENABLING',
  PART_OF: 'SAME_FAMILY',
  SPECIALIZATION_OF: 'SAME_FAMILY',
  SUBSKILL_OF: 'SAME_FAMILY',
  RELATED_TO: 'RELATED',
  DEPENDS_ON: 'RELATED',
  REQUIRES: 'RELATED',
};

/**
 * SAME_FAMILY requires a SPECIFIC shared parent, not merely a shared taxonomy bucket.
 *
 * Without this, "both are programming languages" made Python a transferable route to a Rust
 * requirement, and "both are devops tooling" did the same for Docker -> Kubernetes. Sharing a
 * taxonomy bucket is not transferability; it is a filing decision.
 *
 * The cutoff is MEASURED FROM THE ONTOLOGY, not chosen. IS_A membership counts in the built graph
 * are sharply bimodal:
 *   taxonomy buckets   programming language 19, frontend framework 17, backend framework 16,
 *                      data store 14, devops tooling 14, ML tooling 14, ... testing tool 8
 *   capability families security tooling 5, messaging system 4, python web framework 3,
 *                      relational database 2, document database 1, container orchestration 1
 * Nothing falls between 5 and 8, so the boundary sits in an empty region of the real distribution.
 * Django -> FastAPI still transfers (python web framework, 3); Python -> Rust no longer does.
 */
const MAX_TRANSFERABLE_FAMILY_SIZE = 5;

const familySizeCache = new WeakMap<object, Map<string, number>>();
function familySize(graph: KnowledgeGraph, classId: string): number {
  let cache = familySizeCache.get(graph as unknown as object);
  if (!cache) {
    cache = new Map<string, number>();
    for (const node of (graph as unknown as { nodes: Map<string, { node_id: string }> }).nodes.values()) {
      for (const e of graph.neighbors(node.node_id)) {
        if (e.type === 'IS_A') cache.set(e.to_id, (cache.get(e.to_id) ?? 0) + 1);
      }
    }
    familySizeCache.set(graph as unknown as object, cache);
  }
  return cache.get(classId) ?? 0;
}

/**
 * How the candidate's capabilities reach this requirement, strongest route first.
 *
 * Depth is one hop by design. Two hops through IS_A then RELATED_TO can connect almost any two
 * technologies in a well-populated ontology, which would turn the graph into a machine for
 * manufacturing matches - the exact failure Phase 6 refused for evidence and Phase 7 must refuse
 * for satisfaction.
 */
function resolveRoute(
  graph: KnowledgeGraph | null, subject: string, cand: CandidateProfileP7,
): { route: SemanticRoute; concept: string | null; links: SemanticLink[] } {
  const target = norm(subject);
  const skills = (cand.skills ?? []).filter((s) => s.assertion !== 'NEGATED');

  // ---- EXACT: the candidate has the demanded concept itself.
  // Projects are searched too. Phase 6 accepts project technologies as evidence, so a requirement
  // proven ONLY by a project was reporting route NONE here and producing a SATISFIED verdict with an
  // empty reasoning list - a match a recruiter could not be told the reason for, which §28 forbids.
  for (const s of skills) if (norm(s.skill) === target) return { route: 'EXACT', concept: s.skill, links: [] };
  for (const p of cand.projects ?? []) {
    if ((p.technologies ?? []).some((t) => norm(t) === target)) {
      return { route: 'EXACT', concept: subject, links: [] };
    }
  }

  if (!graph) return { route: 'NONE', concept: null, links: [] };
  const targetNode = graph.resolve(subject).node;
  if (!targetNode) return { route: 'NONE', concept: null, links: [] };

  // ---- EXACT via alias: two surfaces of the SAME canonical concept are not a semantic hop
  for (const s of skills) {
    const n = graph.resolve(s.skill).node;
    if (n && n.node_id === targetNode.node_id) return { route: 'EXACT', concept: s.skill, links: [] };
  }

  // ---- one typed hop, best route wins
  const ORDER: SemanticRoute[] = ['EQUIVALENT', 'SAME_FAMILY', 'ENABLING', 'RELATED'];
  let best: { route: SemanticRoute; concept: string; links: SemanticLink[] } | null = null;

  for (const s of skills) {
    const src = graph.resolve(s.skill).node;
    if (!src || src.node_id === targetNode.node_id) continue;

    for (const edge of graph.neighbors(src.node_id)) {
      let route: SemanticRoute | undefined;
      if (edge.to_id === targetNode.node_id) {
        route = RELATIONSHIP_ROUTE[edge.type];
      } else if (edge.type === 'IS_A') {
        // SAME_FAMILY: both sides IS_A the same parent, and that parent is specific enough to mean
        // something. Checked explicitly rather than by two-hop traversal so an unrelated
        // intermediate cannot bridge them.
        const parentShared = graph.neighbors(targetNode.node_id, 'IS_A' as never)
          .some((e) => e.to_id === edge.to_id);
        if (parentShared && familySize(graph, edge.to_id) <= MAX_TRANSFERABLE_FAMILY_SIZE) {
          route = 'SAME_FAMILY';
        }
      }
      if (!route) continue;
      const link: SemanticLink = {
        from: s.skill, to: subject, relationship: edge.type, route,
        confidence: route === 'EQUIVALENT' ? 'HIGH' : route === 'RELATED' ? 'LOW' : 'MEDIUM',
      };
      if (!best || ORDER.indexOf(route) < ORDER.indexOf(best.route)) {
        best = { route, concept: s.skill, links: [link] };
      }
    }
  }
  return best ?? { route: 'NONE', concept: null, links: [] };
}

// ==================== SATISFACTION ====================

/**
 * Phase 6 evidence state -> the strongest satisfaction this evidence could support, BEFORE the
 * semantic route caps it. Phase 6 is authoritative: this table only renames, never upgrades.
 */
const EVIDENCE_TO_SATISFACTION: Record<EvidenceState, SatisfactionState> = {
  DIRECTLY_SUPPORTED: 'SATISFIED',
  STRONGLY_SUPPORTED: 'SATISFIED',
  PARTIALLY_SUPPORTED: 'PARTIALLY_SATISFIED',
  WEAKLY_SUPPORTED: 'WEAKLY_SATISFIED',
  INDIRECTLY_SUPPORTED: 'TRANSFERABLE',
  UNSUPPORTED: 'NOT_SATISFIED',
  CONTRADICTED: 'CONTRADICTED',
  AMBIGUOUS: 'WEAKLY_SATISFIED',
  INSUFFICIENT_EVIDENCE: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

const STATE_ORDER: SatisfactionState[] = [
  'SATISFIED', 'PARTIALLY_SATISFIED', 'TRANSFERABLE', 'WEAKLY_SATISFIED',
  'NOT_SATISFIED', 'CONTRADICTED', 'UNKNOWN', 'WAIVED', 'NOT_APPLICABLE',
];
const weaker = (a: SatisfactionState, b: SatisfactionState): SatisfactionState =>
  STATE_ORDER.indexOf(a) >= STATE_ORDER.indexOf(b) ? a : b;

/**
 * Cap a satisfaction state by the semantic route that reached it.
 *
 * A candidate who has Django and not FastAPI may satisfy "Python web framework" (SAME_FAMILY) but
 * has NOT satisfied "FastAPI". The evidence for Django can be impeccable and the requirement is
 * still not met, which is precisely the case an embedding-similarity matcher gets wrong.
 */
function capByRoute(state: SatisfactionState, route: SemanticRoute): SatisfactionState {
  if (state === 'CONTRADICTED' || state === 'UNKNOWN' || state === 'NOT_APPLICABLE') return state;
  if (SATISFYING_ROUTES.has(route)) return state;
  if (TRANSFERABLE_ROUTES.has(route)) return weaker(state, 'TRANSFERABLE');
  if (route === 'RELATED') return weaker(state, 'NOT_SATISFIED');
  return state;
}

// ==================== TEMPORAL: RELEVANT EXPERIENCE ====================

const monthsBetween = (a: string, b: string): number => {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};

/** Union of intervals, so concurrent roles are counted once (never summed). */
function unionMonths(spans: { start: string; end: string }[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((x, y) => x.start.localeCompare(y.start));
  let total = 0, curStart = sorted[0].start, curEnd = sorted[0].end;
  for (const s of sorted.slice(1)) {
    if (s.start <= curEnd) { if (s.end > curEnd) curEnd = s.end; }
    else { total += Math.max(0, monthsBetween(curStart, curEnd)); curStart = s.start; curEnd = s.end; }
  }
  return total + Math.max(0, monthsBetween(curStart, curEnd));
}

const ROLE_STOPWORDS = new Set(['senior', 'junior', 'lead', 'principal', 'staff', 'i', 'ii', 'iii',
  'engineer', 'developer', 'specialist', 'associate', 'consultant', 'manager', 'sr', 'jr', 'of', 'and']);

const roleTokens = (s: string): Set<string> =>
  new Set(norm(s).split(/[^a-z0-9+#.]+/).filter((t) => t.length > 2 && !ROLE_STOPWORDS.has(t)));

/**
 * Which of the candidate's roles are RELEVANT to this job, and for how long.
 *
 * THIS IS THE CORE FIX over the production matcher. `expScore = candidateExp >= jobExp ? 100 : ratio`
 * awards a perfect experience score to seven years of data analysis against "5 years backend
 * engineering". Here an experience entry counts only if its role relates to the job's role family or
 * title after stripping seniority words, and the qualifying spans are unioned so overlapping
 * employment is never summed.
 *
 * When no entry carries a determinable role, the result is null -> UNKNOWN, never zero. Refusing to
 * date something is not the same as proving it absent (§24).
 */
function assessExperience(job: JobProfileP7, cand: CandidateProfileP7): ExperienceFit {
  const reqs = job.experience_requirements ?? [];
  const requiredYears = reqs.reduce<number | null>(
    (acc, r) => (r.min_years != null && (acc === null || r.min_years > acc) ? r.min_years : acc), null);
  const requiredMonths = requiredYears === null ? null : Math.round(requiredYears * 12);

  const entries = (cand.experience ?? []);
  const dated = entries.filter((e) => e.start) as { start: string; end: string | null; role?: string | null }[];
  const totalMonths = dated.length
    ? unionMonths(dated.map((e) => ({ start: e.start, end: e.end ?? '2026-08' })))
    : cand.timeline_months ?? null;

  const jobTokens = new Set([...roleTokens(job.role_family ?? ''), ...roleTokens(job.role_title ?? '')]);
  const reasoning: string[] = [];
  const basis: string[] = [];

  const withRole = dated.filter((e) => e.role && norm(e.role).length > 0);
  if (withRole.length === 0 || jobTokens.size === 0) {
    reasoning.push(jobTokens.size === 0
      ? 'job states no role family or title, so experience relevance cannot be established (Phase 3)'
      : 'no candidate experience entry carries a role, so relevance cannot be established (Phase 4)');
    return {
      required_months: requiredMonths, relevant_months: null, total_months: totalMonths,
      alignment: 'UNKNOWN', relevance_basis: basis, confidence: 'UNKNOWN', reasoning,
    };
  }

  const relevantSpans: { start: string; end: string }[] = [];
  for (const e of withRole) {
    const overlap = [...roleTokens(e.role!)].filter((t) => jobTokens.has(t));
    if (overlap.length > 0) {
      relevantSpans.push({ start: e.start, end: e.end ?? '2026-08' });
      basis.push(`${e.role} (matched on ${overlap.join(', ')})`);
    }
  }

  const relevantMonths = unionMonths(relevantSpans);
  if (relevantSpans.length === 0) {
    reasoning.push(`no candidate role relates to "${job.role_family ?? job.role_title}"; `
      + `${totalMonths ?? 0} datable months exist but none in a relevant role (Phase 4)`);
  } else {
    reasoning.push(`${relevantMonths} months in roles relevant to "${job.role_family ?? job.role_title}" `
      + `out of ${totalMonths ?? relevantMonths} total datable months; overlapping roles unioned, not summed`);
  }

  let alignment: Alignment = 'UNKNOWN';
  if (requiredMonths === null) alignment = 'UNKNOWN';
  else if (relevantMonths >= requiredMonths) alignment = relevantMonths >= requiredMonths * 2 ? 'OVER' : 'ALIGNED';
  else alignment = 'UNDER';

  if (requiredMonths !== null && alignment === 'UNDER') {
    reasoning.push(`requirement asks for ${requiredMonths} months of relevant experience; `
      + `${relevantMonths} are supported`);
  }

  return {
    required_months: requiredMonths, relevant_months: relevantMonths, total_months: totalMonths,
    alignment, relevance_basis: basis,
    confidence: relevantSpans.length > 0 ? 'HIGH' : 'MEDIUM', reasoning,
  };
}

// ==================== SENIORITY / DOMAIN / LOCATION ====================

const SENIORITY_RANK: Record<string, number> = {
  INTERN: 0, JUNIOR: 1, MID: 2, SENIOR: 3, STAFF: 4, PRINCIPAL: 5, LEAD: 4, MANAGER: 4, DIRECTOR: 6,
};

function assessSeniority(job: JobProfileP7, cand: CandidateProfileP7) {
  const j = job.seniority?.seniority ?? null;
  const c = cand.seniority?.seniority ?? null;
  const reasoning: string[] = [];
  if (!j || !c) {
    reasoning.push(!j ? 'job states no detectable seniority (Phase 3)' : 'candidate seniority undetermined (Phase 4)');
    return { job: j, candidate: c, alignment: 'UNKNOWN' as Alignment, reasoning };
  }
  const jr = SENIORITY_RANK[j.toUpperCase()], cr = SENIORITY_RANK[c.toUpperCase()];
  if (jr === undefined || cr === undefined) {
    reasoning.push(`seniority levels "${j}" / "${c}" are outside the known ladder`);
    return { job: j, candidate: c, alignment: 'UNKNOWN' as Alignment, reasoning };
  }
  const alignment: Alignment = cr === jr ? 'ALIGNED' : cr < jr ? 'UNDER' : 'OVER';
  reasoning.push(`job seniority ${j}, candidate ${c} -> ${alignment}`
    + (alignment === 'OVER' ? ' (over-level is not a rejection; recorded for the recruiter)' : ''));
  return { job: j, candidate: c, alignment, reasoning };
}

function assessDomain(job: JobProfileP7, cand: CandidateProfileP7, graph: KnowledgeGraph | null) {
  const required = (job.domain_requirements ?? []).filter((d) => !d.negated).map((d) => d.subject);
  const held = (cand.domains ?? []).map((d) => d.domain);
  const reasoning: string[] = [];
  if (required.length === 0) {
    reasoning.push('job states no domain requirement');
    return { required, candidate: held, compatibility: 'NOT_APPLICABLE' as Compatibility, reasoning };
  }
  if (held.length === 0) {
    reasoning.push('candidate record carries no domain, so domain fit is unknown - not a mismatch');
    return { required, candidate: held, compatibility: 'UNKNOWN' as Compatibility, reasoning };
  }
  for (const r of required) {
    if (held.some((h) => norm(h) === norm(r))) {
      reasoning.push(`candidate domain "${r}" matches the required domain`);
      return { required, candidate: held, compatibility: 'MATCHED' as Compatibility, reasoning };
    }
  }
  // Adjacency only through an explicit graph edge - never through string similarity.
  if (graph) {
    for (const r of required) {
      const rn = graph.resolve(r).node;
      if (!rn) continue;
      for (const h of held) {
        const hn = graph.resolve(h).node;
        if (hn && graph.neighbors(hn.node_id).some((e) => e.to_id === rn.node_id)) {
          reasoning.push(`candidate domain "${h}" is graph-adjacent to required "${r}" - adjacent, not equivalent`);
          return { required, candidate: held, compatibility: 'ADJACENT' as Compatibility, reasoning };
        }
      }
    }
  }
  reasoning.push(`candidate domains [${held.join(', ')}] do not cover required [${required.join(', ')}]`);
  return { required, candidate: held, compatibility: 'MISMATCHED' as Compatibility, reasoning };
}

/**
 * Location, from Phase 3 constraints only.
 *
 * Phase 4 does not model candidate location, so in this repository the honest answer is almost always
 * UNKNOWN. §18 is explicit that compatibility must never be inferred from missing data, so this
 * returns UNKNOWN rather than a convenient MATCHED - and the scorer treats UNKNOWN as neutral rather
 * than as a penalty.
 */
function assessLocation(job: JobProfileP7) {
  const constraints = (job.location_constraints ?? []).map((c) => c.subject);
  const work = (job.work_constraints ?? []).map((c) => c.subject);
  const all = [...constraints, ...work];
  if (all.length === 0) {
    return { constraints: all, compatibility: 'NOT_APPLICABLE' as Compatibility,
      reasoning: ['job states no location or work constraint'] };
  }
  const remote = all.some((c) => /remote|anywhere|wfh/i.test(c));
  if (remote) {
    return { constraints: all, compatibility: 'MATCHED' as Compatibility,
      reasoning: ['job is remote-eligible, so location imposes no constraint'] };
  }
  return { constraints: all, compatibility: 'UNKNOWN' as Compatibility,
    reasoning: [`job constrains location to [${all.join(', ')}] but the candidate record carries no `
      + 'location, so compatibility cannot be determined - deliberately not inferred'] };
}

// ==================== MAIN ====================

export function buildMatchIntelligence(
  job: JobProfileP7, cand: CandidateProfileP7, graph: KnowledgeGraph | null, tenantId: string,
): MatchIntelligenceProfile {
  // Phase 6 is authoritative for evidence. Called, not reimplemented.
  const evidence = evaluateEvidence(job, cand, graph, tenantId);
  const byRequirement = new Map(evidence.assessments.map((a) => [a.requirement_id, a]));

  const results: RequirementResult[] = [];
  const transferable: TransferableSkill[] = [];
  /** Evidence identity -> the first requirement that claimed it (the §26 anti-double-count index). */
  const evidenceOwner = new Map<string, string>();

  for (const req of job.requirements ?? []) {
    const requirementId = [job.job_id ?? '', req.subject, req.level].join('|');
    const assessment = byRequirement.get(requirementId);
    const provenance: MatchProvenance[] = [];
    const reasoning: string[] = [];
    const gaps: { kind: string; detail: string }[] = [];

    // ---- §22: a negated or excluded requirement is a demand for ABSENCE. It can never become a
    // positive requirement, and the candidate having the thing is not a failure to match.
    if (req.negated || req.level === 'EXCLUDED') {
      results.push({
        requirement_id: requirementId, subject: req.subject, level: req.level, negated: true,
        state: 'WAIVED', evidence_state: null, route: 'NONE', semantic_links: [], matched_concept: null,
        gaps: [], reasoning: [`the job states "${req.subject}" is NOT required; no demand to satisfy`],
        confidence: 'HIGH', weight: 0, credit: 0, derivative_of: null,
        provenance: [{ source: 'PHASE_3_JD', rule: 'match.negated_requirement',
          detail: 'Phase 3 marked this requirement negated/excluded' }],
      });
      continue;
    }

    const { route, concept, links } = resolveRoute(graph, req.subject, cand);

    /**
     * WHICH CONCEPT DO WE ASK PHASE 6 ABOUT?
     *
     * For an EXACT route, the demanded concept. For a substitute route the candidate does not hold
     * the demanded concept at all, so asking Phase 6 about it returns UNSUPPORTED by construction -
     * a candidate with impeccable production Azure evidence would score NOT_SATISFIED on "AWS"
     * purely because the token differs. The evidence question is about the concept the candidate
     * ACTUALLY holds; the route then caps how far that evidence may travel.
     */
    // AN EXPLICIT DENIAL IS NEVER OVERRIDDEN BY A SUBSTITUTE. A candidate who wrote "I have not used
     // AWS" while holding production Azure must not have the AWS requirement reported SATISFIED -
     // that would put a claim in front of a recruiter that the candidate themselves refuted. The
     // Azure capability is still surfaced under transferable_skills, which is where it belongs.
    const denied = assessment?.state === 'CONTRADICTED';
    const surrogate = !denied && route !== 'EXACT' && route !== 'NONE' && concept
      ? assessRequirement({ ...req, subject: concept }, job, cand, graph) : null;
    const effective = surrogate ?? assessment;

    const evState = effective?.state ?? null;
    const base = evState ? EVIDENCE_TO_SATISFACTION[evState] : 'UNKNOWN';
    const state = capByRoute(base, route === 'NONE' && assessment?.state === 'INDIRECTLY_SUPPORTED'
      ? 'ENABLING' : route);

    if (effective) {
      provenance.push({ source: 'PHASE_6_EVIDENCE', rule: 'match.evidence_state',
        detail: surrogate
          ? `Phase 6 assessed the candidate's "${concept}" as ${evState}; capped by the ${route} route`
          : `Phase 6 assessed this requirement as ${evState}` });
      for (const g of effective.gaps) gaps.push({ kind: g.kind, detail: g.detail });
      for (const l of effective.limitations) reasoning.push(`limitation: ${l}`);
    }

    if (route === 'EXACT') {
      reasoning.push(`candidate holds "${req.subject}" directly; Phase 6 evidence is ${evState}`);
    } else if (route !== 'NONE' && concept) {
      provenance.push({ source: 'PHASE_5_GRAPH', rule: `match.route.${route.toLowerCase()}`,
        detail: `${concept} --${links[0]?.relationship}--> ${req.subject}` });
      reasoning.push(route === 'EQUIVALENT'
        ? `candidate holds "${concept}", a graph-declared alternative to "${req.subject}"`
        : route === 'RELATED'
          ? `candidate holds "${concept}", which is only RELATED_TO "${req.subject}" - adjacency does not satisfy a requirement`
          : `candidate holds "${concept}", which reaches "${req.subject}" via ${links[0]?.relationship}; `
            + 'a transferable route, not direct experience');
      if (TRANSFERABLE_ROUTES.has(route) || route === 'EQUIVALENT') {
        transferable.push({
          source_capability: concept, target_capability: req.subject,
          relationship: links[0]?.relationship ?? 'UNKNOWN', route,
          reason: `${concept} ${links[0]?.relationship} ${req.subject} (Phase 5 ontology)`,
          confidence: links[0]?.confidence ?? 'LOW',
        });
      }
    } else if (state === 'NOT_SATISFIED') {
      reasoning.push(`no candidate capability reaches "${req.subject}" directly or through the ontology`);
    } else if (state === 'UNKNOWN') {
      reasoning.push('the candidate record is too thin to determine this requirement - '
        + 'reported as UNKNOWN, not as a missing skill');
    }

    // ---- §26: double-count detection over EVIDENCE IDENTITY, not concept names.
    // Two requirements resting on the same source span are one fact. The second still reports its
    // own state (a recruiter must see both requirements) but is marked derivative so the evidence
    // -strength component counts the underlying fact once.
    let derivativeOf: string | null = null;
    const identity = (effective?.evidence ?? [])
      .map((u) => `${u.provenance.source_field}:${u.provenance.span?.join('-') ?? 'nospan'}:${u.concept}`)
      .sort().join('|');
    if (identity) {
      const owner = evidenceOwner.get(identity);
      if (owner && owner !== requirementId) {
        derivativeOf = owner;
        reasoning.push(`supported by the same underlying evidence as "${owner.split('|')[1]}" - `
          + 'counted once, not twice');
      } else evidenceOwner.set(identity, requirementId);
    }

    const weight = LEVEL_WEIGHT[req.level] ?? 0;
    results.push({
      requirement_id: requirementId, subject: req.subject, level: req.level, negated: false,
      state, evidence_state: evState, route, semantic_links: links, matched_concept: concept,
      gaps, reasoning,
      confidence: assessment ? (state === 'UNKNOWN' ? 'UNKNOWN'
        : gaps.length === 0 && route === 'EXACT' ? 'HIGH'
          : route === 'EXACT' ? 'MEDIUM' : 'LOW') : 'UNKNOWN',
      weight, credit: SATISFACTION_CREDIT[state], derivative_of: derivativeOf, provenance,
    });
  }

  // ---- §21 composite OR-groups, grounded in ALTERNATIVE_TO rather than invented
  const composites = buildCompositeGroups(results, graph);

  const experienceFit = assessExperience(job, cand);
  const seniorityFit = assessSeniority(job, cand);
  const domainFit = assessDomain(job, cand, graph);
  const locationFit = assessLocation(job);

  const overall = computeFit(results, composites, experienceFit, seniorityFit, locationFit);

  // ---- strengths / gaps / contradictions
  const strengths = results
    .filter((r) => r.state === 'SATISFIED' && r.weight > 0)
    .map((r) => ({ subject: r.subject, why: r.reasoning[0] ?? 'satisfied on direct evidence' }));

  const gapList = results
    .filter((r) => ['NOT_SATISFIED', 'WEAKLY_SATISFIED', 'PARTIALLY_SATISFIED', 'CONTRADICTED'].includes(r.state))
    .flatMap((r) => (r.gaps.length ? r.gaps : [{ kind: 'REQUIREMENT', detail: `${r.subject} is ${r.state}` }])
      .map((g) => ({ subject: r.subject, kind: g.kind, detail: g.detail, critical: r.level === 'MANDATORY' })));

  const contradictions = results
    .filter((r) => r.state === 'CONTRADICTED')
    .map((r) => ({ kind: 'REQUIREMENT_DENIED', severity: 'HIGH' as const,
      detail: `job requires ${r.subject}; candidate explicitly denies it` }));
  if (experienceFit.alignment === 'UNDER' && experienceFit.relevant_months !== null
    && experienceFit.total_months !== null && experienceFit.total_months > (experienceFit.required_months ?? 0)) {
    contradictions.push({
      kind: 'RELEVANCE_CONFLICT', severity: 'MEDIUM' as never,
      detail: `candidate has ${experienceFit.total_months} total months, above the requirement, but only `
        + `${experienceFit.relevant_months} in relevant roles`,
    });
  }

  const evidenceSummary: Record<string, number> = {};
  for (const a of evidence.assessments) evidenceSummary[a.state] = (evidenceSummary[a.state] ?? 0) + 1;

  const reasoning: string[] = [
    `${results.filter((r) => r.state === 'SATISFIED').length} of ${results.filter((r) => r.weight > 0).length} `
      + 'weighted requirements satisfied',
    ...experienceFit.reasoning,
    ...seniorityFit.reasoning,
    ...domainFit.reasoning,
    ...locationFit.reasoning,
  ];

  const profile: MatchIntelligenceProfile = {
    match_schema_version: MATCH_SCHEMA_VERSION,
    match_engine_version: MATCH_ENGINE_VERSION,
    job_id: job.job_id ?? null,
    candidate_id: cand.candidate_id ?? null,
    tenant_id: tenantId,
    overall_fit: overall,
    requirement_results: results,
    composite_groups: composites,
    experience_fit: experienceFit,
    seniority_fit: seniorityFit,
    domain_fit: domainFit,
    location_fit: locationFit,
    transferable_skills: transferable,
    strengths, gaps: gapList, contradictions,
    evidence_summary: evidenceSummary,
    reasoning,
    confidence: overall.confidence,
    source_hashes: {
      job_intelligence_hash: job.intelligence_hash ?? null,
      candidate_intelligence_hash: cand.intelligence_hash ?? null,
      evidence_assessment_hash: evidence.assessment_hash,
      graph_fingerprint: graph ? graph.fingerprint() : null,
      ontology_version: null,
      evidence_engine_version: evidence.evidence_engine_version,
    },
    match_hash: '',
  };
  profile.match_hash = 'sha256:' + createHash('sha256').update(canonicalMatch(profile)).digest('hex');
  return profile;
}

/**
 * OR-groups from ALTERNATIVE_TO edges: "AWS or Azure" is one demand with two acceptable answers.
 *
 * Without this, a JD listing both alternatives scores a candidate who has one of them at 50% on a
 * requirement they fully meet. Membership comes from the ontology, never from parsing "or" out of
 * text - Phase 3 already decided what the requirements ARE.
 */
function buildCompositeGroups(results: RequirementResult[], graph: KnowledgeGraph | null): CompositeGroup[] {
  if (!graph) return [];
  const groups: CompositeGroup[] = [];
  const claimed = new Set<string>();

  for (const r of results) {
    if (claimed.has(r.requirement_id) || r.weight === 0) continue;
    const node = graph.resolve(r.subject).node;
    if (!node) continue;
    const alts = graph.neighbors(node.node_id).filter((e) => e.type === 'ALTERNATIVE_TO').map((e) => e.to_id);
    if (alts.length === 0) continue;

    const members = results.filter((o) => {
      if (o.requirement_id === r.requirement_id) return true;
      const n = graph.resolve(o.subject).node;
      return !!n && alts.includes(n.node_id);
    });
    if (members.length < 2) continue;

    for (const m of members) claimed.add(m.requirement_id);
    const best = members.reduce((a, b) =>
      STATE_ORDER.indexOf(b.state) < STATE_ORDER.indexOf(a.state) ? b : a);
    groups.push({
      kind: 'OR', members: members.map((m) => m.subject), state: best.state,
      satisfied_by: best.state === 'SATISFIED' ? best.subject : null,
      reasoning: `[${members.map((m) => m.subject).join(' OR ')}] are graph-declared alternatives; `
        + `the group resolves to ${best.state}`
        + (best.state === 'SATISFIED' ? ` via ${best.subject}` : ''),
    });
  }
  return groups;
}

/**
 * The decomposed score (§25). Every component reports value, weight and contribution, and the
 * components plus penalties reconstruct `score` exactly - a reviewer can recompute it by hand.
 *
 * UNKNOWN requirements are excluded from BOTH sides of the coverage ratio. Scoring them zero would
 * punish a candidate for our parsing gaps, which §24 forbids; excluding them keeps the ratio a
 * statement about what we actually know.
 */
function computeFit(
  results: RequirementResult[], composites: CompositeGroup[],
  exp: ExperienceFit, sen: { alignment: Alignment }, loc: { compatibility: Compatibility },
): OverallFit {
  // Composite members collapse to one entry at the group's best state.
  const inGroup = new Set(composites.flatMap((g) => g.members));
  const scored = results.filter((r) => r.weight > 0 && !NO_DEMAND_STATES.has(r.state) && !inGroup.has(r.subject));

  let num = 0, den = 0, unknown = 0;
  for (const r of scored) {
    if (UNKNOWN_STATES.has(r.state)) { unknown++; continue; }
    num += r.weight * r.credit;
    den += r.weight;
  }
  for (const g of composites) {
    const w = LEVEL_WEIGHT.MANDATORY;
    if (UNKNOWN_STATES.has(g.state)) { unknown++; continue; }
    num += w * SATISFACTION_CREDIT[g.state];
    den += w;
  }
  const coverage = den > 0 ? (num / den) * 100 : 0;

  const experienceValue = exp.alignment === 'ALIGNED' || exp.alignment === 'OVER' ? 100
    : exp.alignment === 'UNDER' && exp.required_months
      ? Math.max(0, Math.min(100, ((exp.relevant_months ?? 0) / exp.required_months) * 100))
      : 50; // UNKNOWN is neutral, never zero
  const locationValue = loc.compatibility === 'MATCHED' ? 100
    : loc.compatibility === 'MISMATCHED' ? 0 : 50;
  const seniorityValue = sen.alignment === 'ALIGNED' ? 100
    : sen.alignment === 'OVER' ? 80 : sen.alignment === 'UNDER' ? 40 : 50;

  const components: ScoreComponent[] = [
    { name: 'requirement_coverage', value: Math.round(coverage), weight: COMPONENT_WEIGHT.requirement_coverage,
      contribution: +(coverage * COMPONENT_WEIGHT.requirement_coverage).toFixed(2),
      basis: `${den.toFixed(2)} weighted requirement-units assessed, ${num.toFixed(2)} earned; `
        + `${unknown} UNKNOWN excluded from both sides` },
    { name: 'experience_relevance', value: Math.round(experienceValue), weight: COMPONENT_WEIGHT.experience_relevance,
      contribution: +(experienceValue * COMPONENT_WEIGHT.experience_relevance).toFixed(2),
      basis: exp.relevant_months === null ? 'relevance undeterminable - neutral 50'
        : `${exp.relevant_months} relevant months vs ${exp.required_months ?? 'unspecified'} required` },
    { name: 'location_fit', value: locationValue, weight: COMPONENT_WEIGHT.location_fit,
      contribution: +(locationValue * COMPONENT_WEIGHT.location_fit).toFixed(2),
      basis: `location compatibility ${loc.compatibility}` },
    { name: 'seniority_alignment', value: seniorityValue, weight: COMPONENT_WEIGHT.seniority_alignment,
      contribution: +(seniorityValue * COMPONENT_WEIGHT.seniority_alignment).toFixed(2),
      basis: `seniority ${sen.alignment}` },
  ];

  const criticalGaps = results.filter((r) => r.level === 'MANDATORY'
    && ['NOT_SATISFIED', 'CONTRADICTED', 'WEAKLY_SATISFIED'].includes(r.state)).length;
  const contradicted = results.filter((r) => r.state === 'CONTRADICTED').length;

  const penalties: ScoreComponent[] = [
    { name: 'critical_gaps', value: criticalGaps, weight: -PENALTY.critical_gap,
      contribution: -Math.min(criticalGaps * PENALTY.critical_gap, PENALTY.max_critical_gap),
      basis: `${criticalGaps} MANDATORY requirement(s) not satisfied` },
    { name: 'contradictions', value: contradicted, weight: -PENALTY.contradiction,
      contribution: -Math.min(contradicted * PENALTY.contradiction, PENALTY.max_contradiction),
      basis: `${contradicted} requirement(s) explicitly denied by the candidate` },
  ];

  const base = components.reduce((a, c) => a + c.contribution, 0);
  const penalty = penalties.reduce((a, c) => a + c.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(base + penalty)));

  const assessedShare = den > 0 ? den / (den + unknown * LEVEL_WEIGHT.MANDATORY) : 0;
  const insufficient = den === 0 || assessedShare < 0.5;

  return {
    score, components, penalties,
    confidence: insufficient ? 'UNKNOWN'
      : exp.confidence === 'UNKNOWN' || unknown > 0 ? 'MEDIUM' : 'HIGH',
    insufficient_data: insufficient,
  };
}

/** Ids, tenant and lineage excluded: the hash measures the REASONING, not which pair produced it. */
export function canonicalMatch(p: MatchIntelligenceProfile): string {
  return JSON.stringify({
    match_schema_version: p.match_schema_version,
    match_engine_version: p.match_engine_version,
    overall_fit: p.overall_fit,
    requirement_results: p.requirement_results,
    composite_groups: p.composite_groups,
    experience_fit: p.experience_fit,
    seniority_fit: p.seniority_fit,
    domain_fit: p.domain_fit,
    location_fit: p.location_fit,
    transferable_skills: p.transferable_skills,
  });
}

// ==================== VALIDATION ====================

/**
 * The fail-closed gate. Re-checks, independently of how the profile was built, that no requirement
 * claims more than its route and evidence allow, that the score reconstructs from its components,
 * and that every satisfied requirement cites provenance.
 */
export function validateMatchProfile(p: MatchIntelligenceProfile): MatchValidationIssue[] {
  const issues: MatchValidationIssue[] = [];
  if (p.match_schema_version !== MATCH_SCHEMA_VERSION) {
    issues.push({ path: 'match_schema_version', problem: 'unexpected schema version' });
  }

  p.requirement_results.forEach((r, i) => {
    const at = `requirement_results[${i}]`;
    // A non-satisfying route may never produce SATISFIED.
    if (r.state === 'SATISFIED' && !SATISFYING_ROUTES.has(r.route) && r.route !== 'NONE') {
      issues.push({ path: at, problem: `SATISFIED via non-satisfying route ${r.route}` });
    }
    if (r.route === 'RELATED' && ['SATISFIED', 'PARTIALLY_SATISFIED', 'TRANSFERABLE'].includes(r.state)) {
      issues.push({ path: at, problem: 'RELATED_TO adjacency credited as satisfaction' });
    }
    // Phase 6 authority: a requirement may never be stronger than the evidence Phase 6 found.
    if (r.evidence_state) {
      const ceiling = EVIDENCE_TO_SATISFACTION[r.evidence_state];
      if (STATE_ORDER.indexOf(r.state) < STATE_ORDER.indexOf(ceiling)) {
        issues.push({ path: at, problem: `state ${r.state} exceeds Phase 6 evidence ${r.evidence_state}` });
      }
    }
    if (r.negated && r.state !== 'WAIVED') {
      issues.push({ path: at, problem: 'negated requirement did not resolve to WAIVED' });
    }
    if (r.state === 'SATISFIED' && r.provenance.length === 0) {
      issues.push({ path: at, problem: 'SATISFIED without provenance' });
    }
    if (r.credit !== SATISFACTION_CREDIT[r.state]) {
      issues.push({ path: at, problem: 'credit does not match the satisfaction policy' });
    }
    if (r.route !== 'EXACT' && r.route !== 'NONE' && r.semantic_links.length === 0) {
      issues.push({ path: at, problem: 'semantic route without a justifying link' });
    }
  });

  // The score must reconstruct from its own decomposition.
  const base = p.overall_fit.components.reduce((a, c) => a + c.contribution, 0);
  const pen = p.overall_fit.penalties.reduce((a, c) => a + c.contribution, 0);
  const expected = Math.max(0, Math.min(100, Math.round(base + pen)));
  if (expected !== p.overall_fit.score) {
    issues.push({ path: 'overall_fit.score', problem: `score ${p.overall_fit.score} does not match components (${expected})` });
  }
  if (p.overall_fit.score < 0 || p.overall_fit.score > 100) {
    issues.push({ path: 'overall_fit.score', problem: 'score outside 0-100' });
  }
  return issues;
}
