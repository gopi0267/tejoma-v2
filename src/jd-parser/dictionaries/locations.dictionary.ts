import type { DictionaryEntry } from '../matcher/trie.js';

// Reuses the DictionaryEntry shape purely for its {canonical, aliases} matching structure - the
// `category` field is not used for location normalization (routing by category doesn't apply
// here), so it's set to 'general' as a placeholder.
function entry(canonical: string, extraAliases: string[] = []): DictionaryEntry {
  return { canonical, category: 'general', aliases: [canonical, ...extraAliases] };
}

// City-name normalization: common alternate spellings/older names -> one canonical form, so
// "Bangalore" and "Bengaluru" (or "Gurgaon"/"Gurugram") aren't reported as two different cities.
export const LOCATIONS_DICTIONARY: DictionaryEntry[] = [
  entry('Bangalore', ['Bengaluru']),
  entry('Hyderabad'),
  entry('Chennai'),
  entry('Mumbai', ['Bombay']),
  entry('Pune'),
  entry('Delhi', ['New Delhi']),
  entry('Gurugram', ['Gurgaon']),
  entry('Noida'),
  entry('Kolkata', ['Calcutta']),
  entry('Ahmedabad'),
  entry('Kochi', ['Cochin']),
  entry('Coimbatore'),
  entry('Indore'),
  entry('Jaipur'),
  entry('Chandigarh'),
  entry('Nagpur'),
  entry('Vadodara', ['Baroda']),
  entry('Thiruvananthapuram', ['Trivandrum']),
  entry('New York', ['NYC', 'New York City']),
  entry('San Francisco', ['SF', 'Bay Area']),
  entry('London'),
  entry('Singapore'),
  entry('Dubai'),
  entry('Toronto'),
  entry('Sydney'),
  entry('Berlin'),
  entry('Austin'),
  entry('Chicago'),
];
