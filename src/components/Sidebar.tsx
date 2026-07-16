/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Home, Sparkles, Briefcase, Users, BarChart3, UserCircle, X, Upload, ClipboardCheck,
  ChevronLeft, ChevronRight, UserCog, ShieldAlert
} from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';
import { useResponsiveBreakpoint } from '../hooks/useResponsiveBreakpoint.js';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userInfo: { id: number; name: string; email: string; role: string } | null;
  company?: { id: number; name: string; logo_url: string | null; plan: string } | null;
  onLogout: () => void;
  onLogoutAll?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, userInfo, company, onLogout, onLogoutAll, isOpen, onClose }: SidebarProps) {
  const { isTablet } = useResponsiveBreakpoint();
  // Tablet gets a third tier: an icon-only rail, collapsible via the toggle below - defaults to
  // expanded so labeled items (including "Terminate Session") are visible without an extra
  // click. Mobile (overlay drawer) and desktop (always-permanent) are unaffected by this state.
  const [tabletCollapsed, setTabletCollapsed] = useState(false);
  const collapsed = isTablet && tabletCollapsed;

  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'swipe', label: 'Match Candidates', icon: Sparkles, badge: 'AI Match' },
    { id: 'recruiter-review', label: 'Recruiter Review', icon: ClipboardCheck },
    { id: 'jobs', label: 'Job Positions', icon: Briefcase },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'resume-upload', label: 'Upload Resumes', icon: Upload },
    { id: 'analytics', label: 'Analytics Hub', icon: BarChart3 },
    { id: 'user-management', label: 'User Management', icon: UserCog, adminOnly: true },
    { id: 'tenant-requests', label: 'Tenant Requests', icon: ShieldAlert, superadminOnly: true },
  ];
  // User Management adds/manages recruiter accounts for the company - only Company Admins
  // (and superadmin, which cascades down via requireRole on the API side too) should see it.
  // Tenant Requests reviews/approves brand-new companies - superadmin only, never a Company
  // Admin or Recruiter, enforced again server-side by requireRole('superadmin').
  const menuItems = allMenuItems.filter((item) =>
    (!item.adminOnly || userInfo?.role === 'admin' || userInfo?.role === 'superadmin') &&
    (!item.superadminOnly || userInfo?.role === 'superadmin')
  );

  return (
    <>
      {/* Backdrop for mobile drawer view */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 md:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <div
        id="application-sidebar"
        // h-dvh (dynamic viewport height), not h-screen (static 100vh) - on real mobile
        // browsers, 100vh includes space the address bar covers, which can push this
        // fixed-position sidebar's bottom content (Terminate Session) out of the visible area.
        // dvh tracks the actual visible viewport instead.
        className={`${collapsed ? 'w-16' : 'w-64'} bg-white border-r border-slate-200 flex flex-col justify-between h-dvh fixed inset-y-0 left-0 z-50 md:sticky md:top-0 transition-[width,transform] duration-300 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >

        {/* Brand Logo & Name */}
        <div>
          <div className={`p-5 border-b border-slate-200 flex flex-col gap-1.5 ${collapsed ? 'items-center px-2' : ''}`}>
            <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
              {/* TejomaLogo bakes the full wordmark into one wide image (no icon-only crop
                  available), so it doesn't fit the 64px collapsed rail - only shown expanded. */}
              {!collapsed && (
                <TejomaLogo size="md" textColorClass="text-slate-900 font-extrabold" />
              )}
              {!collapsed && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Recruiting</span>
                  {/* Mobile close button */}
                  <button
                    onClick={onClose}
                    aria-label="Close navigation menu"
                    className="md:hidden text-slate-500 hover:text-slate-800 p-2.5 -m-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              {/* Tablet collapse/expand toggle - only relevant in the 768-1023px band */}
              {isTablet && (
                <button
                  onClick={() => setTabletCollapsed((v) => !v)}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className="hidden md:flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
              )}
            </div>
            {!collapsed && (
              <>
                <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase ml-1.5">RANDOM FOREST V2</p>
                {company && (
                  <div className="flex items-center gap-1.5 ml-1.5 mt-0.5">
                    {company.logo_url && (
                      <img src={company.logo_url} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
                    )}
                    <p className="text-[10px] text-slate-500 font-medium truncate">{company.name}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sidebar Nav Links */}
          <nav className={`p-4 space-y-1 ${collapsed ? 'px-2' : ''}`}>
            {menuItems.map((item) => {
              const IconComponent = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    if (onClose) onClose();
                  }}
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                  className={`w-full flex items-center rounded-xl text-xs font-medium transition-all min-h-[44px] ${
                    collapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <div className={`flex items-center ${collapsed ? '' : 'gap-3'}`}>
                    <IconComponent className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                    {!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && item.badge && (
                    <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-200/50 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Recruiter Profile Card & Log Out */}
        <div className={`p-2.5 sm:p-4 border-t border-slate-200 space-y-2 sm:space-y-3 ${collapsed ? 'px-2' : ''}`}>
          {userInfo && (
            <div
              className={`flex items-center gap-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 ${collapsed ? 'justify-center px-1.5' : 'px-2'}`}
              title={collapsed ? `${userInfo.name} (${userInfo.role})` : undefined}
            >
              <UserCircle className="w-8 h-8 text-slate-400 flex-shrink-0" />
              {!collapsed && (
                <div className="overflow-hidden text-left">
                  <p className="text-xs font-semibold text-slate-800 truncate">{userInfo.name}</p>
                  <p className="text-[10px] text-slate-400 truncate capitalize">{userInfo.role}</p>
                </div>
              )}
            </div>
          )}

          {onLogoutAll && !collapsed && (
            <button
              onClick={onLogoutAll}
              className="w-full text-center text-[10px] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer min-h-[24px]"
            >
              Log out from all devices
            </button>
          )}
        </div>

      </div>
    </>
  );
}
