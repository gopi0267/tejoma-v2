/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, X, Download, RefreshCw, AlertCircle, CheckCircle2, XCircle, Bookmark,
  TrendingUp, TrendingDown, Target, CalendarDays, CalendarRange, CalendarClock,
  ChevronLeft, ChevronRight, Eye, FileText, StickyNote, History, Send, Filter
} from 'lucide-react';
import Papa from 'papaparse';
import { Job } from '../types.js';
import { apiFetch } from '../utils/apiFetch.js';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint.js';

interface ReviewRow {
  swipe_id: number;
  candidate_id: number;
  job_id: number;
  action: number;
  match_score: number;
  reason: string | null;
  decision_date: string;
  recruiter_id: number;
  recruiter_name: string;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;
  current_job_title: string;
  current_company: string;
  years_of_experience: string;
  primary_skills: string;
  job_title: string;
  recruiter_note: string | null;
  note_updated_at: string | null;
}

interface Stats {
  totalReviewed: number; accepted: number; rejected: number; saved: number;
  acceptanceRate: number; rejectionRate: number; avgMatchScore: number;
  today: number; thisWeek: number; thisMonth: number;
}

interface DetailData {
  candidate: any;
  job: any;
  history: any[];
  note: { note: string } | null;
}

const PAGE_SIZE = 25;

const decisionLabel = (action: number) => (action === 1 ? 'Accepted' : action === 0 ? 'Rejected' : 'Saved');
const decisionBadgeClass = (action: number) =>
  action === 1 ? 'text-emerald-700 border-emerald-100 bg-emerald-50'
    : action === 0 ? 'text-rose-700 border-rose-100 bg-rose-50'
    : 'text-amber-700 border-amber-100 bg-amber-50';
const scoreBadgeClass = (score: number) => {
  if (score >= 80) return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
  if (score >= 50) return 'bg-amber-50 text-amber-700 border border-amber-100';
  return 'bg-rose-50 text-rose-700 border border-rose-100';
};

