import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Building2, MapPin, Clock, Heart, CheckCircle2, XCircle, HourglassIcon, ChevronRight, ListChecks, Timer } from 'lucide-react';

interface LikedJob {
  id: number;
  job_id: number;
  timestamp: string;
  job_title: string;
  location: string | null;
  company_name: string;
  company_logo_url: string | null;
  status?: 'waiting' | 'interested' | 'rejected' | 'expired';
}

type StatusFilter = 'all' | 'waiting' | 'interested' | 'rejected' | 'expired';
type SortBy = 'recent' | 'company' | 'location';

const STATUS_STYLE: Record<NonNullable<LikedJob['status']>, { label: string; short: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  waiting: { label: 'Waiting for recruiter review', short: 'Waiting', color: '#8A6314', bg: '#FBF3DC', border: '#E0C070', icon: <HourglassIcon className="w-3 h-3" /> },
  interested: { label: 'Recruiter interested', short: 'Interested', color: '#1E8449', bg: '#E5F5E5', border: '#A8E6C1', icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected: { label: 'Rejected', short: 'Rejected', color: '#C0392B', bg: '#FFE5E5', border: '#F0B8B8', icon: <XCircle className="w-3 h-3" /> },
  expired: { label: 'Expired', short: 'Expired', color: '#666666', bg: '#F3F2EF', border: '#E0E0E0', icon: <Clock className="w-3 h-3" /> },
};

// Dedicated visual language for the 5 top stat cards only - deliberately separate from
// STATUS_STYLE above (which drives the job-list badges further down this page and must stay
// exactly as it is). The spec here calls for a distinct "soft blue" for Interested at the card
// level, which would otherwise collide with STATUS_STYLE's green if reused.
const STAT_CARD_META: Record<StatusFilter, { icon: React.ReactNode; iconBg: string; iconColor: string; activeBg: string; activeBorder: string; hoverBorder: string }> = {
  all: { icon: <Heart className="w-4 h-4" />, iconBg: 'bg-[#E5F5E5]', iconColor: 'text-[#1E8449]', activeBg: 'bg-[#F0FAF3]', activeBorder: 'border-[#27AE60]', hoverBorder: 'hover:border-[#A8E6C1]' },
  waiting: { icon: <Clock className="w-4 h-4" />, iconBg: 'bg-[#FBF3DC]', iconColor: 'text-[#8A6314]', activeBg: 'bg-[#FFFBF0]', activeBorder: 'border-[#D9A441]', hoverBorder: 'hover:border-[#E8CE8F]' },
  interested: { icon: <CheckCircle2 className="w-4 h-4" />, iconBg: 'bg-[#E3EEFC]', iconColor: 'text-[#1D5FA8]', activeBg: 'bg-[#F2F8FF]', activeBorder: 'border-[#3B82F6]', hoverBorder: 'hover:border-[#B9D6F5]' },
  rejected: { icon: <XCircle className="w-4 h-4" />, iconBg: 'bg-[#FFE5E5]', iconColor: 'text-[#C0392B]', activeBg: 'bg-[#FFF6F6]', activeBorder: 'border-[#E0685C]', hoverBorder: 'hover:border-[#F0B8B8]' },
  expired: { icon: <Timer className="w-4 h-4" />, iconBg: 'bg-[#EDEDED]', iconColor: 'text-[#666666]', activeBg: 'bg-[#F7F7F7]', activeBorder: 'border-[#9CA3AF]', hoverBorder: 'hover:border-[#D5D5D5]' },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'C';
}

const AVATAR_TINTS = [
  { bg: '#E5F5E5', text: '#1E8449' },
  { bg: '#E3EEFC', text: '#1D5FA8' },
  { bg: '#FBF3DC', text: '#8A6314' },
  { bg: '#F5E6F5', text: '#8A3A8A' },
  { bg: '#FFE9E0', text: '#B8541F' },
];
function avatarTint(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Likes tab: the "liked" jobs list already existed as CandidateDecisions.tsx's "Interested" tab
// (GET /candidate-decisions/active?action=1, unchanged) - this redesign adds a per-job status
// (from the new GET /candidate-decisions/status/:jobId, itself derived from existing
// candidates+swipes data, see db.ts's getRecruiterDecisionForCandidateJob) plus client-side
// filtering/search, matching the pattern CandidateApplications.tsx already uses for its tabs.
export default function CandidateLikes({ onSelectJob, onViewApplications }: { onSelectJob: (id: number) => void; onViewApplications?: () => void }) {
  const [jobs, setJobs] = useState<LikedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/candidate-decisions/active?action=1');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load likes');
      const base: LikedJob[] = data.decisions;

      const withStatus = await Promise.all(
        base.map(async (job) => {
          try {
            const statusRes = await fetch(`/api/candidate-decisions/status/${job.job_id}`);
            const statusData = statusRes.ok ? await statusRes.json() : { status: 'waiting' };
            return { ...job, status: statusData.status };
          } catch {
            return { ...job, status: 'waiting' as const };
          }
        })
      );
      setJobs(withStatus);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: jobs.length, waiting: 0, interested: 0, rejected: 0, expired: 0 };
    for (const j of jobs) {
      const s = j.status || 'waiting';
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    let list = jobs;
    if (statusFilter !== 'all') list = list.filter((j) => (j.status || 'waiting') === statusFilter);
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      list = list.filter((j) => j.job_title.toLowerCase().includes(term) || j.company_name.toLowerCase().includes(term));
    }
    const sorted = [...list];
    if (sortBy === 'company') sorted.sort((a, b) => a.company_name.localeCompare(b.company_name));
    else if (sortBy === 'location') sorted.sort((a, b) => (a.location || '').localeCompare(b.location || ''));
    else sorted.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return sorted;
  }, [jobs, statusFilter, search, sortBy]);

  const statCards: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All Liked', count: counts.all },
    { id: 'waiting', label: 'Waiting', count: counts.waiting },
    { id: 'interested', label: 'Interested', count: counts.interested },
    { id: 'rejected', label: 'Rejected', count: counts.rejected },
    { id: 'expired', label: 'Expired', count: counts.expired },
  ];

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white shadow-sm border border-[#E5E7EB] flex items-center justify-center flex-shrink-0">
              <Heart className="w-5 h-5 text-[#27AE60]" fill="currentColor" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1A1A1A] tracking-tight">Likes</h1>
              <p className="text-[#888888] text-xs mt-0.5">Jobs you've shown interest in, and where things stand.</p>
            </div>
          </div>
          {onViewApplications && (
            <button onClick={onViewApplications} className="flex items-center gap-1 text-xs font-semibold text-[#27AE60] hover:text-[#1E8449] bg-white border border-[#E5E7EB] hover:border-[#A8E6C1] px-3 py-2 rounded-full cursor-pointer whitespace-nowrap transition-colors flex-shrink-0">
              Applications <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Stat cards double as status filters - counts computed from the same data already
            loaded for the list below, no extra request. */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6">
          {statCards.map((s) => {
            const active = statusFilter === s.id;
            const meta = STAT_CARD_META[s.id];
            return (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id)}
                className={`text-left rounded-2xl p-4 sm:p-5 transition-all duration-200 cursor-pointer ${
                  active
                    ? `border-2 ${meta.activeBorder} ${meta.activeBg} shadow-[0_10px_24px_-10px_rgba(0,0,0,0.18)]`
                    : `border border-[#EDEDED] bg-white ${meta.hoverBorder} hover:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.1)] hover:-translate-y-0.5`
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${meta.iconBg} ${meta.iconColor}`}>
                  {meta.icon}
                </div>
                <p className="text-2xl sm:text-3xl font-black leading-none tracking-tight text-[#1A1A1A]">{s.count}</p>
                <p className="text-xs font-semibold mt-2 text-[#666666] truncate">{s.label}</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
          <div className="flex-1 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#999999]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by job title or company..."
              className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-[#E5E7EB] rounded-full text-sm focus:outline-none focus:border-[#27AE60] focus:ring-1 focus:ring-[#27AE60] transition-colors"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-white border border-[#E5E7EB] rounded-full text-sm font-medium px-4 py-2.5 focus:outline-none focus:border-[#27AE60] cursor-pointer"
          >
            <option value="recent">Most Recent</option>
            <option value="company">Company A-Z</option>
            <option value="location">Location A-Z</option>
          </select>
        </div>

        {error && <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium mb-4">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#F3F2EF] flex items-center justify-center mx-auto mb-4">
              <ListChecks className="w-6 h-6 text-[#999999]" />
            </div>
            <p className="text-sm font-bold text-[#1A1A1A]">
              {jobs.length === 0 ? "You haven't liked any jobs yet" : 'Nothing matches your filters'}
            </p>
            <p className="text-xs text-[#888888] mt-1.5">
              {jobs.length === 0 ? 'Head to Explore to start discovering roles.' : 'Try a different search term or status.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((job) => {
              const style = STATUS_STYLE[job.status || 'waiting'];
              const tint = avatarTint(job.company_name);
              return (
                <button
                  key={job.job_id}
                  onClick={() => onSelectJob(job.job_id)}
                  className="group w-full text-left bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-4 hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.12)] hover:border-[#E5E7EB] transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    {job.company_logo_url ? (
                      <img src={job.company_logo_url} alt="" className="w-12 h-12 rounded-2xl object-cover flex-shrink-0 ring-1 ring-black/5" />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-sm ring-1 ring-black/5"
                        style={{ backgroundColor: tint.bg, color: tint.text }}
                      >
                        {initials(job.company_name)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[#1A1A1A] truncate">{job.job_title}</p>
                      <div className="flex items-center gap-1.5 text-xs text-[#888888] mt-0.5">
                        <Building2 className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{job.company_name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                        {job.location && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#999999]"><MapPin className="w-2.5 h-2.5" /> {job.location}</span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#999999]"><Clock className="w-2.5 h-2.5" /> Liked {relativeDate(job.timestamp)}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span
                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border"
                        style={{ color: style.color, backgroundColor: style.bg, borderColor: style.border }}
                      >
                        {style.icon} <span className="hidden sm:inline">{style.short}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-[#CCCCCC] group-hover:text-[#999999] group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
