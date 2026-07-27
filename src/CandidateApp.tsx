/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Menu, LogOut } from 'lucide-react';
import CandidateSidebar from './components/CandidateSidebar.js';
import CandidateNavSearch from './components/CandidateNavSearch.js';
import CandidateNavBell from './components/CandidateNavBell.js';
import CandidateLanding from './components/CandidateLanding.js';
import CandidateAuth from './components/CandidateAuth.js';
import CandidateOnboardingWizard from './components/CandidateOnboardingWizard.js';
import CandidateProfile from './components/CandidateProfile.js';
import CandidateResumeUpload from './components/CandidateResumeUpload.js';
import CandidateExplore from './components/CandidateExplore.js';
import CandidateLikes from './components/CandidateLikes.js';
import CandidateChat from './components/CandidateChat.js';
import CandidateJobDetail from './components/CandidateJobDetail.js';
import CandidateMatches from './components/CandidateMatches.js';
import CandidateApplications from './components/CandidateApplications.js';
import CandidateAnalytics from './components/CandidateAnalytics.js';
import CandidateProtectedRoute from './components/CandidateProtectedRoute.js';
import { useCandidateAuth } from './context/CandidateAuthContext.js';

// Tinder-style redesign: nav is now Explore/Likes/Matches/Chat/Profile (was Profile/Browse
// Jobs/Decisions/Applications/Matches). 'applications' is kept as a reachable-but-not-top-level
// view (linked from Likes) since Phase 5's application-tracking feature/data isn't part of the
// new 5-tab spec but must keep working, per "preserve existing business logic" - the underlying
// CandidateApplications.tsx/candidate-applications.routes.ts are completely unmodified.
// CandidateJobDiscovery.tsx and CandidateDecisions.tsx (the old Browse Jobs/Decisions screens)
// are superseded by CandidateExplore.tsx/CandidateLikes.tsx in the nav - both files are left
// on disk untouched, just no longer imported here.
type CandidateView = 'explore' | 'likes' | 'matches' | 'chat' | 'profile' | 'applications' | 'analytics' | 'upload-resume' | 'job-detail';

