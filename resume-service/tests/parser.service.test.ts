/**
 * Tests for the real parsing/normalization logic in services/parser.service.ts - mocks the
 * Gemini SDK (no real API key available in CI) with controlled two-pass responses, so what's
 * actually under test is the merging/normalization code (skills union, date-format validation,
 * email sanity check, extraction_status computation), not Gemini itself. A real, unmocked call is
 * additionally verified locally as part of this batch's validation (see the batch report).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }
  return { GoogleGenAI, Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', BOOLEAN: 'BOOLEAN' } };
});

const { parseResume } = await import('../src/services/parser.service.js');

const RESUME_TEXT = `Jane Doe
jane.doe@example.test
9876543210

Senior Backend Engineer at Acme Corp (Jan 2021 - Present)
Previously: Software Engineer at Beta Inc (2018 - 2020)

Skills: Node.js, PostgreSQL, Docker
`;

function draftResponse(overrides: Partial<Record<string, any>> = {}) {
  return {
    Name: 'Jane Doe', Email: 'jane.doe@example.test', Phone: '9876543210',
    Skills: 'Node.js, PostgreSQL', Primary_Skills: null, Secondary_Skills: null,
    Years_of_Experience: '5 Years', Current_Location: null, Preferred_Location: null,
    Current_Company: 'Acme Corp', Previous_Companies: 'Beta Inc', Current_Job_Title: 'Senior Backend Engineer',
    Industry_Domain: null, Education: null, Highest_Qualification: null, Graduation_Year: null,
    University: null, Certifications: null, Projects: null, Technical_Tools: null,
    Languages_Known: null, Current_CTC: null, Expected_CTC: null, Notice_Period: null,
    Willingness_to_Relocate: null, LinkedIn_URL: null, GitHub_or_Portfolio_URL: null,
    Resume_Summary: null, AI_Confidence_Score: '95%', Data_Status: 'Complete',
    Work_History: [{ company: 'Acme Corp', title: 'Senior Backend Engineer', start_date: '2021-01', end_date: null, is_current: true }],
    Project_Entries: [],
    ...overrides,
  };
}

describe('parseResume - two-pass merge (mocked Gemini)', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('merges Pass 1 and Pass 2, uses Pass 2 as authoritative when both succeed', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify(draftResponse()) })
      .mockResolvedValueOnce({ text: JSON.stringify(draftResponse({ Skills: 'Node.js, PostgreSQL, Docker' })) });

    const result = await parseResume(RESUME_TEXT, { fallbackToRegex: false });

    expect(result.name).toBe('Jane Doe');
    expect(result.email).toBe('jane.doe@example.test');
    expect(result.current_company).toBe('Acme Corp');
    expect(result.previous_companies).toEqual(['Beta Inc']);
    // Union of both passes' skills, de-duplicated - Pass 2 added Docker, Pass 1's items kept too.
    expect(result.skills).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL', 'Docker']));
    expect(result.work_history).toEqual([
      { company: 'Acme Corp', title: 'Senior Backend Engineer', start_date: '2021-01', end_date: null, is_current: true },
    ]);
    expect(result.extraction_status).toBe('Complete');
  });

  it('falls back to the Pass 1 draft when Pass 2 (audit) fails', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify(draftResponse()) })
      .mockRejectedValueOnce(new Error('audit pass failed'));

    const result = await parseResume(RESUME_TEXT, { fallbackToRegex: false });
    expect(result.name).toBe('Jane Doe');
    expect(result.current_company).toBe('Acme Corp');
  });

  it('discards an email the model invented (post-extraction sanity check)', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify(draftResponse({ Email: 'totally-invented@nowhere.test' })) })
      .mockResolvedValueOnce({ text: JSON.stringify(draftResponse({ Email: 'totally-invented@nowhere.test' })) });

    const result = await parseResume(RESUME_TEXT, { fallbackToRegex: false });
    expect(result.email).toBe('N/A');
    expect(result.extraction_status).toBe('Review Required');
  });

  it('drops a Work_History date that is not YYYY-MM or YYYY format (never fabricates)', async () => {
    const withBadDate = draftResponse({
      Work_History: [{ company: 'Acme Corp', title: 'Engineer', start_date: 'sometime in 2021', end_date: null, is_current: true }],
    });
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify(withBadDate) })
      .mockResolvedValueOnce({ text: JSON.stringify(withBadDate) });

    const result = await parseResume(RESUME_TEXT, { fallbackToRegex: false });
    expect(result.work_history[0].start_date).toBeNull();
  });

  it('falls back to regex-only extraction when Gemini fails entirely and fallbackToRegex is not disabled', async () => {
    mockGenerateContent.mockRejectedValue(new Error('quota exceeded'));

    const result = await parseResume(RESUME_TEXT);
    expect(result.email).toBe('jane.doe@example.test'); // regex fallback still finds it
    expect(result.extraction_status).toBe('Partial');
  });

  it('rethrows when Gemini fails entirely and fallbackToRegex is explicitly disabled', async () => {
    mockGenerateContent.mockRejectedValue(new Error('quota exceeded'));
    await expect(parseResume(RESUME_TEXT, { fallbackToRegex: false })).rejects.toThrow('quota exceeded');
  });
});
