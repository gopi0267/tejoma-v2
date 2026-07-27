// Enterprise AI Matching Architecture, Phase 1 - Confidence Architecture.
//
// A pure, additive enrichment layer. It CONSUMES data parser.service.ts has already extracted -
// it never calls Gemini, never changes the parser's prompt or logic, and never changes the shape
// of anything the parser itself returns (the /candidate-resume/parse preview response the
// candidate onboarding UI depends on is untouched). This module answers a question the parser's
// own single, whole-document ai_confidence_score/extraction_status never could: which specific
// pieces of the extraction should be trusted, and which need a second look.
//
// Wiring: called once, at candidate-creation time, by db.createCandidate (see that function) -
// the result is stored in the new, additive candidates.confidence_profile JSONB column. Nothing
// about the existing candidate-creation flow's inputs, outputs, or side effects changes; this is
// one more field computed and stored alongside everything already computed there.
//
// JD-side note: jobs already has real, wired per-field confidence (parse_confidence JSONB,
// populated from src/jd-parser's per-field tier tracking - see FieldSource in
// src/jd-parser/types.ts). That is genuine, already-functioning confidence infrastructure; this
// module does not duplicate it. The gap this phase closes is specifically the resume/candidate
// side, which had only ever recorded one whole-document score.

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceBasis {
  level: ConfidenceLevel;
  score: number; // 0-1
  basis: string; // human-readable reason, surfaced in the Phase 1 report and reusable by future UI
}

export interface ConfidenceProfile {
  schema_version: 1;
  computed_at: string;
  overall: ConfidenceBasis;
  skills: Record<string, ConfidenceBasis>;
  experience: ConfidenceBasis;
  education: ConfidenceBasis;
  projects: ConfidenceBasis;
}

export interface CandidateConfidenceInput {
  skills?: string[] | null;
  years_of_experience?: string | null;
  resume_text?: string | null;
  highest_qualification?: string | null;
  university?: string | null;
  graduation_year?: string | null;
  projects?: string | null;
  ai_confidence_score?: string | null;
  extraction_status?: string | null;
}

function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? '').toLowerCase();
}

// Same anti-hallucination pattern parser.service.ts already applies to email (discarding an
// extracted email that never literally appears in the raw resume text) - applied here per skill,
// as a confidence signal rather than a discard, since an inferred-but-unverified skill is still
// useful information, just less certain than an explicitly-stated one.
function computeSkillConfidence(skill: string, resumeTextLower: string): ConfidenceBasis {
  const skillLower = skill.trim().toLowerCase();
  if (skillLower && resumeTextLower.includes(skillLower)) {
    return { level: 'high', score: 0.9, basis: 'Exact text match found in resume' };
  }
  return { level: 'medium', score: 0.5, basis: 'Extracted by the parser but not found verbatim in resume text - may be a synonym, abbreviation, or inference' };
}

function computeExperienceConfidence(yearsText: string | null | undefined, resumeTextLower: string): ConfidenceBasis {
  const text = (yearsText ?? '').trim();
  if (!text) {
    return { level: 'low', score: 0.2, basis: 'No years_of_experience value extracted' };
  }
  const numberMatch = text.match(/\d+(\.\d+)?/);
  if (!numberMatch) {
    return { level: 'low', score: 0.3, basis: 'years_of_experience has no parseable number' };
  }
  const numberText = numberMatch[0];
  if (resumeTextLower.includes(numberText)) {
    return { level: 'high', score: 0.85, basis: 'Stated figure corroborated by matching text in the resume' };
  }
  return { level: 'medium', score: 0.55, basis: 'A figure was extracted but could not be corroborated verbatim in resume text (may be date-range-derived)' };
}

function computeEducationConfidence(input: CandidateConfidenceInput): ConfidenceBasis {
  const present = [input.highest_qualification, input.university, input.graduation_year].filter((v) => v && v.trim()).length;
  if (present === 3) return { level: 'high', score: 0.9, basis: 'Qualification, university, and graduation year all present' };
  if (present >= 1) return { level: 'medium', score: 0.5, basis: `${present} of 3 education fields present (qualification/university/graduation year)` };
  return { level: 'low', score: 0.15, basis: 'No structured education fields extracted' };
}

function computeProjectsConfidence(projectsText: string | null | undefined, skills: string[]): ConfidenceBasis {
  const text = (projectsText ?? '').trim();
  if (!text) {
    return { level: 'low', score: 0.2, basis: 'No project descriptions extracted' };
  }
  const textLower = text.toLowerCase();
  const corroboratingSkill = skills.find((s) => s.trim() && textLower.includes(s.trim().toLowerCase()));
  if (corroboratingSkill) {
    return { level: 'high', score: 0.85, basis: `Project description mentions a listed skill ("${corroboratingSkill}") - self-consistent` };
  }
  return { level: 'medium', score: 0.5, basis: 'Project description present but does not reference any listed skill by name' };
}

// The parser's own fallback default is a percentage string ("90%"); a real Gemini extraction
// returns a 0-1 decimal (e.g. "0.98") - both formats are handled, matching the same normalization
// already established for this exact ambiguity in the candidate onboarding UI's confidence
// handling (CandidateOnboardingAIResume.tsx's parseConfidencePercent).
function parseOverallConfidencePercent(raw: string | null | undefined): number {
  if (!raw) return 90;
  const num = parseFloat(String(raw).trim().replace('%', ''));
  if (!Number.isFinite(num)) return 90;
  return num <= 1 ? num * 100 : num;
}

export function computeCandidateConfidence(input: CandidateConfidenceInput): ConfidenceProfile {
  const resumeTextLower = normalizeText(input.resume_text);
  const skills = (input.skills ?? []).filter((s) => s && s.trim());

  const skillConfidences: Record<string, ConfidenceBasis> = {};
  for (const skill of skills) {
    skillConfidences[skill] = computeSkillConfidence(skill, resumeTextLower);
  }

  const experience = computeExperienceConfidence(input.years_of_experience, resumeTextLower);
  const education = computeEducationConfidence(input);
  const projects = computeProjectsConfidence(input.projects, skills);

  // Overall = the parser's own extraction-quality signal, blended with the average of the
  // per-entity signals computed above - grounds the aggregate in both what the parser itself
  // reported AND what this layer could independently verify, rather than either alone.
  const parserConfidenceScore = parseOverallConfidencePercent(input.ai_confidence_score) / 100;
  const isPartialExtraction = Boolean(input.extraction_status && input.extraction_status !== 'success' && input.extraction_status !== 'Complete');
  const entityScores = [experience.score, education.score, projects.score, ...Object.values(skillConfidences).map((c) => c.score)];
  const avgEntityScore = entityScores.length > 0 ? entityScores.reduce((a, b) => a + b, 0) / entityScores.length : parserConfidenceScore;
  const overallScoreRaw = (parserConfidenceScore + avgEntityScore) / 2;
  const overallScore = isPartialExtraction ? Math.min(overallScoreRaw, 0.6) : overallScoreRaw;

  const overall: ConfidenceBasis = {
    level: levelFromScore(overallScore),
    score: Number(overallScore.toFixed(3)),
    basis: isPartialExtraction
      ? `Parser reported a partial/incomplete extraction (status: ${input.extraction_status}) - overall confidence capped accordingly`
      : `Blend of the parser's own extraction confidence (${Math.round(parserConfidenceScore * 100)}%) and this layer's independent per-entity verification`,
  };

  return {
    schema_version: 1,
    computed_at: new Date().toISOString(),
    overall,
    skills: skillConfidences,
    experience,
    education,
    projects,
  };
}
