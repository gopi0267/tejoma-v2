import React, { useState } from 'react';
import { Briefcase, GraduationCap } from 'lucide-react';
import { ErrorBanner } from './Login.js';

export default function CandidateOnboardingExperienceCheck({ onChoice }: { onChoice: (choice: 'fresher' | 'experienced') => void }) {
  const [saving, setSaving] = useState<'fresher' | 'experienced' | null>(null);
  const [error, setError] = useState('');

  const choose = async (choice: 'fresher' | 'experienced') => {
    setSaving(choice);
    setError('');
    try {
      if (choice === 'fresher') {
        // Same years_of_experience = "Fresher" convention already established by the
        // Naukri-inspired registration redesign - reused here, not a new signal.
        const res = await fetch('/api/candidate-profile/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ years_of_experience: 'Fresher' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to save');
        }
      }
      onChoice(choice);
    } catch (err: any) {
      setError(err.message);
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-lg font-bold text-[#1A1A1A]">Are you experienced?</h1>
        <p className="text-[#666666] text-xs mt-1">This helps us tailor the rest of your profile and job matches.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => choose('fresher')}
          disabled={saving !== null}
          className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[#E5E7EB] hover:border-[#27AE60] hover:bg-[#E5F5E5] transition-colors cursor-pointer disabled:opacity-60"
        >
          <div className="w-12 h-12 rounded-full bg-[#E5F5E5] flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-[#27AE60]" />
          </div>
          <span className="font-bold text-[#1A1A1A] text-sm">{saving === 'fresher' ? 'Saving...' : 'Fresher'}</span>
          <span className="text-[10px] text-[#666666] text-center">I'm new to the workforce</span>
        </button>

        <button
          type="button"
          onClick={() => choose('experienced')}
          disabled={saving !== null}
          className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[#E5E7EB] hover:border-[#27AE60] hover:bg-[#E5F5E5] transition-colors cursor-pointer disabled:opacity-60"
        >
          <div className="w-12 h-12 rounded-full bg-[#E5F5E5] flex items-center justify-center">
            <Briefcase className="w-6 h-6 text-[#27AE60]" />
          </div>
          <span className="font-bold text-[#1A1A1A] text-sm">{saving === 'experienced' ? 'Continuing...' : 'Experienced'}</span>
          <span className="text-[10px] text-[#666666] text-center">I've worked before</span>
        </button>
      </div>

      {error && <ErrorBanner text={error} />}
    </div>
  );
}
