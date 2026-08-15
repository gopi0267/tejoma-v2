/**
 * The curated Tejoma ontology - the semantic content Phase 5 actually adds.
 *
 * The five existing skill_edges tables contain 484 co-occurrence edges and one smoketest edge, so
 * there is currently no assertion anywhere in Tejoma that FastAPI is a backend framework or that
 * Kubernetes is used for container orchestration. That is what this file supplies.
 *
 * TWO LAYERS, DELIBERATELY SEPARATE
 *   1. CLASS EDGES, derived mechanically from the dictionary's `category`. Every technology in a
 *      category gets the same IS_A / USED_FOR edges. This is a transformation of an existing
 *      curated fact, not new knowledge, and it is marked derivation=DERIVED.
 *   2. CURATED FACTS, written out one at a time below. These are the specific claims a category
 *      cannot express - Django REQUIRES Python, Flask ALTERNATIVE_TO FastAPI - and each is a human
 *      judgement, marked derivation=ONTOLOGY with confidence=VALIDATED.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 * No edge was created from embedding similarity, from the 484 co-occurrence edges, or from a model.
 * "Python and Docker appear together in 27% of postings" is a correlation; turning it into
 * RELATED_TO would put an unfalsifiable claim into the layer every later phase must trust.
 */

import type { NodeType, RelationshipType } from './contract.js';

/** A capability, class or domain node that curated facts refer to. */
export interface OntologyNodeSeed {
  name: string;
  type: NodeType;
  aliases?: string[];
}

/**
 * Capability and class vocabulary. Kept small and concrete: every entry is either referenced by a
 * curated fact below or produced by the category mapping, so there are no orphan concepts.
 */
