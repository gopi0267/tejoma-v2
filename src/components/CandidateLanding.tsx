import React from 'react';
import { Sparkles, Search, ArrowRight } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';

// The first thing shown at /candidate before any auth screen - a role-selection front door,
// mirroring the Naukri/LinkedIn/Indeed pattern of separating candidate and recruiter journeys
// visually before either one starts. "/" (the staff entry point) is untouched; this only
// replaces what used to render directly at /candidate.
export default function CandidateLanding({ onSelectCandidate }: { onSelectCandidate: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="mb-8 flex flex-col items-center text-center">
        <TejomaLogo size="xl" textColorClass="text-[#1A1A1A]" />
        <h1 className="text-2xl sm:text-3xl font-bold text-[#1A1A1A] mt-5">Find Jobs Faster With AI</h1>
        <p className="text-[#666666] text-sm mt-2 max-w-sm">
          AI-matched roles, one-tap applications, and real-time updates on every application you send.
        </p>
      </div>

      <div className="w-full max-w-md grid gap-4 sm:grid-cols-2">
        <button
          onClick={onSelectCandidate}
          className="group bg-white rounded-2xl shadow-md hover:shadow-lg transition-shadow p-6 text-left cursor-pointer border border-transparent hover:border-[#A8E6C1]"
        >
          <div className="w-10 h-10 rounded-full bg-[#E5F5E5] flex items-center justify-center mb-4">
            <Search className="w-5 h-5 text-[#27AE60]" />
          </div>
          <p className="font-bold text-[#1A1A1A] text-sm">I'm a Candidate</p>
          <p className="text-[#666666] text-xs mt-1">Browse and apply to jobs matched to your profile.</p>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#27AE60] mt-4 group-hover:underline">
            Get started <ArrowRight className="w-3 h-3" />
          </span>
        </button>

        <a
          href="/"
          className="group bg-white rounded-2xl shadow-md hover:shadow-lg transition-shadow p-6 text-left cursor-pointer border border-transparent hover:border-[#CCE0FF]"
        >
          <div className="w-10 h-10 rounded-full bg-[#E8F0FE] flex items-center justify-center mb-4">
            <Sparkles className="w-5 h-5 text-[#2962FF]" />
          </div>
          <p className="font-bold text-[#1A1A1A] text-sm">I'm a Recruiter</p>
          <p className="text-[#666666] text-xs mt-1">Post jobs, review candidates, and manage your pipeline.</p>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2962FF] mt-4 group-hover:underline">
            Recruiter login <ArrowRight className="w-3 h-3" />
          </span>
        </a>
      </div>
    </div>
  );
}
