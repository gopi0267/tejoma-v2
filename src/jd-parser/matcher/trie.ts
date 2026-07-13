import type { SkillCategory } from '../types.js';

export interface DictionaryEntry {
  canonical: string;
  category: SkillCategory;
  // All surface forms that should resolve to this canonical entry, including the canonical
  // spelling itself (e.g. canonical "Node.js" with aliases ["Node.js", "NodeJS", "Node JS"]).
  aliases: string[];
}

export interface TrieMatch {
  matchedText: string; // verbatim substring from the source text, kept for auditing
  start: number;
  end: number; // exclusive
  entry: DictionaryEntry;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  entryIndex: number;
}

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[a-zA-Z0-9]/.test(ch);
}

// Multi-pattern dictionary matcher (a plain trie walk, not a true failure-link Aho-Corasick
// automaton - at JD-text scale (a few KB) a straightforward per-position walk is already well
// under a millisecond, so the added complexity of failure links isn't worth it here). Performs
// greedy longest-match-with-boundary-fallback at each text position: e.g. if "Spring Boot" is a
// pattern but is followed by a non-boundary character ("Spring Bootcamp"), it falls back to the
// shorter "Spring" match instead of silently matching neither.
export class MultiPatternTrie {
  private root: TrieNode = { children: new Map(), isEnd: false, entryIndex: -1 };
  private entries: DictionaryEntry[];

  constructor(entries: DictionaryEntry[]) {
    this.entries = entries;
    entries.forEach((entry, idx) => {
      for (const alias of entry.aliases) {
        this.insert(alias.toLowerCase(), idx);
      }
    });
  }

  private insert(pattern: string, entryIndex: number): void {
    let node = this.root;
    for (const ch of pattern) {
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), isEnd: false, entryIndex: -1 };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.isEnd = true;
    node.entryIndex = entryIndex;
  }

  findAll(text: string): TrieMatch[] {
    const lower = text.toLowerCase();
    const n = lower.length;
    const matches: TrieMatch[] = [];

    let i = 0;
    while (i < n) {
      let node = this.root;
      const candidates: { end: number; entryIndex: number }[] = [];

      for (let j = i; j < n; j++) {
        const next = node.children.get(lower[j]);
        if (!next) break;
        node = next;
        if (node.isEnd) candidates.push({ end: j + 1, entryIndex: node.entryIndex });
      }

      const beforeOk = !isWordChar(lower[i - 1]);
      let matchedAt = -1;

      for (let k = candidates.length - 1; k >= 0; k--) {
        const { end, entryIndex } = candidates[k];
        if (beforeOk && !isWordChar(lower[end])) {
          matches.push({ matchedText: text.slice(i, end), start: i, end, entry: this.entries[entryIndex] });
          matchedAt = end;
          break;
        }
      }

      i = matchedAt > i ? matchedAt : i + 1;
    }

    return matches;
  }
}
