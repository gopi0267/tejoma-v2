import { describe, it, expect } from 'vitest';
import { CATEGORY_TO_DOMAIN, FRAMEWORK_OF, RELATED_TO_GROUPS, USES, domainFor } from '../../src/matching/skillIntelligence.js';
import { SKILL_DICTIONARY } from '../../src/jd-parser/dictionaries/skills.dictionary.js';

// Enterprise AI Matching Architecture, Phase 1 - Skill Intelligence Platform. These are pure
// data-integrity tests over the curated seed data itself (no DB) - they exist specifically to
// catch the class of mistake that matters most for a "do not fabricate taxonomy data" module: a
// typo'd skill name in a hand-curated relationship, a self-referencing edge, or a dictionary
// category with no domain mapping. seedSkillIntelligence()/canonicalizeSkill() themselves need a
// real database and are covered by the integration test pass instead (matching this repo's
// established convention that npm test stays hermetic).

const dictionaryCanonicals = new Set(SKILL_DICTIONARY.map((e) => e.canonical));

describe('CATEGORY_TO_DOMAIN - coverage', () => {
  it('has a domain mapping for every category actually used in the skills dictionary', () => {
    const categoriesInUse = new Set(SKILL_DICTIONARY.map((e) => e.category));
    for (const category of categoriesInUse) {
      expect(CATEGORY_TO_DOMAIN[category], `category "${category}" is used in the dictionary but has no domain mapping`).toBeDefined();
    }
  });

  it('domainFor returns null for an unknown category rather than throwing', () => {
    expect(domainFor('not_a_real_category')).toBeNull();
  });
});

describe('FRAMEWORK_OF - referential integrity', () => {
  it('every referenced skill name exists in the dictionary or in another FRAMEWORK_OF entry (chained relationships like Spring Boot -> Spring)', () => {
    const frameworkOfTargets = new Set(FRAMEWORK_OF.map(([child]) => child));
    for (const [child, parent] of FRAMEWORK_OF) {
      const parentIsKnown = dictionaryCanonicals.has(parent) || frameworkOfTargets.has(parent);
      expect(parentIsKnown, `FRAMEWORK_OF parent "${parent}" (for child "${child}") is neither in the dictionary nor another FRAMEWORK_OF child`).toBe(true);
      expect(dictionaryCanonicals.has(child), `FRAMEWORK_OF child "${child}" is not in the dictionary`).toBe(true);
    }
  });

  it('no entry references the same skill as both child and parent', () => {
    for (const [child, parent] of FRAMEWORK_OF) {
      expect(child).not.toBe(parent);
    }
  });

  it('has no duplicate (child, parent) pairs', () => {
    const seen = new Set<string>();
    for (const [child, parent] of FRAMEWORK_OF) {
      const key = `${child}:${parent}`;
      expect(seen.has(key), `duplicate FRAMEWORK_OF entry: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('RELATED_TO_GROUPS - referential integrity', () => {
  it('every skill named in every group exists in the dictionary', () => {
    for (const group of RELATED_TO_GROUPS) {
      for (const skill of group) {
        expect(dictionaryCanonicals.has(skill), `RELATED_TO group references "${skill}", which is not in the dictionary`).toBe(true);
      }
    }
  });

  it('every group has at least 2 members (a group of 1 is not a relationship)', () => {
    for (const group of RELATED_TO_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('no group contains a duplicate skill', () => {
    for (const group of RELATED_TO_GROUPS) {
      expect(new Set(group).size).toBe(group.length);
    }
  });
});

describe('USES - referential integrity', () => {
  it('every referenced skill exists in the dictionary', () => {
    for (const [user, used] of USES) {
      expect(dictionaryCanonicals.has(user), `USES user "${user}" is not in the dictionary`).toBe(true);
      expect(dictionaryCanonicals.has(used), `USES target "${used}" is not in the dictionary`).toBe(true);
    }
  });

  it('no entry references the same skill as both user and used', () => {
    for (const [user, used] of USES) {
      expect(user).not.toBe(used);
    }
  });
});
