import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Building2, MessageSquare, Paperclip, Calendar, Video, Send, Search, Sparkles, ExternalLink } from 'lucide-react';

interface ConversationSource {
  id: number;
  job_id: number;
  matched_at: string;
  title: string;
  company_name: string;
  company_logo_url: string | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'C';
}

// Deterministic per-company accent so avatars without a logo still look distinct from each
// other in a list, rather than every fallback avatar being an identical gray square.
const AVATAR_TINTS = [
  { bg: '#E5F5E5', text: '#1E8449' },
  { bg: '#E3EEFC', text: '#1D5FA8' },
  { bg: '#FBF3DC', text: '#8A6314' },
  { bg: '#F5E6F5', text: '#8A3A8A' },
  { bg: '#FFE9E0', text: '#B8541F' },
];
function avatarTint(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

function relativeMatchDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Matched today';
  if (days === 1) return 'Matched yesterday';
  if (days < 7) return `Matched ${days}d ago`;
  return `Matched ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function Avatar({ name, logoUrl, size = 44 }: { name: string; logoUrl: string | null; size?: number }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="rounded-2xl object-cover flex-shrink-0 ring-1 ring-black/5" style={{ width: size, height: size }} />;
  }
  const tint = avatarTint(name);
  return (
    <div
      className="rounded-2xl flex items-center justify-center flex-shrink-0 font-black ring-1 ring-black/5"
      style={{ width: size, height: size, backgroundColor: tint.bg, color: tint.text, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  );
}

// Architecture-ready UI shell (per your decision: no new tables, no send/receive wiring in this
// phase). Conversations are sourced from the EXISTING GET /api/candidate-matches (unchanged) -
// a match is the natural prerequisite for a conversation, so the list is real data, not mock
// placeholders. The thread panel, message composer, attachment/scheduling/video affordances are
// all laid out and clearly labeled as launching soon - ready to wire to a real messaging backend
// in a future phase without any layout rework.
export default function CandidateChat({ onSelectJob }: { onSelectJob: (id: number) => void }) {
  const [conversations, setConversations] = useState<ConversationSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/candidate-matches');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load conversations');
        if (!cancelled) setConversations(data.matches);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.company_name.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="px-4 sm:px-8 py-4 border-b border-[#E5E7EB] bg-white flex-shrink-0">
        <h1 className="text-xl font-bold text-[#1A1A1A] tracking-tight flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[#27AE60]" /> Chat</h1>
        <p className="text-[#888888] text-xs mt-1">Conversations open up once you and a recruiter both match.</p>
      </div>

      <div className="flex-1 flex min-h-0 max-w-5xl w-full mx-auto lg:border-x lg:border-[#E5E7EB]">
        {/* Conversation list - full width on mobile until a chat is opened, fixed-width panel on desktop */}
        <div className={`w-full lg:w-[340px] lg:flex-shrink-0 border-r border-[#E5E7EB] bg-white overflow-y-auto flex flex-col ${selectedId !== null ? 'hidden lg:flex' : 'flex'}`}>
          {conversations.length > 0 && (
            <div className="p-3 border-b border-[#E5E7EB] flex-shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#999999] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full bg-[#F3F2EF] border border-transparent focus:border-[#27AE60] focus:bg-white rounded-full py-2.5 pl-9 pr-4 text-xs font-medium text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none transition-colors"
                />
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 text-xs text-[#E74C3C]">{error}</div>
          ) : conversations.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-[220px]">
                <div className="w-14 h-14 rounded-2xl bg-[#E5F5E5] flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-6 h-6 text-[#27AE60]" />
                </div>
                <p className="text-sm font-bold text-[#1A1A1A]">No conversations yet</p>
                <p className="text-xs text-[#888888] mt-1.5 leading-relaxed">Once a recruiter matches with you, you'll be able to chat with them here.</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#888888]">No conversations match "{search}".</div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filtered.map((c) => {
                const active = selectedId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-4 py-3.5 flex items-center gap-3 border-b border-[#E5E7EB] transition-colors cursor-pointer ${active ? 'bg-[#E5F5E5]' : 'hover:bg-[#F8F9FA]'}`}
                  >
                    <Avatar name={c.company_name} logoUrl={c.company_logo_url} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`text-sm font-bold truncate ${active ? 'text-[#1E8449]' : 'text-[#1A1A1A]'}`}>{c.company_name}</p>
                      </div>
                      <p className="text-xs text-[#666666] truncate mt-0.5">{c.title}</p>
                      <p className="text-[10px] text-[#999999] truncate mt-1 font-medium">{relativeMatchDate(c.matched_at)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Thread panel */}
        <div className={`flex-1 flex flex-col min-h-0 bg-white ${selectedId !== null ? 'flex' : 'hidden lg:flex'}`}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <div className="w-16 h-16 rounded-2xl bg-[#F8F9FA] flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-7 h-7 text-[#CCCCCC]" />
                </div>
                <p className="text-sm font-semibold text-[#4A4A4A]">Select a conversation to start chatting</p>
                <p className="text-xs text-[#999999] mt-1.5">Your matches appear on the left.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 sm:px-6 py-3.5 border-b border-[#E5E7EB] bg-white/95 backdrop-blur flex items-center gap-3 flex-shrink-0">
                <button onClick={() => setSelectedId(null)} className="lg:hidden text-[#666666] hover:text-[#1A1A1A] cursor-pointer flex-shrink-0">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <Avatar name={selected.company_name} logoUrl={selected.company_logo_url} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#1A1A1A] truncate">{selected.company_name}</p>
                  <button onClick={() => onSelectJob(selected.job_id)} className="text-[11px] text-[#27AE60] hover:text-[#1E8449] hover:underline cursor-pointer truncate flex items-center gap-1">
                    {selected.title} <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span title="Interview scheduling - launching soon" className="w-8 h-8 rounded-full flex items-center justify-center text-[#999999] bg-[#F3F2EF] hover:bg-[#EDEDED] transition-colors cursor-not-allowed"><Calendar className="w-3.5 h-3.5" /></span>
                  <span title="Video interview - launching soon" className="w-8 h-8 rounded-full flex items-center justify-center text-[#999999] bg-[#F3F2EF] hover:bg-[#EDEDED] transition-colors cursor-not-allowed"><Video className="w-3.5 h-3.5" /></span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center">
                <div className="text-center max-w-xs">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#1E8449] bg-[#E5F5E5] border border-[#A8E6C1] px-2.5 py-1 rounded-full uppercase tracking-wider">
                    {relativeMatchDate(selected.matched_at)}
                  </span>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#27AE60] to-[#1E8449] flex items-center justify-center mx-auto mt-5 mb-4 shadow-[0_10px_24px_-8px_rgba(39,174,96,0.5)]">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-sm font-bold text-[#1A1A1A]">Messaging is launching soon</p>
                  <p className="text-xs text-[#888888] mt-1.5 leading-relaxed">
                    You matched with <span className="font-semibold text-[#4A4A4A]">{selected.company_name}</span> for {selected.title}. Direct messaging isn't live yet — track this application's status from the Likes tab in the meantime.
                  </p>
                </div>
              </div>

              <div className="px-4 sm:px-6 py-3.5 border-t border-[#E5E7EB] bg-white flex-shrink-0">
                <div className="flex items-center gap-2 bg-[#F8F9FA] border border-[#E5E7EB] rounded-full pl-4 pr-1.5 py-1.5">
                  <button disabled title="Document sharing - launching soon" className="text-[#B0B0B0] cursor-not-allowed"><Paperclip className="w-4 h-4" /></button>
                  <input disabled placeholder="Messaging launches soon..." className="flex-1 bg-transparent text-sm text-[#999999] placeholder:text-[#AAAAAA] focus:outline-none cursor-not-allowed" />
                  <span className="hidden sm:inline text-[9px] font-bold text-[#999999] bg-white border border-[#E5E7EB] px-2 py-1 rounded-full uppercase tracking-wide flex-shrink-0">Soon</span>
                  <button disabled className="w-8 h-8 rounded-full bg-[#DDDDDD] flex items-center justify-center text-white cursor-not-allowed flex-shrink-0"><Send className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
