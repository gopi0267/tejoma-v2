import type { DictionaryEntry } from '../matcher/trie.js';

function entry(canonical: string, extraAliases: string[] = []): DictionaryEntry {
  return { canonical, category: 'general', aliases: [canonical, ...extraAliases] };
}

export const CERTIFICATIONS_DICTIONARY: DictionaryEntry[] = [
  entry('AWS Certified Solutions Architect', ['AWS Solutions Architect', 'AWS SAA']),
  entry('AWS Certified Developer', []),
  entry('Microsoft Certified: Azure Administrator', ['Azure Administrator Associate']),
  entry('Google Cloud Certified', ['GCP Certified']),
  entry('PMP', ['Project Management Professional']),
  entry('CSM', ['Certified Scrum Master']),
  entry('PSM', ['Professional Scrum Master']),
  entry('CISSP', ['Certified Information Systems Security Professional']),
  entry('CEH', ['Certified Ethical Hacker']),
  entry('CCNA', ['Cisco Certified Network Associate']),
  entry('ITIL', ['ITIL Foundation']),
  entry('Six Sigma', ['Lean Six Sigma']),
  entry('CFA', ['Chartered Financial Analyst']),
  entry('CPA', ['Certified Public Accountant']),
  entry('SHRM-CP', []),
  entry('Kubernetes Certified Administrator', ['CKA']),
];
