// Ported verbatim from the monolith's src/utils/dateParser.ts.
import { differenceInMonths } from 'date-fns';

function parseResumeDate(dateStr: string): Date | null {
  const clean = dateStr.trim().toLowerCase();
  if (
    clean === 'present' ||
    clean === 'current' ||
    clean === 'now' ||
    clean === 'till date' ||
    clean === 'active' ||
    clean === 'till now'
  ) {
    return new Date(2026, 6, 10); // Reference date: July 10, 2026
  }

  // Common patterns
  // 1. Month word + Year (e.g. "June 2018", "Oct. 2019", "Sept 2020", "jan 21")
  const monthWordYearRegex = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{2,4})$/;
  const match1 = clean.match(monthWordYearRegex);
  if (match1) {
    const monthMap: { [key: string]: number } = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const month = monthMap[match1[1].substring(0, 3)];
    let year = parseInt(match1[2], 10);
    if (match1[2].length === 2) {
      year = year < 50 ? 2000 + year : 1900 + year; // normalize 2-digit years
    }
    return new Date(year, month, 1);
  }

  // 2. Numerical MM/YYYY or MM-YYYY or MM.YYYY (e.g. "06/2018", "12-2020", "4.2021")
  const numericMonthYearRegex = /^(\d{1,2})[-./\s]+(\d{2,4})$/;
  const match2 = clean.match(numericMonthYearRegex);
  if (match2) {
    const month = parseInt(match2[1], 10) - 1;
    let year = parseInt(match2[2], 10);
    if (match2[2].length === 2) {
      year = year < 50 ? 2000 + year : 1900 + year;
    }
    if (month >= 0 && month <= 11) {
      return new Date(year, month, 1);
    }
  }

  // 3. Just Year (e.g. "2018")
  const justYearRegex = /^(\d{4})$/;
  const match3 = clean.match(justYearRegex);
  if (match3) {
    const year = parseInt(match3[1], 10);
    return new Date(year, 0, 1); // default to Jan 1st of that year
  }

  // Try standard Javascript Date parsing as fallback
  const parsedDate = new Date(dateStr);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate;
  }

  return null;
}

export function calculateExperienceFromText(text: string): string {
  // Regex to match date ranges, e.g.:
  // "June 2018 - Present"
  // "06/2018 to 12/2020"
  // "2014 - 2016"
  // "Oct-2021 – Dec-2024" (en-dash)
  const rangeRegex = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4}\s*[-–—to\s]+\s*(?:present|current|now|till date|active|till now|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4})|(?:\d{1,2}[-./\s]+\d{2,4})\s*[-–—to\s]+\s*(?:present|current|now|till date|active|till now|(?:\d{1,2}[-./\s]+\d{2,4}))|(?:\b\d{4}\b)\s*[-–—to\s]+\s*(?:present|current|now|till date|active|till now|(?:\b\d{4}\b))/gi;

  const matches = text.match(rangeRegex);
  if (!matches) {
    return "N/A";
  }

  const intervals: { start: Date; end: Date }[] = [];

  for (const match of matches) {
    const parts = match.split(/[-–—]|\bto\b/i).map(p => p.trim());
    if (parts.length === 2) {
      const start = parseResumeDate(parts[0]);
      const end = parseResumeDate(parts[1]);
      if (start && end && start <= end) {
        intervals.push({ start, end });
      }
    }
  }

  if (intervals.length === 0) {
    return "N/A";
  }

  // Sort intervals by start date
  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlaps
  const merged: { start: Date; end: Date }[] = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      // Overlap, extend end of last interval if current is later
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  // Calculate total months
  let totalMonths = 0;
  for (const interval of merged) {
    const months = differenceInMonths(interval.end, interval.start) + 1;
    totalMonths += months;
  }

  if (totalMonths === 0) {
    return "N/A";
  }

  const years = Math.floor(totalMonths / 12);
  const remainingMonths = totalMonths % 12;

  let result = "";
  if (years > 0) {
    result += `${years} Year${years > 1 ? 's' : ''}`;
  }
  if (remainingMonths > 0) {
    if (result) result += " ";
    result += `${remainingMonths} Month${remainingMonths > 1 ? 's' : ''}`;
  }

  return result || "N/A";
}
