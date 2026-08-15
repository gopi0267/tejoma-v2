/**
 * Candidate chronology: date ranges, overlap detection, non-double-counted totals, and recency.
 *
 * MEASURED CONSTRAINT, STATED UP FRONT
 * In the live corpus only 16 of 39 resumes contain any year at all and only 3 contain a date RANGE.
 * The structured columns that would carry this properly - work_history, project_entries - are
 * populated for 0 of 39 candidates. So for most real candidates this module correctly returns
 * nothing, and recency is UNKNOWN. That is the honest output. Guessing that a skill is "current"
 * because it sits in a Skills section is exactly the fabrication the brief forbids, and it would be
 * indistinguishable to Phase 6 from a genuinely dated timeline.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "Now" is injected, never read from the clock.
 *
 * A profile whose recency silently depends on the wall clock cannot be deterministic: the same
 * resume would hash differently tomorrow, and Phase 4's determinism gate would be measuring the
 * calendar. Callers pass an explicit reference date; the engine defaults it to the newest date the
 * resume itself mentions, so the document is interpreted against its own timeframe.
 */
export interface DateRange {
  start: string;            // yyyy-MM
  end: string | null;       // yyyy-MM, null when ongoing
  ongoing: boolean;
  months: number | null;
  matchedText: string;
  index: number;
  length: number;
}

const ONGOING = /present|current|now|till\s*date|to\s*date|ongoing/i;

const MONTH_YEAR = String.raw`(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?((?:19|20)\d{2})`;
const RANGE_RE = new RegExp(
  String.raw`${MONTH_YEAR}\s*(?:-|–|—|to|until|through)\s*(?:(present|current|now|till\s*date|to\s*date|ongoing)|${MONTH_YEAR})`,
  'gi',
);

const ym = (y: number, m: number): string => `${y}-${String(m).padStart(2, '0')}`;
const toIndex = (s: string): number => {
  const [y, m] = s.split('-').map(Number);
  return y * 12 + (m - 1);
};

/**
 * Extract every date range in the text. Ranges only - a bare year is not an employment period, and
 * treating "2019" as a range would manufacture a duration the resume never stated.
 */
export function extractRanges(text: string, reference: string): DateRange[] {
  if (!text) return [];
  const out: DateRange[] = [];
  RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANGE_RE.exec(text)) !== null) {
    const [full, sMon, sYear, ongoingWord, eMon, eYear] = m;
    const startY = Number(sYear);
    const startM = sMon ? MONTHS[sMon.toLowerCase().slice(0, 3)] : 1;
    const start = ym(startY, startM);

    let end: string | null = null;
    let ongoing = false;
    if (ongoingWord && ONGOING.test(ongoingWord)) {
      ongoing = true;
      end = null;
    } else if (eYear) {
      const endY = Number(eYear);
      const endM = eMon ? MONTHS[eMon.toLowerCase().slice(0, 3)] : 12;
      end = ym(endY, endM);
    }

    const effectiveEnd = end ?? reference;
    // An end before its start is not a duration. Recorded with months=null so the contradiction
    // analyzer can flag it rather than silently producing a negative or absolute value.
    const months = toIndex(effectiveEnd) >= toIndex(start)
      ? toIndex(effectiveEnd) - toIndex(start) + 1
      : null;

    out.push({ start, end, ongoing, months, matchedText: full, index: m.index, length: full.length });
  }
  return out;
}

/** The latest year the document mentions - used as the reference date so results are stable. */
export function inferReferenceDate(text: string, fallback: string): string {
  const years = [...text.matchAll(/(?:19|20)\d{2}/g)].map((m) => Number(m[0]));
  if (years.length === 0) return fallback;
  const max = Math.max(...years);
  // A resume quoting a future year is data noise, not a time machine; clamp to the fallback.
  return max > Number(fallback.slice(0, 4)) ? fallback : `${max}-12`;
}

/**
 * Total months covered by the ranges, counting overlapping periods ONCE.
 *
 * Summing every range is the classic resume-arithmetic bug: a candidate who lists a job and a
 * concurrent side project gets credited twice and appears to have twice the career they have. The
 * union of intervals is the only defensible total.
 */
export function unionMonths(ranges: DateRange[], reference: string): number | null {
  const valid = ranges.filter((r) => r.months !== null);
  if (valid.length === 0) return null;
  const intervals = valid
    .map((r) => [toIndex(r.start), toIndex(r.end ?? reference)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = intervals[0];
  for (const [s, e] of intervals.slice(1)) {
    if (s <= curEnd + 1) curEnd = Math.max(curEnd, e);
    else { total += curEnd - curStart + 1; [curStart, curEnd] = [s, e]; }
  }
  return total + (curEnd - curStart + 1);
}

/** Pairs of ranges that overlap by more than a month - candidate concurrent-employment evidence. */
export function findOverlaps(ranges: DateRange[], reference: string): [DateRange, DateRange][] {
  const out: [DateRange, DateRange][] = [];
  const valid = ranges.filter((r) => r.months !== null);
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i], b = valid[j];
      const aS = toIndex(a.start), aE = toIndex(a.end ?? reference);
      const bS = toIndex(b.start), bE = toIndex(b.end ?? reference);
      const overlap = Math.min(aE, bE) - Math.max(aS, bS) + 1;
      if (overlap > 1) out.push([a, b]);
    }
  }
  return out;
}

/** Ranges whose end precedes their start, or which sit in the future relative to the reference. */
export function findImpossible(ranges: DateRange[], reference: string): DateRange[] {
  const refIdx = toIndex(reference);
  return ranges.filter((r) => r.months === null || toIndex(r.start) > refIdx);
}

/**
 * Recency of a skill, from the newest range that actually mentions it.
 *
 * Returns UNKNOWN when no dated evidence exists, which in this corpus is the common case. UNKNOWN
 * is a real answer here: it tells Phase 6 "no timeline evidence" rather than quietly implying the
 * skill is stale, and those are very different inputs to a hiring decision.
 */
export function recencyFor(lastUsedEnd: string | null, ongoing: boolean, reference: string):
  'ACTIVE' | 'RECENT' | 'HISTORICAL' | 'STALE' | 'UNKNOWN' {
  if (ongoing) return 'ACTIVE';
  if (!lastUsedEnd) return 'UNKNOWN';
  const gap = toIndex(reference) - toIndex(lastUsedEnd);
  if (gap <= 6) return 'ACTIVE';
  if (gap <= 24) return 'RECENT';
  if (gap <= 60) return 'HISTORICAL';
  return 'STALE';
}
