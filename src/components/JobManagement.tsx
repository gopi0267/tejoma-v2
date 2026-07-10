/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  PlusCircle, Search, Edit2, Trash2, CheckCircle, Sparkles, MapPin, DollarSign, Calendar, X, BarChart3 
} from 'lucide-react';
import { Job, Candidate } from '../types.js';
import { apiFetch } from '../utils/apiFetch.js';

interface JobManagementProps {
  jobs: Job[];
  fetchJobs: () => void;
  onOpenCreateJobModal: () => void;
  setActiveTab: (tab: string) => void;
  setSelectedJobId: (id: number) => void;
  selectedCandidatesList?: any[];
  setSelectedCandidatesList?: (candidates: any[]) => void;
}

export default function JobManagement({ 
  jobs, 
  fetchJobs, 
  onOpenCreateJobModal, 
  setActiveTab, 
  setSelectedJobId,
  selectedCandidatesList = [],
  setSelectedCandidatesList
}: JobManagementProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showRejectToast, setShowRejectToast] = useState(false);
  const [rejectedMessage, setRejectedMessage] = useState('');
  const [toastType, setToastType] = useState<'select' | 'reject'>('reject');

  // Responsive state
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Selected job candidate matches list
  const [activeJobDetails, setActiveJobDetails] = useState<Job | null>(null);
  const [matchedCandidates, setMatchedCandidates] = useState<{ candidate: Candidate; match_score: number; breakdown: any; summary: string }[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  
  // Local selected & rejected candidates state
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [rejectedCandidateIds, setRejectedCandidateIds] = useState<number[]>([]);
  const [localSelectedCandidates, setLocalSelectedCandidates] = useState<any[]>([]);

  // Job specific analytics
  const [jobAnalytics, setJobAnalytics] = useState<any | null>(null);

  // Editing Job state
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSkills, setEditSkills] = useState('');
  const [editExp, setEditExp] = useState(0);
  const [editLocation, setEditLocation] = useState('');
  const [editSalMin, setEditSalMin] = useState(50000);
  const [editSalMax, setEditSalMax] = useState(120000);
  const [editStatus, setEditStatus] = useState<'open' | 'closed' | 'on_hold'>('open');

  // Toast Helper Functions
  const showSelectToast = (message: string) => {
    setToastType('select');
    setRejectedMessage(message);
    setShowRejectToast(true);
    setTimeout(() => setShowRejectToast(false), 2500);
  };

  const showRejectToastFn = (message: string) => {
    setToastType('reject');
    setRejectedMessage(message);
    setShowRejectToast(true);
    setTimeout(() => setShowRejectToast(false), 2500);
  };

  const startMatching = (jobId: number) => {
    setSelectedJobId(jobId);
    setActiveTab('swipe');
  };

  const inspectJobMatches = async (job: Job) => {
    setActiveJobDetails(job);
    setLoadingMatches(true);
    try {
      const [matchesRes, analyticsRes] = await Promise.all([
        apiFetch(`/api/jobs/${job.id}`),
        apiFetch(`/api/analytics/job/${job.id}`)
      ]);
      const matchesData = await matchesRes.json();
      const analyticsData = await analyticsRes.json();
      
      setMatchedCandidates(matchesData.matched_candidates || []);
      setJobAnalytics(analyticsData);
    } catch (e) {
      console.error('Failed to retrieve matched candidates for job:', e);
    } finally {
      setLoadingMatches(false);
    }
  };

  // HANDLE SELECT CANDIDATE - REMOVE FROM LIST + ADD TO MATCH CANDIDATES
  const handleSelectCandidate = (candidate: Candidate, score: number, matchIndex: number) => {
    // Mark as selected
    setSelectedCandidateIds([...selectedCandidateIds, candidate.id]);

    // Create candidate object for Match Candidates page
    const newCandidate = {
      id: candidate.id,
      name: candidate.name,
      title: candidate.current_job_title,
      skills: candidate.skills || [],
      score: score,
      jobId: activeJobDetails?.id,
      jobTitle: activeJobDetails?.title,
      initials: candidate.name.split(' ').map(n => n[0]).join('').toUpperCase(),
      summary: `Strong match with ${score}% compatibility. ${candidate.years_of_experience} years of experience in relevant technologies.`
    };

    // Add to selected candidates
    const updatedList = [...localSelectedCandidates, newCandidate];
    setLocalSelectedCandidates(updatedList);
    
    // Update parent state
    if (setSelectedCandidatesList) {
      setSelectedCandidatesList(updatedList);
    }

    // Remove from current list
    const updatedMatches = matchedCandidates.filter((_, idx) => idx !== matchIndex);
    setMatchedCandidates(updatedMatches);

    // Show GREEN toast for SELECT
    showSelectToast(`✅ ${candidate.name} selected!`);
  };

  // HANDLE REJECT CANDIDATE - REMOVE FROM LIST + SHOW TOAST
  const handleRejectCandidate = (candidateName: string, matchIndex: number) => {
    // Mark as rejected
    setRejectedCandidateIds([...rejectedCandidateIds, matchedCandidates[matchIndex].candidate.id]);

    // Remove from current list
    const updatedMatches = matchedCandidates.filter((_, idx) => idx !== matchIndex);
    setMatchedCandidates(updatedMatches);

    // Show RED toast for REJECT
    showRejectToastFn(`❌ ${candidateName} Rejected`);
  };

  const handleEditInit = (job: Job) => {
    setEditingJob(job);
    setEditTitle(job.title);
    setEditDesc(job.description);
    setEditSkills(job.required_skills.join(', '));
    setEditExp(job.experience_years);
    setEditLocation(job.location);
    setEditSalMin(job.salary_min);
    setEditSalMax(job.salary_max);
    setEditStatus(job.status);
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJob) return;

    try {
      const res = await apiFetch(`/api/jobs/${editingJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          description: editDesc,
          required_skills: editSkills.split(',').map(s => s.trim()).filter(s => s.length > 0),
          experience_years: editExp,
          location: editLocation,
          salary_min: editSalMin,
          salary_max: editSalMax,
          status: editStatus
        })
      });

      if (res.ok) {
        setEditingJob(null);
        fetchJobs();
        if (activeJobDetails && activeJobDetails.id === editingJob.id) {
          const updated = { ...activeJobDetails, title: editTitle, location: editLocation, salary_min: editSalMin, salary_max: editSalMax, status: editStatus };
          inspectJobMatches(updated);
        }
      }
    } catch (e) {
      console.error('Failed to update job position:', e);
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    if (!confirm('Are you absolutely sure you want to delete this position? All swipe history for this job will be lost.')) return;

    try {
      const res = await apiFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchJobs();
        if (activeJobDetails && activeJobDetails.id === jobId) {
          setActiveJobDetails(null);
        }
      }
    } catch (e) {
      console.error('Failed to delete job:', e);
    }
  };

  const filteredJobs = jobs.filter(j => {
    const matchSearch = j.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = statusFilter === 'all' || j.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const getScoreBadgeClass = (score: number) => {
    if (score >= 80) return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    if (score >= 50) return 'bg-amber-50 text-amber-700 border border-amber-100';
    return 'bg-rose-50 text-rose-700 border border-rose-100';
  };

  return (
    <>
      {/* TOAST NOTIFICATION - GREEN for SELECT, RED for REJECT */}
      {showRejectToast && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 z-50 animate-bounce ${
          toastType === 'select' 
            ? 'bg-emerald-600' 
            : 'bg-rose-600'
        }`}>
          <span className="font-bold text-sm">{rejectedMessage}</span>
          <button
            onClick={() => setShowRejectToast(false)}
            className={`text-white font-bold text-lg w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              toastType === 'select'
                ? 'bg-emerald-700 hover:bg-emerald-800'
                : 'bg-rose-700 hover:bg-rose-800'
            }`}
          >
            ✓
          </button>
        </div>
      )}

      <div className="p-4 sm:p-8 space-y-4 sm:space-y-8 h-full overflow-y-auto max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left List Pane (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Active Job Postings</h1>
              <p className="text-[10px] text-slate-500">Add, edit, and explore match distributions per role.</p>
            </div>
            <button
              onClick={onOpenCreateJobModal}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <PlusCircle className="w-4 h-4" /> Create Position
            </button>
          </div>

          {/* Search & Filter bar */}
          <div className="flex gap-3 text-xs">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by position title..."
                className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 shadow-xs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 shadow-xs"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="on_hold">On Hold</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* On Mobile: Card View. On Desktop: Table View */}
          {isMobile ? (
            <div className="space-y-3">
              {filteredJobs.length > 0 ? (
                filteredJobs.map((j) => (
                  <div 
                    key={j.id} 
                    className={`bg-white border p-4 rounded-xl shadow-xs space-y-3 text-left transition-all cursor-pointer ${
                      activeJobDetails?.id === j.id ? 'border-emerald-500 ring-2 ring-emerald-500/10' : 'border-slate-200'
                    }`}
                    onClick={() => inspectJobMatches(j)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="overflow-hidden">
                        <h4 className="font-bold text-slate-900 text-sm truncate">{j.title}</h4>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5 capitalize">{j.location} · {j.experience_years}+ Yrs Exp</p>
                      </div>
                      <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0 ${
                        j.status === 'open' ? 'text-emerald-700 border-emerald-100 bg-emerald-50' :
                        j.status === 'on_hold' ? 'text-amber-700 border-amber-100 bg-amber-50' :
                        'text-slate-600 border-slate-200 bg-slate-100'
                      }`}>
                        {j.status}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[11px] border-t border-slate-100 pt-2 text-slate-500">
                      <div>
                        Matches: <strong className="text-slate-700">{(j as any).total_candidates || 0}</strong>
                        <span className="text-slate-400"> ({(j as any).reviewed || 0})</span>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleEditInit(j)}
                          className="bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-[10px] cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteJob(j.id)}
                          className="bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 font-bold px-2.5 py-1 rounded-lg text-[10px] cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-slate-400 text-center py-4">No positions matched current search query.</p>
              )}
            </div>
          ) : (
            /* Job postings index table */
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[9px] border-b border-slate-100">
                    <th className="p-4 pl-6">Position details</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-center">Matched (Reviewed)</th>
                    <th className="p-4 text-right pr-6">Management Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredJobs.length > 0 ? (
                    filteredJobs.map((j) => (
                      <tr 
                        key={j.id} 
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${activeJobDetails?.id === j.id ? 'bg-slate-50/80 border-l-2 border-emerald-500' : ''}`}
                        onClick={() => inspectJobMatches(j)}
                      >
                        <td className="p-4 pl-6">
                          <div className="font-semibold text-slate-800">{j.title}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5 capitalize">{j.location} · {j.experience_years}+ Yrs Exp</div>
                        </td>
                        <td className="p-4">
                          <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                            j.status === 'open' ? 'text-emerald-700 border-emerald-100 bg-emerald-50' :
                            j.status === 'on_hold' ? 'text-amber-700 border-amber-100 bg-amber-50' :
                            'text-slate-600 border-slate-200 bg-slate-100'
                          }`}>
                            {j.status}
                          </span>
                        </td>
                        <td className="p-4 text-center font-mono text-slate-600">
                          <strong className="text-slate-800">{(j as any).total_candidates || 0}</strong> 
                          <span className="text-slate-400"> ({(j as any).reviewed || 0})</span>
                        </td>
                        <td className="p-4 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-2.5">
                            <button
                              onClick={() => handleEditInit(j)}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors cursor-pointer"
                              title="Edit Position"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteJob(j.id)}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                              title="Delete Position"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400">No positions matched current search query.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Detail Pane (5 cols) */}
        <div className="lg:col-span-5 space-y-6 bg-white border border-slate-200 p-6 rounded-2xl shadow-xs text-left">
          {activeJobDetails ? (
            <div className="space-y-6">
              
              {/* Selected Job Header */}
              <div className="border-b border-slate-100 pb-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <h2 className="text-sm font-bold text-slate-900 leading-tight">{activeJobDetails.title}</h2>
                  <button
                    onClick={() => startMatching(activeJobDetails.id)}
                    className="bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 font-bold text-[9px] uppercase tracking-wider px-2.5 py-1 rounded-md flex-shrink-0 flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-emerald-600 animate-pulse" /> Matches Screen
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 font-mono">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {activeJobDetails.location}</span>
                  <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5 text-slate-400" /> ${(activeJobDetails.salary_min/1000).toFixed(0)}k-${(activeJobDetails.salary_max/1000).toFixed(0)}k</span>
                </div>
              </div>

              {/* Required skills badges display */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Required Technical Skills:</span>
                <div className="flex flex-wrap gap-1.5">
                  {activeJobDetails.required_skills.map((skill, idx) => (
                    <span key={idx} className="bg-slate-50 text-slate-700 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-semibold">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Job specific match analytics */}
              {jobAnalytics && (
                <div className="bg-slate-50 p-3.5 border border-slate-100 rounded-xl space-y-3 text-[10px]">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-bold flex items-center gap-1">
                      <BarChart3 className="w-3.5 h-3.5 text-emerald-500" /> Acceptance Yield
                    </span>
                    <span className="font-mono text-slate-700">{jobAnalytics.acceptance_rate}% rate</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${jobAnalytics.acceptance_rate}%` }} />
                  </div>
                </div>
              )}

              {/* Matched Candidates Ranked List */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Ranked Candidate Matches</h3>
                
                {loadingMatches ? (
                  <div className="p-6 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    <span>Matching database candidate vectors...</span>
                  </div>
                ) : matchedCandidates.length > 0 ? (
                  <div className="space-y-2.5 overflow-y-auto max-h-[220px] pr-1">
                    {matchedCandidates.map((match, idx) => (
                      <div key={`${match.candidate.id}-${idx}`} className="p-3 bg-slate-50/50 border border-slate-100 rounded-xl flex items-center justify-between text-xs hover:border-slate-200 transition-colors text-left">
                        <div className="overflow-hidden flex-1">
                          <h4 className="font-bold text-slate-800 truncate">{match.candidate.name}</h4>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5 capitalize">{match.candidate.current_job_title} · {match.candidate.years_of_experience} yrs</p>
                        </div>
                        
                        {/* SCORE + SELECT + REJECT BUTTONS */}
                        <div className="flex gap-2 flex-shrink-0 items-center ml-2">
                          {/* Score Badge */}
                          <div className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold leading-none whitespace-nowrap ${getScoreBadgeClass(match.match_score)}`}>
                            {match.match_score}%
                          </div>
                          
                          {/* SELECT Button (Green) */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCandidate(match.candidate, match.match_score, idx);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                            title="Move to Match Candidates"
                          >
                            ✓ Select
                          </button>
                          
                          {/* REJECT Button (Red) */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRejectCandidate(match.candidate.name, idx);
                            }}
                            className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                            title="Reject candidate"
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 text-center py-4">No candidates available. All have been selected or rejected.</p>
                )}
              </div>

            </div>
          ) : (
            <div className="text-center py-16 text-slate-400 text-xs space-y-2">
              <CheckCircle className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-semibold text-slate-600">Position Profile Board</p>
              <p className="text-[11px] text-slate-400">Select any position from the left index table to view ranked candidate profiles and matching analytics.</p>
            </div>
          )}
        </div>

        {/* Editing Job Dialog Modal sheet */}
        {editingJob && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-xs text-left">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-sm font-bold text-slate-900">Modify Job Position Details</h3>
                <button 
                  onClick={() => setEditingJob(null)} 
                  className="text-slate-500 hover:text-slate-900 border border-slate-200 p-1 rounded-lg bg-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleEditSave} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Position Title</label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Required Skills (Comma-separated)</label>
                  <input
                    type="text"
                    required
                    value={editSkills}
                    onChange={(e) => setEditSkills(e.target.value)}
                    placeholder="React, TypeScript, Jest"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Yrs Experience Required</label>
                    <input
                      type="number"
                      required
                      value={editExp}
                      onChange={(e) => setEditExp(parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Location (e.g. Austin)</label>
                    <input
                      type="text"
                      required
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Salary Min ($)</label>
                    <input
                      type="number"
                      required
                      value={editSalMin}
                      onChange={(e) => setEditSalMin(parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Salary Max ($)</label>
                    <input
                      type="number"
                      required
                      value={editSalMax}
                      onChange={(e) => setEditSalMax(parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Job Posting Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="open">Open</option>
                    <option value="on_hold">On Hold</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Full Description</label>
                  <textarea
                    required
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4 -mx-6 -mb-6">
                  <button
                    type="button"
                    onClick={() => setEditingJob(null)}
                    className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-2 px-4 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </>
  );
}