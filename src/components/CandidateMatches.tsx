import React, { useState, useEffect } from 'react';
import { Sparkles, MapPin, Briefcase, Building2, Check } from 'lucide-react';

interface MatchRow {
  id: number;
  job_id: number;
  matched_at: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  required_skills: string[] | null;
  company_name: string;
  company_logo_url: string | null;
  notification_id: number | null;
  read_at: string | null;
}

export default function CandidateMatches({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/candidate-matches');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load matches');
        if (!cancelled) setMatches(data.matches);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleMarkRead = async (e: React.MouseEvent, notificationId: number) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/candidate-notifications/${notificationId}/read`, { method: 'PUT' });
      if (res.ok) {
        setMatches((prev) => prev.map((m) => (m.notification_id === notificationId ? { ...m, read_at: new Date().toISOString() } : m)));
      }
    } catch {
      // Non-critical - the badge just stays "New" until the next successful attempt.
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1A1A1A] flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#27AE60]" /> Your Matches
          </h1>
          <p className="text-[#666666] text-sm mt-1">Jobs where you and the recruiter both said yes.</p>
        </div>

        {error && <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium mb-4">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-10 text-center text-[#666666] text-sm">
            No matches yet. Keep browsing and marking jobs as Interested - when a recruiter is interested too, it'll show up here.
          </div>
        ) : (
          <div className="space-y-3">
            {matches.map((m) => (
              // A plain div, not a <button> - Phase 4 adds a real "Mark as read" <button> below,
              // and nesting a button inside a button is invalid HTML with unpredictable click
              // behavior (the same fix already applied to CandidateJobDiscovery.tsx's cards).
              <div
                key={m.id}
                className="bg-white rounded-2xl shadow-md p-5 hover:shadow-lg transition-shadow border-2 border-[#A8E6C1]"
              >
                <div onClick={() => onSelectJob(m.job_id)} className="flex items-start justify-between gap-4 cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-[#666666] mb-1">
                      {m.company_logo_url ? (
                        <img src={m.company_logo_url} alt="" className="w-4 h-4 rounded-sm object-cover" />
                      ) : (
                        <Building2 className="w-3.5 h-3.5" />
                      )}
                      <span className="truncate">{m.company_name}</span>
                    </div>
                    <h3 className="text-base font-bold text-[#1A1A1A] truncate">{m.title}</h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-[#666666]">
                      {m.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {m.location}</span>}
                      {m.employment_type && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {m.employment_type}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="text-[10px] font-bold text-[#27AE60] bg-[#E5F5E5] border border-[#A8E6C1] px-2.5 py-1 rounded-full uppercase tracking-wider">
                      Matched
                    </span>
                    {m.notification_id && !m.read_at && (
                      <span className="text-[10px] font-bold text-white bg-[#E74C3C] px-2 py-0.5 rounded-full uppercase tracking-wider">New</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2.5">
                  <p className="text-[10px] text-[#999999]">Matched {new Date(m.matched_at).toLocaleDateString()}</p>
                  {m.notification_id && (
                    m.read_at ? (
                      <span className="flex items-center gap-1 text-[10px] text-[#999999]"><Check className="w-3 h-3" /> Read</span>
                    ) : (
                      <button
                        onClick={(e) => handleMarkRead(e, m.notification_id!)}
                        className="text-[10px] font-semibold text-[#27AE60] hover:underline cursor-pointer"
                      >
                        Mark as read
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
