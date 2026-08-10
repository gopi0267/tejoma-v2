// Enterprise AI Matching Architecture, Phase 1 - Skill Intelligence Platform.
//
// Builds and seeds a real skill graph (skill_nodes / skill_edges - see
// migration-phase1-intelligence-layer.sql) from the JD parser's existing skills dictionary
// (src/jd-parser/dictionaries/skills.dictionary.ts, unmodified). Nothing here is read by
// src/matching/services.ts's live scoring yet - that wiring is Phase 2 work. This module only builds and
// populates the foundation, and exposes canonicalizeSkill() as the primitive future phases will
// call.
//
// Relationship types populated in Phase 1, and why each one is genuinely verifiable (per the
// explicit "do not fabricate taxonomy data" instruction):
//   - PARENT_OF: a small set of technology-domain nodes (e.g. "Web Development") PARENT_OF every
//     skill in the categories that domain covers - mechanically derived from the dictionary's own
//     category tags, not hand-guessed.
//   - FRAMEWORK_OF: hand-verified "this framework/library is built on this language" facts (e.g.
//     Django FRAMEWORK_OF Python) - a conservative, deliberately non-exhaustive list of
//     relationships that are simply true, not inferred.
//   - RELATED_TO: hand-curated "these are known alternatives in the same space" pairs (e.g.
//     React/Vue.js/Angular) - a structural fact about the market, not a claimed numeric
//     substitutability strength (the architecture document's own design explicitly defers learned
//     substitutability weights to a later phase, once real outcome data exists to learn from).
//   - USES: a handful of well-established tool-dependency facts (e.g. Kubernetes USES Docker).
//   - COMMONLY_WITH: NOT hand-curated at all - computed from this database's own real
//     candidates.skills_array / jobs.required_skills data (see computeCooccurrenceEdges below).
// RUNS_ON and DATABASE_FOR are supported by the schema (SkillRelationshipType can be widened
// later) but deliberately not populated - the current dictionary doesn't contain data precise
// enough to state either relationship as fact without guessing.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { SKILL_DICTIONARY } from '../jd-parser/dictionaries/skills.dictionary.js';
import type { SkillNode, SkillRelationshipType } from '../types.js';

// Broader groupings than the dictionary's 19 categories - each becomes one synthetic domain node,
// PARENT_OF every skill whose category maps here. Fewer, coarser domains read better as a
// hierarchy layer than one node per category would.
export const CATEGORY_TO_DOMAIN: Record<string, string> = {
  programming_language: 'Programming Languages',
  frontend_framework: 'Web Development',
  backend_framework: 'Web Development',
  database: 'Data & Storage',
  cloud: 'Cloud & Infrastructure',
  devops: 'Cloud & Infrastructure',
  ai_ml: 'AI & Data Science',
  data_engineering: 'AI & Data Science',
  testing: 'Quality Engineering',
  operating_system: 'Systems & Platforms',
  messaging: 'Systems & Platforms',
  tool: 'Developer Tooling',
  library: 'Developer Tooling',
  methodology: 'Process & Architecture',
  architecture: 'Process & Architecture',
  security: 'Security',
  design: 'Design',
  soft_skill: 'Professional Skills',
  general: 'Professional Skills',
};

// Hand-verified, conservative - every entry below is a well-known, uncontroversial technical
// fact (a framework/library genuinely built on the target language/framework), not a guess.
export const FRAMEWORK_OF: [string, string][] = [
  ['Django', 'Python'], ['Flask', 'Python'], ['FastAPI', 'Python'],
  ['Spring', 'Java'], ['Spring Boot', 'Spring'], ['Spring Cloud', 'Spring'], ['Hibernate', 'Java'],
  ['ASP.NET', 'C#'], ['ASP.NET Core', 'C#'], ['Entity Framework', 'C#'],
  ['Laravel', 'PHP'], ['Symfony', 'PHP'],
  ['React', 'JavaScript'], ['Angular', 'TypeScript'], ['Vue.js', 'JavaScript'],
  ['Next.js', 'React'], ['Nuxt.js', 'Vue.js'], ['Gatsby', 'React'], ['React Native', 'React'],
  ['Ember.js', 'JavaScript'], ['Backbone.js', 'JavaScript'],
  ['Express.js', 'Node.js'], ['NestJS', 'Node.js'], ['Fastify', 'Node.js'],
];

