import { describe, it, expect } from 'vitest';
import { runDictionaryTier, splitIntoSections } from '../../src/jd-parser/tiers/dictionaryTier.js';

describe('splitIntoSections', () => {
  it('closes a multi-line section when it hits a standalone metadata line', () => {
    // Regression test for a real bug found during manual testing: trailing "Label: value" lines
    // after a Responsibilities section were being swept into the responsibilities text instead
    // of ending that section.
    const text = [
      'Responsibilities:',
      '- Design and build scalable backend services',
      '- Mentor junior engineers',
      'Location: Bangalore / Hybrid',
      'Notice Period: 30 days',
    ].join('\n');

    const sections = splitIntoSections(text);
    const responsibilities = sections.find((s) => s.type === 'responsibilities');
    expect(responsibilities).toBeDefined();
    expect(responsibilities!.text).toContain('Design and build scalable backend services');
    expect(responsibilities!.text).not.toContain('Location:');
    expect(responsibilities!.text).not.toContain('Notice Period:');
  });

  it('splits required vs optional/preferred sections', () => {
    const text = ['Required Skills:', 'Node.js, PostgreSQL', 'Nice to Have:', 'GraphQL, MongoDB'].join('\n');
    const sections = splitIntoSections(text);
    expect(sections.find((s) => s.type === 'required')?.text).toContain('Node.js');
    expect(sections.find((s) => s.type === 'optional')?.text).toContain('GraphQL');
  });
});

describe('runDictionaryTier', () => {
  const jd = `
Required Skills:
5+ years of experience with Node.js, Java (Core Java), and PostgreSQL.
Strong knowledge of Spring Boot, MS SQL, and Kubernetes (K8s).
B.Tech or M.Tech in Computer Science required.
PMP certification is a plus.

Nice to Have:
Experience with GraphQL and MongoDB.

Location: Bangalore
Languages: English, Hindi preferred.
`;

  it('normalizes known synonyms to their canonical form', () => {
    const result = runDictionaryTier(jd);
    const canonicals = result.fields.requiredSkills.map((s) => s.canonical);
    expect(canonicals).toContain('SQL Server'); // from "MS SQL"
    expect(canonicals).toContain('Kubernetes'); // from "K8s"
    expect(canonicals).toContain('Java'); // from "Core Java"
  });

  it('never puts the same skill in both required and optional', () => {
    const result = runDictionaryTier(jd);
    const requiredCanonicals = new Set(result.fields.requiredSkills.map((s) => s.canonical.toLowerCase()));
    const optionalCanonicals = result.fields.optionalSkills.map((s) => s.canonical.toLowerCase());
    for (const c of optionalCanonicals) {
      expect(requiredCanonicals.has(c)).toBe(false);
    }
  });

  it('routes preferred/nice-to-have skills into optionalSkills, not requiredSkills', () => {
    const result = runDictionaryTier(jd);
    expect(result.fields.requiredSkills.map((s) => s.canonical)).not.toContain('GraphQL');
    expect(result.fields.optionalSkills.map((s) => s.canonical)).toContain('GraphQL');
  });

  it('extracts education, certifications, languages, and location', () => {
    const result = runDictionaryTier(jd);
    expect(result.fields.education).toContain('B.Tech');
    expect(result.fields.education).toContain('M.Tech');
    expect(result.fields.certifications).toContain('PMP');
    expect(result.fields.requiredLanguages).toEqual(expect.arrayContaining(['English', 'Hindi']));
    expect(result.fields.location).toContain('Bangalore');
  });

  it('does not duplicate a skill matched more than once in the text', () => {
    const text = 'Required Skills: Docker, Docker, Docker containerization.';
    const result = runDictionaryTier(text);
    const dockerMatches = result.fields.requiredSkills.filter((s) => s.canonical === 'Docker');
    expect(dockerMatches.length).toBe(1);
  });

  it('returns empty arrays (never null) for fields with no matches', () => {
    const result = runDictionaryTier('A job with no listed skills at all.');
    expect(result.fields.requiredSkills).toEqual([]);
    expect(result.fields.certifications).toEqual([]);
    expect(result.fields.location).toEqual([]);
  });
});
