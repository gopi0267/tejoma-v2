import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { refreshSession, setSessionExpiredHandler } from '../utils/apiFetch.js';

interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: UserInfo | null;
  companyId: number;
  role: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (userInfo: UserInfo, companyId: number) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 2 * 60 * 1000; // refresh ~2 min before the access token actually expires

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [companyId, setCompanyId] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setCompanyId(1);
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const silentRefresh = useCallback(async (): Promise<boolean> => {
    const data = await refreshSession();
    if (!data) return false;
    setUser(data.user_info);
    setCompanyId(data.company_id);
    return true;
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

  // Any authenticated fetch (apiFetch) that fails to recover via refresh reports back here.
  useEffect(() => {
    setSessionExpiredHandler(clearSession);
  }, [clearSession]);

  // Bootstrap auth state from the httpOnly cookie on first load - localStorage/JS can't
  // read that cookie by design, so this is the only correct source of truth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setUser(data.user_info);
            setCompanyId(data.company_id);
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

  const login = useCallback((userInfo: UserInfo, compId: number) => {
    setUser(userInfo);
    setCompanyId(compId);
    scheduleRefresh();
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear client-side state regardless of network failure.
    }
    clearSession();
  }, [clearSession]);

  const logoutAll = useCallback(async () => {
    try {
      await fetch('/api/auth/logout-all', { method: 'POST' });
    } catch {
      // Clear client-side state regardless of network failure.
    }
    clearSession();
  }, [clearSession]);

  const value: AuthContextValue = {
    user,
    companyId,
    role: user?.role || null,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
    logoutAll,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