// Known alternatives in the same space - a structural market fact, not a claimed
// interchangeability percentage. Bidirectional (each pair gets both directions).
export const RELATED_TO_GROUPS: string[][] = [
  ['React', 'Vue.js', 'Angular'],
  ['MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', 'MariaDB'],
  ['MongoDB', 'Cassandra', 'DynamoDB'],
  ['Jenkins', 'GitLab CI', 'GitHub Actions', 'CircleCI', 'Travis CI'],
  ['TensorFlow', 'PyTorch', 'Keras'],
  ['Terraform', 'CloudFormation'],
  ['Ansible', 'Chef', 'Puppet'],
  ['AWS', 'Azure', 'Google Cloud'],
  ['Selenium', 'Cypress', 'Playwright'],
  ['RabbitMQ', 'Apache Kafka', 'ActiveMQ'],
];

// A small number of well-established tool-dependency facts.
export const USES: [string, string][] = [
  ['Kubernetes', 'Docker'],
  ['Docker Compose', 'Docker'],
  ['Helm', 'Kubernetes'],
  ['GitHub Actions', 'GitHub'],
  ['GitLab CI', 'GitLab'],
];

export function domainFor(category: string): string | null {
  return CATEGORY_TO_DOMAIN[category] ?? null;
}

// ==================== SEEDING ====================

// Idempotent - safe to run multiple times (every DB write below is an upsert). Seeds skill_nodes
// from the dictionary, then the three curated edge sets, then domain hierarchy. Does NOT compute
// co-occurrence (see computeCooccurrenceEdges, run separately since it depends on live candidate/
// job data that changes over time, not a one-time bootstrap step).
export async function seedSkillIntelligence(): Promise<{ nodesSeeded: number; edgesSeeded: number }> {
  let nodesSeeded = 0;
  let edgesSeeded = 0;

  // 1. One node per dictionary entry.
  const canonicalToId = new Map<string, number>();
  for (const dictEntry of SKILL_DICTIONARY) {
    const node = await db.upsertSkillNode({
      canonical_name: dictEntry.canonical,
      category: dictEntry.category,
      technology_domain: domainFor(dictEntry.category),
      aliases: dictEntry.aliases,
      source: 'dictionary',
    });
    if (node) {
      canonicalToId.set(dictEntry.canonical, node.id);
      nodesSeeded++;
    } else {
      logger.warn({ canonical: dictEntry.canonical }, 'Failed to upsert skill node during seeding');
    }
  }

  // 2. Domain hierarchy nodes (one per unique domain value, category 'domain') + PARENT_OF edges.
  const domains = Array.from(new Set(Object.values(CATEGORY_TO_DOMAIN)));
  const domainToId = new Map<string, number>();
  for (const domainName of domains) {
    const node = await db.upsertSkillNode({
      canonical_name: domainName,
      category: 'domain',
      technology_domain: null,
      aliases: [domainName],
      source: 'derived',
    });
    if (node) {
      domainToId.set(domainName, node.id);
      nodesSeeded++;
    }
  }
  for (const dictEntry of SKILL_DICTIONARY) {
    const domainName = domainFor(dictEntry.category);
    const skillId = canonicalToId.get(dictEntry.canonical);
    const parentDomainId = domainName ? domainToId.get(domainName) : undefined;
    if (skillId && parentDomainId) {
      const edge = await db.upsertSkillEdge(parentDomainId, skillId, 'PARENT_OF', 1.0, 'curated');
      if (edge) edgesSeeded++;
    }
  }

  // 3. FRAMEWORK_OF.
  for (const [child, parent] of FRAMEWORK_OF) {
    const childId = canonicalToId.get(child);
    const parentId = canonicalToId.get(parent);
    if (childId && parentId) {
      const edge = await db.upsertSkillEdge(childId, parentId, 'FRAMEWORK_OF', 1.0, 'curated');
      if (edge) edgesSeeded++;
    } else {
      logger.warn({ child, parent }, 'FRAMEWORK_OF seed pair references a skill not in the dictionary - skipped');
    }
  }

  // 4. RELATED_TO (bidirectional within each group).
  for (const group of RELATED_TO_GROUPS) {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const fromId = canonicalToId.get(group[i]);
        const toId = canonicalToId.get(group[j]);
        if (fromId && toId) {
          const edge = await db.upsertSkillEdge(fromId, toId, 'RELATED_TO', 1.0, 'curated');
          if (edge) edgesSeeded++;
        }
      }
    }
  }

  // 5. USES.
  for (const [user, used] of USES) {
    const userId = canonicalToId.get(user);
    const usedId = canonicalToId.get(used);
    if (userId && usedId) {
      const edge = await db.upsertSkillEdge(userId, usedId, 'USES', 1.0, 'curated');
      if (edge) edgesSeeded++;
    }
  }

  logger.info({ nodesSeeded, edgesSeeded }, 'Skill Intelligence Platform seeded');
  return { nodesSeeded, edgesSeeded };
}

