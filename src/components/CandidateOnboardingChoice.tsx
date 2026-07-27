import React from 'react';
import { PenLine, FileUp, ArrowRight, CheckCircle2 } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';

export type OnboardingPath = 'manual' | 'ai-resume';

// First screen a candidate sees right after registration - replaces the old fixed 6-step
// Education->Skills->Experience->Resume->Summary sequence with an explicit choice between two
// complete, self-contained paths (CandidateOnboardingManual / CandidateOnboardingAIResume).
export default function CandidateOnboardingChoice({ candidateName, onChoose }: { candidateName: string; onChoose: (path: OnboardingPath) => void }) {
  return (
    <div className="min-h-screen p-4 sm:p-8 flex flex-col items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="w-full max-w-3xl">
        <div className="flex justify-center mb-8">
          <TejomaLogo size="md" textColorClass="text-[#1A1A1A]" />
        </div>

        <div className="text-center mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1A1A1A]">Create Your Profile</h1>
          <p className="text-[#666666] text-sm mt-2 max-w-md mx-auto">
            Welcome, {candidateName.split(' ')[0]}! Choose how you would like to build your professional profile.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <button
            type="button"
            onClick={() => onChoose('manual')}
            className="group text-left bg-white border-2 border-[#E5E7EB] hover:border-[#27AE60] rounded-2xl p-7 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col"
          >
            <div className="w-12 h-12 rounded-xl bg-[#E5F5E5] flex items-center justify-center mb-5 group-hover:bg-[#27AE60] transition-colors">
              <PenLine className="w-6 h-6 text-[#27AE60] group-hover:text-white transition-colors" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] mb-2">Create Profile Manually</h2>
            <p className="text-xs text-[#666666] leading-relaxed mb-6 flex-1">
              Complete every profile section yourself. Recommended for candidates who want full control.
            </p>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#27AE60]">
              Create Profile Manually <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChoose('ai-resume')}
            className="group text-left bg-white border-2 border-[#E5E7EB] hover:border-[#27AE60] rounded-2xl p-7 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col relative overflow-hidden"
          >
            <span className="absolute top-4 right-4 text-[9px] font-bold text-[#1E8449] bg-[#E5F5E5] border border-[#A8E6C1] px-2 py-0.5 rounded-full uppercase tracking-wide">
              Faster
            </span>
            <div className="w-12 h-12 rounded-xl bg-[#E5F5E5] flex items-center justify-center mb-5 group-hover:bg-[#27AE60] transition-colors">
              <FileUp className="w-6 h-6 text-[#27AE60] group-hover:text-white transition-colors" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A] mb-2">Build Profile From Resume</h2>
            <p className="text-xs text-[#666666] leading-relaxed mb-6 flex-1">
              Upload your resume and let AI create your profile automatically. You can review and edit everything before saving.
            </p>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#27AE60]">
              Build Profile From Resume <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#999999] mt-8">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#27AE60]" /> Either way, you'll always be able to edit your profile later.
        </p>
      </div>
    </div>
  );
}
