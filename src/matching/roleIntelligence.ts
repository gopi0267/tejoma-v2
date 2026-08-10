// Enterprise AI Matching Architecture, Phase 1 - Role Intelligence Platform.
//
// Seeds role_profiles (see migration-phase1-intelligence-layer.sql) with the 9 roles from the
// architecture document's example table, generates a role embedding for each from its aggregated
// skill/responsibility/title text (reusing the existing embedding service - no new ML
// infrastructure), and exposes matchRoleByTitle() as the primitive future phases will call to
// resolve an arbitrary JD title to the closest known role. Nothing here is read by
// src/matching/services.ts's live scoring yet (Phase 2 work).
//
// Extensibility: role_key is a stable slug and upsertRoleProfile() is a plain upsert - adding an
// 8th, 9th, or 30th role later is a data addition via ROLE_SEEDS (or any future admin-authored
// source), never a schema or code-structure change.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding } from '../algorithms/bert-embeddings.js';
import { cosineSimilarity } from '../utils/embeddings.js';
import type { RoleProfile } from '../types.js';

export interface RoleProfileSeed {
  role_key: string;
  display_name: string;
  mandatory_skills: string[];
  preferred_skills: string[];
  optional_skills: string[];
  common_tools: string[];
  typical_responsibilities: string[];
  preferred_certifications: string[];
  experience_band_min: number;
  experience_band_max: number;
  related_roles: string[];
  career_progression: string[];
}

