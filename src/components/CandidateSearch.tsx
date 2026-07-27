/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Filter, X, Bookmark, BookmarkCheck, Eye, MapPin, Briefcase, GraduationCap,
  Award, Wrench, Languages, Clock, IndianRupee, TrendingUp, Loader, UserSearch,
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch.js';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint.js';

type PipelineTab = 'all' | 'saved' | 'recently-viewed' | 'shortlisted';

interface SearchResult {
  id: number;
  name: string;
  headline: string | null;
  skills: string[];
  years_of_experience: string | null;
  location: string | null;
  current_company: string | null;
  education: string | null;
  certifications: string[];
  tools: string[];
  languages: string[];
  notice_period: string | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  open_to_work: boolean;
  profile_strength: { percent: number; missing: string[] };
  profile_updated_at: string;
  last_active: string | null;
  match_score: number | null;
  saved: boolean;
}

interface ProfileDetail extends Omit<SearchResult, 'saved' | 'match_score'> {
  summary: string | null;
}

const EXPERIENCE_BANDS: { label: string; min?: number; max?: number }[] = [
  { label: 'Any experience' },
  { label: '0-1 years', min: 0, max: 1 },
  { label: '1-3 years', min: 1, max: 3 },
  { label: '3-5 years', min: 3, max: 5 },
  { label: '5-8 years', min: 5, max: 8 },
  { label: '8+ years', min: 8 },
];

const TABS: { id: PipelineTab; label: string }[] = [
  { id: 'all', label: 'All Candidates' },
  { id: 'saved', label: 'Saved Candidates' },
  { id: 'recently-viewed', label: 'Recently Viewed' },
  { id: 'shortlisted', label: 'Shortlisted Candidates' },
];

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StrengthBar({ percent }: { percent: number }) {
  const color = percent >= 80 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[11px] font-semibold text-slate-600 tabular-nums">{percent}%</span>
    </div>
  );
}

