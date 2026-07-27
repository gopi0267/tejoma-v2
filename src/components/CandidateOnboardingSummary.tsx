import React, { useState, useEffect } from 'react';
import { GraduationCap, Sparkles, Briefcase, FileText, CheckCircle2, Circle } from 'lucide-react';
import { ErrorBanner } from './Login.js';

interface ProfileSummary {
  education: string | null;
  course_name: string | null;
  primary_skill: string | null;
  skills: string[];
  secondary_skills: string[];
  tools: string[];
  years_of_experience: string | null;
  completion: { percent: number; filled: number; total: number };
}

interface ExperienceSummary {
  job_title: string | null;
  company: string | null;
}

export default function CandidateOnboardingSummary({ resumeUploaded, onComplete, onGoToDashboard }: {
  resumeUploaded: boolean;
  onComplete: () => void;
  onGoToDashboard: () => void;
}) {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [experiences, setExperiences] = useState<ExperienceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState<'complete' | 'dashboard' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profileRes, experiencesRes] = await Promise.all([
          fetch('/api/candidate-profile/me'),
          fetch('/api/candidate-profile/experiences'),
        ]);
        if (profileRes.ok && !cancelled) setProfile(await profileRes.json());
        if (experiencesRes.ok && !cancelled) setExperiences((await experiencesRes.json()).experiences || []);
      } catch {
        if (!cancelled) setError('Failed to load your profile summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isFresher = profile?.years_of_experience === 'Fresher';

  const handleFinish = async (which: 'complete' | 'dashboard') => {
    setFinishing(which);
    setError('');
    try {
      const res = await fetch('/api/candidate-auth/complete-onboarding', { method: 'PUT' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to complete onboarding');
      }
      if (which === 'complete') onComplete();
      else onGoToDashboard();
    } catch (err: any) {
      setError(err.message);
      setFinishing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-[#1A1A1A]">You're almost there!</h1>
        <p className="text-[#666666] text-xs mt-1">Here's a quick summary of your profile.</p>
      </div>

      {profile && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-[#1A1A1A]">Profile completion</span>
            <span className="text-xs text-[#666666]">{profile.completion.percent}%</span>
          </div>
          <div className="w-full h-2 bg-[#E5E5E5] rounded-full overflow-hidden">
            <div className="h-full bg-[#27AE60] transition-all" style={{ width: `${profile.completion.percent}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-start gap-3 bg-[#F8F9FA] rounded-lg p-3.5">
          <GraduationCap className="w-4 h-4 text-[#27AE60] mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#1A1A1A]">Education</p>
            <p className="text-xs text-[#666666] mt-0.5">{profile?.course_name || profile?.education || 'Not added yet'}</p>
          </div>
        </div>

        <div className="flex items-start gap-3 bg-[#F8F9FA] rounded-lg p-3.5">
          <Sparkles className="w-4 h-4 text-[#27AE60] mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#1A1A1A]">Skills</p>
            <p className="text-xs text-[#666666] mt-0.5">
              {[profile?.primary_skill, ...(profile?.skills || []).slice(0, 3)].filter(Boolean).join(', ') || 'Not added yet'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 bg-[#F8F9FA] rounded-lg p-3.5">
          <Briefcase className="w-4 h-4 text-[#27AE60] mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#1A1A1A]">Experience</p>
            <p className="text-xs text-[#666666] mt-0.5">
              {isFresher
                ? 'Fresher'
                : experiences.length > 0
                  ? experiences.map((e) => `${e.job_title || 'Role'} @ ${e.company || 'Company'}`).join(' · ')
                  : 'Not added yet'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 bg-[#F8F9FA] rounded-lg p-3.5">
          <FileText className="w-4 h-4 text-[#27AE60] mt-0.5 flex-shrink-0" />
          <div className="flex items-center gap-1.5">
            {resumeUploaded ? <CheckCircle2 className="w-3.5 h-3.5 text-[#27AE60]" /> : <Circle className="w-3.5 h-3.5 text-[#CCCCCC]" />}
            <p className="text-xs font-semibold text-[#1A1A1A]">Resume Status</p>
            <span className="text-xs text-[#666666]">{resumeUploaded ? '- Uploaded' : '- Not uploaded'}</span>
          </div>
        </div>
      </div>

      {error && <ErrorBanner text={error} />}

      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => handleFinish('complete')}
          disabled={finishing !== null}
          className="w-full bg-[#27AE60] hover:bg-[#219653] active:bg-[#1E8449] text-white text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer shadow-sm disabled:opacity-60"
        >
          {finishing === 'complete' ? 'Finishing...' : 'Complete Profile'}
        </button>
        <button
          type="button"
          onClick={() => handleFinish('dashboard')}
          disabled={finishing !== null}
          className="w-full border border-[#E5E7EB] text-[#666666] hover:text-[#1A1A1A] text-xs font-semibold py-3 rounded-full transition-colors cursor-pointer disabled:opacity-60"
        >
          {finishing === 'dashboard' ? 'One moment...' : 'Go To Candidate Dashboard'}
        </button>
      </div>
    </div>
  );
}
