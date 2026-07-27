import React, { useState, useRef } from 'react';
import { MapPin, Sparkles, FileText, Upload } from 'lucide-react';

// Candidate-portal design language is hex-literal-based (Login.tsx / CandidateAuth.tsx /
// CandidateProfile.tsx), distinct from Recruiter Management's Tailwind-token palette - every
// color here intentionally reuses that same existing hex set rather than introducing slate-*/
// emerald-* tokens, so this page stays visually consistent with the rest of the candidate portal.

export interface CandidateExperience {
  id: number;
  job_title: string | null;
  company: string | null;
  employment_type: string | null;
  experience_years: number | null;
  experience_months: number | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  notice_period: string | null;
  current_location: string | null;
  preferred_location: string | null;
  key_responsibilities: string | null;
  skills_used: string[];
  created_at: string;
  updated_at: string;
}

export const NAV_SECTIONS = [
  { id: 'career-preferences', label: 'Career Preferences' },
  { id: 'education', label: 'Education' },
  { id: 'key-skills', label: 'Key Skills' },
  { id: 'languages', label: 'Languages' },
  { id: 'internships', label: 'Internships' },
  { id: 'projects', label: 'Projects' },
  { id: 'profile-summary', label: 'Profile Summary' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'employment-history', label: 'Employment History' },
  { id: 'academic-achievements', label: 'Academic Achievements' },
  { id: 'resume', label: 'Resume' },
] as const;

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function EmptyNote({ text }: { text: string }) {
  return (
    <p className="text-xs text-[#999999] italic bg-[#F8F9FA] border border-dashed border-[#E5E7EB] rounded-xl px-4 py-3.5 leading-relaxed">
      {text}
    </p>
  );
}

export function ReadOnlyChips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#E5F5E5] text-[#1E8449] border border-[#A8E6C1]">
          {item}
        </span>
      ))}
    </div>
  );
}

function formatDuration(years: number | null, months: number | null): string {
  const parts: string[] = [];
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} mo${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}

// Read-only display of one candidate_experiences row - this data is currently only collected
// during onboarding (CandidateOnboardingExperience.tsx); this page has no add/edit UI for it yet,
// so every field is shown exactly as saved, with no invented dates or descriptions for gaps.
export function ExperienceEntryCard({ exp }: { exp: CandidateExperience }) {
  const duration = formatDuration(exp.experience_years, exp.experience_months);
  return (
    <div className="border border-[#E5E7EB] rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-[#1A1A1A]">{exp.job_title || 'Role not specified'}</p>
          <p className="text-xs text-[#666666] mt-0.5">{exp.company || 'Company not specified'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {exp.employment_type && (
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#F3F2EF] text-[#666666] border border-[#E5E7EB]">{exp.employment_type}</span>
          )}
          {duration && (
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#EAF2FF] text-[#2962FF] border border-[#D6E4FF]">{duration}</span>
          )}
        </div>
      </div>

      {(exp.current_location || exp.preferred_location) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#666666]">
          {exp.current_location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#999999]" /> {exp.current_location}</span>}
          {exp.preferred_location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#999999]" /> Prefers {exp.preferred_location}</span>}
        </div>
      )}

      {(exp.current_ctc || exp.expected_ctc || exp.notice_period) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#666666]">
          {exp.current_ctc && <span>Current CTC: <span className="font-semibold text-[#1A1A1A]">{exp.current_ctc}</span></span>}
          {exp.expected_ctc && <span>Expected CTC: <span className="font-semibold text-[#1A1A1A]">{exp.expected_ctc}</span></span>}
          {exp.notice_period && <span>Notice: <span className="font-semibold text-[#1A1A1A]">{exp.notice_period}</span></span>}
        </div>
      )}

      {exp.key_responsibilities && (
        <p className="text-xs text-[#444444] whitespace-pre-wrap leading-relaxed border-t border-[#F0F0F0] pt-3">{exp.key_responsibilities}</p>
      )}

      {exp.skills_used?.length > 0 && <ReadOnlyChips items={exp.skills_used} />}
    </div>
  );
}

// ==================== AI Insights (candidate-facing, computed only) ====================
// Nothing here is fetched or predicted - every number is derived from fields already present on
// this candidate's own saved profile. "Profile Completion" reuses the exact percentage the
// backend already computes (computeCompletion in candidate-profile.routes.ts) rather than a
// second, possibly-inconsistent client-side calculation of the same thing.
export interface CandidateInsights {
  completionPercent: number;
  skillsCoverage: number;
  sectionsPercent: number;
  strengthLabel: string;
  strengthClass: string;
}

export function computeCandidateInsights(profile: {
  completion: { percent: number };
  primary_skill: string | null;
  secondary_skills: string[];
  skills: string[];
  tools: string[];
  certifications: string[];
  languages: string[];
}, sectionsWithContent: number, totalSections: number): CandidateInsights {
  const skillChecks = [
    !!profile.primary_skill,
    (profile.secondary_skills?.length ?? 0) > 0,
    (profile.skills?.length ?? 0) > 0,
    (profile.tools?.length ?? 0) > 0,
    (profile.certifications?.length ?? 0) > 0,
    (profile.languages?.length ?? 0) > 0,
  ];
  const skillsCoverage = Math.round((skillChecks.filter(Boolean).length / skillChecks.length) * 100);
  const sectionsPercent = totalSections > 0 ? Math.round((sectionsWithContent / totalSections) * 100) : 0;

  let strengthLabel = 'Just Getting Started';
  let strengthClass = 'text-[#E74C3C] bg-[#FFE5E5] border-[#FFB3B3]';
  if (profile.completion.percent >= 80) {
    strengthLabel = 'Excellent'; strengthClass = 'text-[#1E8449] bg-[#E5F5E5] border-[#A8E6C1]';
  } else if (profile.completion.percent >= 60) {
    strengthLabel = 'Strong'; strengthClass = 'text-[#2962FF] bg-[#EAF2FF] border-[#D6E4FF]';
  } else if (profile.completion.percent >= 35) {
    strengthLabel = 'Needs Improvement'; strengthClass = 'text-[#B7791F] bg-[#FFF7E6] border-[#FFE0B2]';
  }

  return { completionPercent: profile.completion.percent, skillsCoverage, sectionsPercent, strengthLabel, strengthClass };
}

function InsightStat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] px-3.5 py-3">
      <p className="text-[10px] font-semibold text-[#999999] uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-1 ${valueClass || 'text-[#1A1A1A]'}`}>{value}</p>
    </div>
  );
}