export default function CandidateSearch() {
  const { isMobile } = useResponsiveBreakpoint();
  const [tab, setTab] = useState<PipelineTab>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<ProfileDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Search + filter state
  const [q, setQ] = useState('');
  const [skills, setSkills] = useState('');
  const [location, setLocation] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [education, setEducation] = useState('');
  const [certifications, setCertifications] = useState('');
  const [tools, setTools] = useState('');
  const [languages, setLanguages] = useState('');
  const [noticePeriod, setNoticePeriod] = useState('');
  const [experienceBand, setExperienceBand] = useState(0);
  const [openToWork, setOpenToWork] = useState(false);
  const [minProfileStrength, setMinProfileStrength] = useState(0);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (skills) params.set('skills', skills);
    if (location) params.set('location', location);
    if (currentCompany) params.set('currentCompany', currentCompany);
    if (jobTitle) params.set('jobTitle', jobTitle);
    if (education) params.set('education', education);
    if (certifications) params.set('certifications', certifications);
    if (tools) params.set('tools', tools);
    if (languages) params.set('languages', languages);
    if (noticePeriod) params.set('noticePeriod', noticePeriod);
    const band = EXPERIENCE_BANDS[experienceBand];
    if (band.min !== undefined) params.set('minExperience', String(band.min));
    if (band.max !== undefined) params.set('maxExperience', String(band.max));
    if (openToWork) params.set('openToWork', 'true');
    if (minProfileStrength > 0) params.set('minProfileStrength', String(minProfileStrength));
    return params;
  }, [q, skills, location, currentCompany, jobTitle, education, certifications, tools, languages, noticePeriod, experienceBand, openToWork, minProfileStrength]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const endpoint = tab === 'all'
        ? `/api/candidate-search?${buildQueryParams().toString()}`
        : `/api/candidate-search/tab/${tab}`;
      const res = await apiFetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setResults(data.candidates || []);
      setTotal(data.total ?? data.candidates?.length ?? 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, buildQueryParams]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab !== 'all') setTab('all');
    else load();
  };

  const toggleSave = async (candidate: SearchResult, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if (candidate.saved) {
        await apiFetch(`/api/candidate-search/${candidate.id}/save`, { method: 'DELETE' });
      } else {
        await apiFetch(`/api/candidate-search/${candidate.id}/save`, { method: 'POST' });
      }
      setResults((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, saved: !c.saved } : c)));
      if (tab === 'saved') load();
    } catch {
      // Non-critical - the toggle just won't stick this click; user can retry.
    }
  };

  const openProfile = async (candidateId: number) => {
    setDetailLoading(true);
    setSelected(null);
    try {
      const res = await apiFetch(`/api/candidate-search/${candidateId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load profile');
      setSelected(data.candidate);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const clearFilters = () => {
    setSkills(''); setLocation(''); setCurrentCompany(''); setJobTitle(''); setEducation('');
    setCertifications(''); setTools(''); setLanguages(''); setNoticePeriod('');
    setExperienceBand(0); setOpenToWork(false); setMinProfileStrength(0);
  };

  return (
    <div className="h-full w-full flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-8 py-4 sm:py-6 bg-white border-b border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <UserSearch className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Candidate Search</h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">Search the talent database - candidates who've registered and opted into recruiter visibility</p>
          </div>
        </div>
      </div>

      {/* Pipeline tabs */}
      <div className="px-4 sm:px-8 pt-4 bg-white border-b border-slate-200 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg cursor-pointer transition-colors whitespace-nowrap border-b-2 ${
              tab === t.id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search bar + filters (only meaningful on the "All Candidates" tab) */}
      {tab === 'all' && (
        <div className="px-4 sm:px-8 py-4 bg-white border-b border-slate-200">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, headline, location, company..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-lg cursor-pointer transition-colors min-h-[44px] ${
                showFilters ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Filter className="w-4 h-4" /> Filters
            </button>
            <button
              type="submit"
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg cursor-pointer transition-colors min-h-[44px]"
            >
              Search
            </button>
          </form>

          {showFilters && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Skills (comma-separated)</label>
                <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, Node.js" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Location</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bengaluru" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Current Company</label>
                <input value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} placeholder="Infosys" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Job Title</label>
                <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Backend Engineer" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Education</label>
                <input value={education} onChange={(e) => setEducation(e.target.value)} placeholder="B.Tech" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Certifications</label>
                <input value={certifications} onChange={(e) => setCertifications(e.target.value)} placeholder="AWS Certified" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tools</label>
                <input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="Docker, Jira" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Languages</label>
                <input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Hindi" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Experience</label>
                <select value={experienceBand} onChange={(e) => setExperienceBand(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                  {EXPERIENCE_BANDS.map((b, i) => <option key={i} value={i}>{b.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notice Period</label>
                <input value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)} placeholder="30 days" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Min Profile Strength: {minProfileStrength}%</label>
                <input type="range" min={0} max={100} step={10} value={minProfileStrength} onChange={(e) => setMinProfileStrength(Number(e.target.value))} className="w-full accent-emerald-600 mt-2.5" />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer py-2">
                  <input type="checkbox" checked={openToWork} onChange={(e) => setOpenToWork(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                  <span className="text-sm font-medium text-slate-700">Open To Work only</span>
                </label>
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
                <button type="button" onClick={clearFilters} className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 font-semibold rounded-lg hover:bg-slate-100 cursor-pointer transition-colors text-sm">
                  Clear
                </button>
                <button type="button" onClick={() => load()} className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg cursor-pointer transition-colors text-sm">
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mx-4 sm:mx-8 mt-4 p-3 bg-red-50 text-red-800 border border-red-200 rounded-lg text-sm font-medium">{error}</div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto p-4 sm:p-8">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader className="w-8 h-8 text-emerald-600 animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <UserSearch className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-slate-600 font-semibold text-lg">No candidates found</p>
              <p className="text-slate-500 text-sm mt-2">
                {tab === 'all' ? 'Try adjusting your search or filters' : 'Nothing here yet'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">{total} candidate{total !== 1 ? 's' : ''}</p>
            {isMobile ? (
              <div className="space-y-3">
                {results.map((c) => (
                  <div key={c.id} className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs space-y-3 cursor-pointer" onClick={() => openProfile(c.id)}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-900 text-sm truncate">{c.name}</h4>
                        <p className="text-xs text-slate-600 truncate mt-0.5">{c.headline || '-'}</p>
                      </div>
                      {c.match_score !== null && (
                        <span className="flex-shrink-0 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">{c.match_score}%</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-500">
                      <span className="truncate">{c.location || '-'}</span>
                      <span className="flex-shrink-0 ml-2">{c.years_of_experience || '-'}</span>
                    </div>
                    <StrengthBar percent={c.profile_strength.percent} />
                    <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openProfile(c.id)} className="flex-1 flex items-center justify-center gap-1.5 min-h-[40px] bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg cursor-pointer transition-colors text-xs font-semibold">
                        <Eye className="w-4 h-4" /> View
                      </button>
                      <button onClick={(e) => toggleSave(c, e)} className={`flex-1 flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg cursor-pointer transition-colors text-xs font-semibold ${c.saved ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {c.saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />} {c.saved ? 'Saved' : 'Save'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 overflow-x-auto">
                <div className="grid grid-cols-7 gap-4 px-6 py-3 bg-slate-200 rounded-lg font-semibold text-sm text-slate-700 min-w-[900px]">
                  <div className="min-w-0 col-span-2">Name</div>
                  <div className="min-w-0">Location</div>
                  <div className="min-w-0">Experience</div>
                  <div className="min-w-0">Strength</div>
                  <div className="min-w-0">Last Active</div>
                  <div className="min-w-0">Actions</div>
                </div>
                {results.map((c) => (
                  <div key={c.id} className="grid grid-cols-7 gap-4 px-6 py-4 bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all items-center min-w-[900px] cursor-pointer" onClick={() => openProfile(c.id)}>
                    <div className="min-w-0 col-span-2">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900 truncate">{c.name}</p>
                        {c.open_to_work && <span className="flex-shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">Open</span>}
                        {c.match_score !== null && <span className="flex-shrink-0 text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">{c.match_score}% match</span>}
                      </div>
                      <p className="text-xs text-slate-600 truncate mt-0.5">{c.headline || '-'} {c.current_company ? `@ ${c.current_company}` : ''}</p>
                    </div>
                    <div className="min-w-0 text-sm text-slate-700 truncate">{c.location || '-'}</div>
                    <div className="min-w-0 text-sm text-slate-700 truncate">{c.years_of_experience || '-'}</div>
                    <div className="min-w-0"><StrengthBar percent={c.profile_strength.percent} /></div>
                    <div className="min-w-0 text-xs text-slate-500">{timeAgo(c.last_active)}</div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openProfile(c.id)} className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg cursor-pointer transition-colors" title="View profile">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => toggleSave(c, e)} className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg cursor-pointer transition-colors ${c.saved ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`} title={c.saved ? 'Remove from saved' : 'Save candidate'}>
                        {c.saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ==================== PROFILE DETAIL MODAL ==================== */}
      {(detailLoading || selected) && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => { setSelected(null); }}>
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div className="p-16 flex items-center justify-center"><Loader className="w-8 h-8 text-emerald-600 animate-spin" /></div>
            ) : selected && (
              <>
                <div className="sticky top-0 bg-gradient-to-r from-slate-50 to-slate-100 flex items-center justify-between p-6 border-b border-slate-200">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                    <p className="text-sm text-slate-600 mt-1">{selected.headline || '-'}</p>
                  </div>
                  <button onClick={() => setSelected(null)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-300 rounded-lg transition-colors">
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>

                <div className="p-4 sm:p-8 space-y-6">
                  {/* Activity + strength */}
                  <div className="flex flex-wrap items-center gap-4 pb-4 border-b border-slate-100">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Profile Strength</p>
                      <div className="mt-1.5"><StrengthBar percent={selected.profile_strength.percent} /></div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Profile Updated</p>
                      <p className="text-sm text-slate-800 mt-1.5">{timeAgo(selected.profile_updated_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Active</p>
                      <p className="text-sm text-slate-800 mt-1.5">{timeAgo(selected.last_active)}</p>
                    </div>
                    {selected.open_to_work && (
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">Open To Work</span>
                    )}
                  </div>

                  {selected.profile_strength.missing.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Missing information</p>
                      <p className="text-xs text-amber-700">{selected.profile_strength.missing.join(' · ')}</p>
                    </div>
                  )}

                  {/* Basic info */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Location</p><p className="text-slate-900 font-medium mt-1">{selected.location || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Briefcase className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Experience</p><p className="text-slate-900 font-medium mt-1">{selected.years_of_experience || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Briefcase className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Current Company</p><p className="text-slate-900 font-medium mt-1">{selected.current_company || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <GraduationCap className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Education</p><p className="text-slate-900 font-medium mt-1">{selected.education || '-'}</p></div>
                    </div>
                  </div>

                  {/* Skills */}
                  {selected.skills.length > 0 && (
                    <div className="pt-6 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Skills</p>
                      <div className="flex flex-wrap gap-2">
                        {selected.skills.map((s, i) => <span key={i} className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-medium">{s}</span>)}
                      </div>
                    </div>
                  )}

                  {/* Certifications / tools / languages */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
                    <div className="flex items-start gap-2">
                      <Award className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Certifications</p><p className="text-slate-900 font-medium mt-1">{selected.certifications.join(', ') || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Wrench className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Tools</p><p className="text-slate-900 font-medium mt-1">{selected.tools.join(', ') || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Languages className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Languages</p><p className="text-slate-900 font-medium mt-1">{selected.languages.join(', ') || '-'}</p></div>
                    </div>
                  </div>

                  {/* Compensation */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
                    <div className="flex items-start gap-2">
                      <IndianRupee className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Current CTC</p><p className="text-slate-900 font-medium mt-1">{selected.current_ctc || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <TrendingUp className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Expected CTC</p><p className="text-slate-900 font-medium mt-1">{selected.expected_ctc || '-'}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Notice Period</p><p className="text-slate-900 font-medium mt-1">{selected.notice_period || '-'}</p></div>
                    </div>
                  </div>

                  {/* Resume summary */}
                  {selected.summary && (
                    <div className="pt-6 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Resume Summary</p>
                      <p className="text-slate-900 mt-2 whitespace-pre-wrap text-sm">{selected.summary}</p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-6 border-t border-slate-200">
                    <button onClick={() => setSelected(null)} className="flex-1 px-6 py-3 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                      Close
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