// The 9 example role profiles from the architecture document's §2 table, expanded into the full
// schema. Skill names are drawn from the JD parser's skills dictionary where a matching canonical
// entry exists (e.g. 'Python', 'React', 'Kubernetes'); a handful of role-defining concepts the
// technical skills dictionary doesn't cover (e.g. "Prompt Engineering", SAP modules, product
// management practices) are listed as plain text - role_profiles has no foreign-key constraint to
// skill_nodes, so this is a valid, honest representation rather than a forced/fabricated mapping.
export const ROLE_SEEDS: RoleProfileSeed[] = [
  {
    role_key: 'genai_engineer',
    display_name: 'GenAI Engineer',
    mandatory_skills: ['Python', 'Large Language Models', 'Prompt Engineering'],
    preferred_skills: ['RAG Architecture', 'Vector Databases', 'FastAPI'],
    optional_skills: ['Docker', 'AWS', 'PyTorch'],
    common_tools: ['Git', 'Docker', 'Postman'],
    typical_responsibilities: [
      'Design and implement LLM-powered features',
      'Build retrieval-augmented generation pipelines',
      'Evaluate and refine prompt strategies',
      'Integrate vector databases for semantic search',
    ],
    preferred_certifications: [],
    experience_band_min: 1,
    experience_band_max: 5,
    related_roles: ['ML Engineer', 'Backend Engineer', 'Data Scientist'],
    career_progression: ['GenAI Engineer', 'Senior GenAI Engineer', 'AI Architect'],
  },
  {
    role_key: 'backend_engineer',
    display_name: 'Backend Engineer',
    mandatory_skills: ['REST API', 'SQL'],
    preferred_skills: ['Python', 'Node.js', 'Java', 'PostgreSQL', 'Redis'],
    optional_skills: ['Docker', 'Kubernetes', 'AWS', 'Microservices'],
    common_tools: ['Git', 'Docker', 'Postman'],
    typical_responsibilities: [
      'Design and build REST/GraphQL APIs',
      'Own database schema design and query performance',
      'Deploy and monitor backend services',
      'Collaborate with frontend teams on API contracts',
    ],
    preferred_certifications: [],
    experience_band_min: 0,
    experience_band_max: 8,
    related_roles: ['Full-Stack Engineer', 'DevOps Engineer', 'Data Engineer'],
    career_progression: ['Backend Engineer', 'Senior Backend Engineer', 'Staff Engineer', 'Engineering Manager'],
  },
  {
    role_key: 'frontend_engineer',
    display_name: 'Frontend Engineer',
    mandatory_skills: ['JavaScript', 'React', 'HTML5', 'CSS3'],
    preferred_skills: ['TypeScript', 'Next.js', 'Angular', 'Vue.js'],
    optional_skills: ['Tailwind CSS', 'Jest', 'Cypress'],
    common_tools: ['Git', 'Figma', 'Postman'],
    typical_responsibilities: [
      'Build responsive, accessible user interfaces',
      'Own component architecture and state management',
      'Optimize page performance and load times',
      'Collaborate with design and backend teams',
    ],
    preferred_certifications: [],
    experience_band_min: 0,
    experience_band_max: 8,
    related_roles: ['Full-Stack Engineer', 'UI Engineer', 'Mobile Engineer'],
    career_progression: ['Frontend Engineer', 'Senior Frontend Engineer', 'Staff Engineer', 'Engineering Manager'],
  },
  {
    role_key: 'data_engineer',
    display_name: 'Data Engineer',
    mandatory_skills: ['SQL', 'Python', 'Apache Spark'],
    preferred_skills: ['Apache Airflow', 'Data Warehousing', 'Snowflake', 'AWS'],
    optional_skills: ['Apache Kafka', 'ETL'],
    common_tools: ['Git', 'Apache Airflow'],
    typical_responsibilities: [
      'Design and maintain data pipelines',
      'Build and optimize data warehouse schemas',
      'Ensure data quality and reliability',
      'Support analytics and ML teams with clean data',
    ],
    preferred_certifications: [],
    experience_band_min: 1,
    experience_band_max: 8,
    related_roles: ['ML Engineer', 'Backend Engineer', 'Analytics Engineer'],
    career_progression: ['Data Engineer', 'Senior Data Engineer', 'Staff Data Engineer', 'Data Architect'],
  },
  {
    role_key: 'ml_engineer',
    display_name: 'ML Engineer',
    mandatory_skills: ['Python', 'Machine Learning', 'Scikit-learn'],
    preferred_skills: ['TensorFlow', 'PyTorch', 'Deep Learning'],
    optional_skills: ['Apache Spark', 'AWS', 'Docker'],
    common_tools: ['Git', 'Docker'],
    typical_responsibilities: [
      'Build and deploy ML models to production',
      'Design feature engineering pipelines',
      'Monitor model performance and drift',
      'Collaborate with data engineering on data pipelines',
    ],
    preferred_certifications: [],
    experience_band_min: 1,
    experience_band_max: 7,
    related_roles: ['Data Engineer', 'GenAI Engineer', 'Data Scientist'],
    career_progression: ['ML Engineer', 'Senior ML Engineer', 'Staff ML Engineer', 'ML Architect'],
  },
  {
    role_key: 'devops_engineer',
    display_name: 'DevOps Engineer',
    mandatory_skills: ['Docker', 'Kubernetes', 'CI/CD'],
    preferred_skills: ['Terraform', 'AWS', 'Ansible', 'Jenkins'],
    optional_skills: ['Azure', 'Google Cloud', 'Grafana'],
    common_tools: ['Git', 'Docker', 'Kubernetes', 'Terraform'],
    typical_responsibilities: [
      'Build and maintain CI/CD pipelines',
      'Manage cloud infrastructure as code',
      'Own observability and incident response',
      'Improve deployment reliability and speed',
    ],
    preferred_certifications: [],
    experience_band_min: 1,
    experience_band_max: 8,
    related_roles: ['SRE', 'Backend Engineer', 'Cyber Security Engineer'],
    career_progression: ['DevOps Engineer', 'Senior DevOps Engineer', 'SRE Lead', 'Platform Architect'],
  },
  {
    role_key: 'cyber_security_engineer',
    display_name: 'Cyber Security Engineer',
    mandatory_skills: ['OAuth2', 'JWT', 'TLS'],
    preferred_skills: ['Kubernetes', 'AWS', 'Linux'],
    optional_skills: ['Python'],
    common_tools: ['Git', 'Linux'],
    typical_responsibilities: [
      'Perform threat modeling and risk assessments',
      'Design and enforce authentication/authorization standards',
      'Conduct security audits and penetration testing',
      'Respond to and remediate security incidents',
    ],
    preferred_certifications: ['CISSP', 'OSCP'],
    experience_band_min: 2,
    experience_band_max: 10,
    related_roles: ['DevOps Engineer', 'Network Engineer', 'Compliance'],
    career_progression: ['Security Engineer', 'Senior Security Engineer', 'Security Architect', 'CISO'],
  },
  {
    role_key: 'sap_consultant',
    display_name: 'SAP Consultant',
    mandatory_skills: ['SAP FICO', 'SAP MM', 'SAP SD'],
    preferred_skills: ['ABAP', 'ERP Implementation Methodology'],
    optional_skills: ['Business Process Mapping'],
    common_tools: [],
    typical_responsibilities: [
      'Configure and customize SAP modules to business requirements',
      'Lead ERP implementation and rollout projects',
      'Map business processes to SAP workflows',
      'Provide end-user training and support',
    ],
    preferred_certifications: ['SAP Certified Application Associate'],
    experience_band_min: 2,
    experience_band_max: 12,
    related_roles: ['ERP Consultant', 'Business Analyst', 'Solutions Architect'],
    career_progression: ['SAP Consultant', 'Senior SAP Consultant', 'SAP Solution Architect', 'ERP Program Manager'],
  },
  {
    role_key: 'product_manager',
    display_name: 'Product Manager',
    mandatory_skills: ['Agile', 'Scrum'],
    preferred_skills: ['Kanban', 'SQL'],
    optional_skills: ['Figma'],
    common_tools: ['JIRA', 'Confluence', 'Figma'],
    typical_responsibilities: [
      'Own product roadmap and prioritization',
      'Gather and synthesize user and market research',
      'Partner with engineering and design on delivery',
      'Define and track success metrics',
    ],
    preferred_certifications: [],
    experience_band_min: 2,
    experience_band_max: 10,
    related_roles: ['Product Owner', 'Business Analyst', 'Program Manager'],
    career_progression: ['Product Manager', 'Senior Product Manager', 'Director of Product', 'VP of Product'],
  },
];

