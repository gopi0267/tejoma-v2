import type { DictionaryEntry } from '../matcher/trie.js';

function entry(canonical: string, extraAliases: string[] = []): DictionaryEntry {
  return { canonical, category: 'general', aliases: [canonical, ...extraAliases] };
}

// Spoken/human languages - kept as a separate dictionary/trie from programming languages so
// "English" or "Hindi" in a JD never collides with the tech-skills scan.
export const SPOKEN_LANGUAGES_DICTIONARY: DictionaryEntry[] = [
  entry('English'),
  entry('Hindi'),
  entry('Telugu'),
  entry('Tamil'),
  entry('Kannada'),
  entry('Malayalam'),
  entry('Marathi'),
  entry('Gujarati'),
  entry('Bengali'),
  entry('Punjabi'),
  entry('Urdu'),
  entry('Spanish'),
  entry('French'),
  entry('German'),
  entry('Mandarin', ['Chinese', 'Mandarin Chinese']),
  entry('Japanese'),
  entry('Korean'),
  entry('Arabic'),
  entry('Portuguese'),
  entry('Russian'),
  entry('Italian'),
];
