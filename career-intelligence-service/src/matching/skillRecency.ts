// Ported from the monolith's src/matching/skillRecency.ts - parseResumeDate only, byte-identical.
// Needed by jobSequence.ts/stability.ts's date arithmetic.

// Parses this module's own "YYYY-MM" | "YYYY" format (the exact format parser.service.ts's
// normalizeDateField already validates and stores). Returns a comparable Date (first of the
// month, or Jan 1 for year-only) or null for anything else.
export function parseResumeDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(dateStr);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month - 1, 1));
  }
  const yearMatch = /^(\d{4})$/.exec(dateStr);
  if (yearMatch) {
    return new Date(Date.UTC(Number(yearMatch[1]), 0, 1));
  }
  return null;
}