// Aggregates a role's mandatory+preferred skills, responsibilities, and title into one text blob
// for embedding - the same "aggregated skill/responsibility/title text" the architecture document
// specifies role embeddings should be built from.
function buildRoleEmbeddingText(seed: RoleProfileSeed): string {
  return [
    seed.display_name,
    seed.mandatory_skills.join(', '),
    seed.preferred_skills.join(', '),
    seed.typical_responsibilities.join('. '),
  ].join('. ');
}

// Idempotent - safe to run multiple times (upsertRoleProfile is an upsert; embeddings are
// regenerated each run, which is correct since a seed's text could change between runs).
export async function seedRoleProfiles(): Promise<{ profilesSeeded: number; embeddingsGenerated: number }> {
  let profilesSeeded = 0;
  let embeddingsGenerated = 0;

  for (const seed of ROLE_SEEDS) {
    const profile = await db.upsertRoleProfile({
      role_key: seed.role_key,
      display_name: seed.display_name,
      mandatory_skills: seed.mandatory_skills,
      preferred_skills: seed.preferred_skills,
      optional_skills: seed.optional_skills,
      common_tools: seed.common_tools,
      typical_responsibilities: seed.typical_responsibilities,
      preferred_certifications: seed.preferred_certifications,
      experience_band_min: seed.experience_band_min,
      experience_band_max: seed.experience_band_max,
      related_roles: seed.related_roles,
      career_progression: seed.career_progression,
      source: 'seed',
    });
    if (!profile) {
      logger.warn({ roleKey: seed.role_key }, 'Failed to upsert role profile during seeding');
      continue;
    }
    profilesSeeded++;

    const embedding = await generateEmbedding(buildRoleEmbeddingText(seed));
    if (embedding) {
      await db.updateRoleProfileEmbedding(profile.id, embedding);
      embeddingsGenerated++;
    } else {
      logger.warn({ roleKey: seed.role_key }, 'Embedding service unavailable - role profile seeded without an embedding, matchRoleByTitle will skip it until re-run');
    }
  }

  logger.info({ profilesSeeded, embeddingsGenerated }, 'Role Intelligence Platform seeded');
  return { profilesSeeded, embeddingsGenerated };
}

export async function getRoleProfile(roleKey: string): Promise<RoleProfile | null> {
  return db.getRoleProfileByKey(roleKey);
}

export async function getAllRoleProfiles(): Promise<RoleProfile[]> {
  return db.getAllRoleProfiles();
}

// Resolves an arbitrary JD title (e.g. "Platform Engineer II") to the closest known role profile
// by embedding cosine similarity - the primitive a future phase's "compensate for incomplete job
// descriptions" logic would call. Returns null if no role profile has an embedding yet (e.g.
// the embedding service was unavailable during seeding) or if the title itself can't be embedded.
export async function matchRoleByTitle(title: string): Promise<{ role: RoleProfile; similarity: number } | null> {
  if (!title || !title.trim()) return null;

  const titleEmbedding = await generateEmbedding(title);
  if (!titleEmbedding) return null;

  const roles = await db.getAllRoleProfiles();
  let best: { role: RoleProfile; similarity: number } | null = null;
  for (const role of roles) {
    if (!role.embedding || role.embedding.length === 0) continue;
    const similarity = cosineSimilarity(titleEmbedding, role.embedding);
    if (!best || similarity > best.similarity) {
      best = { role, similarity };
    }
  }
  return best;
}
