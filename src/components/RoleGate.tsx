import React from 'react';
import { useAuth } from '../context/AuthContext.js';

interface RoleGateProps {
  allow: string[];
  children: React.ReactNode;
}

/** Renders children only if the current user's role is in `allow`. Mirrors the backend's
 *  requireRole() gates (see src/middleware/auth.middleware.ts) so the UI and API agree on
 *  who can do what. Note: 'superadmin' is not special-cased here the way the backend does
 *  it (ROLE_HIERARCHY) - there's no superadmin-only UI today, so it hasn't been needed. */
export function RoleGate({ allow, children }: RoleGateProps) {
  const { role } = useAuth();
  if (!role || !allow.includes(role)) return null;
  return <>{children}</>;
}
