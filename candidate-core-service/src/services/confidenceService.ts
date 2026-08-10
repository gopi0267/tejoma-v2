// Ported verbatim from the monolith's src/matching/confidenceService.ts (write-cutover completion
// plan, Phase A) - a pure, dependency-free enrichment layer with no DB/network calls, so it moves
// as-is. See the monolith's own copy for the full module doc; the summary: this answers which
// specific pieces of a candidate extraction should be trusted, computed once at candidate-creation
// time and stored in the additive candidates.confidence_profile JSONB column.

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceBasis {
  level: ConfidenceLevel;
  score: number; // 0-1
  basis: string;
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