// Mirrors App.tsx's top-level auth-gate pattern (unauthenticated -> auth screen,
// authenticated -> wrapped in the matching ProtectedRoute), using local state instead of a
// router - consistent with App.tsx, which also has no client-side router. Each phase has added
// to this same local-state view switcher rather than introducing any routing dependency.
export default function CandidateApp() {
  const { isAuthenticated, loading, candidate, logout } = useCandidateAuth();
  const [view, setView] = useState<CandidateView>('explore');
  // Landing is the new front door at /candidate (Phase 6) - shown once per browser session
  // before CandidateAuth, never on its own URL. A Google OAuth redirect back to /candidate
  // (with ?auth_error=...) should land straight on the auth screen, not the landing page.
  const [showAuthDirectly] = useState(() => window.location.search.includes('auth_error='));
  const [pastLanding, setPastLanding] = useState(showAuthDirectly);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  // Job detail is reachable from Explore, Likes, Matches, or Chat - remember which one so
  // "Back" returns to the right place instead of always landing on Explore.
  const [jobDetailReturnTo, setJobDetailReturnTo] = useState<CandidateView>('explore');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/candidate-notifications/unread-count');
      if (res.ok) setUnreadCount((await res.json()).count);
    } catch {
      // Non-critical - badge just won't update this cycle.
    }
  }, []);

  // Simple polling, not the app's global SSE broadcast - that channel has no per-connection
  // identity/company scoping (see src/realtime.ts), so it's the wrong tool for a candidate's
  // own unread count. Re-checked whenever Matches is opened (marking read happens there) plus
  // every 30s in the background.
  useEffect(() => {
    if (!isAuthenticated) return;
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshUnreadCount]);

  useEffect(() => {
    if (view === 'matches') refreshUnreadCount();
  }, [view, refreshUnreadCount]);

  if (!loading && !isAuthenticated) {
    if (!pastLanding) {
      return <CandidateLanding onSelectCandidate={() => setPastLanding(true)} />;
    }
    return <CandidateAuth />;
  }

  // Onboarding gate is driven by real DB state (candidate_accounts.onboarding_completed_at),
  // not a client-only flag - new registrations start NULL so this shows exactly once; existing
  // accounts were backfilled to their own created_at so they never see it. onboardingComplete
  // additionally suppresses it for the rest of this session once the wizard finishes, without
  // waiting on a full /me refetch. Lands on Explore (was Browse Jobs) once done.
  if (isAuthenticated && candidate && candidate.onboarding_completed_at == null && !onboardingComplete) {
    return (
      <CandidateOnboardingWizard
        candidateName={candidate.name}
        onComplete={() => {
          setOnboardingComplete(true);
          setView('explore');
        }}
      />
    );
  }

  const openJobDetail = (id: number, from: CandidateView) => {
    setSelectedJobId(id);
    setJobDetailReturnTo(from);
    setView('job-detail');
  };

  // Nav hidden only on job-detail/upload-resume... actually upload-resume only (job-detail keeps
  // navigation visible, same as before this layout change). Chat keeps navigation visible too -
  // it's a top-level destination like any other, just with a taller internal layout (conversation
  // list + thread) that fills the remaining viewport height via flex-1/min-h-0 rather than hiding
  // navigation entirely.
  const showNav = view !== 'upload-resume';
  const activeForSidebar: CandidateView = view === 'job-detail' ? jobDetailReturnTo : view;

  return (
    <CandidateProtectedRoute>
      <div className="flex min-h-screen w-full" style={{ backgroundColor: '#F8FAFC' }}>
        {showNav && (
          <CandidateSidebar
            view={activeForSidebar}
            setView={setView}
            candidateName={candidate?.name || 'Candidate'}
            unreadCount={unreadCount}
            onLogout={logout}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
        )}

        <div className={`flex-1 min-w-0 flex flex-col ${view === 'chat' ? 'h-screen' : 'min-h-screen'}`}>
          {showNav && (
            <div className="flex items-center gap-2 px-4 sm:px-6 h-16 bg-white/90 backdrop-blur-sm border-b border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sticky top-0 z-10">
              <button
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open navigation menu"
                className="md:hidden text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-slate-50 hover:bg-white hover:shadow-xs transition-all cursor-pointer flex-shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex-1" />
              <div className="flex items-center gap-1 sm:gap-1.5">
                <CandidateNavSearch onSelectJob={(id) => openJobDetail(id, activeForSidebar)} />
                <div className="hidden sm:block w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
                <CandidateNavBell unreadCount={unreadCount} onRefreshCount={refreshUnreadCount} onNavigateToMatches={() => setView('matches')} />
                <button
                  onClick={() => logout()}
                  aria-label="Log out"
                  title="Log out"
                  className="w-6 h-6 lg:w-9 lg:h-9 rounded-full flex items-center justify-center flex-shrink-0 border border-transparent text-slate-500 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 lg:hover:shadow-xs transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {view === 'explore' && (
            <CandidateExplore onSelectJob={(id) => openJobDetail(id, 'explore')} />
          )}
          {view === 'likes' && (
            <CandidateLikes onSelectJob={(id) => openJobDetail(id, 'likes')} onViewApplications={() => setView('applications')} />
          )}
          {view === 'matches' && (
            <CandidateMatches onSelectJob={(id) => openJobDetail(id, 'matches')} />
          )}
          {view === 'chat' && (
            <div className="flex-1 min-h-0">
              <CandidateChat onSelectJob={(id) => openJobDetail(id, 'chat')} />
            </div>
          )}
          {view === 'profile' && <CandidateProfile onUploadResume={() => setView('upload-resume')} />}
          {view === 'upload-resume' && (
            <CandidateResumeUpload onDone={() => setView('profile')} onCancel={() => setView('profile')} />
          )}
          {view === 'applications' && (
            <CandidateApplications onSelectJob={(id) => openJobDetail(id, 'applications')} />
          )}
          {view === 'analytics' && <CandidateAnalytics />}
          {view === 'job-detail' && selectedJobId != null && (
            <CandidateJobDetail jobId={selectedJobId} onBack={() => setView(jobDetailReturnTo)} />
          )}
        </div>
      </div>
    </CandidateProtectedRoute>
  );
}
