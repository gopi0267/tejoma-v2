import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Briefcase, Building2, X, Heart, Bookmark, Eye, Clock, Sparkles, Wallet, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { postCandidateDecision } from '../utils/candidateDecisions.js';

// Explore tab: one job card at a time, Tinder-inspired interaction (swipe right = Interested,
// swipe left = Not Interested) over the EXISTING candidate-jobs/candidate-decisions endpoints -
// postCandidateDecision below is the same, unmodified util CandidateJobDiscovery.tsx already
// used. Original card design (not a Tinder UI clone): Tejoma green, rounded, generous spacing.
interface ExploreJob {
  id: number;
  title: string;
  description: string | null;
  job_summary?: string | null;
  required_skills: string[] | null;
  experience_years: number | null;
  min_experience: number | null;
  max_experience: number | null;
  location: string | null;
  remote_type?: string | null;
  department?: string | null;
  employment_type: string | null;
  salary_min: string | null;
  salary_max: string | null;
  salary_currency: string | null;
  company_name: string;
  company_logo_url: string | null;
  created_at: string;
  match_score?: number | null;
}

const PAGE_SIZE = 20;
const SWIPE_THRESHOLD = 110;

function experienceLabel(job: ExploreJob): string | null {
  if (job.min_experience != null || job.max_experience != null) {
    if (job.min_experience != null && job.max_experience != null) return `${job.min_experience}-${job.max_experience} yrs`;
    return `${job.min_experience ?? job.max_experience} yrs`;
  }
  if (job.experience_years) return `${job.experience_years}+ yrs`;
  return null;
}

function salaryLabel(job: ExploreJob): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const currency = job.salary_currency || '';
  if (job.salary_min && job.salary_max) return `${currency} ${job.salary_min} - ${job.salary_max}`;
  return `${currency} ${job.salary_min || job.salary_max}`;
}

function postingAge(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 30) return `Posted ${days}d ago`;
  return `Posted ${Math.floor(days / 30)}mo ago`;
}

// Tiered so a glance at the ring color alone signals fit, same idea as a lot of ATS "match"
// gauges - a flat single-color circle didn't distinguish a 90% fit from a 25% one.
function matchTier(score: number): { ring: string; text: string; bg: string } {
  if (score >= 70) return { ring: '#27AE60', text: '#1E8449', bg: '#E5F5E5' };
  if (score >= 40) return { ring: '#E0A030', text: '#8A6314', bg: '#FBF3DC' };
  return { ring: '#B0B0B0', text: '#6B6B6B', bg: '#F3F2EF' };
}

function MatchRing({ score }: { score: number }) {
  const tier = matchTier(score);
  const size = 56;
  const stroke = 4.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EDEDED" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={tier.ring} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[13px] font-black leading-none" style={{ color: tier.text }}>{score}%</span>
        <span className="text-[7px] font-bold uppercase tracking-wide mt-0.5" style={{ color: tier.text }}>Match</span>
      </div>
    </div>
  );
}

