// Ported verbatim from the monolith's skillsExtractor.ts.
import skillsData from './skills.json' with { type: 'json' };

export function extractSkills(text: string) {
  const textLower = text.toLowerCase();
  const foundSkills = new Set<string>();

  skillsData.skills.forEach((skill: string) => {
    if (textLower.includes(skill.toLowerCase())) {
      foundSkills.add(skill);
    }
  });

  return Array.from(foundSkills).slice(0, 15);
}