export function AIInsightsCard({ insights }: { insights: CandidateInsights }) {
  return (
    <section id="ai-insights" className="rounded-2xl border border-[#2962FF]/20 bg-gradient-to-br from-[#2962FF]/5 to-white p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-6 h-6 rounded-full bg-[#2962FF] text-white flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </span>
        <h3 className="text-sm font-bold text-[#1A1A1A]">Tejoma AI Insights</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InsightStat label="Profile Completion" value={`${insights.completionPercent}%`} />
        <InsightStat label="Skills Coverage" value={`${insights.skillsCoverage}%`} />
        <InsightStat label="Sections Completed" value={`${insights.sectionsPercent}%`} />
        <InsightStat label="Profile Strength" value={insights.strengthLabel} valueClass={insights.strengthClass.split(' ')[0]} />
      </div>

      <p className="text-[10px] text-[#999999] mt-4 leading-relaxed">
        These are computed from how much of your profile you've filled in - not a prediction of how recruiters will respond. Fill in more sections below to raise them.
      </p>
    </section>
  );
}

// ==================== Permanent resume file: upload / update / view ====================
// Separate from the existing "Upload Resume" flow (CandidateResumeUpload.tsx, via
// /api/candidate-resume/parse), which extracts text into profile fields and never keeps the
// file - this widget talks to the new /api/candidate-resume/file endpoints, which persist the
// actual uploaded file and let it be replaced. Same input handles both first upload and update;
// the label and layout just reflect whether a file is already on record.
export function ResumeFileManager({
  filename, uploadedAt, onUploaded,
}: {
  filename: string | null;
  uploadedAt: string | null;
  onUploaded: (data: { resume_original_filename: string; resume_file_uploaded_at: string }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/candidate-resume/file', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload resume');
      onUploaded({ resume_original_filename: data.resume_original_filename, resume_file_uploaded_at: data.resume_file_uploaded_at });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const uploadedDate = formatDate(uploadedAt);

  return (
    <div className="border border-[#E5E7EB] rounded-xl p-4 sm:p-5">
      {filename ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-[#E5F5E5] text-[#1E8449] flex items-center justify-center flex-shrink-0"><FileText className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1A1A1A] truncate">{filename}</p>
              {uploadedDate && <p className="text-[11px] text-[#999999]">Uploaded {uploadedDate}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href="/api/candidate-resume/file"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] border border-[#E5E7EB] rounded-full px-3.5 py-1.5 transition-colors"
            >
              View / Download
            </a>
            <label className={`text-xs font-semibold text-[#27AE60] border border-[#27AE60] hover:bg-[#E5F5E5] rounded-full px-3.5 py-1.5 transition-colors cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
              {uploading ? 'Uploading...' : 'Update Resume'}
              <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFile} className="hidden" disabled={uploading} />
            </label>
          </div>
        </div>
      ) : (
        <div className="text-center py-2">
          <p className="text-xs text-[#666666] mb-3">No resume file on record yet.</p>
          <label className={`inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#27AE60] hover:bg-[#219653] rounded-full px-4 py-2.5 cursor-pointer transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading...' : 'Upload Resume'}
            <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFile} className="hidden" disabled={uploading} />
          </label>
        </div>
      )}
      {error && <p className="text-xs text-[#E74C3C] mt-2.5">{error}</p>}
    </div>
  );
}