export const ONTOLOGY_NODES: OntologyNodeSeed[] = [
  // ---- technology classes (IS_A targets)
  { name: 'programming language', type: 'TECHNOLOGY_CLASS' },
  { name: 'backend framework', type: 'TECHNOLOGY_CLASS', aliases: ['server-side framework'] },
  { name: 'frontend framework', type: 'TECHNOLOGY_CLASS', aliases: ['UI framework'] },
  { name: 'data store', type: 'TECHNOLOGY_CLASS', aliases: ['database system'] },
  { name: 'cloud platform', type: 'TECHNOLOGY_CLASS' },
  { name: 'devops tooling', type: 'TECHNOLOGY_CLASS' },
  { name: 'testing tool', type: 'TECHNOLOGY_CLASS' },
  { name: 'messaging system', type: 'TECHNOLOGY_CLASS' },
  { name: 'machine learning tooling', type: 'TECHNOLOGY_CLASS' },
  { name: 'data tooling', type: 'TECHNOLOGY_CLASS' },
  { name: 'security tooling', type: 'TECHNOLOGY_CLASS' },
  { name: 'operating system', type: 'TECHNOLOGY_CLASS' },
  { name: 'engineering tool', type: 'TECHNOLOGY_CLASS' },
  { name: 'working practice', type: 'TECHNOLOGY_CLASS', aliases: ['methodology'] },
  { name: 'architectural approach', type: 'TECHNOLOGY_CLASS' },
  { name: 'python web framework', type: 'TECHNOLOGY_CLASS' },
  { name: 'javascript runtime', type: 'TECHNOLOGY_CLASS' },
  { name: 'relational database', type: 'TECHNOLOGY_CLASS' },
  { name: 'document database', type: 'TECHNOLOGY_CLASS' },
  { name: 'container orchestration technology', type: 'TECHNOLOGY_CLASS' },

  // ---- capabilities
  { name: 'software development', type: 'CAPABILITY' },
  { name: 'API development', type: 'CAPABILITY', aliases: ['REST API development'] },
  { name: 'user interface development', type: 'CAPABILITY' },
  { name: 'data persistence', type: 'CAPABILITY' },
  { name: 'infrastructure provisioning', type: 'CAPABILITY' },
  { name: 'deployment automation', type: 'CAPABILITY' },
  { name: 'container orchestration', type: 'CAPABILITY' },
  { name: 'containerized deployment', type: 'CAPABILITY' },
  { name: 'cloud-native deployment', type: 'CAPABILITY' },
  { name: 'quality assurance', type: 'CAPABILITY' },
  { name: 'asynchronous communication', type: 'CAPABILITY' },
  { name: 'model development', type: 'CAPABILITY' },
  { name: 'data processing', type: 'CAPABILITY' },
  { name: 'security engineering', type: 'CAPABILITY' },
  { name: 'schema design', type: 'CAPABILITY' },
  { name: 'query optimization', type: 'CAPABILITY' },
  { name: 'transactional data systems', type: 'CAPABILITY' },
  { name: 'scalability engineering', type: 'CAPABILITY' },
  { name: 'production engineering', type: 'CAPABILITY' },
  { name: 'distributed systems', type: 'CAPABILITY' },
  { name: 'machine learning', type: 'CAPABILITY' },
  { name: 'deep learning', type: 'CAPABILITY' },
  { name: 'data engineering', type: 'CAPABILITY' },
  { name: 'test automation', type: 'CAPABILITY' },

  // ---- role families (must match Phase 3/4 vocabulary exactly)
  { name: 'Backend Engineering', type: 'ROLE_FAMILY' },
  { name: 'Frontend Engineering', type: 'ROLE_FAMILY' },
  { name: 'Full Stack Engineering', type: 'ROLE_FAMILY' },
  { name: 'Platform Engineering', type: 'ROLE_FAMILY', aliases: ['DevOps Engineering'] },
  { name: 'Data Engineering', type: 'ROLE_FAMILY' },
  { name: 'Machine Learning', type: 'ROLE_FAMILY' },
  { name: 'Quality Engineering', type: 'ROLE_FAMILY' },
  { name: 'Security', type: 'ROLE_FAMILY' },
  { name: 'Mobile Engineering', type: 'ROLE_FAMILY' },
  { name: 'Support Engineering', type: 'ROLE_FAMILY' },

  // ---- domains (must match Phase 4 vocabulary exactly)
  { name: 'FinTech', type: 'DOMAIN' }, { name: 'Healthcare', type: 'DOMAIN' },
  { name: 'Recruitment', type: 'DOMAIN' }, { name: 'E-commerce', type: 'DOMAIN' },
  { name: 'Telecommunications', type: 'DOMAIN' }, { name: 'Cybersecurity', type: 'DOMAIN' },
  { name: 'Hospitality', type: 'DOMAIN' }, { name: 'Insurance', type: 'DOMAIN' },
  { name: 'Logistics', type: 'DOMAIN' },

  // ---- evidence types (shared vocabulary with Phases 3 and 4; the Phase 6 hook)
  { name: 'SKILL_CLAIM', type: 'EVIDENCE_TYPE' },
  { name: 'WORK_EXPERIENCE', type: 'EVIDENCE_TYPE' },
  { name: 'PRODUCTION_EXPERIENCE', type: 'EVIDENCE_TYPE' },
  { name: 'PROJECT_EVIDENCE', type: 'EVIDENCE_TYPE' },
  { name: 'LEADERSHIP_EVIDENCE', type: 'EVIDENCE_TYPE' },
  { name: 'CREDENTIAL', type: 'EVIDENCE_TYPE' },
];

/**
 * Dictionary category -> class edges. Applied to every technology in that category.
 * `IS_A` names the class; `USED_FOR` names what the class is a means of achieving.
 */
export const CATEGORY_CLASS_EDGES: Record<string, { is_a?: string; used_for?: string[] }> = {
  programming_language: { is_a: 'programming language', used_for: ['software development'] },
  backend_framework: { is_a: 'backend framework', used_for: ['API development'] },
  frontend_framework: { is_a: 'frontend framework', used_for: ['user interface development'] },
  database: { is_a: 'data store', used_for: ['data persistence'] },
  cloud: { is_a: 'cloud platform', used_for: ['infrastructure provisioning'] },
  devops: { is_a: 'devops tooling', used_for: ['deployment automation'] },
  testing: { is_a: 'testing tool', used_for: ['quality assurance'] },
  messaging: { is_a: 'messaging system', used_for: ['asynchronous communication'] },
  ai_ml: { is_a: 'machine learning tooling', used_for: ['model development'] },
  data_engineering: { is_a: 'data tooling', used_for: ['data processing'] },
  security: { is_a: 'security tooling', used_for: ['security engineering'] },
  operating_system: { is_a: 'operating system' },
  tool: { is_a: 'engineering tool' },
  methodology: { is_a: 'working practice' },
  architecture: { is_a: 'architectural approach' },
  // Deliberately unmapped: `library`, `design`, `soft_skill`, `general`, `language`, `domain`.
  // A library's parent class varies by ecosystem and a soft skill is not a technology; asserting a
  // class for them would be inventing the very relationships this phase must not invent.
};

