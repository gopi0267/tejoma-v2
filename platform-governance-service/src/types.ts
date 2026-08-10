// Ported exactly from the monolith's src/types.ts CompanyRegistrationRequest interface - same
// field names/types, so nothing downstream has to guess at a shape that already exists and is
// already correct. This is the ONLY table this service owns (migrations/001_initial_schema.up.sql).
export interface CompanyRegistrationRequest {
  id: number;
  company_name: string;
  company_website: string | null;
  industry: string | null;
  company_size: string | null;
  business_email: string;
  company_phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  admin_name: string;
  admin_email: string;
  admin_phone: string | null;
  password_hash: string;
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  resulting_company_id: number | null;
  resulting_user_id: number | null;
  created_at: string;
  updated_at: string;
}

// Ported exactly from the monolith's src/db.ts CompanyRegistrationFilters interface.
export interface CompanyRegistrationFilters {
  status?: 'pending' | 'approved' | 'rejected';
  industry?: string;
  companyName?: string;
  businessEmail?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'newest' | 'oldest' | 'company_name' | 'status';
  page: number;
  pageSize: number;
}

// Mirrors identity-service/src/middleware/auth.middleware.ts's AccessTokenPayload exactly - the
// shape Identity Service signs into a staff access token (src/utils/tokens.ts). Duplicated here
// (not imported) since this is a separate deployable service verifying a token it did not sign -
// see src/middleware/staffAuth.middleware.ts for why.
export interface AccessTokenPayload {
  user_id: number;
  email: string | null;
  name: string;
  company_id: number;
  role: string;
}
