import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Users, Award, Zap, Download, RefreshCw, Clock, ArrowUpRight, 
  Activity, Briefcase, ChevronRight, BarChart3, AlertCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../utils/apiFetch.js';

interface DashboardStats {
  total_reviewed: number;
  matches_made: number;
  avg_score: number;
  acceptance_rate: number;
  trends: { date: string; swipes: number }[];
  recent_activity: {
    id: number;
    recruiterName: string;
    candidateName: string;
    jobTitle: string;
    action: 'accept' | 'save' | 'reject';
    matchScore: number;
    timestamp: string;
  }[];
}

interface SkillStat {
  skill: string;
  count: number;
}

interface RecruiterStat {
  id: number;
  name: string;
  email: string | null;
  swipesCount: number;
  acceptanceRate: number;
  averageMatchScore: number;
  // null until enough decision-timing data exists for this recruiter (see
  // migration-analytics-decision-timing.sql) - rendered as "N/A", never a fake number.
  avgTimeSpentSeconds: number | null;
  lastLoginAt: string | null;
  status: 'active' | 'disabled';
}

export default function Analytics() {
  const [dashboardData, setDashboardData] = useState<DashboardStats | null>(null);
  const [skillsData, setSkillsData] = useState<SkillStat[]>([]);
  const [recruiterData, setRecruiterData] = useState<RecruiterStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; val: number; date: string } | null>(null);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [dashRes, skillsRes, recRes] = await Promise.all([
        apiFetch('/api/analytics/dashboard'),
        apiFetch('/api/analytics/skills'),
        apiFetch('/api/analytics/recruiter/me')
      ]);

      if (!dashRes.ok || !skillsRes.ok || !recRes.ok) {
        throw new Error('Failed to retrieve recruiter analytical telemetries.');
      }

      const dashJson = await dashRes.json();
      const skillsJson = await skillsRes.json();
      const recJson = await recRes.json();

      setDashboardData(dashJson);
      setSkillsData(skillsJson);
      setRecruiterData(recJson);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Network exception during analytics sync.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();
    // Auto-refresh so the page reflects new swipes without a manual reload - polls the same
    // already company-scoped endpoints rather than subscribing to the app's global SSE broadcast
    // (src/realtime.ts), which isn't scoped per-tenant and would leak other companies' event
    // payloads to this browser.
    const interval = setInterval(fetchAnalyticsData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleExportCSV = () => {
    if (!dashboardData) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Metric,Value\n";
    csvContent += `Total Candidates Evaluated,${dashboardData.total_reviewed}\n`;
    csvContent += `Matches Accepted,${dashboardData.matches_made}\n`;
    csvContent += `Average Calibration Score,${dashboardData.avg_score}%\n`;
    csvContent += `Overall Acceptance Ratio,${dashboardData.acceptance_rate}%\n\n`;
    
    csvContent += "Skill Analytics,Frequency Count\n";
    skillsData.forEach(s => {
      csvContent += `"${s.skill}",${s.count}\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `tejoma_talent_intelligence_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div id="analytics-loading-screen" className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
        <p className="text-sm font-semibold tracking-wide font-mono">Processing real-time talent intelligence...</p>
      </div>
    );
  }

  if (error || !dashboardData) {
    return (
      <div id="analytics-error-screen" className="flex flex-col items-center justify-center min-h-[400px] gap-4 max-w-md mx-auto text-center px-4">
        <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800">Telemetry Sync Failed</h3>
          <p className="text-xs text-slate-500 leading-relaxed">{error || 'An unexpected telemetry pipeline fault has occurred.'}</p>
        </div>
        <button
          onClick={fetchAnalyticsData}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reconnect Telemetry
        </button>
      </div>
    );
  }

  // Calculate highest trend point for SVG height ratios
  const maxSwipes = Math.max(...dashboardData.trends.map(t => t.swipes), 5);
  const chartHeight = 160;
  const chartWidth = 500;
  const paddingX = 40;
  const paddingY = 20;

  // Generate SVG coordinates for trend line
  const points = dashboardData.trends.map((t, idx) => {
    const totalPoints = dashboardData.trends.length;
    const x = paddingX + (idx / (totalPoints - 1)) * (chartWidth - paddingX * 2);
    const y = chartHeight - paddingY - (t.swipes / maxSwipes) * (chartHeight - paddingY * 2);
    return { x, y, val: t.swipes, date: t.date };
  });

  const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length > 0 
    ? `${linePath} L ${points[points.length - 1].x} ${chartHeight - paddingY} L ${points[0].x} ${chartHeight - paddingY} Z`
    : '';

  return (
    <motion.div 
      id="analytics-dashboard-viewport"
      className="p-4 sm:p-8 space-y-6 text-slate-800 overflow-y-auto h-full max-w-7xl mx-auto"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {/* Header section with telemetry actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5.5 h-5.5 text-indigo-500" /> Talent Intelligence & Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-1">Real-time matching efficiencies, calibration ratios, and skill market distributions.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAnalyticsData}
            className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl transition-all text-slate-500 flex items-center justify-center cursor-pointer"
            title="Refresh telemetries"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-indigo-100 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export Raw Metrics
          </button>
        </div>
      </div>

      {/* Grid of Key Telemetry Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Evaluated */}
        <div className="bg-white border border-slate-200/70 p-4 rounded-2xl flex flex-col justify-between shadow-xs relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-16 h-16 bg-slate-50 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
          <div className="flex items-center justify-between relative z-10">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Candidates Processed</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl font-extrabold text-slate-950 font-mono tracking-tight">{dashboardData.total_reviewed}</span>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
              <Activity className="w-3.5 h-3.5 text-indigo-500" /> active indexation
            </div>
          </div>
        </div>

        {/* Card 2: Matches Made */}
        <div className="bg-white border border-slate-200/70 p-4 rounded-2xl flex flex-col justify-between shadow-xs relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-16 h-16 bg-slate-50 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
          <div className="flex items-center justify-between relative z-10">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Matches Accepted</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl font-extrabold text-slate-950 font-mono tracking-tight">{dashboardData.matches_made}</span>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-emerald-600 font-medium">
              <TrendingUp className="w-3.5 h-3.5" /> positive recruitment response
            </div>
          </div>
        </div>

        {/* Card 3: Acceptance Rate */}
        <div className="bg-white border border-slate-200/70 p-4 rounded-2xl flex flex-col justify-between shadow-xs relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-16 h-16 bg-slate-50 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
          <div className="flex items-center justify-between relative z-10">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Acceptance Ratio</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl font-extrabold text-slate-950 font-mono tracking-tight">{dashboardData.acceptance_rate}%</span>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
              <ArrowUpRight className="w-3.5 h-3.5 text-amber-500" /> pipeline flow velocity
            </div>
          </div>
        </div>

        {/* Card 4: Calibration Accuracy */}
        <div className="bg-white border border-slate-200/70 p-4 rounded-2xl flex flex-col justify-between shadow-xs relative overflow-hidden group">
          <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-16 h-16 bg-slate-50 rounded-full group-hover:scale-110 transition-transform duration-300"></div>
          <div className="flex items-center justify-between relative z-10">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Average Match Fit</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 relative z-10">
            <span className="text-2xl font-extrabold text-slate-950 font-mono tracking-tight">{dashboardData.avg_score}%</span>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
              <Clock className="w-3.5 h-3.5 text-indigo-500" /> dynamic weight average
            </div>
          </div>
        </div>

      </div>

      {/* Main interactive visualization block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* SVG interactive trend graph (2 cols) */}
        <div className="bg-white border border-slate-200/70 rounded-2xl p-4 lg:col-span-2 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Active Evaluation Volumetrics</h3>
                <p className="text-[10px] text-slate-400">Daily candidates evaluated in the past 7 standard indexation cycles.</p>
              </div>
              <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full font-mono font-semibold text-slate-500">Live Trend</span>
            </div>
          </div>

          <div className="relative mt-4 flex justify-center items-center">
            <svg 
              viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
              className="w-full h-auto overflow-visible select-none"
            >
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.00" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                const yVal = paddingY + ratio * (chartHeight - paddingY * 2);
                const labelVal = Math.round(maxSwipes - ratio * maxSwipes);
                return (
                  <g key={index}>
                    <line 
                      x1={paddingX} 
                      y1={yVal} 
                      x2={chartWidth - paddingX} 
                      y2={yVal} 
                      stroke="#F1F5F9" 
                      strokeWidth="1.5" 
                      strokeDasharray="4 4"
                    />
                    <text 
                      x={paddingX - 10} 
                      y={yVal + 3} 
                      fill="#94A3B8" 
                      fontSize="9" 
                      fontFamily="monospace" 
                      textAnchor="end"
                    >
                      {labelVal}
                    </text>
                  </g>
                );
              })}

              {/* Shaded Area */}
              {areaPath && <path d={areaPath} fill="url(#chartGradient)" />}

              {/* Polyline Path */}
              {linePath && (
                <path 
                  d={linePath} 
                  fill="none" 
                  stroke="#4F46E5" 
                  strokeWidth="2.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
              )}

              {/* Data points */}
              {points.map((p, idx) => (
                <g key={idx}>
                  <circle 
                    cx={p.x} 
                    cy={p.y} 
                    r="4.5" 
                    fill="#FFFFFF" 
                    stroke="#4F46E5" 
                    strokeWidth="2" 
                    className="cursor-pointer transition-all hover:scale-130 hover:r-6"
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredPoint({ x: p.x, y: p.y, val: p.val, date: p.date });
                    }}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                  {/* Axis dates */}
                  <text 
                    x={p.x} 
                    y={chartHeight - 3} 
                    fill="#94A3B8" 
                    fontSize="8.5" 
                    fontFamily="monospace" 
                    textAnchor="middle"
                  >
                    {p.date.substring(5)}
                  </text>
                </g>
              ))}

              {/* Interactive Tooltip Overlay */}
              {hoveredPoint && (
                <g>
                  {/* Tooltip background card */}
                  <rect 
                    x={Math.max(10, Math.min(chartWidth - 110, hoveredPoint.x - 50))} 
                    y={Math.max(5, hoveredPoint.y - 38)} 
                    width="100" 
                    height="28" 
                    rx="6" 
                    fill="#0F172A" 
                    opacity="0.95" 
                  />
                  <text 
                    x={Math.max(10, Math.min(chartWidth - 110, hoveredPoint.x - 50)) + 50} 
                    y={Math.max(5, hoveredPoint.y - 38) + 11} 
                    fill="#F1F5F9" 
                    fontSize="8.5" 
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {hoveredPoint.val} evaluations
                  </text>
                  <text 
                    x={Math.max(10, Math.min(chartWidth - 110, hoveredPoint.x - 50)) + 50} 
                    y={Math.max(5, hoveredPoint.y - 38) + 21} 
                    fill="#94A3B8" 
                    fontSize="7" 
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {hoveredPoint.date}
                  </text>
                </g>
              )}
            </svg>
          </div>
          <div className="border-t border-slate-50 pt-2.5 flex justify-between items-center text-[10px] text-slate-400">
            <span>Graph updates on live candidate evaluations.</span>
            <span className="text-indigo-500 font-bold flex items-center gap-0.5">● Auto-refreshing every 30s</span>
          </div>
        </div>

        {/* Recruiter calibration performance & velocity */}
        <div className="bg-white border border-slate-200/70 rounded-2xl p-4 flex flex-col justify-between shadow-xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Active Recruiter Profile</h3>
            <p className="text-[10px] text-slate-400">Your own calibration efficiency metrics.</p>
          </div>

          {recruiterData ? (
            <div className="space-y-4 my-4 flex-1 flex flex-col justify-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-700 font-extrabold flex items-center justify-center text-sm border border-indigo-100">
                  {recruiterData.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">{recruiterData.name}</h4>
                  <span className="text-[10px] text-slate-400 font-mono">{recruiterData.email || '-'}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded border ${recruiterData.status === 'active' ? 'text-emerald-700 border-emerald-100 bg-emerald-50' : 'text-rose-700 border-rose-100 bg-rose-50'}`}>{recruiterData.status}</span>
                    <span className="text-[9px] text-slate-400">Last login: {recruiterData.lastLoginAt ? new Date(recruiterData.lastLoginAt).toLocaleString() : 'Never'}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left pt-2">
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Total Actions</span>
                  <span className="text-sm font-extrabold text-slate-900 font-mono block mt-0.5">{recruiterData.swipesCount}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Acceptance Ratio</span>
                  <span className="text-sm font-extrabold text-slate-900 font-mono block mt-0.5">{recruiterData.acceptanceRate}%</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Mean Match Weight</span>
                  <span className="text-sm font-extrabold text-slate-900 font-mono block mt-0.5">{recruiterData.averageMatchScore}%</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Avg Review Velocity</span>
                  <span className="text-sm font-extrabold text-indigo-600 font-mono block mt-0.5">{recruiterData.avgTimeSpentSeconds != null ? `${recruiterData.avgTimeSpentSeconds}s` : 'N/A'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center text-[11px] text-slate-400 font-mono">Profile loaded offline</div>
          )}

          <div className="border-t border-slate-50 pt-2 text-[9px] text-slate-400">
            Calibration speed tracks manual screen timings.
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Top skills indexed list */}
        <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-xs">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Market Skill Distributions</h3>
            <p className="text-[10px] text-slate-400">Prevalent skills identified in the candidate database.</p>
          </div>

          <div className="space-y-3">
            {skillsData.length > 0 ? (
              skillsData.map((s, idx) => {
                const maxCount = Math.max(...skillsData.map(item => item.count), 1);
                const pct = (s.count / maxCount) * 100;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span> {s.skill}
                      </span>
                      <span className="font-bold text-slate-500 font-mono text-[10px]">{s.count} candidates</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: idx * 0.05 }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-10 text-center text-slate-400 text-xs font-mono">No skill telemetries indexed.</div>
            )}
          </div>
        </div>

        {/* Recent stream tracking */}
        <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Active Evaluation Stream</h3>
            <p className="text-[10px] text-slate-400">Chronological telemetry of recruiter decisions.</p>
          </div>

          <div className="mt-4 flex-1 divide-y divide-slate-100 max-h-[295px] overflow-y-auto custom-scrollbar">
            {dashboardData.recent_activity && dashboardData.recent_activity.length > 0 ? (
              dashboardData.recent_activity.map((activity, index) => {
                const isAccept = activity.action === 'accept';
                const isSave = activity.action === 'save';
                const isReject = activity.action === 'reject';
                
                let actionBadge = '';
                let actionColor = '';
                if (isAccept) {
                  actionBadge = 'Accepted';
                  actionColor = 'text-emerald-700 bg-emerald-50 border-emerald-100/30';
                } else if (isSave) {
                  actionBadge = 'Saved';
                  actionColor = 'text-amber-700 bg-amber-50 border-amber-100/30';
                } else {
                  actionBadge = 'Rejected';
                  actionColor = 'text-rose-700 bg-rose-50 border-rose-100/30';
                }

                return (
                  <div key={activity.id || index} className="py-2.5 flex items-center justify-between gap-3 text-left">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-800 truncate max-w-[120px]">{activity.candidateName}</span>
                        <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${actionColor}`}>
                          {actionBadge}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[200px]">{activity.jobTitle} · by {activity.recruiterName}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-[10px] font-mono font-bold text-slate-600">{activity.matchScore}%</span>
                      <span className="text-[9px] text-slate-400 font-mono block">
                        {new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-10 text-center text-slate-400 text-xs font-mono flex flex-col items-center justify-center gap-2">
                <Clock className="w-5 h-5 text-slate-300" />
                <span>No live matches recorded. Start swiping candidates to compile evaluations!</span>
              </div>
            )}
          </div>
        </div>

      </div>

    </motion.div>
  );
}
