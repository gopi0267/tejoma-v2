import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, Briefcase, Building2, Users, GraduationCap, ThumbsUp, ThumbsDown, Send, Check } from 'lucide-react';
import { ErrorBanner } from './Login.js';
import type { PublicJob } from './CandidateJobDiscovery.js';
import { postCandidateDecision } from '../utils/candidateDecisions.js';

// Detail response is the same explicit-column shape as the list, plus a few extra safe fields
// (education, certifications, required_languages, responsibilities, job_summary,
// number_of_openings) that the list card doesn't show. Still never includes company_id,
// recruiter notes, or any matching/scoring data - enforced server-side in db.getOpenJobByIdPublic.
interface PublicJobDetail extends PublicJob {
  optional_skills: string[] | null;
  education: string[] | null;
  certifications: string[] | null;
  required_languages: string[] | null;
  responsibilities: string[] | null;
  job_summary: string | null;
  number_of_openings: number | null;
}

function experienceLabel(job: PublicJobDetail): string | null {
  if (job.min_experience != null || job.max_experience != null) {
    if (job.min_experience != null && job.max_experience != null) return `${job.min_experience}-${job.max_experience} years`;
    return `${job.min_experience ?? job.max_experience} years`;
  }
  if (job.experience_years) return `${job.experience_years}+ years`;
  return null;
}

function salaryLabel(job: PublicJobDetail): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const currency = job.salary_currency || '';
  if (job.salary_min && job.salary_max) return `${currency} ${job.salary_min} - ${job.salary_max}`;
  return `${currency} ${job.salary_min || job.salary_max}`;
}

function TagList({ label, icon, items }: { label: string; icon: React.ReactNode; items: string[] | null | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1A] mb-2">{icon} {label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="text-xs bg-[#F3F2EF] text-[#666666] px-2.5 py-1 rounded-full">{item}</span>
        ))}
      </div>
    </div>
  );
}

export default function CandidateJobDetail({ jobId, onBack }: { jobId: number; onBack: () => void }) {
  const [job, setJob] = useState<PublicJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<number | null>(null); // 0=passed, 1=interested/applied
  const [decisionType, setDecisionType] = useState<'swipe_right' | 'swipe_left' | 'apply' | null>(null);
  const [decisionLoading, setDecisionLoading] = useState<'swipe_right' | 'swipe_left' | 'apply' | null>(null);
  const [decisionError, setDecisionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/candidate-jobs/${jobId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load job');
        if (!cancelled) setJob(data);

        const activeRes = await fetch('/api/candidate-decisions/active');
        const activeData = await activeRes.json();
        if (!cancelled && activeRes.ok) {
          const existing = activeData.decisions.find((d: any) => d.job_id === jobId);
          if (existing) {
            setDecision(Number(existing.action));
            setDecisionType(existing.decision_type);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  const handleDecision = async (type: 'swipe_right' | 'swipe_left' | 'apply') => {
    setDecisionLoading(type);
    setDecisionError('');
    const result = await postCandidateDecision(jobId, type);
    setDecisionLoading(null);
    if (!result.ok) {
      setDecisionError(result.error || 'Failed to record decision');
      return;
    }
    setDecision(type === 'swipe_left' ? 0 : 1);
    setDecisionType(type);
  };

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <button onClick={onBack} className="text-xs font-semibold text-[#666666] hover:text-[#1A1A1A] cursor-pointer flex items-center gap-1 mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Jobs
        </button>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
          </div>
        )}

        {error && <ErrorBanner text={error} />}

        {job && (
          <div className="bg-white rounded-2xl shadow-md p-8 sm:p-10 space-y-6">
            <div>
              <div className="flex items-center gap-2 text-sm text-[#666666] mb-2">
                {job.company_logo_url ? (
                  <img src={job.company_logo_url} alt="" className="w-5 h-5 rounded-sm object-cover" />
                ) : (
                  <Building2 className="w-4 h-4" />
                )}
                <span>{job.company_name}</span>
              </div>
              <h1 className="text-2xl font-bold text-[#1A1A1A]">{job.title}</h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 text-sm text-[#666666]">
                {job.location && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {job.location}</span>}
                {job.employment_type && <span className="flex items-center gap-1.5"><Briefcase className="w-4 h-4" /> {job.employment_type}</span>}
                {experienceLabel(job) && <span>{experienceLabel(job)}</span>}
                {job.number_of_openings != null && <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {job.number_of_openings} opening(s)</span>}
              </div>
              {salaryLabel(job) && (
                <div className="inline-block mt-3 text-sm font-bold text-[#27AE60] bg-[#E5F5E5] border border-[#A8E6C1] px-3 py-1 rounded-full">
                  {salaryLabel(job)}
                </div>
              )}
            </div>

            <div className="border-t border-b border-[#E5E7EB] py-4">
              {decision !== null ? (
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: decision === 1 ? '#27AE60' : '#999999' }}>
                  {decision === 1 ? <Check className="w-4 h-4" /> : null}
                  {decisionType === 'apply' ? 'You applied to this job' : decision === 1 ? "You're interested in this job" : 'You passed on this job'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={() => handleDecision('apply')}
                    disabled={decisionLoading !== null}
                    className="flex items-center gap-1.5 bg-[#27AE60] hover:bg-[#219653] text-white text-xs font-semibold px-5 py-2.5 rounded-full transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" /> {decisionLoading === 'apply' ? 'Applying...' : 'Apply'}
                  </button>
                  <button
                    onClick={() => handleDecision('swipe_right')}
                    disabled={decisionLoading !== null}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#27AE60] border border-[#27AE60] hover:bg-[#E5F5E5] px-4 py-2.5 rounded-full transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <ThumbsUp className="w-4 h-4" /> Interested
                  </button>
                  <button
                    onClick={() => handleDecision('swipe_left')}
                    disabled={decisionLoading !== null}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#666666] border border-[#E5E7EB] hover:bg-[#F3F2EF] px-4 py-2.5 rounded-full transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <ThumbsDown className="w-4 h-4" /> Pass
                  </button>
                </div>
              )}
              {decisionError && <div className="mt-2"><ErrorBanner text={decisionError} /></div>}
            </div>

            {(job.job_summary || job.description) && (
              <div>
                <h2 className="text-sm font-semibold text-[#1A1A1A] mb-2">About this role</h2>
                <p className="text-sm text-[#4A4A4A] whitespace-pre-wrap leading-relaxed">{job.job_summary || job.description}</p>
              </div>
            )}

            <TagList label="Required skills" icon={<Briefcase className="w-3.5 h-3.5" />} items={job.required_skills} />
            <TagList label="Nice to have" icon={<Briefcase className="w-3.5 h-3.5" />} items={job.optional_skills} />
            <TagList label="Responsibilities" icon={<Briefcase className="w-3.5 h-3.5" />} items={job.responsibilities} />
            <TagList label="Education" icon={<GraduationCap className="w-3.5 h-3.5" />} items={job.education} />
            <TagList label="Certifications" icon={<GraduationCap className="w-3.5 h-3.5" />} items={job.certifications} />
            <TagList label="Languages" icon={<Briefcase className="w-3.5 h-3.5" />} items={job.required_languages} />
          </div>
        )}
      </div>
    </div>
  );
}
