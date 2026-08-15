/**
 * Clause segmentation, modality and negation scope.
 *
 * This is the layer that makes the difference between a keyword extractor and an understanding
 * engine. "Kubernetes" is the same token in all four of these and means four different things:
 *
 *   must have Kubernetes                                  -> MANDATORY
 *   Kubernetes is a plus                                  -> OPTIONAL
 *   Kubernetes is not required                            -> EXCLUDED
 *   candidates without Kubernetes will not be considered  -> MANDATORY  (double negative)
 *
 * Strength therefore comes from the clause a mention sits in, never from the mention itself. The
 * unit of analysis is the clause rather than the sentence because a single sentence routinely
 * carries two different modalities: "Python is required, Go is a plus" must not resolve to one
 * level for both.
 */

import type { Confidence, RequirementLevel } from './contract.js';

export interface Clause {
  text: string;
  /** Offset of this clause within the field text it came from. */
  start: number;
  end: number;
  field: string;
}

/**
 * Split into sentences, then into clauses on coordinating punctuation and conjunctions that in JD
 * prose reliably separate independent requirement statements. Offsets are preserved throughout so
 * every downstream claim can cite an exact span.
 */
export function segment(text: string, field: string): Clause[] {
  if (!text) return [];
  const out: Clause[] = [];
  // A '.' only ends a sentence when whitespace or end-of-input follows it.
  //
  // Splitting on every '.' cut "Vue.js is strongly preferred." into "Vue." and
  // "js is strongly preferred." - which did two kinds of damage at once: Vue.js lost the clause
  // carrying its modality and fell back to INFORMATIONAL, and the orphaned "js" matched the
  // JavaScript alias and FABRICATED a strongly-preferred JavaScript requirement the JD never
  // stated. Dotted technology names are everywhere in real JDs (Node.js, React.js, ASP.NET, .NET,
  // D3.js), so this was mis-reading a large slice of the corpus, not an edge case. The same rule
  // keeps decimals ("3.5 years") intact for free.
  const boundaryRe = /(?:[.!?;]+(?=\s|$))|\n+/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = boundaryRe.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const sentence = text.slice(cursor, end);
    if (sentence.trim()) for (const c of splitClauses(sentence, cursor, field)) out.push(c);
    cursor = end;
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail.trim()) for (const c of splitClauses(tail, cursor, field)) out.push(c);
  }
  return out.filter((c) => c.text.trim().length > 0);
}

/**
 * Clause split points. Only separators that change the SUBJECT of a requirement are used: a comma
 * inside "Python, Go and Rust are required" is a list, not a clause boundary, so splitting on every
 * comma would shatter one requirement into three fragments that each lose the modality carried by
 * the tail of the sentence. Splitting on ", and " / " but " / " while " / " whereas " keeps lists
 * intact while still separating genuinely independent statements.
 */
function splitClauses(sentence: string, offset: number, field: string): Clause[] {
  const boundary = /(?:,\s+(?:and\s+|but\s+|while\s+|whereas\s+|although\s+))|(?:\s+but\s+)|(?:\s+while\s+)|(?:\s+whereas\s+)|(?:\s+although\s+)/gi;
  const parts: Clause[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(sentence)) !== null) {
    parts.push({ text: sentence.slice(last, m.index), start: offset + last, end: offset + m.index, field });
    last = m.index + m[0].length;
  }
  parts.push({ text: sentence.slice(last), start: offset + last, end: offset + sentence.length, field });
  return parts;
}

// ==================== MODALITY ====================

/**
 * Cue phrases ordered by strength. Longest/most specific first so "strongly preferred" is not
 * consumed by "preferred", and "not required" is not consumed by "required" - that ordering is the
 * whole correctness of this table, and a test asserts each pair resolves the way it reads.
 */
interface Cue { re: RegExp; level: RequirementLevel; rule: string }

