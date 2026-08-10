// Enterprise AI Matching Architecture, Phase 15 - Reasoning Conclusions Weighting, SHADOW MODE
// ONLY.
//
// Same discipline and reasoning as Phases 11/12/13 - computes and shadow-logs what a
// reasoning-alignment-weighted score WOULD be, alongside every real decision. Never applied to a
// live match score.
//
// CORRECTION AGAINST THE SPEC, more fundamental than prior phases' corrections: the spec treats
// reasoning_conclusions as a generic skill-to-skill graph with from_skill_id/to_skill_id/edge_type
// columns, and asks for fresh BFS traversal at match time ("build subgraph of candidate skills
// union job skills... run BFS from candidate_skill_ids"). Neither premise is true:
//   1. reasoning_conclusions (Phase 9) has no from_skill_id/to_skill_id/edge_type columns at
//      all - it's subject_type/subject_id-scoped (one row = one conclusion about ONE candidate
//      OR ONE job), not a traversable graph. The real traversable skill-to-skill graph is
//      skill_edges (Phase 1: from_skill_id, to_skill_id, relationship_type) - a completely
//      different table.
//   2. Even if reasoning_conclusions WERE a graph, re-running fresh BFS over it at match time
//      would violate Phase 9's own explicit, load-bearing design principle: "multi-hop graph
//      traversal at request time... becomes exactly the kind of unconstrained hot path this
//      architecture was built to eliminate... must be precomputed and cached" (computeReasoning.ts's
//      module doc). Building a live-BFS module here would silently reintroduce the exact problem
//      Phase 9 was designed to avoid.
//
// The honest version, and the one actually implemented below: compare the candidate's
// ALREADY-COMPUTED Phase 9 conclusions against the job's ALREADY-COMPUTED Phase 9 conclusions
// (Phase 9 computes and stores conclusions for jobs too - see job.routes.ts's
// computeReasoningForJobInBackground). No new graph traversal, no new inference - just reading
// two sets of precomputed rows and finding real overlap:
//   - Density:  the candidate's own `concept`-type conclusions ARE already a density signal -
//               Phase 9's concept reasoning only ever produces one when 3+ skills cluster in the
//               same domain (see conceptReasoning.ts's CONCEPT_INSTANCE_THRESHOLD). More/
//               stronger concept conclusions = a denser, already-verified skill cluster.
//   - Coverage: overlap between the domain names referenced in the candidate's and the job's
//               `hierarchical`-type conclusions - extracted from the real, structured
//               evidence_chain[].edge.from field (the PARENT_OF step's source), never by parsing
//               conclusion_text prose.
//   - Quality:  the real, already-stored conclusion_confidence on the matched conclusions - no
//               new confidence computation invented.

import { db } from '../db.js';
import type { Candidate, Job, ReasoningConclusion, ReasoningMultiplierResult } from '../types.js';

// Pure - domain name for a hierarchical conclusion is edge.from on whichever evidence step is
// the PARENT_OF hop (present at hop-1 as the only step, or as the second step for a hop-2
// FRAMEWORK_OF-then-PARENT_OF chain - see hierarchicalReasoning.ts).
export function extractDomainsFromHierarchicalConclusions(conclusions: ReasoningConclusion[]): string[] {
  const domains = new Set<string>();
  for (const c of conclusions) {
    if (c.reasoning_type !== 'hierarchical') continue;
    const parentStep = c.evidence_chain.find((s) => s.edge?.type === 'PARENT_OF');
    if (parentStep?.edge) domains.add(parentStep.edge.from);
  }
  return Array.from(domains);
}

// Pure - normalized instance count (Phase 9's own threshold is 3) blended with how confident
// those conclusions actually are. 0 with no concept conclusions - never fabricates density from
// nothing.
export function computeDensitySignal(conceptConclusions: ReasoningConclusion[]): number {
  if (conceptConclusions.length === 0) return 0;
  const avgConfidence = conceptConclusions.reduce((sum, c) => sum + c.conclusion_confidence, 0) / conceptConclusions.length;
  const countSignal = Math.min(1, conceptConclusions.length / 3);
  return Number((countSignal * avgConfidence).toFixed(4));
}

export interface CoverageResult {
  coverageSignal: number;
  covered: string[];
  uncovered: string[];
}

// Pure - case-insensitive domain-name overlap. 0/[]/[] when the job has no hierarchical
// conclusions yet (nothing to cover, not a penalty).
export function computeCoverageResult(candidateDomains: string[], jobDomains: string[]): CoverageResult {
  if (jobDomains.length === 0) return { coverageSignal: 0, covered: [], uncovered: [] };
  const candidateSet = new Set(candidateDomains.map((d) => d.toLowerCase()));
  const covered = jobDomains.filter((d) => candidateSet.has(d.toLowerCase()));
  const uncovered = jobDomains.filter((d) => !candidateSet.has(d.toLowerCase()));
  return { coverageSignal: Number((covered.length / jobDomains.length).toFixed(4)), covered, uncovered };
}

