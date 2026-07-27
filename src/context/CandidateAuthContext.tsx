import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface CandidateInfo {
  id: number;
  name: string;
  email: string;
  phone: string;
  headline: string | null;
  skills: string[];
  years_of_experience: string | null;
  location: string | null;
  education: string | null;
  summary: string | null;
  onboarding_completed_at: string | null;
}

interface CandidateAuthContextValue {
  candidate: CandidateInfo | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (candidateInfo: CandidateInfo) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshCandidate: () => Promise<void>;
}

const CandidateAuthContext = createContext<CandidateAuthContextValue | undefined>(undefined);

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 2 * 60 * 1000; // refresh ~2 min before the access token actually expires

// Mirrors AuthContext.tsx's structure exactly, but talks to /api/candidate-auth/* and carries
// no company_id/role - a fully separate provider so a candidate session can never be confused
// with, or short-circuit, the staff AuthContext above.
export function CandidateAuthProvider({ children }: { children: React.ReactNode }) {
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(() => {
    setCandidate(null);
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const silentRefresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/candidate-auth/refresh', { method: 'POST' });
      if (!res.ok) return false;
      const data = await res.json();
      setCandidate(data.candidate);
      return true;
    } catch {
      return false;
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      const ok = await silentRefresh();
      if (ok) {
        scheduleRefresh();
      } else {
        clearSession();
      }
    }, ACCESS_TOKEN_TTL_MS - REFRESH_MARGIN_MS);
  }, [silentRefresh, clearSession]);

  // Bootstrap from the httpOnly candidate cookie on first load - mirrors AuthContext's
  // GET /api/auth/me bootstrap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/candidate-auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setCandidate(data.candidate);
            scheduleRefresh();
          }
        }
      } catch {
        // Not logged in, or server unreachable - stay logged out.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback((candidateInfo: CandidateInfo) => {
    setCandidate(candidateInfo);
    scheduleRefresh();
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/candidate-auth/logout', { method: 'POST' });
    } catch {
      // Clear client-side state regardless of network failure.
    }
    clearSession();
  }, [clearSession]);

  const logoutAll = useCallback(async () => {
    try {
      await fetch('/api/candidate-auth/logout-all', { method: 'POST' });
    } catch {
      // Clear client-side state regardless of network failure.
    }
    clearSession();
  }, [clearSession]);

  const refreshCandidate = useCallback(async () => {
    try {
      const res = await fetch('/api/candidate-profile/me');
      if (res.ok) {
        const data = await res.json();
        setCandidate((prev) => (prev ? { ...prev, ...data } : prev));
      }
    } catch {
      // Leave existing state as-is on failure.
    }
  }, []);

  const value: CandidateAuthContextValue = {
    candidate,
    isAuthenticated: !!candidate,
    loading,
    login,
    logout,
    logoutAll,
    refreshCandidate,
  };

  return <CandidateAuthContext.Provider value={value}>{children}</CandidateAuthContext.Provider>;
}

export function useCandidateAuth(): CandidateAuthContextValue {
  const ctx = useContext(CandidateAuthContext);
  if (!ctx) {
    throw new Error('useCandidateAuth must be used within a CandidateAuthProvider');
  }
  return ctx;
}
