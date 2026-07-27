import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Building2, X, Loader2 } from 'lucide-react';

interface JobResult {
  id: number;
  title: string;
  location: string | null;
  company_name: string;
  company_logo_url: string | null;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

// Global job search reachable from every tab via the nav bar - reuses the EXISTING
// GET /api/candidate-jobs?search= endpoint (already supports title/summary/company ILIKE
// search server-side, see db.ts's getOpenJobsPublic) and the EXISTING job-detail navigation
// (onSelectJob), so this is purely a new frontend entry point onto already-built, unmodified
// backend logic - no new endpoint, no schema change.
export default function CandidateNavSearch({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JobResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidate-jobs?search=${encodeURIComponent(q)}&pageSize=6`);
      const data = await res.json();
      setResults(res.ok ? data.jobs : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMobileExpanded(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setMobileExpanded(false); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const selectJob = (id: number) => {
    onSelectJob(id);
    setQuery('');
    setResults([]);
    setOpen(false);
    setMobileExpanded(false);
  };

  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;

  const dropdown = showDropdown ? (
    <div className="absolute top-full mt-2 left-0 right-0 bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_12px_28px_-8px_rgba(0,0,0,0.15)] overflow-hidden z-30 max-h-80 overflow-y-auto">
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-4 h-4 text-[#27AE60] animate-spin" />
        </div>
      ) : results.length === 0 ? (
        <p className="text-xs text-[#888888] text-center py-6 px-4">No jobs match "{query.trim()}".</p>
      ) : (
        results.map((job) => (
          <button
            key={job.id}
            onClick={() => selectJob(job.id)}
            className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer border-b border-[#F5F5F5] last:border-b-0"
          >
            {job.company_logo_url ? (
              <img src={job.company_logo_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-[#F3F2EF] flex items-center justify-center flex-shrink-0"><Building2 className="w-3.5 h-3.5 text-[#888888]" /></div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#1A1A1A] truncate">{job.title}</p>
              <p className="text-[10px] text-[#888888] truncate">{job.company_name}{job.location ? ` · ${job.location}` : ''}</p>
            </div>
          </button>
        ))
      )}
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative flex items-center justify-end">
      {/* Desktop: inline search field - only from lg: up, since sm-lg is too tight once the
          nav labels are also showing at that range (see CandidateApp.tsx's own lg: switch). */}
      <div className="hidden lg:block relative w-[110px] xl:w-[240px]">
        <Search className="w-3.5 h-3.5 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search jobs..."
          aria-label="Search jobs"
          className="w-full bg-[#F3F2EF] border border-transparent focus:border-[#27AE60] focus:bg-white rounded-full py-2 pl-9 pr-3 text-xs font-medium text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none transition-colors"
        />
        {dropdown}
      </div>

      {/* Mobile/tablet (below lg:): icon toggle -> full-width expanding field */}
      <div className="lg:hidden">
        {!mobileExpanded ? (
          <button
            onClick={() => setMobileExpanded(true)}
            aria-label="Search jobs"
            className="w-6 h-6 rounded-full flex items-center justify-center border border-transparent text-[#666666] hover:bg-[#F3F2EF] hover:border-[#E5E7EB] transition-all cursor-pointer flex-shrink-0"
          >
            <Search className="w-4 h-4" />
          </button>
        ) : (
          <div className="fixed inset-x-0 top-16 p-3 bg-white border-b border-[#E5E7EB] shadow-md z-20">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setOpen(true)}
                placeholder="Search jobs..."
                aria-label="Search jobs"
                className="w-full bg-[#F3F2EF] border border-transparent focus:border-[#27AE60] focus:bg-white rounded-full py-2.5 pl-9 pr-9 text-xs font-medium text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none transition-colors"
              />
              <button
                onClick={() => { setMobileExpanded(false); setOpen(false); setQuery(''); }}
                aria-label="Close search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999999] hover:text-[#1A1A1A] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {showDropdown && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_12px_28px_-8px_rgba(0,0,0,0.15)] overflow-hidden z-30 max-h-80 overflow-y-auto">
                  {loading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-4 h-4 text-[#27AE60] animate-spin" />
                    </div>
                  ) : results.length === 0 ? (
                    <p className="text-xs text-[#888888] text-center py-6 px-4">No jobs match "{query.trim()}".</p>
                  ) : (
                    results.map((job) => (
                      <button
                        key={job.id}
                        onClick={() => selectJob(job.id)}
                        className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer border-b border-[#F5F5F5] last:border-b-0"
                      >
                        {job.company_logo_url ? (
                          <img src={job.company_logo_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-[#F3F2EF] flex items-center justify-center flex-shrink-0"><Building2 className="w-3.5 h-3.5 text-[#888888]" /></div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#1A1A1A] truncate">{job.title}</p>
                          <p className="text-[10px] text-[#888888] truncate">{job.company_name}{job.location ? ` · ${job.location}` : ''}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