// Pure - 0.5 (neutral floor) with no corroborating conclusions, matching Phase 9's own
// technology_relationship confidence philosophy ("reflects how much was evaluated, not a
// judgment of the score itself").
export function computeQualitySignal(usedConclusions: ReasoningConclusion[]): number {
  if (usedConclusions.length === 0) return 0.5;
  return Number((usedConclusions.reduce((sum, c) => sum + c.conclusion_confidence, 0) / usedConclusions.length).toFixed(4));
}

const MAX_MULTIPLIER = 1.3;
const MIN_MULTIPLIER = 0.7;

// Pure - same confidence-interpolation unification as Phases 11/12/13: confidence=0 -> exactly
// neutral, confidence=1 -> full effect. Quality only ever boosts (never penalizes) - conclusions
// already trusted enough to be stored aren't second-guessed downward here, only rewarded for
// extra corroboration.
export function combineReasoningSignals(densitySignal: number, coverageSignal: number, qualitySignal: number, confidence: number): number {
  const multiplierDensity = 1 + densitySignal * 0.25;
  const multiplierCoverage = 1 + coverageSignal * 0.2;
  const multiplierQuality = 1 + Math.max(0, qualitySignal - 0.5) * 0.2;
  const raw = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplierDensity * multiplierCoverage * multiplierQuality));
  const c = Math.min(1, Math.max(0, confidence));
  return Number((1 + (raw - 1) * c).toFixed(4));
}

export interface ReasoningShadowResult {
  reasoningAdjustedScore: number;
  result: ReasoningMultiplierResult;
}

// Orchestration - reads both sides' ALREADY-COMPUTED Phase 9 conclusions (db.getReasoningConclusions,
// no new computation). Always returns a real result (never null) - with no data at all, every
// component naturally converges to exactly neutral (1.0), the same graceful-degradation pattern
// Phase 13 established.
export async function computeReasoningShadowResult(candidate: Candidate, job: Job, priorAdjustedScore: number): Promise<ReasoningShadowResult> {
  const [candidateConclusions, jobConclusions] = await Promise.all([db.getReasoningConclusions('candidate', candidate.id), db.getReasoningConclusions('job', job.id)]);

  const conceptConclusions = candidateConclusions.filter((c) => c.reasoning_type === 'concept');
  const candidateHierarchical = candidateConclusions.filter((c) => c.reasoning_type === 'hierarchical');
  const jobHierarchical = jobConclusions.filter((c) => c.reasoning_type === 'hierarchical');

  const candidateDomains = extractDomainsFromHierarchicalConclusions(candidateHierarchical);
  const jobDomains = extractDomainsFromHierarchicalConclusions(jobHierarchical);

  const densitySignal = computeDensitySignal(conceptConclusions);
  const { coverageSignal, covered, uncovered } = computeCoverageResult(candidateDomains, jobDomains);

  const coveredLower = covered.map((d) => d.toLowerCase());
  const matchedCandidateHierarchical = candidateHierarchical.filter((c) => {
    const step = c.evidence_chain.find((s) => s.edge?.type === 'PARENT_OF');
    return step?.edge && coveredLower.includes(step.edge.from.toLowerCase());
  });
  const usedForQuality = [...conceptConclusions, ...matchedCandidateHierarchical];
  const qualitySignal = computeQualitySignal(usedForQuality);

  // "How much real evidence went into this" - same philosophy as Phase 9's own coherence
  // confidence, not a claim about correctness.
  const evidenceCount = conceptConclusions.length + matchedCandidateHierarchical.length;
  const confidence = Math.min(1, evidenceCount / 4);

  const multiplier = combineReasoningSignals(densitySignal, coverageSignal, qualitySignal, confidence);
  const reasoningAdjustedScore = Number(Math.min(100, Math.max(0, priorAdjustedScore * multiplier)).toFixed(2));

  const reasoning =
    jobDomains.length === 0
      ? 'Job has no computed domain requirements yet - neutral.'
      : `${covered.length}/${jobDomains.length} job domain(s) covered by candidate reasoning conclusions, ${conceptConclusions.length} concept-level competency cluster(s).`;

  return {
    reasoningAdjustedScore,
    result: { multiplier, densitySignal, coverageSignal, qualitySignal, coveredDomains: covered, uncoveredDomains: uncovered, confidence, reasoning },
  };
}
