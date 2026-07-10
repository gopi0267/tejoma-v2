import React from 'react';
import { useAuth } from '../context/AuthContext.js';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Wraps the main app content. Shows a loading state during the initial /auth/me check,
 *  and renders nothing once we know for certain there's no valid session (App.tsx renders
 *  <Login /> in that case instead). */
export default function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      fallback ?? (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FA' }}>
          <div className="w-10 h-10 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin" />
        </div>
      )
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
