import type { DictionaryEntry } from '../matcher/trie.js';

function entry(canonical: string, extraAliases: string[] = []): DictionaryEntry {
  return { canonical, category: 'general', aliases: [canonical, ...extraAliases] };
}

// Degree/qualification patterns. Canonical spellings match common recruiter usage in India-market
// JDs (B.Tech/M.Tech) plus international equivalents (Bachelor's/Master's/BS/MS).
export const EDUCATION_DICTIONARY: DictionaryEntry[] = [
  entry('B.Tech', ['BTech', 'B Tech', 'Bachelor of Technology']),
  entry('M.Tech', ['MTech', 'M Tech', 'Master of Technology']),
  entry('BE', ['B.E.', 'Bachelor of Engineering']),
  entry('ME', ['M.E.', 'Master of Engineering']),
  entry('BCA', ['Bachelor of Computer Applications']),
  entry('MCA', ['Master of Computer Applications']),
  entry('MBA', ['Master of Business Administration']),
  entry('BBA', ['Bachelor of Business Administration']),
  entry('PhD', ['Ph.D.', 'Ph.D', 'Doctorate', 'Doctor of Philosophy']),
  entry('Diploma', ['Polytechnic Diploma']),
  // Bare "MS"/"BS" are deliberately excluded as aliases here (unlike the longer degree names) -
  // "MS" collides too often with unrelated phrases like "MS SQL" or "MS Office" in tech JDs,
  // since each dictionary trie scans independently and can't see that "MS" is followed by "SQL"
  // in the skills sense. Under-extracting a bare "MS"/"BS" is safer than that false positive.
  entry('BSc', ['B.Sc.', 'Bachelor of Science']),
  entry('MSc', ['M.Sc.', 'Master of Science']),
  entry('BCom', ['B.Com', 'Bachelor of Commerce']),
  entry('Any Degree', ['Any Graduate', 'Any Bachelor Degree', 'Graduate Degree']),
];
