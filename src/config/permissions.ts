/**
 * Reference map of what each role is allowed to do. Actual enforcement happens via
 * `requireRole(...)` directly on each route (see src/middleware/auth.middleware.ts) -
 * with only 3 roles, a dynamic DB-driven permission table would be overkill. This file
 * exists so the intent behind each route's role gate is documented in one place.
 */
export const PERMISSIONS = {
  admin: [
    'manage_users',
    'view_system_analytics',
    'manage_jobs',
    'manage_candidates',
    'upload_resumes',
    'view_matches',
    'manage_ml_config',
  ],
  recruiter: [
    'manage_jobs',
    'manage_candidates',
    'upload_resumes',
    'view_matches',
    'view_own_analytics',
  ],
  candidate: [
    'manage_own_profile',
    'apply_to_jobs',
  ],
} as const;

export type Role = keyof typeof PERMISSIONS;