const CUES: Cue[] = [
  // Exclusions first: every one of these contains a positive cue as a substring.
  { re: /\bnot\s+(?:strictly\s+|necessarily\s+)?(?:required|necessary|mandatory|essential|expected)\b/i, level: 'EXCLUDED', rule: 'cue.not_required' },
  { re: /\bno\s+(?:prior\s+|previous\s+)?experience\s+(?:with|in|of)\b[^.;]*\bis\s+(?:required|necessary|needed)\b/i, level: 'EXCLUDED', rule: 'cue.no_experience_required' },
  { re: /\bdo(?:es)?\s+not\s+(?:need|require)\b/i, level: 'EXCLUDED', rule: 'cue.does_not_require' },

  // Double negatives: "without X will not be considered" is the strongest possible requirement.
  { re: /\bwithout\b[^.;]*\b(?:will\s+not\s+be\s+considered|need\s+not\s+apply|are\s+not\s+eligible)\b/i, level: 'MANDATORY', rule: 'cue.without_not_considered' },
  { re: /\b(?:only|exclusively)\s+candidates?\s+with\b/i, level: 'MANDATORY', rule: 'cue.only_candidates_with' },

  { re: /\bmust\s+(?:have|possess|demonstrate|be\s+able)\b/i, level: 'MANDATORY', rule: 'cue.must_have' },
  // ADVERB SLOT: JD prose routinely puts one adverb between the copula and the qualifier -
  // "is also a plus", "is definitely required", "would be desirable". Without the optional
  // \w+ slot, "Python is also a plus" matched no cue at all and fell back to INFORMATIONAL,
  // silently losing a stated optional requirement.
  { re: /\b(?:is|are|would\s+be)\s+(?:\w+\s+)?(?:strictly\s+)?(?:required|mandatory|essential|a\s+must)\b/i, level: 'MANDATORY', rule: 'cue.is_required' },
  { re: /\b(?:required|mandatory|essential)\s+(?:experience|skills?|qualifications?)\b/i, level: 'MANDATORY', rule: 'cue.required_noun' },
  { re: /\bwe\s+require\b|\brequires?\b(?!\s+no\b)/i, level: 'MANDATORY', rule: 'cue.requires' },
  { re: /\bminimum\s+(?:of\s+)?\d/i, level: 'MANDATORY', rule: 'cue.minimum_of' },
  { re: /\bproven\s+(?:track\s+record|experience|ability)\b/i, level: 'MANDATORY', rule: 'cue.proven' },

  { re: /\b(?:strongly|highly)\s+(?:preferred|desirable|desired)\b/i, level: 'STRONGLY_PREFERRED', rule: 'cue.strongly_preferred' },
  { re: /\b(?:is|are|would\s+be)\s+(?:\w+\s+)?(?:preferred|desirable|desired|an\s+advantage)\b/i, level: 'PREFERRED', rule: 'cue.is_preferred' },
  { re: /\bpreferab(?:ly|le)\b|\bideally\b|\bwe\s+(?:would\s+)?prefer\b/i, level: 'PREFERRED', rule: 'cue.preferably' },

  { re: /\b(?:is|are|would\s+be)\s+(?:\w+\s+)?a\s+(?:plus|bonus)\b|\bnice\s+to\s+have\b|\bgood\s+to\s+have\b|\bbonus\s+points?\b/i, level: 'OPTIONAL', rule: 'cue.nice_to_have' },
  { re: /\boptional(?:ly)?\b|\bnot\s+essential\b/i, level: 'OPTIONAL', rule: 'cue.optional' },
  { re: /\bfamiliarity\s+with\b|\bexposure\s+to\b|\bawareness\s+of\b/i, level: 'PREFERRED', rule: 'cue.familiarity' },

  // Work description rather than a bar to clear: "you will build services using Go".
  { re: /\b(?:you\s+will|responsibilities\s+include|the\s+role\s+involves|day\s+to\s+day)\b/i, level: 'CONTEXTUAL', rule: 'cue.role_context' },
  { re: /\b(?:build|design|develop|deploy|maintain|own|lead)\b[^.;]*\busing\b/i, level: 'CONTEXTUAL', rule: 'cue.doing_using' },
];

export interface Modality {
  level: RequirementLevel;
  rule: string;
  confidence: Confidence;
  /** The literal cue text that decided it - cited in provenance. */
  cueText: string | null;
}

/**
 * Resolve the requirement strength of a clause.
 *
 * Returns INFORMATIONAL when no cue matches. That is deliberate and load-bearing: a mention with no
 * detectable requirement force must NOT default to "required", because defaulting is precisely how
 * a keyword matcher fabricates requirements the employer never stated.
 */
export function modality(clause: string): Modality {
  for (const cue of CUES) {
    const m = cue.re.exec(clause);
    if (m) {
      return {
        level: cue.level,
        rule: cue.rule,
        cueText: m[0],
        // An exclusion or an explicit must/plus is a direct reading of the text. Contextual cues
        // are an interpretation of what the sentence is doing, so they claim less.
        confidence: cue.level === 'CONTEXTUAL' ? 'MEDIUM' : 'EXPLICIT',
      };
    }
  }
  return { level: 'INFORMATIONAL', rule: 'cue.none', cueText: null, confidence: 'LOW' };
}

// ==================== NEGATION SCOPE ====================

const NEGATORS = /\b(?:not|no|never|without|excluding|except)\b/gi;
/** Terminators that end a negation's reach: a contrast marker restores positive polarity. */
const SCOPE_END = /\b(?:but|however|although|though|whereas|;)\b/i;

/**
 * Is the mention at [start,end) inside the scope of a negator?
 *
 * Scope runs from the negator to the end of the clause or the first contrast marker, whichever
 * comes first. A mention BEFORE the negator is not negated - "Python is required, Kubernetes is
 * not" must keep Python mandatory, and a naive "clause contains 'not'" test gets that backwards.
 */
export function isNegated(clause: string, start: number, end: number): boolean {
  NEGATORS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NEGATORS.exec(clause)) !== null) {
    const negAt = m.index;
    if (negAt >= start) continue;            // negator appears after the mention: no reach
    const rest = clause.slice(negAt);
    const term = SCOPE_END.exec(rest);
    const scopeEnd = negAt + (term ? term.index : rest.length);
    if (end <= scopeEnd) return true;
  }
  return false;
}

/**
 * "Candidates WITHOUT production Kubernetes experience WILL NOT BE CONSIDERED" contains two
 * negations that cancel into a hard requirement. Detected as a whole-clause pattern rather than by
 * counting negators, because the cancellation depends on the two halves being this specific
 * construction and not merely on the parity of negatives in the sentence.
 */
export function isDoubleNegativeRequirement(clause: string): boolean {
  return /\bwithout\b[^.;]*\b(?:will\s+not\s+be\s+considered|need\s+not\s+apply|are\s+not\s+eligible|cannot\s+be\s+considered)\b/i.test(clause);
}
