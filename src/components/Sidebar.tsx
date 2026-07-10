/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Home, Sparkles, Briefcase, Users, BarChart3, LogOut, UserCircle, X, Upload
} from 'lucide-react';
import TejomaLogo from './TejomaLogo.js';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userInfo: { id: number; name: string; email: string; role: string } | null;
  onLogout: () => void;
  onLogoutAll?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, userInfo, onLogout, onLogoutAll, isOpen, onClose }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'swipe', label: 'Match Candidates', icon: Sparkles, badge: 'AI Match' },
    { id: 'jobs', label: 'Job Positions', icon: Briefcase },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'resume-upload', label: 'Upload Resumes', icon: Upload },
    { id: 'analytics', label: 'Analytics Hub', icon: BarChart3 },
  ];

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
        className={`w-64 bg-white border-r border-slate-200 flex flex-col justify-between h-screen fixed inset-y-0 left-0 z-50 md:sticky md:top-0 transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        
        {/* Brand Logo & Name */}
        <div>
          <div className="p-5 border-b border-slate-200 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <TejomaLogo size="md" textColorClass="text-slate-900 font-extrabold" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Recruiting</span>
                {/* Mobile close button */}
                <button 
                  onClick={onClose}
                  className="md:hidden text-slate-500 hover:text-slate-800 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase ml-1.5">RANDOM FOREST V2</p>
          </div>

          {/* Sidebar Nav Links */}
          <nav className="p-4 space-y-1">
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
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    isActive 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <IconComponent className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
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
        <div className="p-4 border-t border-slate-200 space-y-3">
          {userInfo && (
            <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
              <UserCircle className="w-8 h-8 text-slate-400" />
              <div className="overflow-hidden text-left">
                <p className="text-xs font-semibold text-slate-800 truncate">{userInfo.name}</p>
                <p className="text-[10px] text-slate-400 truncate capitalize">{userInfo.role}</p>
              </div>
            </div>
          )}

          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-all border border-transparent hover:border-rose-200"
          >
            <LogOut className="w-4 h-4 text-slate-500 group-hover:text-rose-600" />
            <span>Terminate Session</span>
          </button>

          {onLogoutAll && (
            <button
              onClick={onLogoutAll}
              className="w-full text-center text-[10px] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
            >
              Log out from all devices
            </button>
          )}
        </div>

      </div>
    </>
  );
}
