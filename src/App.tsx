/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  PlusCircle, Sparkles, X, Activity, Menu
} from 'lucide-react';
import CandidateMatching from './components/CandidateMatching.tsx';
import Login from './components/Login.js';
import Sidebar from './components/Sidebar.js';
import Dashboard from './components/Dashboard.js';
import SwipeInterface from './components/SwipeInterface.js';
import JobManagement from './components/JobManagement.js';
import CandidateManagement from './components/CandidateManagement.js';
import Analytics from './components/Analytics.js';
import RecruiterReview from './components/RecruiterReview.js';
import UserManagement from './components/UserManagement.js';
import TenantRequests from './components/TenantRequests.js';
import TejomaLogo from './components/TejomaLogo.js';
import { Job, Candidate } from './types.js';
import ResumeUploadPage from './components/ResumeUploadPage.js';
import { useAuth } from './context/AuthContext.js';
import ProtectedRoute from './components/ProtectedRoute.js';
import { apiFetch } from './utils/apiFetch.js';
import ChatbotWidget from './components/ChatbotWidget.js';

export default function App() {
  // Authentication state now lives in AuthContext (see src/context/AuthContext.tsx) - it
  // bootstraps from the httpOnly session cookie via /api/auth/me rather than localStorage,
  // since the cookie itself isn't readable by frontend JS.
  const { user: userInfo, companyId, company, isAuthenticated, loading: authLoading, logout, logoutAll } = useAuth();

  // Core navigation & selection states
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedJobId, setSelectedJobId] = useState<number>(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Create Job Modal
  const [showCreateJobModal, setShowCreateJobModal] = useState(false);
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newJobDesc, setNewJobDesc] = useState('');
  const [newJobSkills, setNewJobSkills] = useState('');
  const [newJobExp, setNewJobExp] = useState(3);
  const [newJobLocation, setNewJobLocation] = useState('Austin, TX');
  const [newJobSalMin, setNewJobSalMin] = useState(60000);
  const [newJobSalMax, setNewJobSalMax] = useState(130000);

  // Paste-JD auto-fill: parses free-text into the fields above (plus the extra JD-parser fields
  // below, which aren't shown as individual inputs in this compact modal but are still sent to
  // the backend on submit so they're not silently dropped).
  const [showJdPaste, setShowJdPaste] = useState(false);
  const [jdPasteText, setJdPasteText] = useState('');
  const [isParsingJD, setIsParsingJD] = useState(false);
  const [jdParseError, setJdParseError] = useState('');
  const [parsedJDExtras, setParsedJDExtras] = useState<any>(null);

  // Live Toast Notifications from SSE streams
  const [notifications, setNotifications] = useState<{ id: number; message: string; type: string }[]>([]);

  // Fetch core telemetry once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchCoreTelemetry();
    }
  }, [isAuthenticated]);

  // Server-Sent Events (SSE) live stream registration
  useEffect(() => {
    if (!isAuthenticated) return;

    const eventSource = new EventSource('/api/realtime/stream');

    eventSource.addEventListener('swipe_completed', (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        triggerNotification(
          `Live Feed: candidate ${payload.candidateName} swiped ${payload.action === 'accept' ? 'ACCEPTED ✅' : 'REJECTED ✕'}`,
          'info'
        );
        // Refresh collections silently to reflect real-time dashboard counts
        fetchCoreTelemetry();
      } catch (err) {
        console.error('Failed to parse SSE event payload:', err);
      }
    });

    eventSource.addEventListener('model_retrained', (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        triggerNotification(`Ensemble Algorithm: RandomForest retrained successfully on startup.`, 'success');
      } catch (err) {
        console.error('Failed to parse model retrain event:', err);
      }
    });

    eventSource.addEventListener('open', () => {
      console.log('SSE Stream established successfully.');
    });

    return () => {
      eventSource.close();
    };
  }, [isAuthenticated]);

  const triggerNotification = (message: string, type: string) => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  const fetchCoreTelemetry = async () => {
    setLoading(true);
    try {
      const [jobsRes, candidatesRes] = await Promise.all([
        apiFetch('/api/jobs'),
        apiFetch('/api/candidates')
      ]);
      const jobsData = await jobsRes.json();
      const candidatesData = await candidatesRes.json();

      setJobs(jobsData);
      setCandidates(candidatesData);
    } catch (e) {
      console.error('Failed to load core talent database metrics:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleParseJobDescription = async () => {
    if (!jdPasteText.trim()) return;
    setIsParsingJD(true);
    setJdParseError('');
    try {
      const res = await apiFetch('/api/jobs/parse-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: jdPasteText })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to parse job description');

      const p = data.parsed;
      // Pre-fill the existing simple fields - still fully editable before the recruiter submits.
      if (p.jobTitle) setNewJobTitle(p.jobTitle);
      setNewJobDesc(jdPasteText);
      if (p.requiredSkills?.length) setNewJobSkills(p.requiredSkills.map((s: any) => s.canonical).join(', '));
      if (p.minimumExperience != null) setNewJobExp(Math.round(p.minimumExperience));
      if (p.location?.length) setNewJobLocation(p.location.join(', '));
      if (p.salaryMinimum != null) setNewJobSalMin(Math.round(p.salaryMinimum));
      if (p.salaryMaximum != null) setNewJobSalMax(Math.round(p.salaryMaximum));

      // Extra fields this compact modal doesn't have dedicated inputs for - kept for display
      // and included in the final submit so they aren't silently dropped.
      setParsedJDExtras(p);
    } catch (err: any) {
      setJdParseError(err.message);
    } finally {
      setIsParsingJD(false);
    }
  };

  const handleCreateJobSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobTitle || !newJobDesc) return;

    try {
      const extras = parsedJDExtras || {};
      const res = await apiFetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newJobTitle,
          description: newJobDesc,
          required_skills: newJobSkills.split(',').map(s => s.trim()).filter(s => s.length > 0),
          experience_years: newJobExp,
          location: newJobLocation,
          salary_min: newJobSalMin,
          salary_max: newJobSalMax,
          company_id: companyId,
          optional_skills: extras.optionalSkills?.map((s: any) => s.canonical) || [],
          min_experience: extras.minimumExperience ?? null,
          max_experience: extras.maximumExperience ?? null,
          experience_unit: extras.experienceUnit ?? null,
          remote_type: extras.remoteType ?? null,
          employment_type: extras.employmentType ?? null,
          industry: extras.industry ?? null,
          department: extras.department ?? null,
          education: extras.education || [],
          certifications: extras.certifications || [],
          salary_currency: extras.salaryCurrency ?? null,
          notice_period: extras.noticePeriod ?? null,
          number_of_openings: extras.numberOfOpenings ?? null,
          required_languages: extras.requiredLanguages || [],
          responsibilities: extras.responsibilities || [],
          keywords: extras.keywords || [],
          job_summary: extras.jobSummary ?? null,
          source_raw_text: jdPasteText || null,
        })
      });

      if (res.ok) {
        setShowCreateJobModal(false);
        setNewJobTitle('');
        setNewJobDesc('');
        setNewJobSkills('');
        setNewJobExp(3);
        setNewJobLocation('Austin, TX');
        setNewJobSalMin(60000);
        setNewJobSalMax(130000);
        setJdPasteText('');
        setParsedJDExtras(null);
        setShowJdPaste(false);
        
        // Refresh
        fetchCoreTelemetry();
        triggerNotification('New Position indexed successfully into talent scoring tables.', 'success');
      }
    } catch (e) {
      console.error('Failed to register job position:', e);
    }
  };

  if (!authLoading && !isAuthenticated) {
    return <Login />;
  }

  return (
    <ProtectedRoute>
    <div id="application-root" className="flex h-screen w-screen bg-[#F8FAFC] text-slate-800 font-sans overflow-hidden">

      {/* Universal Toast Notifications Container */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none">
        {notifications.map(n => (
          <div 
            key={n.id} 
            className="flex items-center gap-2.5 p-3 rounded-xl shadow-xl bg-white border border-slate-200 animate-fade-in text-xs font-semibold text-slate-800 max-w-sm pointer-events-auto"
          >
            <Activity className="w-4 h-4 text-emerald-500 flex-shrink-0 animate-pulse" />
            <span>{n.message}</span>
          </div>
        ))}
      </div>

      {/* Main Left-Hand Side Menu (Sidebar) */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userInfo={userInfo}
        company={company}
        onLogout={logout}
        onLogoutAll={logoutAll}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Container Wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden relative w-full h-full">
        {/* Mobile Header Bar */}
        {activeTab !== 'swipe' && (
          <header className="flex md:hidden items-center justify-between px-4 py-3 bg-white border-b border-slate-200 h-14 w-full z-40">
            <button
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="text-slate-600 hover:text-slate-900 border border-slate-200 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-slate-50 transition-colors cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-1.5">
              <TejomaLogo size="sm" textColorClass="text-slate-900 font-extrabold" />
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">Recruiting</span>
            </div>

            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-xs uppercase shadow-xs">
              {userInfo?.name ? userInfo.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U'}
            </div>
          </header>
        )}

        {/* Primary Context Pane (Page View router) */}
        <main className="flex-1 overflow-hidden relative">
          {activeTab === 'dashboard' && (
            <Dashboard 
              setActiveTab={setActiveTab} 
              setSelectedJobId={setSelectedJobId} 
              onOpenCreateJobModal={() => setShowCreateJobModal(true)} 
            />
          )}
          {activeTab === 'swipe' && (
            <SwipeInterface
              jobs={jobs}
              selectedJobId={selectedJobId}
              setSelectedJobId={setSelectedJobId}
              setActiveTab={setActiveTab}
              onLogout={logout}
              userInfo={userInfo}
              onOpenSidebar={() => setIsSidebarOpen(true)}
            />
          )}
          {activeTab === 'recruiter-review' && (
            <RecruiterReview />
          )}
          {activeTab === 'jobs' && (
            <JobManagement 
              jobs={jobs} 
              fetchJobs={fetchCoreTelemetry} 
              onOpenCreateJobModal={() => setShowCreateJobModal(true)} 
              setActiveTab={setActiveTab}
              setSelectedJobId={setSelectedJobId}
            />
          )}
          {activeTab === 'candidates' && (
            <CandidateManagement 
              candidates={candidates} 
              fetchCandidates={fetchCoreTelemetry} 
            />
          )}
          {activeTab === 'analytics' && (
            <Analytics />
          )}
          {activeTab === 'user-management' && (
            <UserManagement />
          )}
          {activeTab === 'tenant-requests' && (
            <TenantRequests />
          )}
          {activeTab === 'resume-upload' && (
            <ResumeUploadPage 
              onBackToLanding={() => setActiveTab('dashboard')} 
              onViewChange={(view) => setActiveTab(view)}
            />
          )}
        </main>
      </div>

      {/* Universal Form Sheet (Create Job Modal) */}
      {showCreateJobModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-xs text-left">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">Index New Corporate Opening</h3>
              <button 
                onClick={() => setShowCreateJobModal(false)}
                className="text-slate-500 hover:text-slate-900 border border-slate-200 p-1 rounded-lg transition-colors cursor-pointer bg-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateJobSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

              {/* Paste-JD auto-fill (production JD parser: regex + dictionary + spaCy/GLiNER) */}
              <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-3">
                <button
                  type="button"
                  onClick={() => setShowJdPaste(v => !v)}
                  className="flex items-center gap-1.5 text-emerald-700 font-bold text-[10px] uppercase tracking-wider cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {showJdPaste ? 'Hide' : 'Paste a Job Description to Auto-Fill'}
                </button>

                {showJdPaste && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={jdPasteText}
                      onChange={(e) => setJdPasteText(e.target.value)}
                      rows={6}
                      placeholder="Paste the full job description text here..."
                      className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                    {jdParseError && <p className="text-red-600 text-[10px] font-semibold">{jdParseError}</p>}
                    <button
                      type="button"
                      onClick={handleParseJobDescription}
                      disabled={isParsingJD || !jdPasteText.trim()}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] cursor-pointer"
                    >
                      {isParsingJD ? 'Extracting...' : 'Extract & Fill Fields'}
                    </button>

                    {parsedJDExtras && (
                      <div className="mt-2 bg-white border border-slate-200 rounded-lg p-2.5 space-y-1">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Also detected (included on submit)</p>
                        <div className="flex flex-wrap gap-1.5 text-[10px]">
                          {parsedJDExtras.remoteType && <span className="bg-slate-100 px-2 py-0.5 rounded-full">{parsedJDExtras.remoteType}</span>}
                          {parsedJDExtras.employmentType && <span className="bg-slate-100 px-2 py-0.5 rounded-full">{parsedJDExtras.employmentType}</span>}
                          {parsedJDExtras.industry && <span className="bg-slate-100 px-2 py-0.5 rounded-full">Industry: {parsedJDExtras.industry}</span>}
                          {parsedJDExtras.department && <span className="bg-slate-100 px-2 py-0.5 rounded-full">Dept: {parsedJDExtras.department}</span>}
                          {parsedJDExtras.noticePeriod && <span className="bg-slate-100 px-2 py-0.5 rounded-full">Notice: {parsedJDExtras.noticePeriod}</span>}
                          {parsedJDExtras.numberOfOpenings != null && <span className="bg-slate-100 px-2 py-0.5 rounded-full">{parsedJDExtras.numberOfOpenings} opening(s)</span>}
                          {parsedJDExtras.education?.map((ed: string) => <span key={ed} className="bg-slate-100 px-2 py-0.5 rounded-full">{ed}</span>)}
                          {parsedJDExtras.certifications?.map((c: string) => <span key={c} className="bg-slate-100 px-2 py-0.5 rounded-full">{c}</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Position Title</label>
                <input
                  type="text"
                  required
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                  placeholder="Senior React Developer"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Required Skills (Comma-separated)</label>
                <input
                  type="text"
                  required
                  value={newJobSkills}
                  onChange={(e) => setNewJobSkills(e.target.value)}
                  placeholder="React, TypeScript, Tailwind, Jest"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Years Experience Required</label>
                  <input
                    type="number"
                    required
                    value={newJobExp}
                    onChange={(e) => setNewJobExp(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Location (e.g. Austin)</label>
                  <input
                    type="text"
                    required
                    value={newJobLocation}
                    onChange={(e) => setNewJobLocation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Salary Floor ($)</label>
                  <input
                    type="number"
                    required
                    value={newJobSalMin}
                    onChange={(e) => setNewJobSalMin(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Salary Ceiling ($)</label>
                  <input
                    type="number"
                    required
                    value={newJobSalMax}
                    onChange={(e) => setNewJobSalMax(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1.5 uppercase tracking-wider text-[9px]">Position Summary Description</label>
                <textarea
                  required
                  value={newJobDesc}
                  onChange={(e) => setNewJobDesc(e.target.value)}
                  rows={4}
                  placeholder="Outline core responsibilities and technical projects..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4 -mx-6 -mb-6">
                <button
                  type="button"
                  onClick={() => setShowCreateJobModal(false)}
                  className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer"
                >
                  Add Position
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
    <ChatbotWidget />
    </ProtectedRoute>
  );
}
