import React, { useState, useEffect } from 'react';
import {
  BarChart3, Target, Users, Sparkles, Heart, Eye, ThumbsUp, ListChecks, Trophy,
  Wallet, MapPin, Lightbulb, AlertCircle, TrendingUp, Clock, CheckCircle2,
} from 'lucide-react';

interface AnalyticsData {
  averageMatchScore: number | null;
  matchDistribution: Record<'90+' | '80-89' | '70-79' | '60-69' | 'below60', number>;
  totalLikedJobsScored: number;
  recruiterResponseRate: number | null;
  reviewedCount: number;
  interestedCount: number;
  funnel: { liked: number; reviewedByRecruiters: number; interested: number; shortlisted: number; accepted: number };
  topSkills: { skill: string; count: number; percentOfLikedJobs: number }[];
  salary: { candidateExpected: number | null; avgMatchedJobSalary: number | null; avgInterestedRecruiterSalary: number | null };
  topLocations: { location: string; count: number; percent: number }[];
  profileViewCount: number;
  profileUpdatedAt: string;
  activityTrend7: { liked: TrendPoint[]; recruiterInterest: TrendPoint[]; matches: TrendPoint[] };
  activityTrend30: { liked: TrendPoint[]; recruiterInterest: TrendPoint[]; matches: TrendPoint[] };
  recommendations: { skill: string; affectedJobs: number; expectedMatchIncrease: number }[];
  insights: { type: string; message: string }[];
  interviewProbability: number | null;
  interviewProbabilityIsHeuristic: boolean;
}
interface TrendPoint { date: string; count: number }
interface ProfileCompletion { percent: number; filled: number; total: number }

function formatSalary(v: number | null): string {
  if (v === null) return 'Not available';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  return `₹${v.toLocaleString()}`;
}

function KpiCard({ icon, label, value, sublabel, accent }: { icon: React.ReactNode; label: string; value: string; sublabel?: string; accent: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: accent + '1A' }}>
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <p className="text-xs font-semibold text-[#666666]">{label}</p>
      </div>
      <p className="text-3xl font-black text-[#1A1A1A] tracking-tight">{value}</p>
      {sublabel && <p className="text-[11px] text-[#999999] mt-1">{sublabel}</p>}
    </div>
  );
}

