// Ported exactly from the monolith's src/types.ts User interface - same field names/types/
// optionality, so nothing downstream (routes, tests) has to guess at a shape that already exists
// and is already correct.
export interface User {
  id: number;
  email: string | null;
  phone: string | null;
  password_hash: string;
  company_id: number;
  role: 'recruiter' | 'admin' | 'superadmin' | 'candidate';
  is_active: boolean;
  name: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
  disabled_by?: number | null;
  password_reset_by?: number | null;
  last_login_at?: string | null;
}

export interface RefreshTokenRecord {
  id: number;
  user_id: number;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  remember: boolean;
}

/**
 * Identity DB's candidate_accounts is the AUTH-COLUMN SLICE ONLY (Phase 3(database) section 4's
 * "hard case" split, executed in Batch 3) - deliberately NOT the same shape as the monolith's
 * CandidateAccount interface (src/types.ts), which also carries profile fields (headline, skills,
 * years_of_experience, location, education, summary) that remain owned by Marketplace Service's
 * database (Tier 1, out of this document's scope). See candidate-auth.routes.ts's header comment
 * for the full implication of this boundary.
 */
export interface CandidateAccount {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  is_active: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandidateRefreshTokenRecord {
  id: number;
  candidate_id: number;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  remember: boolean;
}

// Ported exactly from the monolith's src/db.ts - the shared otp_verification purpose vocabulary
// used by both staff and candidate flows.
export type OtpPurpose = 'signup' | 'password_reset' | 'candidate_signup' | 'candidate_reset';

export interface OtpRecord {
  id: number;
  email: string | null;
  phone: string | null;
  otp_hash: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  verified: boolean;
  purpose: OtpPurpose;
}

// New in Batch 9 - see migrations/002_audit_log.up.sql's header comment for why this table exists
// (the monolith has no equivalent; this is a new capability, not a port).
export type AuditEventType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'logout_all'
  | 'password_reset'
  | 'oauth_signin'
  | 'oauth_signup'
  | 'registration'
  | 'refresh_token_reuse_detected';

export interface AuditEvent {
  actorType: 'staff' | 'candidate';
  actorId: number | null;
  eventType: AuditEventType;
  ip: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown>;
}
