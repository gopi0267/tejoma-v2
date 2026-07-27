import React, { useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { ProfileField, SelectField } from './CandidateProfile.js';
import { ChipInput } from './CandidateOnboardingSkills.js';
import { ErrorBanner } from './Login.js';

const EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Contract', 'Internship', 'Freelance'];

export interface ExperienceEntry {
  jobTitle: string;
  company: string;
  employmentType: string;
  years: string;
  months: string;
  currentCtc: string;
  expectedCtc: string;
  noticePeriod: string;
  currentLocation: string;
  preferredLocation: string;
  keyResponsibilities: string;
  skillsUsed: string[];
}

const BLANK_ENTRY: ExperienceEntry = {
  jobTitle: '', company: '', employmentType: '', years: '', months: '',
  currentCtc: '', expectedCtc: '', noticePeriod: '', currentLocation: '', preferredLocation: '',
  keyResponsibilities: '', skillsUsed: [],
};

export default function CandidateOnboardingExperience({ initial, onSaved }: { initial: ExperienceEntry[]; onSaved: (entries: ExperienceEntry[]) => void }) {
  const [entries, setEntries] = useState<ExperienceEntry[]>(initial.length > 0 ? initial : [{ ...BLANK_ENTRY }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateEntry = (index: number, patch: Partial<ExperienceEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const addEntry = () => setEntries((prev) => [...prev, { ...BLANK_ENTRY }]);
  const removeEntry = (index: number) => setEntries((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const incomplete = entries.find((entry) => !entry.jobTitle.trim() || !entry.company.trim());
    if (incomplete) {
      setError('Please fill in at least Job Title and Company for every experience entry.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const entry of entries) {
        const res = await fetch('/api/candidate-profile/experiences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_title: entry.jobTitle,
            company: entry.company,
            employment_type: entry.employmentType || null,
            experience_years: entry.years ? parseInt(entry.years, 10) : null,
            experience_months: entry.months ? parseInt(entry.months, 10) : null,
            current_ctc: entry.currentCtc || null,
            expected_ctc: entry.expectedCtc || null,
            notice_period: entry.noticePeriod || null,
            current_location: entry.currentLocation || null,
            preferred_location: entry.preferredLocation || null,
            key_responsibilities: entry.keyResponsibilities || null,
            skills_used: entry.skillsUsed,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save an experience entry');
      }

      // Total experience for candidate_accounts.years_of_experience reuses the most recently
      // added entry's years/months as a representative summary value - the same "first number
      // found" convention the matching engine already uses for this free-text field elsewhere.
      const primary = entries[0];
      if (primary?.years || primary?.months) {
        const label = `${primary.years || 0} years ${primary.months || 0} months`;
        await fetch('/api/candidate-profile/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            years_of_experience: label,
            current_company: primary.company || null,
            notice_period: primary.noticePeriod || null,
            current_ctc: primary.currentCtc || null,
            expected_ctc: primary.expectedCtc || null,
            location: primary.currentLocation || null,
          }),
        }).catch(() => {});
      }

      onSaved(entries);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-[#1A1A1A]">Experience Details</h1>
        <p className="text-[#666666] text-xs mt-1">Add your work history - you can add more than one company.</p>
      </div>

      {entries.map((entry, i) => (
        <div key={i} className="border border-[#E5E7EB] rounded-xl p-5 space-y-5 relative">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1A1A1A]">Company {i + 1}</h2>
            {entries.length > 1 && (
              <button type="button" onClick={() => removeEntry(i)} aria-label="Remove this experience" className="text-[#999999] hover:text-[#E74C3C] cursor-pointer">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <ProfileField label="Current Job Title" value={entry.jobTitle} onChange={(v) => updateEntry(i, { jobTitle: v })} placeholder="e.g. Software Engineer" />
            <ProfileField label="Current Company" value={entry.company} onChange={(v) => updateEntry(i, { company: v })} placeholder="e.g. Acme Corp" />
          </div>

          <SelectField label="Employment Type" value={entry.employmentType} onChange={(v) => updateEntry(i, { employmentType: v })} options={EMPLOYMENT_TYPES} />

          <div>
            <label className="block text-[#1A1A1A] text-sm font-medium mb-1.5">Total Experience</label>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" min={0} value={entry.years} onChange={(e) => updateEntry(i, { years: e.target.value })} placeholder="Years" className="w-full bg-white border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60]" />
              <input type="number" min={0} max={11} value={entry.months} onChange={(e) => updateEntry(i, { months: e.target.value })} placeholder="Months" className="w-full bg-white border border-[#E5E7EB] rounded-lg py-2.5 px-3.5 text-[#1A1A1A] text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60]" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <ProfileField label="Current CTC" value={entry.currentCtc} onChange={(v) => updateEntry(i, { currentCtc: v })} placeholder="e.g. 12 LPA" />
            <ProfileField label="Expected CTC" value={entry.expectedCtc} onChange={(v) => updateEntry(i, { expectedCtc: v })} placeholder="e.g. 18 LPA" />
          </div>
          <ProfileField label="Notice Period" value={entry.noticePeriod} onChange={(v) => updateEntry(i, { noticePeriod: v })} placeholder="e.g. 30 days" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <ProfileField label="Current Location" value={entry.currentLocation} onChange={(v) => updateEntry(i, { currentLocation: v })} placeholder="e.g. Bengaluru" />
            <ProfileField label="Preferred Location" value={entry.preferredLocation} onChange={(v) => updateEntry(i, { preferredLocation: v })} placeholder="e.g. Remote" />
          </div>

          <ProfileField label="Key Responsibilities" value={entry.keyResponsibilities} onChange={(v) => updateEntry(i, { keyResponsibilities: v })} placeholder="What did you own in this role?" textarea />

          <ChipInput label="Skills Used" values={entry.skillsUsed} onChange={(v) => updateEntry(i, { skillsUsed: v })} placeholder="Add a skill used in this role..." />
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className="w-full border-2 border-dashed border-[#A8E6C1] text-[#27AE60] hover:bg-[#E5F5E5] text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
      >
        <Plus className="w-4 h-4" /> Add Another Company
      </button>

      {error && <ErrorBanner text={error} />}

      <button type="submit" disabled={saving} className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60">
        {saving ? 'Saving...' : <>Save &amp; Continue <ArrowRight className="w-4 h-4" /></>}
      </button>
    </form>
  );
}
