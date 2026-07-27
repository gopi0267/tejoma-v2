import React, { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { ProfileField } from './CandidateProfile.js';
import { ErrorBanner } from './Login.js';

// Original chip/tag input - add via Enter or comma, remove with the x, optional suggestion
// list filtered client-side as the candidate types. Not copied from any external product.
// Exported so CandidateOnboardingExperience.tsx can reuse it for "Skills Used" per entry,
// rather than duplicating a non-trivial component.
export function ChipInput({ label, values, onChange, placeholder, suggestions }: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');

  const addChip = (raw: string) => {
    const v = raw.trim();
    if (!v || values.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };

  const removeChip = (v: string) => onChange(values.filter((s) => s !== v));

  const filteredSuggestions = (suggestions || [])
    .filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()))
    .filter((s) => draft.trim() && s.toLowerCase().includes(draft.trim().toLowerCase()))
    .slice(0, 6);

  return (
    <div>
      <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addChip(draft);
            }
          }}
          placeholder={placeholder}
          className="w-full bg-white border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
        />
        {filteredSuggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-[#E5E7EB] rounded-lg shadow-md overflow-hidden">
            {filteredSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addChip(s)}
                className="w-full text-left px-3.5 py-2 text-sm text-[#1A1A1A] hover:bg-[#E5F5E5] cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1.5 bg-[#E5F5E5] text-[#1E8449] text-xs font-semibold px-3 py-1.5 rounded-full">
              {v}
              <button type="button" onClick={() => removeChip(v)} aria-label={`Remove ${v}`} className="hover:text-[#E74C3C] cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="text-[10px] text-[#999999] mt-1.5">Press Enter or comma to add</p>
    </div>
  );
}

const COMMON_SKILLS = ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'SQL', 'AWS', 'Docker', 'Communication', 'Project Management', 'Excel'];
const COMMON_TOOLS = ['Git', 'Jira', 'Figma', 'Docker', 'Kubernetes', 'Slack', 'Postman', 'VS Code', 'Salesforce', 'Tableau'];

export interface SkillsData {
  primarySkill: string;
  secondarySkills: string[];
  technicalSkills: string[];
  tools: string[];
}

export default function CandidateOnboardingSkills({ initial, onSaved }: { initial: SkillsData; onSaved: (data: SkillsData) => void }) {
  const [primarySkill, setPrimarySkill] = useState(initial.primarySkill);
  const [secondarySkills, setSecondarySkills] = useState<string[]>(initial.secondarySkills);
  const [technicalSkills, setTechnicalSkills] = useState<string[]>(initial.technicalSkills);
  const [tools, setTools] = useState<string[]>(initial.tools);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!primarySkill.trim()) {
      setError('Please enter your primary skill.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/candidate-profile/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_skill: primarySkill,
          secondary_skills: secondarySkills,
          skills: technicalSkills,
          tools,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save skills');
      onSaved({ primarySkill, secondarySkills, technicalSkills, tools });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-[#1A1A1A]">Skills</h1>
        <p className="text-[#666666] text-xs mt-1">Add the skills that best represent you - recruiters search by these.</p>
      </div>

      <ProfileField label="Primary Skill" value={primarySkill} onChange={setPrimarySkill} placeholder="e.g. React Development" />
      <ChipInput label="Secondary Skills" values={secondarySkills} onChange={setSecondarySkills} placeholder="Add a secondary skill..." suggestions={COMMON_SKILLS} />
      <ChipInput label="Technical Skills" values={technicalSkills} onChange={setTechnicalSkills} placeholder="Add a technical skill..." suggestions={COMMON_SKILLS} />
      <ChipInput label="Tools & Technologies" values={tools} onChange={setTools} placeholder="Add a tool..." suggestions={COMMON_TOOLS} />

      {error && <ErrorBanner text={error} />}

      <button type="submit" disabled={saving} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60">
        {saving ? 'Saving...' : <>Save &amp; Continue <ArrowRight className="w-4 h-4" /></>}
      </button>
    </form>
  );
}
