/**
 * Internal, service-to-service endpoints - not part of the public API surface (in production,
 * gated by network boundary/API Gateway routing rather than by a staff JWT, the same convention
 * identity-service's own internal-style endpoints follow, e.g. marketplaceClient.ts's
 * /internal/candidate-profiles/:id target on Marketplace Service).
 *
 * GET /internal/company-requests/by-identifier closes the loop identity-service's auth.routes.ts
 * header comment explicitly deferred: "Differentiated pending/rejected registration login error
 * messaging - deferred to Platform Governance Service." That service now exists, so
 * identity-service is wired to call this endpoint in this same batch (see
 * identity-service/src/services/platformGovernanceClient.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';

const router = Router();

const queryByIdentifierSchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().trim().min(1),
});

router.get('/internal/company-requests/by-identifier', async (req, res) => {
  try {
    const parsed = queryByIdentifierSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }

    const request = await db.getCompanyRegistrationRequestByIdentifier(parsed.data);
    if (!request) return res.status(404).json({ status: null });

    // Only the status is exposed here - this endpoint exists purely to let another service render
    // a differentiated login error message, not to leak the full request payload (which includes
    // a password hash and full applicant PII) across a service boundary.
    res.json({ status: request.status });
  } catch (error: any) {
    console.error('Failed to look up company registration request by identifier:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

export default router;
