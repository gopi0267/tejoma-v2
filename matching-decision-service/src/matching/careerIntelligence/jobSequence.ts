/**
 * Career Intelligence Module - Job Sequence Analysis
 * Ported from monolith for explainability module to infer seniority from job titles.
 * Used by narrativeGeneration.ts to build SeniorityNarrative.
 */

export type SeniorityLevel = 'entry' | 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'principal' | 'director' | 'executive';

export const SENIORITY_ORDER: SeniorityLevel[] = ['entry', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal', 'director', 'executive'];

const SENIORITY_KEYWORDS: Record<SeniorityLevel, string[]> = {
  executive: ['ceo', 'cto', 'cfo', 'chief', 'president', 'founder', 'vp ', 'vice president'],
  director: ['director', 'head of', 'regional manager', 'general manager'],
  principal: ['principal', 'principal engineer', 'principal architect', 'distinguished'],
  staff: ['staff', 'staff engineer', 'staff architect', 'senior staff'],
  lead: ['lead', 'tech lead', 'team lead', 'engineering lead', 'development lead', 'squad lead'],
  senior: ['senior', 'sr ', 'sr.', 'senior engineer', 'senior developer', 'senior architect'],
  mid: ['engineer', 'developer', 'architect', 'software', 'full stack', 'backend', 'frontend'],
  junior: ['junior', 'jr ', 'jr.', 'associate', 'graduate'],
  entry: ['intern', 'trainee', 'apprentice'],
};

export interface SeniorityInference {
  level: SeniorityLevel | null;
  confidence: number; // 0-1
}

export function inferSeniority(jobTitle: string | null): SeniorityInference {
  if (!jobTitle || jobTitle.trim().length === 0) {
    return { level: null, confidence: 0 };
  }

  const titleLower = jobTitle.toLowerCase().trim();

  // Check each seniority level from highest to lowest
  for (const level of [...SENIORITY_ORDER].reverse()) {
    const keywords = SENIORITY_KEYWORDS[level];
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        // Higher confidence for exact matches and primary keywords
        const confidence = keyword.length > 3 ? 0.85 : 0.7;
        return { level, confidence };
      }
    }
  }

  // Default to mid-level if no explicit indicators found (common for generic "Software Engineer")
  if (titleLower.includes('engineer') || titleLower.includes('developer')) {
    return { level: 'mid', confidence: 0.5 };
  }

  return { level: null, confidence: 0 };
}
