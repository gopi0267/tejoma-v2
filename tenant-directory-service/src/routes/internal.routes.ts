/**
 * Internal, service-to-service endpoints - the entire public surface of this service (it has no
 * staff-JWT-gated routes at all, see config/env.ts's header comment). Gated by network
 * boundary/API Gateway routing in production, not by a token, matching the convention already
 * established by identity-service's marketplaceClient.ts target and platform-governance-service's
 * /internal/company-requests/by-identifier.
 *
 * Four endpoints, matching contracts already written by their callers (not redesigned here):
 *   - GET /internal/companies/:id           - identity-service's tenantDirectoryClient.ts (Batch 4)
 *   - GET /internal/companies/exists        - platform-governance-service's tenantDirectoryClient.ts (Batch 10)
 *   - POST /internal/companies              - platform-governance-service's approve saga (Batch 11)
 *   - PATCH /internal/companies/:id/deactivate - the approve saga's compensating action (Batch 11)
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';

const router = Router();

router.get('/internal/companies/exists', async (req, res) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    if (!name.trim()) {
      return res.status(422).json({ error: 'name query parameter is required' });
    }
    const company = await db.getCompanyByName(name);
    res.json({ exists: company !== null });
  } catch (error: any) {
    console.error('Failed to check company existence:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(255),
  industry: z.string().trim().max(100).optional().nullable(),
  website: z.string().trim().max(255).optional().nullable(),
});

router.post('/internal/companies', async (req, res) => {
  try {
    const parsed = createCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid company details', details: parsed.error.flatten() });
    }

    const existing = await db.getCompanyByName(parsed.data.name);
    if (existing) {
      return res.status(409).json({ error: 'A company with this name already exists', company: existing });
    }

    const company = await db.createCompany(parsed.data);
    if (!company) return res.status(500).json({ error: 'Failed to create company' });
    res.status(201).json(company);
  } catch (error: any) {
    console.error('Failed to create company:', error);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

router.patch('/internal/companies/:id/deactivate', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid company ID' });

    const ok = await db.deactivateCompany(id);
    if (!ok) return res.status(404).json({ error: 'Company not found' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to deactivate company:', error);
    res.status(500).json({ error: 'Failed to deactivate company' });
  }
});

// Registered last among the /internal/companies/* routes so the more specific paths above
// (/exists) are matched first - Express matches route definitions in registration order, and
// :id would otherwise greedily capture "exists" as an id parameter.
//
// Returns the FULL company row, not just the CompanyInfo subset - two different callers need two
// different slices of it: identity-service's tenantDirectoryClient.ts (Batch 4) only reads
// id/name/logo_url/plan for session enrichment (still typed as CompanyInfo there, so the extra
// fields are simply ignored, not a breaking change to that contract), while
// platform-governance-service's approve saga (Batch 11) needs the full row to display in its
// approve response. One endpoint, one real row, each caller reads what it needs - simpler than
// maintaining two near-identical endpoints.
router.get('/internal/companies/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid company ID' });

    const company = await db.getCompanyById(id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    res.json(company);
  } catch (error: any) {
    console.error('Failed to fetch company:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

export default router;
