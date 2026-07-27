import React, { useState, useRef, useEffect } from 'react';
import { Bell, Loader2, CheckCheck } from 'lucide-react';

interface NotificationItem {
  id: number;
  match_id: number | null;
  type: string;
  title: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Reuses the EXISTING candidate-notifications API in full (list/unread-count/mark-one-read/
// mark-all-read, all already built and unmodified) - this is purely a new nav entry point onto
// already-shipped backend logic, same pattern as CandidateNavSearch.tsx.
export default function CandidateNavBell({
  unreadCount,
  onRefreshCount,
  onNavigateToMatches,
}: {
  unreadCount: number;
  onRefreshCount: () => void;
  onNavigateToMatches: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/candidate-notifications');
      const data = await res.json();
      if (res.ok) setNotifications(data.notifications);
      setLoaded(true);
    } catch {
      // Non-critical - dropdown just shows nothing this open.
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && !loaded) loadNotifications();
      return next;
    });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const markOneRead = async (n: NotificationItem) => {
    if (!n.read_at) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      try { await fetch(`/api/candidate-notifications/${n.id}/read`, { method: 'PUT' }); } catch { /* best-effort */ }
      onRefreshCount();
    }
    setOpen(false);
    if (n.match_id) onNavigateToMatches();
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    try { await fetch('/api/candidate-notifications/read-all', { method: 'PUT' }); } catch { /* best-effort */ }
    onRefreshCount();
  };

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        onClick={toggleOpen}
        aria-label="Notifications"
        className="relative w-6 h-6 lg:w-9 lg:h-9 rounded-full flex items-center justify-center border border-transparent text-[#666666] hover:bg-[#F3F2EF] hover:border-[#E5E7EB] lg:hover:shadow-xs transition-all cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-[#E74C3C] text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center leading-none ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 right-0 w-[300px] sm:w-[340px] bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_12px_28px_-8px_rgba(0,0,0,0.15)] overflow-hidden z-30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#F0F0F0]">
            <p className="text-xs font-bold text-[#1A1A1A]">Notifications</p>
            {notifications.some((n) => !n.read_at) && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-[10px] font-semibold text-[#27AE60] hover:text-[#1E8449] cursor-pointer">
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 text-[#27AE60] animate-spin" /></div>
            ) : notifications.length === 0 ? (
              <p className="text-xs text-[#888888] text-center py-8 px-4">You're all caught up - no notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markOneRead(n)}
                  className={`w-full text-left px-4 py-3 border-b border-[#F5F5F5] last:border-b-0 hover:bg-[#F8FAFC] transition-colors cursor-pointer ${!n.read_at ? 'bg-[#F0FAF3]' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[#27AE60] mt-1.5 flex-shrink-0" />}
                    <div className={`min-w-0 flex-1 ${n.read_at ? 'pl-3.5' : ''}`}>
                      <p className="text-xs font-bold text-[#1A1A1A]">{n.title}</p>
                      {n.message && <p className="text-[11px] text-[#666666] mt-0.5 leading-relaxed">{n.message}</p>}
                      <p className="text-[10px] text-[#999999] mt-1">{relativeTime(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
