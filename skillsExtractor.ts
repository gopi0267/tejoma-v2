import skillsData from './skills.json';

export function extractSkills(text: string) {
  const textLower = text.toLowerCase();
  const foundSkills = new Set<string>();
  
  skillsData.skills.forEach(skill => {
    if (textLower.includes(skill.toLowerCase())) {
      foundSkills.add(skill);
    }
  });

  return Array.from(foundSkills).slice(0, 15);
}