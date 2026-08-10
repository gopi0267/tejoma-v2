// Ported from the monolith's src/matching/reasoningWeighting.ts - byte-identical logic. SHADOW
// MODE ONLY - see the monolith's own module doc for the full correction rationale (why this reads
// precomputed reasoning_conclusions rather than re-running graph traversal at match time).
// Reads this service's own dual-written reasoning_conclusions mirror (Batch 31, this table's first
// passive mirror anywhere in this migration - see db.ts's header comment), not the monolith's
// table directly.
import { db } from '../db.js';
import type { ShadowCandidate, ShadowJob, ReasoningConclusion, ReasoningMultiplierResult } from '../types.js';

export function extractDomainsFromHierarchicalConclusions(conclusions: ReasoningConclusion[]): string[] {
  const domains = new Set<string>();
  for (const c of conclusions) {
    if (c.reasoning_type !== 'hierarchical') continue;
    const parentStep = c.evidence_chain.find((s) => s.edge?.type === 'PARENT_OF');
    if (parentStep?.edge) domains.add(parentStep.edge.from);
  }
  return Array.from(domains);
}

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

export function computeCoverageResult(candidateDomains: string[], jobDomains: string[]): CoverageResult {
  if (jobDomains.length === 0) return { coverageSignal: 0, covered: [], uncovered: [] };
  const candidateSet = new Set(candidateDomains.map((d) => d.toLowerCase()));
  const covered = jobDomains.filter((d) => candidateSet.has(d.toLowerCase()));
  const uncovered = jobDomains.filter((d) => !candidateSet.has(d.toLowerCase()));
  return { coverageSignal: Number((covered.length / jobDomains.length).toFixed(4)), covered, uncovered };
}

export function computeQualitySignal(usedConclusions: ReasoningConclusion[]): number {
  if (usedConclusions.length === 0) return 0.5;
  return Number((usedConclusions.reduce((sum, c) => sum + c.conclusion_confidence, 0) / usedConclusions.length).toFixed(4));
}

const MAX_MULTIPLIER = 1.3;
const MIN_MULTIPLIER = 0.7;

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

export async function computeReasoningShadowResult(candidate: ShadowCandidate, job: ShadowJob, priorAdjustedScore: number): Promise<ReasoningShadowResult> {
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
