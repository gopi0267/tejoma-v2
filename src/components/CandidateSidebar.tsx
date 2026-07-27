import React from 'react';
import { Compass, Heart, ListChecks, Sparkles, MessageSquare, BarChart3, User, X, LogOut } from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';

export type CandidateView = 'explore' | 'likes' | 'matches' | 'chat' | 'profile' | 'applications' | 'analytics' | 'upload-resume' | 'job-detail';

interface CandidateSidebarProps {
  view: CandidateView;
  setView: (v: CandidateView) => void;
  candidateName: string;
  unreadCount: number;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

// Mirrors Sidebar.tsx (the Recruiter Management reference) as closely as the candidate portal's
// actual needs allow: same width/border tokens, same emerald active-state language, same mobile
// fixed-drawer + desktop md:sticky behavior, same bottom profile-card + logout pattern. Deliberately
// NOT replicated: Sidebar.tsx's tablet icon-only collapse rail (a Recruiter-specific complexity tied
// to multi-role/plan tiers, never requested here) and the company/role display (candidates don't
// have either concept) - everything else is a direct visual-language match, refined with a chip-style
// active icon, initials avatar, and subtle elevation for a more polished, production-grade finish.
const NAV_ITEMS: { id: CandidateView; label: string; icon: React.ReactNode }[] = [
  { id: 'explore', label: 'Explore', icon: <Compass className="w-4 h-4" /> },
  { id: 'likes', label: 'Likes', icon: <Heart className="w-4 h-4" /> },
  { id: 'applications', label: 'Applications', icon: <ListChecks className="w-4 h-4" /> },
  { id: 'matches', label: 'Matches', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export default function CandidateSidebar({ view, setView, candidateName, unreadCount, onLogout, isOpen, onClose }: CandidateSidebarProps) {
  return (
    <>
      {/* Backdrop for mobile drawer view - same treatment as Sidebar.tsx */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 md:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <div
        id="candidate-application-sidebar"
        className={`w-64 bg-white border-r border-slate-200 shadow-[1px_0_3px_rgba(15,23,42,0.03)] flex flex-col justify-between h-dvh fixed inset-y-0 left-0 z-50 md:sticky md:top-0 transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand logo - same slot/position as Sidebar.tsx */}
          <div className="p-5 border-b border-slate-200 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <TejomaLogo size="md" textColorClass="text-slate-900 font-extrabold" />
              <button
                onClick={onClose}
                aria-label="Close navigation menu"
                className="md:hidden text-slate-500 hover:text-slate-800 p-2.5 -m-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Nav links - Sidebar.tsx's active/inactive language, with a chip-style icon badge and
              subtle elevation on the active row for a more finished, "lifted" feel. */}
          <nav className="p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setView(item.id); onClose(); }}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group w-full flex items-center justify-between rounded-xl text-xs font-medium transition-all min-h-[44px] px-2.5 py-2 border ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 shadow-[0_1px_3px_rgba(16,185,129,0.12)]'
                      : 'text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                        isActive ? 'bg-white text-emerald-600 shadow-xs' : 'text-slate-400 group-hover:text-slate-600 group-hover:bg-white'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>
                  {item.id === 'matches' && unreadCount > 0 && (
                    <span className="bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center leading-none ring-2 ring-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Candidate profile card & log out - same slot as Sidebar.tsx's bottom section, with an
            initials avatar (matching the app's emerald brand accent) instead of a generic icon. */}
        <div className="p-2.5 sm:p-4 border-t border-slate-200 space-y-2 sm:space-y-3">
          <div className="flex items-center gap-2.5 py-2 px-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 shadow-sm">
              {initialsOf(candidateName)}
            </div>
            <div className="overflow-hidden text-left">
              <p className="text-xs font-semibold text-slate-800 truncate">{candidateName}</p>
              <p className="text-[10px] text-slate-400 truncate">Candidate</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 rounded-lg transition-colors cursor-pointer min-h-[32px]"
          >
            <LogOut className="w-3.5 h-3.5" /> Log Out
          </button>
        </div>
      </div>
    </>
  );
}
