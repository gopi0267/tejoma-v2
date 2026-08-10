// Ported exactly from the monolith's src/types.ts Company interface - the only table this service
// owns (migrations/001_initial_schema.up.sql).
export interface Company {
  id: number;
  name: string;
  industry: string | null;
  plan: 'starter' | 'pro' | 'enterprise';
  seats_limit: number;
  is_active: boolean;
  company_slug: string;
  logo_url: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

// The shape identity-service's services/tenantDirectoryClient.ts already expects from
// GET /internal/companies/:id (written in Batch 4, before this service existed) - matched
// exactly, not redesigned.
export interface CompanyInfo {
  id: number;
  name: string;
  logo_url: string | null;
  plan: string;
}
