import { describe, it, expect } from 'vitest';
import { parseJobDescription } from '../../src/jd-parser/index.js';

// skipNlpTier: true throughout - these are unit/integration tests for the deterministic Tier 1-2
// path (regex + dictionary), which must never depend on the Python NLP microservice being up.
// The NLP tier itself is exercised separately (see scripts/smoke-test-pipeline-with-nlp.ts and
// the E2E script), since it requires a running model server, not something a CI unit test suite
// should depend on.

const SAMPLE_JD = `Senior Backend Engineer

Required Skills:
5-8 Years of experience with Node.js, Java (Core Java), and PostgreSQL.
Strong knowledge of Spring Boot, MS SQL, and Kubernetes (K8s).
B.Tech or M.Tech in Computer Science required.
PMP certification is a plus.

Nice to Have:
Experience with GraphQL and MongoDB.

Responsibilities:
- Design and build scalable backend services
- Mentor junior engineers

Location: Bangalore / Hybrid
Employment Type: Full-time
Notice Period: 30 days
Openings: 3
Salary: 18-25 LPA
`;

describe('parseJobDescription (Tier 1-2 only)', () => {
  it('throws on empty input rather than returning a garbage result', async () => {
    await expect(parseJobDescription('   ', { skipNlpTier: true })).rejects.toThrow();
  });

  it('extracts and merges fields from all tiers into one validated result', async () => {
    const result = await parseJobDescription(SAMPLE_JD, { skipNlpTier: true });
    const p = result.parsed;

    expect(p.jobTitle).toBe('Senior Backend Engineer');
    expect(p.minimumExperience).toBe(5);
    expect(p.maximumExperience).toBe(8);
    expect(p.salaryMinimum).toBe(1800000);
    expect(p.salaryMaximum).toBe(2500000);
    expect(p.salaryCurrency).toBe('INR');
    expect(p.remoteType).toBe('hybrid');
    expect(p.employmentType).toBe('full-time');
    expect(p.noticePeriod).toBe('30 days');
    expect(p.numberOfOpenings).toBe(3);
    expect(p.location).toContain('Bangalore');
    expect(p.responsibilities).toEqual([
      'Design and build scalable backend services',
      'Mentor junior engineers',
    ]);
  });

  it('derives non-empty keywords from the matched skills/education/certifications', async () => {
    const result = await parseJobDescription(SAMPLE_JD, { skipNlpTier: true });
    expect(result.parsed.keywords.length).toBeGreaterThan(0);
    expect(result.parsed.keywords).toContain('Node.js');
  });

  it('tracks which tier resolved each field', async () => {
    const result = await parseJobDescription(SAMPLE_JD, { skipNlpTier: true });
    const bySource = Object.fromEntries(result.fieldSources.map((f) => [f.field, f.tier]));
    expect(bySource.minimumExperience).toBe('regex');
    expect(bySource.requiredSkills).toBe('dictionary');
    expect(bySource.keywords).toBe('derived');
  });

  it('completes well within the 300ms budget for the deterministic tiers', async () => {
    const result = await parseJobDescription(SAMPLE_JD, { skipNlpTier: true });
    expect(result.parseTimeMs).toBeLessThan(300);
  });

  it('never leaves industry/department NLP-only fields populated when the NLP tier is skipped', async () => {
    const result = await parseJobDescription(SAMPLE_JD, { skipNlpTier: true });
    expect(result.parsed.industry).toBeNull();
    expect(result.parsed.department).toBeNull();
  });

  it('produces a valid result even for a JD with no recognizable structure at all', async () => {
    const result = await parseJobDescription('We are hiring. Please apply.', { skipNlpTier: true });
    expect(result.parsed.requiredSkills).toEqual([]);
    expect(result.parsed.minimumExperience).toBeNull();
  });
});
