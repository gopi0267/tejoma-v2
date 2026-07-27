import React, { useState, useEffect } from 'react';
import { Sparkles, User, Check } from 'lucide-react';

interface RecruiterMatchRow {
  id: number;
  job_id: number;
  matched_at: string;
  job_title: string;
  candidate_id: number | null;
  candidate_name: string | null;
  candidate_email: string | null;
  candidate_skills: string | null;
  candidate_years_of_experience: string | null;
  notification_id: number | null;
  read_at: string | null;
}

// New, standalone screen (Phase 3) - "matches involving their jobs." Reads GET /api/matches
// (recruiter-matches.routes.ts, brand new file - swipe.routes.ts/recruiter-review.routes.ts
// are untouched). Everything shown here is data the recruiter already has access to (the
// linked candidates row is company-scoped, same as any resume-uploaded candidate).
export default function RecruiterMatches() {
  const [matches, setMatches] = useState<RecruiterMatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/matches');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load matches');
        setMatches(data.matches);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleMarkRead = async (notificationId: number) => {
    try {
      const res = await fetch(`/api/recruiter-notifications/${notificationId}/read`, { method: 'PUT' });
      if (res.ok) {
        setMatches((prev) => prev.map((m) => (m.notification_id === notificationId ? { ...m, read_at: new Date().toISOString() } : m)));
      }
    } catch {
      // Non-critical - the badge just stays "New" until the next successful attempt.
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-emerald-600" /> Matches
        </h1>
        <p className="text-xs text-slate-500 mt-1">Candidates and jobs where both sides said yes.</p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium px-4 py-2.5 rounded-lg mb-4">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      ) : matches.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500 text-sm">
          No matches yet.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Candidate</th>
                <th className="text-left px-4 py-3 font-semibold">Job</th>
                <th className="text-left px-4 py-3 font-semibold">Experience</th>
                <th className="text-left px-4 py-3 font-semibold">Matched</th>
                <th className="text-left px-4 py-3 font-semibold">Notification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matches.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <div>
                        <p className="font-semibold text-slate-800">{m.candidate_name || 'Unknown'}</p>
                        <p className="text-slate-400">{m.candidate_email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{m.job_title}</td>
                  <td className="px-4 py-3 text-slate-500">{m.candidate_years_of_experience || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(m.matched_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {m.notification_id ? (
                      m.read_at ? (
                        <span className="flex items-center gap-1 text-emerald-600 font-medium"><Check className="w-3.5 h-3.5" /> Read</span>
                      ) : (
                        <button
                          onClick={() => handleMarkRead(m.notification_id!)}
                          className="text-rose-600 font-bold hover:underline cursor-pointer"
                        >
                          ● New - Mark read
                        </button>
                      )
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
