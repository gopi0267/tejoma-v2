import React from 'react';
import { useCandidateAuth } from '../context/CandidateAuthContext.js';

interface CandidateProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Mirrors ProtectedRoute.tsx, against CandidateAuthContext instead of AuthContext. Shows a
 *  loading state during the initial /candidate-auth/me check, and renders nothing once we
 *  know for certain there's no valid candidate session (CandidateApp.tsx renders
 *  <CandidateAuth /> in that case instead). */
export default function CandidateProtectedRoute({ children, fallback }: CandidateProtectedRouteProps) {
  const { isAuthenticated, loading } = useCandidateAuth();

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
