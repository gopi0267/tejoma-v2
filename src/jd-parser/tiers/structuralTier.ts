import { splitIntoSections } from './dictionaryTier.js';
import type { ParsedJobDescription } from '../types.js';

const TITLE_LABEL_RE = /^(?:job\s*title|position|role)\s*:\s*(.+)$/im;

// Best-effort, label/heuristic-only title extraction (still Tier 1 - no NLP). Falls back to the
// first short, non-empty line of the document, which is how most pasted JDs actually start.
// The NLP tier (Tier 3) can override this later with a spaCy-based extraction when available.
export function extractJobTitle(text: string): string | null {
  const labeled = text.match(TITLE_LABEL_RE);
  if (labeled) return labeled[1].trim();

  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine && firstLine.length <= 80 && !/[.!?]$/.test(firstLine)) {
    return firstLine;
  }
  return null;
}

function splitBullets(sectionText: string): string[] {
  return sectionText
    .split('\n')
    .map((line) => line.replace(/^[\s•\-*·▪◦]+/, '').trim())
    .filter((line) => line.length > 0);
}

export function extractResponsibilities(text: string): string[] {
  const sections = splitIntoSections(text);
  const respSection = sections.find((s) => s.type === 'responsibilities');
  if (!respSection) return [];
  return splitBullets(respSection.text);
}

export function extractJobSummary(text: string): string | null {
  const sections = splitIntoSections(text);
  const summarySection = sections.find((s) => s.type === 'summary');
  const source = summarySection ? summarySection.text : sections.find((s) => s.type === 'other')?.text || '';

  const cleaned = source.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  // First 2 sentences as a lightweight summary - good enough for the common case; the NLP tier
  // can produce a better abstractive/extractive summary later.
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length === 0) return cleaned.length > 300 ? cleaned.slice(0, 300).trim() + '...' : cleaned;
  return sentences.slice(0, 2).join(' ').trim();
}

export interface StructuralTierResult {
  fields: Pick<ParsedJobDescription, 'jobTitle' | 'jobSummary' | 'responsibilities'>;
  resolvedFields: string[];
}

export function runStructuralTier(text: string): StructuralTierResult {
  const jobTitle = extractJobTitle(text);
  const jobSummary = extractJobSummary(text);
  const responsibilities = extractResponsibilities(text);

  const resolvedFields: string[] = [];
  if (jobTitle) resolvedFields.push('jobTitle');
  if (jobSummary) resolvedFields.push('jobSummary');
  if (responsibilities.length) resolvedFields.push('responsibilities');

  return { fields: { jobTitle, jobSummary, responsibilities }, resolvedFields };
}
