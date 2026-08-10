/**
 * Internal, service-to-service endpoints - not part of the public API surface (in production,
 * gated by network boundary/API Gateway routing rather than a staff JWT, the same convention
 * platform-governance-service's and tenant-directory-service's own /internal/* routes follow).
 *
 * New in Batch 11, closing two gaps opened in earlier batches:
 *   - GET /internal/users/exists: the real target for platform-governance-service's
 *     services/identityServiceClient.ts (written in Batch 10 against this exact contract,
 *     gracefully returning null until this endpoint existed).
 *   - POST /internal/users: the user-creation half of platform-governance-service's approve saga
 *     (see that service's routes/company-requests.routes.ts header comment) - the cross-service
 *     replacement for the monolith's direct `INSERT INTO users` inside
 *     approveCompanyRegistrationRequest's single transaction.
 *
 * Neither endpoint is reachable by any staff/candidate session token - both trust the network
 * boundary only, so there is no requireAuth/requireRole gate here (mirroring
 * platform-governance-service's /internal/company-requests/by-identifier).
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';

const router = Router();

router.get('/internal/users/exists', async (req, res) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    const phone = typeof req.query.phone === 'string' ? req.query.phone : null;
    if (!email && !phone) {
      return res.status(422).json({ error: 'At least one of email or phone query parameters is required' });
    }

    const byEmail = email ? await db.getUserByEmail(email) : null;
    const byPhone = phone ? await db.getUserByPhone(phone) : null;
    res.json({ exists: Boolean(byEmail || byPhone) });
  } catch (error: any) {
    console.error('Failed to check user existence:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().min(1).optional().nullable(),
  passwordHash: z.string().min(1),
  companyId: z.number().int().positive(),
  role: z.enum(['recruiter', 'admin', 'superadmin']),
  createdBy: z.number().int().positive().optional().nullable(),
});

router.post('/internal/users', async (req, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid user details', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    if (!data.email && !data.phone) {
      return res.status(422).json({ error: 'At least one of email or phone is required' });
    }

    const existingByEmail = data.email ? await db.getUserByEmail(data.email) : null;
    const existingByPhone = data.phone ? await db.getUserByPhone(data.phone) : null;
    if (existingByEmail || existingByPhone) {
      return res.status(409).json({ error: 'A user with this email or phone already exists' });
    }

    const user = await db.createStaffUser({
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      passwordHash: data.passwordHash,
      companyId: data.companyId,
      role: data.role,
      createdBy: data.createdBy || null,
    });
    if (!user) return res.status(500).json({ error: 'Failed to create user' });

    const { password_hash, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (error: any) {
    console.error('Failed to create user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Remaining-monolith migration, Step 5 - candidate-search.routes.ts's "last_active" enrichment,
// folded into candidate-service, needs this service's own candidate_refresh_tokens table (candidate
// auth sessions are this service's domain, not candidate-service's). Same network-boundary-trusted
// convention as the two routes above - no requireAuth/requireRole gate.
router.get('/internal/candidates/last-active', async (req, res) => {
  try {
    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = idsParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    const lastActive = await db.getCandidateAccountsLastActiveBulk(ids);
    res.json({ lastActive });
  } catch (error: any) {
    console.error('Failed to fetch bulk candidate last-active:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

export default router;