export default function RecruiterReview() {
  const { isMobile } = useResponsiveBreakpoint();

  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    apiFetch('/api/jobs').then((r) => r.json()).then((j) => setJobs(Array.isArray(j) ? j : [])).catch(() => {});
  }, []);

  // Filters / search / sort / pagination
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [decisionTab, setDecisionTab] = useState<'all' | 'accepted' | 'rejected' | 'saved'>('all');
  const [jobId, setJobId] = useState<string>('');
  const [recruiterId, setRecruiterId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minExperience, setMinExperience] = useState('');
  const [maxExperience, setMaxExperience] = useState('');
  const [skills, setSkills] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [sortBy, setSortBy] = useState('latest_decision');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Distinct recruiters seen so far, for the recruiter filter dropdown (this dataset is
  // typically a handful of people per company, so accumulating across page loads converges fast).
  const recruitersRef = useRef<Map<number, string>>(new Map());
  const [recruiterOptions, setRecruiterOptions] = useState<{ id: number; name: string }[]>([]);

  const buildQuery = useCallback((overridePage?: number, overridePageSize?: number) => {
    const params = new URLSearchParams();
    params.set('page', String(overridePage ?? page));
    params.set('pageSize', String(overridePageSize ?? PAGE_SIZE));
    if (search) params.set('search', search);
    if (decisionTab !== 'all') params.set('decision', decisionTab);
    if (jobId) params.set('jobId', jobId);
    if (recruiterId) params.set('recruiterId', recruiterId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minExperience) params.set('minExperience', minExperience);
    if (maxExperience) params.set('maxExperience', maxExperience);
    if (skills) params.set('skills', skills);
    if (minScore) params.set('minScore', minScore);
    if (maxScore) params.set('maxScore', maxScore);
    if (sortBy) params.set('sortBy', sortBy);
    return params;
  }, [page, search, decisionTab, jobId, recruiterId, dateFrom, dateTo, minExperience, maxExperience, skills, minScore, maxScore, sortBy]);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/recruiter-review?${buildQuery().toString()}`);
      if (!res.ok) throw new Error('Failed to load recruiter review data.');
      const json = await res.json();
      setRows(json.data);
      setStats(json.stats);
      setTotalRecords(json.totalRecords);
      setTotalPages(json.totalPages);
      for (const r of json.data as ReviewRow[]) recruitersRef.current.set(r.recruiter_id, r.recruiter_name);
      setRecruiterOptions(Array.from(recruitersRef.current, ([id, name]) => ({ id, name })));
    } catch (err: any) {
      setError(err.message || 'Failed to load recruiter review data.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Detail modal
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [decisionAction, setDecisionAction] = useState<'accepted' | 'rejected' | 'saved'>('accepted');
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);

  const openDetail = async (row: ReviewRow) => {
    setSelected(row);
    setDetail(null);
    setShowDecisionForm(false);
    setDecisionReason('');
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/recruiter-review/${row.candidate_id}/${row.job_id}`);
      if (res.ok) {
        const json = await res.json();
        setDetail(json);
        setNoteDraft(json.note?.note || '');
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const saveNote = async () => {
    if (!selected) return;
    setNoteSaving(true);
    try {
      const res = await apiFetch(`/api/recruiter-review/${selected.swipe_id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteDraft }),
      });
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.swipe_id === selected.swipe_id ? { ...r, recruiter_note: noteDraft } : r)));
      }
    } finally {
      setNoteSaving(false);
    }
  };

  const submitDecisionChange = async () => {
    if (!selected) return;
    setDecisionSaving(true);
    try {
      const res = await apiFetch(`/api/recruiter-review/${selected.swipe_id}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decisionAction, reason: decisionReason || undefined }),
      });
      if (res.ok) {
        setShowDecisionForm(false);
        setDecisionReason('');
        await openDetail(selected);
        fetchList();
      }
    } finally {
      setDecisionSaving(false);
    }
  };

  const exportCSV = async (format: 'csv' | 'excel') => {
    // Loops through every page of the CURRENT filtered/sorted result server-side, so the export
    // covers the whole filtered set (not just the visible page) without ever holding the full
    // unfiltered dataset in the browser at once.
    const all: ReviewRow[] = [];
    let p = 1;
    const cap = 200; // defensive cap (~20k rows at pageSize 100)
    while (p <= cap) {
      const res = await apiFetch(`/api/recruiter-review?${buildQuery(p, 100).toString()}`);
      if (!res.ok) break;
      const json = await res.json();
      all.push(...json.data);
      if (p >= json.totalPages) break;
      p++;
    }
    const csv = Papa.unparse(all.map((r) => ({
      'Candidate Name': r.candidate_name,
      'Email': r.candidate_email,
      'Phone': r.candidate_phone,
      'Current Job Title': r.current_job_title,
      'Current Company': r.current_company,
      'Experience': r.years_of_experience,
      'Primary Skills': r.primary_skills,
      'Match Score': r.match_score,
      'Latest Decision': decisionLabel(r.action),
      'Job ID': r.job_id,
      'Job Role': r.job_title,
      'Recruiter': r.recruiter_name,
      'Decision Date': r.decision_date,
    })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recruiter-review-${format}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const statCards = stats ? [
    { label: 'Total Reviewed', value: stats.totalReviewed, icon: Target, color: 'indigo' },
    { label: 'Accepted', value: stats.accepted, icon: CheckCircle2, color: 'emerald' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'rose' },
    { label: 'Saved', value: stats.saved, icon: Bookmark, color: 'amber' },
    { label: 'Acceptance Rate', value: `${stats.acceptanceRate}%`, icon: TrendingUp, color: 'emerald' },
    { label: 'Rejection Rate', value: `${stats.rejectionRate}%`, icon: TrendingDown, color: 'rose' },
    { label: 'Avg Match Score', value: `${stats.avgMatchScore}%`, icon: Target, color: 'indigo' },
    { label: "Today's Decisions", value: stats.today, icon: CalendarClock, color: 'slate' },
  ] : [];

  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600', slate: 'bg-slate-100 text-slate-600',
  };

  const clearFilters = () => {
    setJobId(''); setRecruiterId(''); setDateFrom(''); setDateTo('');
    setMinExperience(''); setMaxExperience(''); setSkills(''); setMinScore(''); setMaxScore('');
    setPage(1);
  };

  return (
    <div className="p-4 sm:p-8 space-y-6 h-full overflow-y-auto max-w-7xl mx-auto text-slate-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Recruiter Review</h1>
          <p className="text-xs text-slate-500 mt-1">Review every accept/reject/save decision your team has made, with full audit history.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchList} className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl transition-all text-slate-500 cursor-pointer" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => exportCSV('csv')} className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer">
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button onClick={() => exportCSV('excel')} className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-indigo-100 cursor-pointer">
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200/70 p-4 rounded-2xl flex flex-col justify-between shadow-xs relative overflow-hidden group">
            <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-16 h-16 bg-slate-50 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
            <div className="flex items-center justify-between relative z-10">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{c.label}</span>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colorMap[c.color]}`}>
                <c.icon className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 relative z-10">
              <span className="text-2xl font-extrabold text-slate-950 font-mono tracking-tight">{c.value}</span>
            </div>
          </div>
        ))}
      </div>
      {stats && (
        <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 font-mono -mt-2">
          <span className="flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" /> This Week: <strong className="text-slate-700">{stats.thisWeek}</strong></span>
          <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> This Month: <strong className="text-slate-700">{stats.thisMonth}</strong></span>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-2 text-xs">
        {(['all', 'accepted', 'rejected', 'saved'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setDecisionTab(t); setPage(1); }}
            className={`px-3.5 py-1.5 rounded-xl font-bold capitalize transition-colors cursor-pointer ${
              decisionTab === t ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Search + filter toggle */}
      <div className="flex gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by candidate name, email, phone, skill, or company..."
            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
          />
        </div>
        <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }} className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs">
          <option value="latest_decision">Latest Decision</option>
          <option value="oldest_decision">Oldest Decision</option>
          <option value="highest_score">Highest Match Score</option>
          <option value="lowest_score">Lowest Match Score</option>
          <option value="name_asc">Candidate Name A-Z</option>
          <option value="name_desc">Candidate Name Z-A</option>
        </select>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold cursor-pointer ${showFilters ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          <Filter className="w-4 h-4" /> Filters
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs shadow-xs">
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Job</label>
            <select value={jobId} onChange={(e) => { setJobId(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20">
              <option value="">All jobs</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Recruiter</label>
            <select value={recruiterId} onChange={(e) => { setRecruiterId(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20">
              <option value="">All recruiters</option>
              {recruiterOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Min Experience (yrs)</label>
            <input type="number" min="0" value={minExperience} onChange={(e) => { setMinExperience(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Max Experience (yrs)</label>
            <input type="number" min="0" value={maxExperience} onChange={(e) => { setMaxExperience(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Skills (comma-separated)</label>
            <input type="text" value={skills} onChange={(e) => { setSkills(e.target.value); setPage(1); }} placeholder="React, SAP FICO" className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Min Score</label>
              <input type="number" min="0" max="100" value={minScore} onChange={(e) => { setMinScore(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
            </div>
            <div className="flex-1">
              <label className="block text-slate-500 font-bold mb-1 uppercase tracking-wider text-[9px]">Max Score</label>
              <input type="number" min="0" max="100" value={maxScore} onChange={(e) => { setMaxScore(e.target.value); setPage(1); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" />
            </div>
          </div>
          <div className="col-span-2 sm:col-span-4 flex justify-end">
            <button onClick={clearFilters} className="text-slate-500 hover:text-rose-600 font-bold text-[11px] cursor-pointer">Clear all filters</button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Table / cards */}
      {loading ? (
        <div className="p-10 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading recruiter review data...</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-center py-10 text-xs">No decisions matched the current search/filters.</p>
      ) : isMobile ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.swipe_id} onClick={() => openDetail(r)} className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs space-y-2 cursor-pointer">
              <div className="flex justify-between items-start">
                <div className="overflow-hidden">
                  <h4 className="font-bold text-slate-900 text-sm truncate">{r.candidate_name}</h4>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{r.job_title}</p>
                </div>
                <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0 ${decisionBadgeClass(r.action)}`}>{decisionLabel(r.action)}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                <span className={`px-2 py-0.5 rounded-lg font-mono font-bold ${scoreBadgeClass(r.match_score)}`}>{r.match_score}%</span>
                <span>{new Date(r.decision_date).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[9px] border-b border-slate-100">
                <th className="p-4 pl-6">Candidate</th>
                <th className="p-4">Job Role</th>
                <th className="p-4">Experience</th>
                <th className="p-4">Score</th>
                <th className="p-4">Decision</th>
                <th className="p-4">Recruiter</th>
                <th className="p-4">Decision Date</th>
                <th className="p-4 text-right pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.swipe_id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => openDetail(r)}>
                  <td className="p-4 pl-6">
                    <div className="font-semibold text-slate-800">{r.candidate_name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{r.current_job_title} · {r.current_company}</div>
                  </td>
                  <td className="p-4 text-slate-600">{r.job_title} <span className="text-slate-400 font-mono text-[10px]">#{r.job_id}</span></td>
                  <td className="p-4 text-slate-600 font-mono">{r.years_of_experience || '-'}</td>
                  <td className="p-4"><span className={`px-2 py-0.5 rounded-lg font-mono font-bold ${scoreBadgeClass(r.match_score)}`}>{r.match_score}%</span></td>
                  <td className="p-4">
                    <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${decisionBadgeClass(r.action)}`}>{decisionLabel(r.action)}</span>
                  </td>
                  <td className="p-4 text-slate-600">{r.recruiter_name}</td>
                  <td className="p-4 text-slate-500 font-mono text-[10px]">{new Date(r.decision_date).toLocaleString()}</td>
                  <td className="p-4 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2.5">
                      <button onClick={() => openDetail(r)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="View Decision History" aria-label={`View decision history for ${r.candidate_name}`}><History className="w-3.5 h-3.5" /></button>
                      <button onClick={() => openDetail(r)} className="text-slate-400 hover:text-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors cursor-pointer" title="View Candidate" aria-label={`View ${r.candidate_name}`}><Eye className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Showing page {page} of {totalPages} ({totalRecords} total decisions)</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page" className="min-w-[44px] min-h-[44px] flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page" className="min-w-[44px] min-h-[44px] flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-auto shadow-2xl">
            <div className="sticky top-0 bg-gradient-to-r from-slate-50 to-slate-100 flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selected.candidate_name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{selected.job_title} <span className="font-mono text-slate-400">#{selected.job_id}</span></p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-300 rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-10 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <span>Loading detail...</span>
              </div>
            ) : detail ? (
              <div className="p-8 space-y-6">
                {/* Candidate info */}
                <div className="grid grid-cols-2 gap-6">
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email</p><p className="text-slate-900 font-medium mt-2">{detail.candidate.email || '-'}</p></div>
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Phone</p><p className="text-slate-900 font-medium mt-2">{detail.candidate.phone || '-'}</p></div>
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Current Role</p><p className="text-slate-900 font-medium mt-2">{detail.candidate.current_job_title || '-'} @ {detail.candidate.current_company || '-'}</p></div>
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Experience</p><p className="text-slate-900 font-medium mt-2">{detail.candidate.years_of_experience || '-'}</p></div>
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Education</p><p className="text-slate-900 font-medium mt-2">{detail.candidate.highest_qualification || '-'} {detail.candidate.university ? `- ${detail.candidate.university}` : ''}</p></div>
                </div>

                {detail.candidate.skills?.length > 0 && (
                  <div className="pt-6 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Primary Skills</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.candidate.skills.map((s: string, idx: number) => (
                        <span key={idx} className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-medium">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {detail.candidate.resume_summary && (
                  <div className="pt-6 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Resume Summary</p>
                    <p className="text-slate-900 mt-2 whitespace-pre-wrap text-sm">{detail.candidate.resume_summary}</p>
                  </div>
                )}

                {/* Job details */}
                <div className="pt-6 border-t border-slate-100 grid grid-cols-2 gap-6">
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Job Title</p><p className="text-slate-900 font-medium mt-2">{detail.job.title}</p></div>
                  <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Location</p><p className="text-slate-900 font-medium mt-2">{detail.job.location || '-'}</p></div>
                </div>

                {/* AI Match Breakdown - from the latest history entry that has one */}
                {(() => {
                  const withBreakdown = detail.history.find((h) => h.breakdown);
                  if (!withBreakdown) return null;
                  const b = withBreakdown.breakdown;
                  return (
                    <div className="pt-6 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">AI Match Breakdown</p>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Skills</span><div className="font-bold text-slate-800">{b.skills?.score ?? '-'}%</div></div>
                        <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Experience</span><div className="font-bold text-slate-800">{b.experience?.score ?? '-'}%</div></div>
                        <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Location</span><div className="font-bold text-slate-800">{b.location?.score ?? '-'}%</div></div>
                        <div className="bg-slate-50 rounded-lg p-3"><span className="text-slate-500">Salary</span><div className="font-bold text-slate-800">{b.salary?.score ?? '-'}%</div></div>
                      </div>
                      <div className={`mt-3 inline-block px-3 py-1.5 rounded-lg font-mono font-bold text-sm ${scoreBadgeClass(withBreakdown.match_score)}`}>
                        Overall: {withBreakdown.match_score}%
                      </div>
                    </div>
                  );
                })()}

                {/* Recruiter notes */}
                <div className="pt-6 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1"><StickyNote className="w-3.5 h-3.5" /> Recruiter Notes</p>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    placeholder="e.g. Good communication. Waiting for salary confirmation."
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button onClick={saveNote} disabled={noteSaving} className="mt-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
                    {noteSaving ? 'Saving...' : 'Save Note'}
                  </button>
                </div>

                {/* Decision history */}
                <div className="pt-6 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1"><History className="w-3.5 h-3.5" /> Decision History</p>
                  <div className="space-y-3">
                    {detail.history.map((h) => (
                      <div key={h.id} className="flex items-start justify-between border-b border-slate-100 pb-3 last:border-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${decisionBadgeClass(h.action)}`}>{decisionLabel(h.action)}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{new Date(h.timestamp).toLocaleString()}</span>
                          </div>
                          {h.reason && <p className="text-xs text-slate-600 mt-1">Reason: {h.reason}</p>}
                        </div>
                        <span className="text-[10px] text-slate-400">by user #{h.recruiter_id}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Row actions */}
                <div className="pt-6 border-t border-slate-200 space-y-3">
                  {!showDecisionForm ? (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setShowDecisionForm(true)} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg cursor-pointer text-xs">
                        Change Decision
                      </button>
                      <button disabled title="Coming soon" className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-400 font-semibold rounded-lg cursor-not-allowed text-xs flex items-center justify-center gap-1.5">
                        <Send className="w-3.5 h-3.5" /> Forward to Client
                      </button>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex gap-2">
                        {(['accepted', 'rejected', 'saved'] as const).map((a) => (
                          <button
                            key={a}
                            onClick={() => setDecisionAction(a)}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold capitalize cursor-pointer ${decisionAction === a ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={decisionReason}
                        onChange={(e) => setDecisionReason(e.target.value)}
                        placeholder="Reason (optional) - e.g. Salary too high, Client approved"
                        className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setShowDecisionForm(false)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg cursor-pointer text-xs">Cancel</button>
                        <button onClick={submitDecisionChange} disabled={decisionSaving} className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg cursor-pointer text-xs disabled:opacity-50">
                          {decisionSaving ? 'Saving...' : 'Confirm Decision Change'}
                        </button>
                      </div>
                    </div>
                  )}
                  <button onClick={() => setSelected(null)} className="w-full px-4 py-2.5 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 cursor-pointer text-xs">
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-400 text-xs">Failed to load detail.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
