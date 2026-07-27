import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Clock } from 'lucide-react';

type Tab = 'all' | 'under_review' | 'shortlisted' | 'accepted' | 'rejected';

interface ApplicationRow {
  job_id: number;
  applied_at: string;
  job_title: string;
  company_name: string;
  company_logo_url: string | null;
  status: 'applied' | 'under_review' | 'shortlisted' | 'rejected' | 'accepted';
  last_updated: string;
}

const STATUS_STYLE: Record<ApplicationRow['status'], { label: string; color: string; bg: string }> = {
  applied: { label: 'Applied', color: '#666666', bg: '#F3F2EF' },
  under_review: { label: 'Under Review', color: '#2F6FA8', bg: '#E6F0F8' },
  shortlisted: { label: 'Shortlisted', color: '#B8860B', bg: '#FDF3DC' },
  accepted: { label: 'Accepted', color: '#27AE60', bg: '#E5F5E5' },
  rejected: { label: 'Rejected', color: '#E74C3C', bg: '#FFE5E5' },
};

export default function CandidateApplications({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [tab, setTab] = useState<Tab>('all');
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/candidate-applications');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load applications');
      setApplications(data.applications);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'All Applications' },
    { id: 'under_review', label: 'Under Review' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'rejected', label: 'Rejected' },
  ];

  const filtered = tab === 'all' ? applications : applications.filter((a) => a.status === tab);

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Your Applications</h1>
          <p className="text-[#666666] text-sm mt-1">Track every job you've applied to and its current status.</p>
        </div>

        <div className="flex gap-1 mb-5 bg-white rounded-full p-1 shadow-sm w-fit overflow-x-auto max-w-full">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-xs font-semibold px-4 py-2 rounded-full transition-colors cursor-pointer whitespace-nowrap ${
                tab === t.id ? 'bg-[#27AE60] text-white' : 'text-[#666666] hover:text-[#1A1A1A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="bg-[#FFE5E5] border border-[#FFB3B3] p-3 rounded-lg text-[#E74C3C] text-xs font-medium mb-4">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-10 text-center text-[#666666] text-sm">
            {tab === 'all' ? "You haven't applied to any jobs yet." : 'Nothing here yet.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((a) => {
              const style = STATUS_STYLE[a.status];
              return (
                <button
                  key={a.job_id}
                  onClick={() => onSelectJob(a.job_id)}
                  className="w-full text-left bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-[#666666] mb-0.5">
                        {a.company_logo_url ? (
                          <img src={a.company_logo_url} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
                        ) : (
                          <Building2 className="w-3 h-3" />
                        )}
                        <span className="truncate">{a.company_name}</span>
                      </div>
                      <p className="text-sm font-bold text-[#1A1A1A] truncate">{a.job_title}</p>
                      <p className="text-[10px] text-[#999999] mt-1 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" /> Applied {new Date(a.applied_at).toLocaleDateString()}
                        {a.last_updated !== a.applied_at && <> · Updated {new Date(a.last_updated).toLocaleDateString()}</>}
                      </p>
                    </div>
                    <span
                      className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
                      style={{ color: style.color, backgroundColor: style.bg }}
                    >
                      {style.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