// ==================== CO-OCCURRENCE (real, data-driven - not curated) ====================

// Jaccard co-occurrence over this database's actual candidates.skills_array and
// jobs.required_skills: weight(A,B) = |documents containing both A and B| / |documents containing
// A or B|. Only canonicalizable skills are considered (raw strings that don't resolve to a known
// node are ignored for this computation - they're not part of the graph). Deliberately separate
// from seedSkillIntelligence() since this reflects live platform data that changes over time, not
// a one-time bootstrap fact; safe to re-run periodically as more candidates/jobs are added.
export async function computeCooccurrenceEdges(minCooccurrence: number = 2): Promise<{ edgesComputed: number; nodesWithPopularity: number }> {
  const [candidateSkillSets, jobSkillSets] = await Promise.all([
    db.getAllCandidateSkillArrays(),
    db.getAllJobRequiredSkills(),
  ]);
  const documents: string[][] = [...candidateSkillSets, ...jobSkillSets].filter((doc) => doc && doc.length > 0);

  const allNodes = await db.getAllSkillNodes();
  const aliasToNode = new Map<string, SkillNode>();
  for (const node of allNodes) {
    aliasToNode.set(node.canonical_name.toLowerCase(), node);
    for (const alias of node.aliases) aliasToNode.set(alias.toLowerCase(), node);
  }

  // Canonicalize every document's skill list, deduping to one occurrence per canonical skill per
  // document (a skill listed twice in one resume shouldn't inflate its own co-occurrence).
  const canonicalDocs: Set<number>[] = documents.map((doc) => {
    const ids = new Set<number>();
    for (const raw of doc) {
      const node = aliasToNode.get(String(raw).trim().toLowerCase());
      if (node) ids.add(node.id);
    }
    return ids;
  });

  const occurrenceCount = new Map<number, number>();
  const pairCount = new Map<string, number>();
  for (const doc of canonicalDocs) {
    const ids = Array.from(doc);
    for (const id of ids) occurrenceCount.set(id, (occurrenceCount.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}:${ids[j]}` : `${ids[j]}:${ids[i]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  let edgesComputed = 0;
  for (const [key, count] of pairCount.entries()) {
    if (count < minCooccurrence) continue;
    const [aId, bId] = key.split(':').map(Number);
    const union = (occurrenceCount.get(aId) ?? 0) + (occurrenceCount.get(bId) ?? 0) - count;
    const weight = union > 0 ? Number((count / union).toFixed(4)) : 0;
    const edgeAB = await db.upsertSkillEdge(aId, bId, 'COMMONLY_WITH', weight, 'computed_cooccurrence');
    const edgeBA = await db.upsertSkillEdge(bId, aId, 'COMMONLY_WITH', weight, 'computed_cooccurrence');
    if (edgeAB) edgesComputed++;
    if (edgeBA) edgesComputed++;
  }

  let nodesWithPopularity = 0;
  for (const [id, count] of occurrenceCount.entries()) {
    await db.updateSkillNodePopularity(id, count);
    nodesWithPopularity++;
  }

  logger.info({ edgesComputed, nodesWithPopularity, documentsScanned: documents.length }, 'Skill co-occurrence computed from live platform data');
  return { edgesComputed, nodesWithPopularity };
}

// ==================== CANONICALIZATION (the primitive future phases will call) ====================

export async function canonicalizeSkill(rawSkillText: string): Promise<SkillNode | null> {
  if (!rawSkillText || !rawSkillText.trim()) return null;
  return db.findSkillNodeByAlias(rawSkillText);
}

export async function canonicalizeSkills(rawSkillTexts: string[]): Promise<(SkillNode | null)[]> {
  return Promise.all(rawSkillTexts.map(canonicalizeSkill));
}

export async function getRelatedSkills(skillId: number, relationshipType?: SkillRelationshipType) {
  return db.getSkillEdgesFrom(skillId, relationshipType);
}
