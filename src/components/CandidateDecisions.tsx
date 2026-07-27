import React, { useState, useEffect, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Clock, Building2 } from 'lucide-react';

type Tab = 'interested' | 'passed' | 'history';

interface DecisionRow {
  id: number;
  job_id: number;
  action: number;
  decision_type: 'swipe_right' | 'swipe_left' | 'apply';
  timestamp: string;
  job_title: string;
  company_name: string;
  company_logo_url: string | null;
}

function decisionLabel(d: DecisionRow): string {
  if (d.decision_type === 'apply') return 'Applied';
  return Number(d.action) === 1 ? 'Interested' : 'Passed';
}

export default function CandidateDecisions({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [tab, setTab] = useState<Tab>('interested');
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    setError('');
    try {
      const url = t === 'history' ? '/api/candidate-decisions' : `/api/candidate-decisions/active?action=${t === 'interested' ? 1 : 0}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load decisions');
      setRows(data.decisions);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'interested', label: 'Interested' },
    { id: 'passed', label: 'Passed' },
    { id: 'history', label: 'Full History' },
  ];

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Your Decisions</h1>
          <p className="text-[#666666] text-sm mt-1">Jobs you've shown interest in, passed on, or applied to.</p>
        </div>

        <div className="flex gap-1 mb-5 bg-white rounded-full p-1 shadow-sm w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-xs font-semibold px-4 py-2 rounded-full transition-colors cursor-pointer ${
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
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-10 text-center text-[#666666] text-sm">Nothing here yet.</div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelectJob(d.job_id)}
                className="w-full text-left bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-[#666666] mb-0.5">
                    {d.company_logo_url ? (
                      <img src={d.company_logo_url} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
                    ) : (
                      <Building2 className="w-3 h-3" />
                    )}
                    <span className="truncate">{d.company_name}</span>
                  </div>
                  <p className="text-sm font-bold text-[#1A1A1A] truncate">{d.job_title}</p>
                  {tab === 'history' && (
                    <p className="text-[10px] text-[#999999] mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> {new Date(d.timestamp).toLocaleString()}
                    </p>
                  )}
                </div>
                <span
                  className="flex items-center gap-1 text-xs font-semibold flex-shrink-0"
                  style={{ color: Number(d.action) === 1 ? '#27AE60' : '#999999' }}
                >
                  {Number(d.action) === 1 ? <ThumbsUp className="w-3.5 h-3.5" /> : <ThumbsDown className="w-3.5 h-3.5" />}
                  {decisionLabel(d)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