function SectionCard({ icon, title, subtitle, children, empty }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-lg bg-[#E5F5E5] flex items-center justify-center flex-shrink-0">{icon}</div>
        <h2 className="text-sm font-bold text-[#1A1A1A]">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-[#999999] ml-[42px] mb-5">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-5'}>
        {empty ? <p className="text-xs text-[#999999] text-center py-8">Not enough data yet - keep exploring jobs to see this fill in.</p> : children}
      </div>
    </div>
  );
}

function HorizontalBar({ label, count, percent, color }: { label: string; count: number; percent: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-semibold text-[#1A1A1A]">{label}</span>
        <span className="text-[#888888]">{count} · {percent}%</span>
      </div>
      <div className="h-2 bg-[#F3F2EF] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(percent, 2)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function FunnelStage({ label, count, percentOfTop, color }: { label: string; count: number; percentOfTop: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 flex-shrink-0 text-xs font-semibold text-[#666666] text-right">{label}</div>
      <div className="flex-1 h-8 bg-[#F3F2EF] rounded-lg overflow-hidden">
        <div className="h-full rounded-lg flex items-center justify-end pr-2.5 transition-all" style={{ width: `${Math.max(percentOfTop, count > 0 ? 6 : 0)}%`, backgroundColor: color }}>
          {count > 0 && <span className="text-white text-[11px] font-bold">{count}</span>}
        </div>
      </div>
    </div>
  );
}

function formatTickDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Smooth, safe curve: control points sit at the horizontal midpoint between each pair of points,
// so the curve can never overshoot above/below the two points it's connecting - a small-integer
// step series (0, 1, 2 jobs/day) reads as a clean trend line instead of a jagged zig-zag.
function toSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C${midX},${p0.y} ${midX},${p1.y} ${p1.x},${p1.y}`;
  }
  return d;
}

function MiniTrendChart({ series }: { series: { name: string; color: string; points: TrendPoint[] }[] }) {
  const width = 640;
  const height = 220;
  const padTop = 16;
  const padRight = 12;
  const padBottom = 28;
  const padLeft = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxCount = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const dates = series[0]?.points.map((p) => p.date) || [];
  const pointCount = dates.length || 1;
  const xStep = plotW / Math.max(pointCount - 1, 1);
  const xAt = (i: number) => padLeft + i * xStep;
  const yAt = (count: number) => padTop + plotH - (count / maxCount) * plotH;

  const toXY = (points: TrendPoint[]) => points.map((p, i) => ({ x: xAt(i), y: yAt(p.count) }));

  // Up to 5 evenly-spaced date ticks so labels never overlap, regardless of 7-day vs 30-day range.
  const tickCount = Math.min(5, pointCount);
  const tickIndexes = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i * (pointCount - 1)) / (tickCount - 1))
  );

  const gridValues = Array.from(new Set([maxCount, Math.round(maxCount / 2), 0]));

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          {series.map((s) => (
            <linearGradient key={s.name} id={`trend-fill-${s.name.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Gridlines + y-axis labels */}
        {gridValues.map((v, i) => {
          const y = yAt(v);
          return (
            <g key={i}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#F0F0F0" strokeWidth={1} />
              <text x={padLeft - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#999999">{v}</text>
            </g>
          );
        })}

        {/* X-axis date labels */}
        {tickIndexes.map((i) => (
          <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="#999999">
            {formatTickDate(dates[i])}
          </text>
        ))}

        {/* Series: area fill + smooth line + emphasized last point */}
        {series.map((s) => {
          const xy = toXY(s.points);
          const linePath = toSmoothPath(xy);
          const areaPath = xy.length > 0
            ? `${linePath} L${xy[xy.length - 1].x},${padTop + plotH} L${xy[0].x},${padTop + plotH} Z`
            : '';
          const last = xy[xy.length - 1];
          return (
            <g key={s.name}>
              {areaPath && <path d={areaPath} fill={`url(#trend-fill-${s.name.replace(/\s+/g, '-')})`} stroke="none" />}
              <path d={linePath} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
              {last && (
                <circle cx={last.x} cy={last.y} r={4} fill={s.color} stroke="#FFFFFF" strokeWidth={2} />
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
        {series.map((s) => {
          const latest = s.points[s.points.length - 1]?.count ?? 0;
          return (
            <span key={s.name} className="flex items-center gap-1.5 text-[11px] font-medium text-[#666666]">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              {s.name}
              <span className="font-bold text-[#1A1A1A]">{latest}</span>
              <span className="text-[#999999]">today</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function CandidateAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [completion, setCompletion] = useState<ProfileCompletion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trendRange, setTrendRange] = useState<'7' | '30'>('7');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [analyticsRes, profileRes] = await Promise.all([
          fetch('/api/candidate-analytics'),
          fetch('/api/candidate-profile/me'),
        ]);
        const analyticsData = await analyticsRes.json();
        if (!analyticsRes.ok) throw new Error(analyticsData.error || 'Failed to load analytics');
        const profileData = profileRes.ok ? await profileRes.json() : null;
        if (!cancelled) {
          setData(analyticsData);
          setCompletion(profileData?.completion || null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="max-w-2xl mx-auto bg-[#FFE5E5] border border-[#FFB3B3] p-4 rounded-lg text-[#E74C3C] text-sm font-medium">
          {error || 'Failed to load analytics'}
        </div>
      </div>
    );
  }

  const distTotal = Object.values(data.matchDistribution).reduce((a, b) => a + b, 0);
  const funnelTop = Math.max(data.funnel.liked, 1);
  const trendSeries = trendRange === '7' ? data.activityTrend7 : data.activityTrend30;
  const hasTrendData = [...trendSeries.liked, ...trendSeries.recruiterInterest, ...trendSeries.matches].some((p) => p.count > 0);

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-2xl bg-white shadow-sm border border-[#E5E7EB] flex items-center justify-center flex-shrink-0">
            <BarChart3 className="w-5 h-5 text-[#27AE60]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A] tracking-tight">Analytics</h1>
            <p className="text-[#888888] text-xs mt-0.5">How your job search is actually performing.</p>
          </div>
        </div>

        {/* ==================== KPI CARDS ==================== */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={<Target className="w-4 h-4" />}
            label="Profile Strength"
            value={completion ? `${completion.percent}%` : '—'}
            sublabel={completion ? `${completion.filled} of ${completion.total} sections complete` : 'Unavailable'}
            accent="#27AE60"
          />
          <KpiCard
            icon={<Sparkles className="w-4 h-4" />}
            label="Avg. Match Score"
            value={data.averageMatchScore !== null ? `${data.averageMatchScore}%` : '—'}
            sublabel={data.totalLikedJobsScored > 0 ? `Across ${data.totalLikedJobsScored} liked jobs` : 'Like some jobs to see this'}
            accent="#2962FF"
          />
          <KpiCard
            icon={<Users className="w-4 h-4" />}
            label="Recruiter Response"
            value={data.recruiterResponseRate !== null ? `${data.recruiterResponseRate}%` : '—'}
            sublabel={data.reviewedCount > 0 ? `${data.interestedCount} of ${data.reviewedCount} reviewed` : 'No recruiter reviews yet'}
            accent="#B8860B"
          />
          <KpiCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Interview Probability"
            value={data.interviewProbability !== null ? `${data.interviewProbability}%` : '—'}
            sublabel="Estimate from match score + response rate"
            accent="#8A3A8A"
          />
        </div>

        {/* ==================== FUNNEL ==================== */}
        <SectionCard icon={<ListChecks className="w-4 h-4 text-[#27AE60]" />} title="Application Funnel" subtitle="Where your liked jobs stand right now - real counts, no interview/offer stages are invented since they aren't tracked yet." empty={data.funnel.liked === 0}>
          <div className="space-y-3">
            <FunnelStage label="Liked Jobs" count={data.funnel.liked} percentOfTop={100} color="#27AE60" />
            <FunnelStage label="Reviewed by Recruiters" count={data.funnel.reviewedByRecruiters} percentOfTop={(data.funnel.reviewedByRecruiters / funnelTop) * 100} color="#3CA05A" />
            <FunnelStage label="Interested" count={data.funnel.interested} percentOfTop={(data.funnel.interested / funnelTop) * 100} color="#2962FF" />
            <FunnelStage label="Shortlisted" count={data.funnel.shortlisted} percentOfTop={(data.funnel.shortlisted / funnelTop) * 100} color="#B8860B" />
            <FunnelStage label="Accepted" count={data.funnel.accepted} percentOfTop={(data.funnel.accepted / funnelTop) * 100} color="#8A3A8A" />
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ==================== MATCH QUALITY ==================== */}
          <SectionCard icon={<Trophy className="w-4 h-4 text-[#27AE60]" />} title="Match Quality Distribution" subtitle="Score spread across your liked jobs." empty={distTotal === 0}>
            <div className="space-y-3">
              <HorizontalBar label="90%+ Match" count={data.matchDistribution['90+']} percent={distTotal ? Math.round((data.matchDistribution['90+'] / distTotal) * 100) : 0} color="#1E8449" />
              <HorizontalBar label="80-89%" count={data.matchDistribution['80-89']} percent={distTotal ? Math.round((data.matchDistribution['80-89'] / distTotal) * 100) : 0} color="#27AE60" />
              <HorizontalBar label="70-79%" count={data.matchDistribution['70-79']} percent={distTotal ? Math.round((data.matchDistribution['70-79'] / distTotal) * 100) : 0} color="#E0A030" />
              <HorizontalBar label="60-69%" count={data.matchDistribution['60-69']} percent={distTotal ? Math.round((data.matchDistribution['60-69'] / distTotal) * 100) : 0} color="#E07830" />
              <HorizontalBar label="Below 60%" count={data.matchDistribution.below60} percent={distTotal ? Math.round((data.matchDistribution.below60 / distTotal) * 100) : 0} color="#E74C3C" />
            </div>
          </SectionCard>

          {/* ==================== SKILL DEMAND ==================== */}
          <SectionCard icon={<Sparkles className="w-4 h-4 text-[#27AE60]" />} title="Top Skills Driving Matches" subtitle="Your skills that appear most in jobs you've liked." empty={data.topSkills.length === 0}>
            <div className="space-y-3">
              {data.topSkills.map((s) => (
                <HorizontalBar key={s.skill} label={s.skill} count={s.count} percent={s.percentOfLikedJobs} color="#27AE60" />
              ))}
            </div>
          </SectionCard>
        </div>

        {/* ==================== ACTIVITY TREND ==================== */}
        <SectionCard
          icon={<Clock className="w-4 h-4 text-[#27AE60]" />}
          title="Activity Trend"
          subtitle="Jobs liked, recruiter interest, and matches over time."
          empty={!hasTrendData}
        >
          <div className="flex items-center gap-1 bg-[#F3F2EF] rounded-full p-1 w-fit mb-4">
            {(['7', '30'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTrendRange(r)}
                className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition-colors cursor-pointer ${trendRange === r ? 'bg-white text-[#1E8449] shadow-sm' : 'text-[#666666]'}`}
              >
                {r} days
              </button>
            ))}
          </div>
          <MiniTrendChart
            series={[
              { name: 'Jobs Liked', color: '#27AE60', points: trendSeries.liked },
              { name: 'Recruiter Interest', color: '#2962FF', points: trendSeries.recruiterInterest },
              { name: 'Matches', color: '#B8860B', points: trendSeries.matches },
            ]}
          />
        </SectionCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ==================== SALARY INSIGHTS ==================== */}
          <SectionCard icon={<Wallet className="w-4 h-4 text-[#27AE60]" />} title="Salary Insights" subtitle="Parsed from your profile and matched job postings.">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#F5F5F5]">
                <span className="text-xs text-[#666666]">Your expected salary</span>
                <span className="text-sm font-bold text-[#1A1A1A]">{formatSalary(data.salary.candidateExpected)}</span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-[#F5F5F5]">
                <span className="text-xs text-[#666666]">Avg. salary - liked jobs</span>
                <span className="text-sm font-bold text-[#1A1A1A]">{formatSalary(data.salary.avgMatchedJobSalary)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#666666]">Avg. salary - recruiter interested</span>
                <span className="text-sm font-bold text-[#1A1A1A]">{formatSalary(data.salary.avgInterestedRecruiterSalary)}</span>
              </div>
            </div>
          </SectionCard>

          {/* ==================== LOCATION INSIGHTS ==================== */}
          <SectionCard icon={<MapPin className="w-4 h-4 text-[#27AE60]" />} title="Top Locations" subtitle="Where the jobs you've liked are based." empty={data.topLocations.length === 0}>
            <div className="space-y-3">
              {data.topLocations.map((l) => (
                <HorizontalBar key={l.location} label={l.location} count={l.count} percent={l.percent} color="#2962FF" />
              ))}
            </div>
          </SectionCard>
        </div>

        {/* ==================== PROFILE PERFORMANCE ==================== */}
        <SectionCard icon={<Eye className="w-4 h-4 text-[#27AE60]" />} title="Profile Performance">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-black text-[#1A1A1A]">{data.profileViewCount}</p>
              <p className="text-[11px] text-[#888888] mt-0.5">Recruiter profile views</p>
            </div>
            <div>
              <p className="text-2xl font-black text-[#1A1A1A]">{completion ? `${completion.percent}%` : '—'}</p>
              <p className="text-[11px] text-[#888888] mt-0.5">Profile completeness</p>
            </div>
            <div>
              <p className="text-sm font-bold text-[#1A1A1A] mt-1.5">{new Date(data.profileUpdatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              <p className="text-[11px] text-[#888888] mt-0.5">Profile last updated</p>
            </div>
          </div>
        </SectionCard>

        {/* ==================== AI RECOMMENDATIONS ==================== */}
        <SectionCard
          icon={<Lightbulb className="w-4 h-4 text-[#27AE60]" />}
          title="Recommendations"
          subtitle="Computed by re-scoring your profile against jobs you've liked - not fixed numbers."
          empty={data.recommendations.length === 0}
        >
          <div className="space-y-2.5">
            {data.recommendations.map((r) => (
              <div key={r.skill} className="flex items-center justify-between bg-[#F8FAFC] rounded-xl p-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-[#27AE60] flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#1A1A1A] truncate">Add {r.skill}</p>
                    <p className="text-[10px] text-[#999999]">Relevant to {r.affectedJobs} liked job{r.affectedJobs === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-[#1E8449] bg-[#E5F5E5] border border-[#A8E6C1] px-2.5 py-1 rounded-full flex-shrink-0">
                  +{r.expectedMatchIncrease}%
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ==================== WHY AM I NOT GETTING RESPONSES ==================== */}
        <SectionCard
          icon={<AlertCircle className="w-4 h-4 text-[#27AE60]" />}
          title="Why Am I Not Getting Responses?"
          subtitle="Only shown when your actual data supports it."
          empty={data.insights.length === 0}
        >
          <div className="space-y-2.5">
            {data.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-[#FBF3DC] border border-[#E0C070] rounded-xl p-3.5">
                <AlertCircle className="w-4 h-4 text-[#8A6314] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[#8A6314] leading-relaxed">{insight.message}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
