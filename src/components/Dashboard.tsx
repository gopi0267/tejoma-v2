/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  PlusCircle, Sparkles, TrendingUp, Users, CheckSquare, Clock, ArrowRight, Activity 
} from 'lucide-react';
import { Job, DashboardStats } from '../types.js';
import { apiFetch } from '../utils/apiFetch.js';

interface DashboardProps {
  setActiveTab: (tab: string) => void;
  setSelectedJobId: (id: number) => void;
  onOpenCreateJobModal: () => void;
}

export default function Dashboard({ setActiveTab, setSelectedJobId, onOpenCreateJobModal }: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, jobsRes] = await Promise.all([
        apiFetch('/api/analytics/dashboard'),
        apiFetch('/api/jobs')
      ]);
      const statsData = await statsRes.json();
      const jobsData = await jobsRes.json();
      
      setStats(statsData);
      setJobs(jobsData);
    } catch (e) {
      console.error('Failed to load dashboard statistics:', e);
    } finally {
      setLoading(false);
    }
  };

  const startMatching = (jobId: number) => {
    setSelectedJobId(jobId);
    setActiveTab('swipe');
  };

  if (loading || !stats) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-500 font-mono">Loading telemetry feeds...</p>
        </div>
      </div>
    );
  }

  // Calculate high-fidelity custom SVG line heights for trend visualizers
  const maxSwipes = Math.max(...stats.swipesTrend.map(t => t.swipes), 10);
  const chartHeight = 120;
  const chartWidth = 500;
  const points = stats.swipesTrend.map((t, idx) => {
    const x = (idx / (stats.swipesTrend.length - 1)) * chartWidth;
    const y = chartHeight - (t.swipes / maxSwipes) * (chartHeight - 20);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="p-4 sm:p-8 space-y-4 sm:space-y-8 overflow-y-auto h-full max-w-7xl mx-auto">
      
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Recruiting Command Center</h1>
          <p className="text-xs text-slate-500 mt-1">Real-time matching efficiency and model analytics for Tejoma Corp.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onOpenCreateJobModal}
            className="bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <PlusCircle className="w-4 h-4 text-emerald-500" /> New Job Position
          </button>
          <button
            onClick={() => setActiveTab('swipe')}
            className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <Sparkles className="w-4 h-4 text-white animate-pulse" /> Launch Matcher
          </button>
        </div>
      </div>

      {/* Stats Dashboard Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Swipes Today */}
        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Swipes Today</span>
            <p className="text-2xl font-bold text-slate-900 font-mono">{stats.totalSwipesToday || 0}</p>
            <span className="text-[9px] text-emerald-600 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> +14.5% versus yesterday
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
            <CheckSquare className="w-6 h-6" />
          </div>
        </div>

        {/* Acceptance Rate */}
        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Acceptance Rate</span>
            <p className="text-2xl font-bold text-slate-900 font-mono">{stats.acceptanceRate || 0}%</p>
            <span className="text-[9px] text-slate-500 flex items-center gap-1">
              Optimal matching range
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Candidates Reviewed */}
        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Total Reviewed</span>
            <p className="text-2xl font-bold text-slate-900 font-mono">{stats.totalCandidatesReviewed || 0}</p>
            <span className="text-[9px] text-indigo-600 flex items-center gap-1">
              Model accuracy: 84.5%
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        {/* Pending Candidates */}
        <div className="bg-white border border-slate-200 p-5 rounded-2xl flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Queue Remaining</span>
            <p className="text-2xl font-bold text-slate-900 font-mono">{stats.pendingCandidates || 0}</p>
            <span className="text-[9px] text-amber-600 flex items-center gap-1">
              Requires review attention
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
            <Clock className="w-6 h-6" />
          </div>
        </div>

      </div>

      {/* Main Grid: Left Side Trend/Recent, Right Side Jobs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Trend Chart */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Review Activity Trend</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">7-day tracking metric of total candidate swipes.</p>
              </div>
              <span className="text-[9px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                LIVE TELEMETRY
              </span>
            </div>

            {/* Custom SVG Line Graph */}
            <div className="relative h-32 w-full mt-4">
              <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                {/* Grid Lines */}
                <line x1="0" y1="20" x2={chartWidth} y2="20" stroke="#E2E8F0" strokeDasharray="4" strokeWidth="0.5" />
                <line x1="0" y1="60" x2={chartWidth} y2="60" stroke="#E2E8F0" strokeDasharray="4" strokeWidth="0.5" />
                <line x1="0" y1="100" x2={chartWidth} y2="100" stroke="#E2E8F0" strokeDasharray="4" strokeWidth="0.5" />
                
                {/* SVG Polyline representing the data */}
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  points={points}
                />

                {/* Data Points hover visualizers */}
                {stats.swipesTrend.map((t, idx) => {
                  const x = (idx / (stats.swipesTrend.length - 1)) * chartWidth;
                  const y = chartHeight - (t.swipes / maxSwipes) * (chartHeight - 20);
                  return (
                    <g key={idx}>
                      <circle
                        cx={x}
                        cy={y}
                        r="4"
                        fill="#10b981"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* X-axis labels */}
            <div className="flex justify-between text-[9px] text-slate-400 font-mono mt-3">
              {stats.swipesTrend.map((t, idx) => (
                <span key={idx}>{t.date.split('-').slice(1).join('/')}</span>
              ))}
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-bold text-slate-900">Live Workspace Activity</h3>
            </div>

            <div className="space-y-3">
              {stats.recent_activity && stats.recent_activity.length > 0 ? (
                stats.recent_activity.map((act) => (
                  <div key={act.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-left">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        act.action === 'accept' ? 'bg-emerald-500' : act.action === 'save' ? 'bg-amber-500' : 'bg-rose-500'
                      }`} />
                      <div className="overflow-hidden">
                        <p className="text-slate-600 font-medium truncate">
                          {act.recruiterName} swiped <span className="font-bold text-slate-900">{act.candidateName}</span>
                        </p>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{act.jobTitle}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4 font-mono text-[9px] text-slate-400">
                      {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">No recent swipes processed yet.</p>
              )}
            </div>
          </div>

        </div>

        {/* Right Side Positions (5 Cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-900">Active Positions</h3>
              <span className="text-[10px] text-slate-400 font-mono">{jobs.length} jobs</span>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[380px] pr-1">
              {jobs.map((job) => (
                <div 
                  key={job.id} 
                  className="p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition-colors flex flex-col justify-between text-left"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-bold text-slate-800 truncate">{job.title}</h4>
                      <p className="text-[10px] text-slate-500 font-mono mt-1 capitalize">{job.location} · {job.experience_years}+ Yrs Exp</p>
                    </div>
                    <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider flex-shrink-0">
                      {job.status}
                    </span>
                  </div>

                  {/* Tiny progress status overview */}
                  <div className="flex justify-between items-center mt-4 text-[10px] text-slate-500 border-t border-slate-100 pt-3">
                    <div className="flex gap-4">
                      <div>
                        <span className="text-[9px] text-slate-400 block">Reviewed</span>
                        <span className="font-mono font-medium text-slate-700">{(job as any).reviewed || 0}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 block">Accepted</span>
                        <span className="font-mono font-medium text-emerald-600">{(job as any).accepted || 0}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => startMatching(job.id)}
                      className="text-emerald-600 hover:text-emerald-500 font-semibold flex items-center gap-1 hover:translate-x-0.5 transition-transform cursor-pointer"
                    >
                      Swipe Matches <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setActiveTab('jobs')}
            className="w-full bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold py-2 rounded-xl text-xs transition-colors text-center mt-4 cursor-pointer"
          >
            Manage All Positions
          </button>
        </div>

      </div>

    </div>
  );
}