export default function CandidateExplore({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [jobs, setJobs] = useState<ExploreJob[]>([]);
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(true);

  const cardRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; dragging: boolean } | null>(null);
  const [dragX, setDragX] = useState(0);

  const loadJobs = useCallback(async (pageToLoad: number, append: boolean) => {
    setLoading(!append);
    setError('');
    try {
      const [jobsRes, decisionsRes] = await Promise.all([
        fetch(`/api/candidate-jobs?page=${pageToLoad}&pageSize=${PAGE_SIZE}`),
        fetch('/api/candidate-decisions/active'),
      ]);
      const jobsData = await jobsRes.json();
      if (!jobsRes.ok) throw new Error(jobsData.error || 'Failed to load jobs');
      const decisionsData = decisionsRes.ok ? await decisionsRes.json() : { decisions: [] };
      const decidedIds = new Set<number>((decisionsData.decisions || []).map((d: any) => d.job_id));
      const fresh = (jobsData.jobs as ExploreJob[]).filter((j) => !decidedIds.has(j.id));

      setJobs((prev) => (append ? [...prev, ...fresh] : fresh));
      setHasMore(jobsData.jobs.length === PAGE_SIZE);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(1, false); }, [loadJobs]);

  // Fetch the next page a couple of cards before running out, so the deck never visibly stalls.
  useEffect(() => {
    if (!loading && hasMore && index >= jobs.length - 3 && jobs.length > 0) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadJobs(nextPage, true);
    }
  }, [index, jobs.length, hasMore, loading, page, loadJobs]);

  const current = jobs[index];

  const advance = useCallback((direction: 'left' | 'right') => {
    setExitDirection(direction);
    setTimeout(() => {
      setIndex((i) => i + 1);
      setExitDirection(null);
      setDragX(0);
    }, 220);
  }, []);

  const decide = useCallback(async (jobId: number, direction: 'left' | 'right') => {
    advance(direction);
    await postCandidateDecision(jobId, direction === 'right' ? 'swipe_right' : 'swipe_left');
  }, [advance]);

  const toggleSave = (jobId: number) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  // ==================== Keyboard shortcuts ====================
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!current || exitDirection) return;
      if (e.key === 'ArrowRight') decide(current.id, 'right');
      if (e.key === 'ArrowLeft') decide(current.id, 'left');
      if (e.key === 'ArrowUp') { e.preventDefault(); onSelectJob(current.id); }
      if (e.key === 'ArrowDown') { e.preventDefault(); toggleSave(current.id); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [current, exitDirection, decide, onSelectJob, toggleSave]);

  // ==================== Pointer drag (mouse on desktop, touch on mobile - same handlers) ====================
  const onPointerDown = (e: React.PointerEvent) => {
    if (exitDirection) return;
    dragState.current = { startX: e.clientX, dragging: true };
    cardRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current?.dragging) return;
    setDragX(e.clientX - dragState.current.startX);
  };
  const onPointerUp = () => {
    if (!dragState.current?.dragging || !current) return;
    dragState.current.dragging = false;
    if (dragX > SWIPE_THRESHOLD) {
      decide(current.id, 'right');
    } else if (dragX < -SWIPE_THRESHOLD) {
      decide(current.id, 'left');
    } else {
      setDragX(0);
    }
  };

  const rotation = dragX / 18;
  const cardTransform = exitDirection
    ? `translateX(${exitDirection === 'right' ? 600 : -600}px) rotate(${exitDirection === 'right' ? 30 : -30}deg)`
    : `translateX(${dragX}px) rotate(${rotation}deg)`;

  // Peek of the next 2 cards behind the active one, purely decorative (pointer-events-none) -
  // signals "this is a deck" the way real swipe UIs do, instead of one card floating alone.
  const stackPeek = jobs.slice(index + 1, index + 3);
  const remaining = Math.max(jobs.length - index - 1, 0);

  return (
    <div className="min-h-screen p-4 sm:p-8 flex flex-col items-center" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Explore</h1>
          <p className="text-[#888888] text-xs mt-1.5">Swipe right if you wish to apply — arrow keys work too.</p>
        </div>

        {error && <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium mb-4">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
          </div>
        ) : !current ? (
          <div className="bg-white rounded-3xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.12)] border border-[#E5E7EB] p-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#E5F5E5] flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-[#27AE60]" />
            </div>
            <p className="text-base font-bold text-[#1A1A1A]">You're all caught up!</p>
            <p className="text-xs text-[#888888] mt-1.5 leading-relaxed">Check back later for new roles, or review what you've liked in the Likes tab.</p>
          </div>
        ) : (
          <>
            <div className="relative" style={{ touchAction: 'pan-y' }}>
              {/* Stacked deck peek - reverse order so the nearest-next card sits on top */}
              {[...stackPeek].reverse().map((job, i) => {
                const depth = stackPeek.length - i;
                return (
                  <div
                    key={job.id}
                    aria-hidden="true"
                    className="absolute inset-0 bg-white rounded-[28px] border border-[#E5E7EB] pointer-events-none"
                    style={{
                      transform: `translateY(${depth * 18}px) scale(${1 - depth * 0.025})`,
                      opacity: 1 - depth * 0.3,
                      boxShadow: '0 10px 24px -12px rgba(0,0,0,0.1)',
                      zIndex: 10 - depth,
                    }}
                  />
                );
              })}

              <div
                ref={cardRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="relative bg-white rounded-[28px] border border-[#E5E7EB] overflow-hidden cursor-grab active:cursor-grabbing select-none"
                style={{
                  transform: cardTransform,
                  transition: dragState.current?.dragging ? 'none' : 'transform 0.22s ease-out',
                  opacity: exitDirection ? 0 : 1,
                  boxShadow: '0 14px 34px -14px rgba(0,0,0,0.2), 0 2px 6px -2px rgba(0,0,0,0.06)',
                  zIndex: 20,
                }}
              >
                <div className="h-1.5 bg-gradient-to-r from-[#27AE60] to-[#1E8449]" />

                <div className="p-6 sm:p-7">
                  {dragX > 30 && (
                    <span className="absolute top-6 left-6 text-[#27AE60] bg-white border-2 border-[#27AE60] rounded-lg px-3 py-1 text-xs font-black uppercase tracking-wider -rotate-12 shadow-sm" style={{ opacity: Math.min(dragX / SWIPE_THRESHOLD, 1) }}>
                      Interested
                    </span>
                  )}
                  {dragX < -30 && (
                    <span className="absolute top-6 right-6 text-[#E74C3C] bg-white border-2 border-[#E74C3C] rounded-lg px-3 py-1 text-xs font-black uppercase tracking-wider rotate-12 shadow-sm" style={{ opacity: Math.min(-dragX / SWIPE_THRESHOLD, 1) }}>
                      Pass
                    </span>
                  )}

                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {current.company_logo_url ? (
                        <img src={current.company_logo_url} alt="" className="w-12 h-12 rounded-2xl object-cover flex-shrink-0 ring-1 ring-black/5" />
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-[#F3F2EF] flex items-center justify-center flex-shrink-0 ring-1 ring-black/5"><Building2 className="w-5 h-5 text-[#888888]" /></div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A1A] truncate">{current.company_name}</p>
                        {current.department && <p className="text-[11px] text-[#999999] truncate mt-0.5">{current.department}</p>}
                      </div>
                    </div>
                    {current.match_score != null && <MatchRing score={current.match_score} />}
                  </div>

                  <h2 className="text-[26px] font-bold text-[#1A1A1A] mt-5 leading-[1.15] tracking-tight">{current.title}</h2>

                  <div className="flex flex-wrap items-center gap-1.5 mt-3.5">
                    {current.location && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4A4A4A] bg-[#F8F9FA] border border-[#E5E7EB] px-2.5 py-1.5 rounded-full"><MapPin className="w-3 h-3 text-[#999999]" /> {current.location}</span>
                    )}
                    {current.remote_type && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4A4A4A] bg-[#F8F9FA] border border-[#E5E7EB] px-2.5 py-1.5 rounded-full capitalize"><Briefcase className="w-3 h-3 text-[#999999]" /> {current.remote_type}</span>
                    )}
                    {experienceLabel(current) && (
                      <span className="inline-flex items-center text-xs font-medium text-[#4A4A4A] bg-[#F8F9FA] border border-[#E5E7EB] px-2.5 py-1.5 rounded-full">{experienceLabel(current)}</span>
                    )}
                  </div>

                  {salaryLabel(current) && (
                    <div className="inline-flex items-center gap-1.5 mt-3 text-sm font-bold text-[#1E8449] bg-[#E5F5E5] border border-[#A8E6C1] px-3 py-1.5 rounded-full">
                      <Wallet className="w-3.5 h-3.5" /> {salaryLabel(current)}
                    </div>
                  )}

                  {(current.job_summary || current.description) && (
                    <p className="text-[13.5px] text-[#5A5A5A] mt-4 leading-relaxed line-clamp-3">{current.job_summary || current.description}</p>
                  )}

                  {current.required_skills && current.required_skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {current.required_skills.slice(0, 6).map((s) => (
                        <span key={s} className="text-[11px] font-medium bg-white text-[#4A4A4A] border border-[#E5E7EB] px-2.5 py-1 rounded-lg">{s}</span>
                      ))}
                      {current.required_skills.length > 6 && (
                        <span className="text-[11px] font-medium text-[#999999] px-2.5 py-1">+{current.required_skills.length - 6} more</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#F3F2EF]">
                    <p className="text-[11px] text-[#999999] flex items-center gap-1.5"><Clock className="w-3 h-3" /> {postingAge(current.created_at)}</p>
                    {remaining > 0 && <p className="text-[11px] text-[#999999] font-medium">{remaining} more today</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => decide(current.id, 'left')}
                aria-label="Not Interested"
                className="w-14 h-14 rounded-full bg-white shadow-[0_8px_20px_-6px_rgba(231,76,60,0.25)] border border-[#F0DEDE] flex items-center justify-center text-[#E74C3C] hover:bg-[#FFE5E5] hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <X className="w-6 h-6" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => toggleSave(current.id)}
                aria-label="Save"
                className={`w-11 h-11 rounded-full shadow-md border flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer ${savedIds.has(current.id) ? 'bg-[#FBF3DC] border-[#E0C070] text-[#B8860B]' : 'bg-white border-[#E5E7EB] text-[#666666] hover:bg-[#F3F2EF]'
                  }`}
              >
                <Bookmark className="w-4 h-4" fill={savedIds.has(current.id) ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => onSelectJob(current.id)}
                aria-label="View Details"
                className="w-11 h-11 rounded-full bg-white shadow-md border border-[#E5E7EB] flex items-center justify-center text-[#666666] hover:bg-[#F3F2EF] hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                onClick={() => decide(current.id, 'right')}
                aria-label="Interested"
                className="w-14 h-14 rounded-full bg-gradient-to-br from-[#27AE60] to-[#1E8449] shadow-[0_8px_20px_-6px_rgba(39,174,96,0.5)] flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <Heart className="w-6 h-6" fill="currentColor" />
              </button>
            </div>

            {/* Keyboard shortcuts legend - desktop only (arrow keys are meaningless on touch),
                mirrors the four buttons above exactly (Pass/Save/View Details/Interested) rather
                than inventing shortcuts for features this deck doesn't have (no undo, no
                multi-photo cards). Dismissible, matching the reference pattern's "Hide" toggle. */}
            <div className="hidden sm:flex justify-center mt-5">
              {showShortcuts ? (
                <div className="flex items-center gap-2 bg-white border border-[#E5E7EB] rounded-full pl-2 pr-1 py-1 shadow-sm">
                  <div className="flex items-center gap-3 px-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#666666]">
                      <span className="w-6 h-6 rounded-md bg-[#F3F2EF] border border-[#E5E7EB] flex items-center justify-center text-[#4A4A4A]"><ArrowLeft className="w-3 h-3" /></span>
                      Pass
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#666666]">
                      <span className="w-6 h-6 rounded-md bg-[#F3F2EF] border border-[#E5E7EB] flex items-center justify-center text-[#4A4A4A]"><ArrowUp className="w-3 h-3" /></span>
                      View Details
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#666666]">
                      <span className="w-6 h-6 rounded-md bg-[#F3F2EF] border border-[#E5E7EB] flex items-center justify-center text-[#4A4A4A]"><ArrowDown className="w-3 h-3" /></span>
                      Save
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#666666]">
                      <span className="w-6 h-6 rounded-md bg-[#F3F2EF] border border-[#E5E7EB] flex items-center justify-center text-[#4A4A4A]"><ArrowRight className="w-3 h-3" /></span>
                      Interested
                    </span>
                  </div>
                  <button
                    onClick={() => setShowShortcuts(false)}
                    className="text-[10px] font-bold text-[#999999] hover:text-[#666666] bg-[#F3F2EF] hover:bg-[#EDEDED] rounded-full px-3 py-1.5 transition-colors cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowShortcuts(true)}
                  className="text-[11px] font-medium text-[#999999] hover:text-[#666666] cursor-pointer"
                >
                  Show keyboard shortcuts
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
