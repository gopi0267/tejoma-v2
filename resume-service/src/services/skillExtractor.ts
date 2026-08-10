import { MIN_SKILL_CONFIDENCE } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Simplified skill extraction using pattern matching
const COMMON_SKILLS = [
  'node.js',
  'typescript',
  'javascript',
  'react',
  'vue',
  'angular',
  'python',
  'java',
  'golang',
  'rust',
  'postgresql',
  'mongodb',
  'redis',
  'docker',
  'kubernetes',
  'aws',
  'azure',
  'gcp',
  'agile',
  'scrum',
  'git',
  'rest api',
  'graphql',
  'sql',
  'nosql',
];

export function extractSkills(text: string): string[] {
  try {
    if (!text) return [];

    const lowerText = text.toLowerCase();
    const foundSkills = new Set<string>();

    for (const skill of COMMON_SKILLS) {
      if (lowerText.includes(skill)) {
        foundSkills.add(skill);
      }
    }

    const skills = Array.from(foundSkills).sort();
    logger.debug({ skillCount: skills.length, skills }, 'Skills extracted from text');

    return skills;
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Skill extraction failed');
    return [];
  }
}

export function calculateSkillsConfidence(skills: string[], text: string): number {
  try {
    if (skills.length === 0) return 0;

    // Simple confidence calculation: how many times each skill is mentioned
    const lowerText = text.toLowerCase();
    let mentionCount = 0;

    for (const skill of skills) {
      const pattern = new RegExp(skill, 'gi');
      const matches = lowerText.match(pattern) || [];
      mentionCount += matches.length;
    }

    // Normalize: more mentions = higher confidence (capped at 1.0)
    const confidence = Math.min(1.0, mentionCount / (skills.length * 2));
    logger.debug({ confidence, skillCount: skills.length, mentionCount }, 'Skills confidence calculated');

    return confidence;
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Confidence calculation failed');
    return 0;
  }
}
