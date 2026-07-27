import { describe, it, expect } from 'vitest';
import { computeCandidateConfidence } from '../../src/matching/confidenceService.js';

// Enterprise AI Matching Architecture, Phase 1 - Confidence Architecture. Pure function, no DB/
// network dependency - computeCandidateConfidence never calls parser.service.ts, it only
// consumes data shaped like what that parser already returns.

describe('computeCandidateConfidence - skill confidence', () => {
  it('rates a skill high when it appears verbatim in resume_text', () => {
    const profile = computeCandidateConfidence({
      skills: ['Python'],
      resume_text: 'Experienced engineer with 5 years of Python development.',
    });
    expect(profile.skills['Python'].level).toBe('high');
    expect(profile.skills['Python'].score).toBeGreaterThanOrEqual(0.75);
  });

  it('rates a skill medium (not low) when it does not appear verbatim - never silently discarded', () => {
    const profile = computeCandidateConfidence({
      skills: ['Kubernetes'],
      resume_text: 'Built and deployed containerized applications for years.',
    });
    expect(profile.skills['Kubernetes'].level).toBe('medium');
    expect(profile.skills['Kubernetes'].basis).toContain('not found verbatim');
  });

  it('is case-insensitive when checking for verbatim mentions', () => {
    const profile = computeCandidateConfidence({
      skills: ['python'],
      resume_text: 'Extensive PYTHON background.',
    });
    expect(profile.skills['python'].level).toBe('high');
  });

  it('produces one confidence entry per listed skill, and none for skills not listed', () => {
    const profile = computeCandidateConfidence({ skills: ['Python', 'Django', 'AWS'], resume_text: 'Python and Django expert.' });
    expect(Object.keys(profile.skills).sort()).toEqual(['AWS', 'Django', 'Python']);
  });

  it('handles an empty or missing skills list without error', () => {
    const profile = computeCandidateConfidence({ skills: [], resume_text: 'Some resume text.' });
    expect(profile.skills).toEqual({});
    const profile2 = computeCandidateConfidence({ resume_text: 'Some resume text.' });
    expect(profile2.skills).toEqual({});
  });
});

describe('computeCandidateConfidence - experience confidence', () => {
  it('rates high when the stated figure is corroborated by the resume text', () => {
    const profile = computeCandidateConfidence({ years_of_experience: '6 years', resume_text: 'I have 6 years of professional experience.' });
    expect(profile.experience.level).toBe('high');
  });

  it('rates medium when a figure is extracted but not corroborated', () => {
    const profile = computeCandidateConfidence({ years_of_experience: '6 years', resume_text: 'Senior engineer, joined in 2018.' });
    expect(profile.experience.level).toBe('medium');
  });

  it('rates low when no years_of_experience value is present', () => {
    const profile = computeCandidateConfidence({ years_of_experience: '', resume_text: 'Some resume.' });
    expect(profile.experience.level).toBe('low');
  });

  it('rates low when years_of_experience has no parseable number (e.g. "Fresher")', () => {
    const profile = computeCandidateConfidence({ years_of_experience: 'Fresher', resume_text: 'Recent graduate.' });
    expect(profile.experience.level).toBe('low');
  });
});

describe('computeCandidateConfidence - education confidence', () => {
  it('rates high when qualification, university, and graduation year are all present', () => {
    const profile = computeCandidateConfidence({ highest_qualification: 'B.Tech', university: 'IIT Bombay', graduation_year: '2020' });
    expect(profile.education.level).toBe('high');
  });

  it('rates medium when some but not all education fields are present', () => {
    const profile = computeCandidateConfidence({ highest_qualification: 'B.Tech', university: '', graduation_year: '' });
    expect(profile.education.level).toBe('medium');
  });

  it('rates low when no education fields are present', () => {
    const profile = computeCandidateConfidence({});
    expect(profile.education.level).toBe('low');
  });
});

describe('computeCandidateConfidence - project confidence (self-consistency)', () => {
  it('rates high when a project description references a listed skill', () => {
    const profile = computeCandidateConfidence({
      skills: ['Django'],
      projects: 'Built an e-commerce platform using Django and PostgreSQL.',
    });
    expect(profile.projects.level).toBe('high');
    expect(profile.projects.basis).toContain('Django');
  });

  it('rates medium when a project description exists but references no listed skill', () => {
    const profile = computeCandidateConfidence({ skills: ['Java'], projects: 'Led a cross-functional initiative to improve delivery speed.' });
    expect(profile.projects.level).toBe('medium');
  });

  it('rates low when no project description is present', () => {
    const profile = computeCandidateConfidence({ projects: '' });
    expect(profile.projects.level).toBe('low');
  });
});

describe('computeCandidateConfidence - overall confidence', () => {
  it('handles both ai_confidence_score formats (0-1 decimal and percentage string)', () => {
    const decimal = computeCandidateConfidence({ skills: ['Python'], resume_text: 'Python developer.', ai_confidence_score: '0.95', extraction_status: 'Complete' });
    const percent = computeCandidateConfidence({ skills: ['Python'], resume_text: 'Python developer.', ai_confidence_score: '95%', extraction_status: 'Complete' });
    // Both should land in the same rough confidence tier - not off by a factor of 100.
    expect(decimal.overall.level).toBe(percent.overall.level);
  });

  it('caps overall confidence when the parser reported a partial extraction', () => {
    const complete = computeCandidateConfidence({ skills: ['Python'], resume_text: 'Python developer with strong background.', ai_confidence_score: '0.95', extraction_status: 'Complete' });
    const partial = computeCandidateConfidence({ skills: ['Python'], resume_text: 'Python developer with strong background.', ai_confidence_score: '0.95', extraction_status: 'Partial' });
    expect(partial.overall.score).toBeLessThan(complete.overall.score);
    expect(partial.overall.basis).toContain('partial');
  });

  it('always includes schema_version and a valid ISO computed_at timestamp', () => {
    const profile = computeCandidateConfidence({ skills: ['Python'] });
    expect(profile.schema_version).toBe(1);
    expect(() => new Date(profile.computed_at).toISOString()).not.toThrow();
  });

  it('produces a lower overall score for a sparse/empty extraction than a rich, corroborated one', () => {
    const rich = computeCandidateConfidence({
      skills: ['Python', 'Django'],
      years_of_experience: '5 years',
      resume_text: '5 years of Python and Django experience.',
      highest_qualification: 'B.Tech', university: 'IIT Delhi', graduation_year: '2019',
      projects: 'Built a Django-based analytics platform.',
    });
    const sparse = computeCandidateConfidence({ skills: [], resume_text: '' });
    expect(rich.overall.score).toBeGreaterThan(sparse.overall.score);
  });
});
