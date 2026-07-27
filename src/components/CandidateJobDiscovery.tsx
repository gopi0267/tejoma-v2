import React, { useState, useEffect, useCallback } from 'react';
import { Search, MapPin, Briefcase, Building2, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { TextField } from './Login.js';
import { postCandidateDecision } from '../utils/candidateDecisions.js';

// Shape returned by GET /api/candidate-jobs (db.getOpenJobsPublic's explicit column allowlist -
// no company_id, no recruiter-internal fields, always status='open').
export interface PublicJob {
  id: number;
  title: string;
  description: string | null;
  required_skills: string[] | null;
  experience_years: number | null;
  min_experience: number | null;
  max_experience: number | null;
  location: string | null;
  employment_type: string | null;
  salary_min: string | null;
  salary_max: string | null;
  salary_currency: string | null;
  company_name: string;
  company_logo_url: string | null;
  created_at: string;
}

const PAGE_SIZE = 10;

function experienceLabel(job: PublicJob): string | null {
  if (job.min_experience != null || job.max_experience != null) {
    if (job.min_experience != null && job.max_experience != null) return `${job.min_experience}-${job.max_experience} yrs`;
    return `${job.min_experience ?? job.max_experience} yrs`;
  }
  if (job.experience_years) return `${job.experience_years}+ yrs`;
  return null;
}

function salaryLabel(job: PublicJob): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const currency = job.salary_currency || '';
  if (job.salary_min && job.salary_max) return `${currency} ${job.salary_min} - ${job.salary_max}`;
  return `${currency} ${job.salary_min || job.salary_max}`;
}

export default function CandidateJobDiscovery({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [keyword, setKeyword] = useState('');
  const [skill, setSkill] = useState('');
  const [location, setLocation] = useState('');
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(1);

  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // job_id -> 0 (passed) | 1 (interested/applied), from /candidate-decisions/active - lets
  // each card show its current decision state and avoid re-submitting a duplicate.
  const [decisions, setDecisions] = useState<Record<number, number>>({});
  const [decisionError, setDecisionError] = useState('');

  const loadActiveDecisions = useCallback(async () => {
    try {
      const res = await fetch('/api/candidate-decisions/active');
      const data = await res.json();
      if (res.ok) {
        const map: Record<number, number> = {};
        for (const d of data.decisions) map[d.job_id] = Number(d.action);
        setDecisions(map);
      }
    } catch {
      // Non-critical - cards just won't show a prior decision state.
    }
  }, []);

  useEffect(() => { loadActiveDecisions(); }, [loadActiveDecisions]);

  const handleDecision = async (e: React.MouseEvent, jobId: number, decisionType: 'swipe_right' | 'swipe_left') => {
    e.stopPropagation();
    setDecisionError('');
    const result = await postCandidateDecision(jobId, decisionType);
    if (!result.ok) {
      setDecisionError(result.error || 'Failed to record decision');
      return;
    }
    setDecisions((prev) => ({ ...prev, [jobId]: decisionType === 'swipe_right' ? 1 : 0 }));
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (keyword.trim()) params.set('search', keyword.trim());
      if (skill.trim()) params.set('skill', skill.trim());
      if (location.trim()) params.set('location', location.trim());
      if (company.trim()) params.set('company', company.trim());

      const res = await fetch(`/api/candidate-jobs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load jobs');
      setJobs(data.jobs);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [keyword, skill, location, company, page]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchJobs();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-3xl mx-auto">

        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Browse Jobs</h1>
          <p className="text-[#666666] text-sm mt-1">Open roles across every company on Tejoma.</p>
        </div>

        <form onSubmit={handleSearchSubmit} className="bg-white rounded-2xl shadow-md p-5 mb-6 space-y-4">
          <TextField label="Job title or keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. Backend Engineer" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <TextField label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="e.g. React" />
            <TextField label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bengaluru" />
            <TextField label="Company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Corp" />
          </div>
          <button type="submit" className="w-full sm:w-auto bg-[#27AE60] hover:bg-[#219653] text-white text-xs font-semibold px-6 py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer">
            <Search className="w-4 h-4" /> Search
          </button>
        </form>

        {error && <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium mb-4">{error}</div>}
        {decisionError && <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium mb-4">{decisionError}</div>}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-10 text-center text-[#666666] text-sm">No open jobs match your search.</div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const decision = decisions[job.id];
              return (
                <div key={job.id} className="bg-white rounded-2xl shadow-md p-5 hover:shadow-lg transition-shadow">
                  <div
                    onClick={() => onSelectJob(job.id)}
                    className="flex items-start justify-between gap-4 cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-[#666666] mb-1">
                        {job.company_logo_url ? (
                          <img src={job.company_logo_url} alt="" className="w-4 h-4 rounded-sm object-cover" />
                        ) : (
                          <Building2 className="w-3.5 h-3.5" />
                        )}
                        <span className="truncate">{job.company_name}</span>
                      </div>
                      <h3 className="text-base font-bold text-[#1A1A1A] truncate">{job.title}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-[#666666]">
                        {job.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>}
                        {job.employment_type && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {job.employment_type}</span>}
                        {experienceLabel(job) && <span>{experienceLabel(job)}</span>}
                        {salaryLabel(job) && <span>{salaryLabel(job)}</span>}
                      </div>
                      {job.required_skills && job.required_skills.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {job.required_skills.slice(0, 6).map((s) => (
                            <span key={s} className="text-[10px] bg-[#F3F2EF] text-[#666666] px-2 py-0.5 rounded-full">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3.5 pt-3.5 border-t border-[#E5E7EB]">
                    {decision === 1 ? (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-[#27AE60]"><Check className="w-3.5 h-3.5" /> Interested</span>
                    ) : decision === 0 ? (
                      <span className="text-xs font-semibold text-[#999999]">Passed</span>
                    ) : (
                      <>
                        <button
                          onClick={(e) => handleDecision(e, job.id, 'swipe_right')}
                          className="flex items-center gap-1.5 text-xs font-semibold text-[#27AE60] border border-[#27AE60] hover:bg-[#E5F5E5] px-3 py-1.5 rounded-full transition-colors cursor-pointer"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" /> Interested
                        </button>
                        <button
                          onClick={(e) => handleDecision(e, job.id, 'swipe_left')}
                          className="flex items-center gap-1.5 text-xs font-semibold text-[#666666] border border-[#E5E7EB] hover:bg-[#F3F2EF] px-3 py-1.5 rounded-full transition-colors cursor-pointer"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" /> Pass
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between mt-6 text-xs text-[#666666]">
            <span>Page {page} of {totalPages} ({total} total jobs)</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F3F2EF] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F3F2EF] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