export interface CuratedFact {
  from: string;
  type: RelationshipType;
  to: string;
  /**
   * Explicit endpoint types, for names that denote more than one kind of thing. "machine learning"
   * is a CAPABILITY, a ROLE_FAMILY and a dictionary TECHNOLOGY; without pinning the types, the
   * capability-to-role-family fact resolved both endpoints to the capability and collapsed into a
   * self-loop. Where a name is unambiguous these stay omitted.
   */
  from_type?: NodeType;
  to_type?: NodeType;
  /** Why a human asserted this. Recorded so the fact is arguable rather than anonymous. */
  rationale: string;
}

/**
 * Curated semantic facts. Each is a specific claim that the category mapping cannot express.
 * Named endpoints must resolve to a dictionary technology or an ONTOLOGY_NODES entry; the builder
 * rejects the file if any endpoint is unknown, so a typo cannot silently create an orphan.
 */
export const CURATED_FACTS: CuratedFact[] = [
  // ---- the brief's worked example, asserted explicitly
  { from: 'FastAPI', type: 'IS_A', to: 'python web framework', rationale: 'FastAPI is a web framework written for and in Python' },
  { from: 'Django', type: 'IS_A', to: 'python web framework', rationale: 'Django is a Python web framework' },
  { from: 'Flask', type: 'IS_A', to: 'python web framework', rationale: 'Flask is a Python web framework' },
  { from: 'python web framework', type: 'PART_OF', to: 'Backend Engineering', rationale: 'server-side web frameworks are practised within backend engineering' },
  { from: 'FastAPI', type: 'USED_FOR', to: 'API development', rationale: 'FastAPI exists to build HTTP APIs' },
  { from: 'FastAPI', type: 'REQUIRES', to: 'Python', rationale: 'FastAPI cannot be used without Python' },
  { from: 'Django', type: 'REQUIRES', to: 'Python', rationale: 'Django cannot be used without Python' },
  { from: 'Flask', type: 'REQUIRES', to: 'Python', rationale: 'Flask cannot be used without Python' },
  { from: 'Flask', type: 'ALTERNATIVE_TO', to: 'FastAPI', rationale: 'either can serve the same Python API role' },
  { from: 'API development', type: 'PART_OF', to: 'Backend Engineering', rationale: 'building APIs is a component of backend engineering' },

  // ---- the brief's second worked example
  { from: 'Kubernetes', type: 'IS_A', to: 'container orchestration technology', rationale: 'Kubernetes is an orchestrator for containers' },
  { from: 'Kubernetes', type: 'USED_FOR', to: 'container orchestration', rationale: 'orchestration is what Kubernetes does' },
  { from: 'Kubernetes', type: 'ENABLES', to: 'cloud-native deployment', rationale: 'orchestration makes cloud-native deployment practical' },
  { from: 'Kubernetes', type: 'RELATED_TO', to: 'Docker', rationale: 'Kubernetes schedules OCI containers, the format Docker popularised' },
  { from: 'container orchestration', type: 'ENABLES', to: 'containerized deployment', rationale: 'orchestration is how containers reach production' },
  { from: 'container orchestration', type: 'PART_OF', to: 'Platform Engineering', rationale: 'orchestration is practised within platform engineering' },
  { from: 'Docker', type: 'USED_FOR', to: 'containerized deployment', rationale: 'Docker packages and runs containers' },

  // ---- runtime / language dependencies
  { from: 'Node.js', type: 'IS_A', to: 'javascript runtime', rationale: 'Node.js executes JavaScript outside a browser' },
  { from: 'Node.js', type: 'REQUIRES', to: 'JavaScript', rationale: 'a JavaScript runtime is meaningless without the language' },
  { from: 'Spring Boot', type: 'REQUIRES', to: 'Java', rationale: 'Spring Boot targets the JVM via Java' },
  { from: 'React Native', type: 'REQUIRES', to: 'JavaScript', rationale: 'React Native applications are written in JavaScript' },
  { from: 'TypeScript', type: 'RELATED_TO', to: 'JavaScript', rationale: 'TypeScript compiles to JavaScript; related, not identical' },

  // ---- databases
  { from: 'PostgreSQL', type: 'IS_A', to: 'relational database', rationale: 'PostgreSQL is an RDBMS' },
  { from: 'MySQL', type: 'IS_A', to: 'relational database', rationale: 'MySQL is an RDBMS' },
  { from: 'MongoDB', type: 'IS_A', to: 'document database', rationale: 'MongoDB stores documents rather than relations' },
  { from: 'PostgreSQL', type: 'ALTERNATIVE_TO', to: 'MySQL', rationale: 'either can serve the same relational role' },
  { from: 'PostgreSQL', type: 'USED_FOR', to: 'transactional data systems', rationale: 'PostgreSQL provides ACID transactions' },
  { from: 'PostgreSQL', type: 'REQUIRES', to: 'SQL', rationale: 'PostgreSQL is queried with SQL' },
  { from: 'MySQL', type: 'REQUIRES', to: 'SQL', rationale: 'MySQL is queried with SQL' },
  { from: 'relational database', type: 'USED_FOR', to: 'schema design', rationale: 'relational modelling is expressed as schema design' },
  { from: 'relational database', type: 'USED_FOR', to: 'query optimization', rationale: 'query planning is intrinsic to relational systems' },

  // ---- cloud
  { from: 'AWS', type: 'IS_A', to: 'cloud platform', rationale: 'AWS is a public cloud provider' },
  { from: 'Azure', type: 'IS_A', to: 'cloud platform', rationale: 'Azure is a public cloud provider' },
  { from: 'AWS', type: 'ALTERNATIVE_TO', to: 'Azure', rationale: 'either can host the same workload' },
  { from: 'Terraform', type: 'USED_FOR', to: 'infrastructure provisioning', rationale: 'Terraform declares and provisions infrastructure' },
  { from: 'infrastructure provisioning', type: 'PART_OF', to: 'Platform Engineering', rationale: 'provisioning is core platform work' },

  // ---- machine learning
  { from: 'PyTorch', type: 'IS_A', to: 'machine learning tooling', rationale: 'PyTorch is a deep learning framework' },
  { from: 'PyTorch', type: 'USED_FOR', to: 'deep learning', rationale: 'PyTorch exists to train neural networks' },
  { from: 'TensorFlow', type: 'USED_FOR', to: 'deep learning', rationale: 'TensorFlow exists to train neural networks' },
  { from: 'PyTorch', type: 'ALTERNATIVE_TO', to: 'TensorFlow', rationale: 'either can train the same model class' },
  { from: 'deep learning', type: 'IS_A', to: 'machine learning', from_type: 'CAPABILITY', to_type: 'CAPABILITY', rationale: 'deep learning is a subfield of machine learning' },
  { from: 'machine learning', type: 'PART_OF', to: 'Machine Learning', from_type: 'CAPABILITY', to_type: 'ROLE_FAMILY', rationale: 'the capability sits inside the role family of the same name' },

  // ---- testing
  { from: 'Selenium', type: 'USED_FOR', to: 'test automation', rationale: 'Selenium drives browsers for automated tests' },
  { from: 'test automation', type: 'PART_OF', to: 'Quality Engineering', rationale: 'automation is the core of modern QA' },
  { from: 'test automation', type: 'ENABLES', to: 'quality assurance', rationale: 'automation is how QA scales' },

  // ---- capability structure
  { from: 'distributed systems', type: 'PART_OF', to: 'Backend Engineering', rationale: 'distributed design is backend work' },
  { from: 'scalability engineering', type: 'PART_OF', to: 'Backend Engineering', rationale: 'scaling services is backend work' },
  { from: 'production engineering', type: 'PART_OF', to: 'Platform Engineering', rationale: 'running production is platform work' },
  { from: 'data processing', type: 'PART_OF', to: 'Data Engineering', to_type: 'ROLE_FAMILY', rationale: 'pipelines are the substance of data engineering' },
  { from: 'security engineering', type: 'PART_OF', to: 'Security', to_type: 'ROLE_FAMILY', rationale: 'the capability sits inside the role family' },
  { from: 'user interface development', type: 'PART_OF', to: 'Frontend Engineering', rationale: 'UI work is frontend engineering' },
  { from: 'Backend Engineering', type: 'PART_OF', to: 'Full Stack Engineering', rationale: 'full stack subsumes the backend half' },
  { from: 'Frontend Engineering', type: 'PART_OF', to: 'Full Stack Engineering', rationale: 'full stack subsumes the frontend half' },

  { from: 'data engineering', type: 'PART_OF', to: 'Data Engineering', from_type: 'CAPABILITY', to_type: 'ROLE_FAMILY', rationale: 'the capability sits inside the role family of the same name' },
  { from: 'data engineering', type: 'ENABLES', to: 'data processing', from_type: 'CAPABILITY', to_type: 'CAPABILITY', rationale: 'data engineering is how large-scale processing becomes possible' },

  // ---- remaining evidence hooks, so every EVIDENCE_TYPE is reachable from a capability
  { from: 'software development', type: 'DEMONSTRATED_BY', to: 'WORK_EXPERIENCE', rationale: 'employment is the ordinary proof of general development ability' },
  { from: 'software development', type: 'DEMONSTRATED_BY', to: 'SKILL_CLAIM', rationale: 'the weakest admissible proof, recorded so Phase 6 can rank it lowest' },
  { from: 'scalability engineering', type: 'DEMONSTRATED_BY', to: 'LEADERSHIP_EVIDENCE', rationale: 'scaling decisions are typically owned rather than merely executed' },

  // ---- domain applicability, asserted only where the practice is genuinely domain-shaped
  { from: 'security engineering', type: 'APPLIES_TO', to: 'Cybersecurity', rationale: 'security engineering is the practice of that domain' },
  { from: 'transactional data systems', type: 'APPLIES_TO', to: 'FinTech', rationale: 'financial systems are defined by transactional correctness' },

  // ---- evidence hooks for Phase 6. These say what WOULD demonstrate a capability; they compute
  //      nothing and score nothing.
  { from: 'container orchestration', type: 'DEMONSTRATED_BY', to: 'PRODUCTION_EXPERIENCE', rationale: 'orchestration is only meaningfully shown by running it in production' },
  { from: 'API development', type: 'DEMONSTRATED_BY', to: 'PROJECT_EVIDENCE', rationale: 'a built API is the natural proof' },
  { from: 'distributed systems', type: 'DEMONSTRATED_BY', to: 'PRODUCTION_EXPERIENCE', rationale: 'distributed behaviour only appears under real load' },
  { from: 'production engineering', type: 'DEMONSTRATED_BY', to: 'PRODUCTION_EXPERIENCE', rationale: 'by definition' },
  { from: 'machine learning', type: 'DEMONSTRATED_BY', to: 'PROJECT_EVIDENCE', rationale: 'a trained model is the natural proof' },
  { from: 'security engineering', type: 'DEMONSTRATED_BY', to: 'CREDENTIAL', rationale: 'the domain has meaningful industry certifications' },

  // ---- deliberate NON-facts are documented in golden-cases.ts as rejection expectations:
  //      Python !RELATED_TO machine learning (a language is not a subfield),
  //      React !ALTERNATIVE_TO React Native (different targets),
  //      Node !== Node.js as separate concepts (curated alias instead).
];

/**
 * Pairs that must NEVER be merged into one concept, regardless of string or embedding similarity.
 * Checked by the entity resolver as a hard guard: a false merge is the most damaging failure this
 * graph can suffer, because every later phase would inherit it silently.
 */
export const NON_MERGEABLE: readonly (readonly [string, string])[] = [
  ['Java', 'JavaScript'],
  ['C++', 'C#'],
  ['React', 'React Native'],
  ['Node.js', 'JavaScript'],
  ['PostgreSQL', 'MySQL'],
  ['Docker', 'Kubernetes'],
  ['FastAPI', 'Flask'],
  ['AWS', 'Azure'],
  ['machine learning', 'deep learning'],
  ['Data Engineering', 'Machine Learning'],
  ['Backend Engineering', 'Full Stack Engineering'],
  ['Platform Engineering', 'Backend Engineering'],
  ['TypeScript', 'JavaScript'],
  ['MySQL', 'MongoDB'],
  ['Selenium', 'Jenkins'],
];
