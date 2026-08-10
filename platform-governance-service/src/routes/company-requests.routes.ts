/**
 * Company registration/approval workflow - ported from the monolith's
 * src/api/company-requests.routes.ts. Submission, listing, detail, and reject are fully ported
 * (self-contained to this service's own database). Approve is now implemented too (Batch 11).
 *
 * IMPLEMENTATION ISSUE, resolved per the required methodology - approve's design:
 *   Problem: the monolith's `approveCompanyRegistrationRequest` (src/db.ts:836-896) does three
 *     things inside ONE Postgres transaction: (1) INSERT INTO companies, (2) INSERT INTO users
 *     with role='admin', (3) UPDATE company_registration_requests to mark it approved and link
 *     both new rows.
 *   Why it exists: in the monolith's single shared database, all three tables live in the same
 *     Postgres instance, so a single ACID transaction can guarantee "all three happen, or none
 *     do."
 *   Impact: once split (Phase 3(database) section 1), `companies` belongs to Tenant Directory
 *     Service, `users` belongs to Identity Service, and `company_registration_requests` belongs
 *     to this service - three separate physical databases. A single Postgres transaction can no
 *     longer span them. This is a genuine distributed-transaction problem (Batch 10 left this
 *     BLOCKED for exactly this reason, since Tenant Directory Service didn't exist yet to even
 *     call).
 *   Minimum change, now that Tenant Directory Service exists (Batch 11): a saga with a local
 *     atomic claim, a durable checkpoint after each remote step, and one compensating action -
 *     see the `approve` handler below for the step-by-step design, and db.ts's "APPROVE SAGA
 *     PRIMITIVES" section for the local (this service's own database) half of it.
 *
 * Two duplicate-check pre-validations in submission still degrade gracefully (companies/users
 * live in services this one must not query directly) - see services/tenantDirectoryClient.ts and
 * services/identityServiceClient.ts for the full issue/reason/impact/fix writeup for each; both
 * are now wired to real endpoints as of Batch 11 and only degrade if those services are actually
 * unreachable at request time.
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { db, pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/staffAuth.middleware.js';
import { validatePassword } from '../utils/password.js';
import { companyNameExists, createCompany, deactivateCompany, getCompanyById } from '../services/tenantDirectoryClient.js';
import { staffUserExists, createStaffUser } from '../services/identityServiceClient.js';
import { logger } from '../utils/logger.js';
import type { CompanyRegistrationRequest } from '../types.js';

const router = Router();

function sanitizeRequest(request: CompanyRegistrationRequest) {
  const { password_hash, ...rest } = request;
  return rest;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const parsed = parsePhoneNumberFromString(phone.trim(), 'IN');
  return parsed && parsed.isValid() ? parsed.number : null;
}

const registrationSchema = z.object({
  companyName: z.string().trim().min(1).max(255),
  companyWebsite: z.string().trim().url().optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  companySize: z.string().trim().max(50).optional().nullable(),
  businessEmail: z.string().trim().email(),
  companyPhone: z.string().trim().min(1).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  adminName: z.string().trim().min(1).max(255),
  adminEmail: z.string().trim().email(),
  adminPhone: z.string().trim().min(1).optional().nullable(),
  password: z.string(),
});

// POST /company-registration - public, unauthenticated. Creates a *request*, never a company or
// user directly - nothing is activated until a superadmin approves it (blocked this batch - see
// header comment).
router.post('/company-registration', async (req, res) => {
  try {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid registration details', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const businessEmail = data.businessEmail.trim().toLowerCase();
    const adminEmail = data.adminEmail.trim().toLowerCase();

    let companyPhone: string | null = null;
    if (data.companyPhone) {
      companyPhone = normalizePhone(data.companyPhone);
      if (!companyPhone) return res.status(400).json({ error: 'Invalid company phone number' });
    }
    let adminPhone: string | null = null;
    if (data.adminPhone) {
      adminPhone = normalizePhone(data.adminPhone);
      if (!adminPhone) return res.status(400).json({ error: 'Invalid admin phone number' });
    }

    const strength = validatePassword(data.password, [data.adminName, adminEmail, data.companyName]);
    if (!strength.valid) {
      return res.status(400).json({ error: strength.errors[0], errors: strength.errors, password_strength: strength.label });
    }

    // Graceful-degradation pre-checks - see tenantDirectoryClient.ts/identityServiceClient.ts
    // header comments. A `null` result means "unknown," not "does not exist," so it is never
    // treated as a hard rejection - only a confirmed `true` blocks submission.
    if ((await companyNameExists(data.companyName)) === true) {
      return res.status(400).json({ error: 'A company with this name is already registered' });
    }
    if ((await staffUserExists({ email: adminEmail })) === true) {
      return res.status(400).json({ error: 'An account with this admin email already exists' });
    }
    if (adminPhone && (await staffUserExists({ phone: adminPhone })) === true) {
      return res.status(400).json({ error: 'An account with this admin phone number already exists' });
    }
    const duplicate = await db.findPendingCompanyRegistrationDuplicate({ companyName: data.companyName, businessEmail, adminEmail });
    if (duplicate) {
      const field = duplicate.field === 'company_name' ? 'company name' : duplicate.field === 'business_email' ? 'business email' : 'admin email';
      return res.status(400).json({ error: `A pending registration request with this ${field} already exists` });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const request = await db.createCompanyRegistrationRequest({
      companyName: data.companyName,
      companyWebsite: data.companyWebsite || null,
      industry: data.industry || null,
      companySize: data.companySize || null,
      businessEmail,
      companyPhone,
      country: data.country || null,
      state: data.state || null,
      city: data.city || null,
      address: data.address || null,
      adminName: data.adminName,
      adminEmail,
      adminPhone,
      passwordHash,
    });
    if (!request) return res.status(500).json({ error: 'Failed to submit registration request' });

    res.status(201).json({
      message: 'Your registration request has been submitted and is pending administrator approval.',
      request: sanitizeRequest(request),
    });
  } catch (error: any) {
    console.error('Failed to submit company registration:', error);
    res.status(500).json({ error: 'Failed to submit registration request: ' + error.message });
  }
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  industry: z.string().trim().optional(),
  companyName: z.string().trim().optional(),
  businessEmail: z.string().trim().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(['newest', 'oldest', 'company_name', 'status']).optional(),
});

// GET /admin/company-requests - superadmin only. Deliberately not company-scoped: a superadmin
// oversees every prospective tenant, not one company's data.
router.get('/admin/company-requests', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const q = parsed.data;

    const [{ rows, totalRecords }, stats] = await Promise.all([
      db.getCompanyRegistrationRequests(q),
      db.getCompanyRegistrationStats(),
    ]);

    res.json({
      data: rows.map(sanitizeRequest),
      page: q.page,
      pageSize: q.pageSize,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / q.pageSize)),
      stats,
    });
  } catch (error: any) {
    console.error('Failed to load company registration requests:', error);
    res.status(500).json({ error: 'Failed to load company registration requests: ' + error.message });
  }
});

router.get('/admin/company-requests/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid request ID' });

    const request = await db.getCompanyRegistrationRequestById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json(sanitizeRequest(request));
  } catch (error: any) {
    console.error('Failed to load company registration request:', error);
    res.status(500).json({ error: 'Failed to load company registration request: ' + error.message });
  }
});

/**
 * PATCH /admin/company-requests/:id/approve - the saga (see this file's header comment for the
 * distributed-transaction problem this solves).
 *
 * Concurrency: a Postgres session-level advisory lock, keyed on the request id, is held for the
 * ENTIRE handler via a single checked-out connection (not the shared pool) - a second concurrent
 * approve call for the same id blocks briefly on pg_advisory_lock, or (since we use the
 * non-blocking pg_try_advisory_lock here) is told to retry rather than proceeding in parallel.
 * If this process crashes mid-saga, Postgres releases the lock automatically when the underlying
 * connection drops - no permanently-stuck lock, no separate "claim" column/state needed.
 *
 * Resumability: resulting_company_id is checkpointed durably (setResultingCompany) the moment
 * company-creation succeeds, before user-creation is even attempted. A retry (same id, lock
 * re-acquired) sees resulting_company_id already set and skips straight to user-creation,
 * instead of creating a second company.
 *
 * Compensation: if user-creation fails AFTER company-creation succeeded, the just-created company
 * is deactivated (not deleted - Tenant Directory Service has no delete endpoint, and soft-disable
 * is the safer default for something a human may need to inspect afterward) and
 * resulting_company_id is cleared, so a retry creates a fresh company rather than reusing a
 * deactivated one. If the compensating deactivation call itself fails, that is logged at error
 * level as needing manual operator cleanup - not silently swallowed - since it's the one failure
 * mode this saga cannot fully self-heal.
 */
router.patch('/admin/company-requests/:id/approve', requireAuth, requireRole('superadmin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid request ID' });

  const client = await pool.connect();
  try {
    const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [id]);
    if (!lockResult.rows[0].acquired) {
      return res.status(409).json({ error: 'This request is currently being processed. Please try again shortly.' });
    }

    try {
      const request = await db.getCompanyRegistrationRequestById(id);
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'pending') {
        return res.status(400).json({ error: `Request has already been ${request.status}` });
      }

      // Step 1: create the company, unless a prior attempt already checkpointed one.
      let companyId = request.resulting_company_id;
      let companyDetail: Awaited<ReturnType<typeof getCompanyById>> = null;
      if (!companyId) {
        const companyResult = await createCompany({
          name: request.company_name,
          industry: request.industry,
          website: request.company_website,
        });
        if (!companyResult.ok) {
          return res.status(502).json({ error: `Failed to create company: ${companyResult.error}. Please try again.` });
        }
        companyId = companyResult.company.id;
        companyDetail = companyResult.company;
        await db.setResultingCompany(id, companyId);
      } else {
        // Resumed retry - best-effort enrichment only; the durable saga state doesn't depend on this succeeding.
        companyDetail = await getCompanyById(companyId);
      }

      // Step 2: create the admin user, reusing the request's already-hashed password (never a
      // raw password crossing a service boundary).
      const userResult = await createStaffUser({
        name: request.admin_name,
        email: request.admin_email,
        phone: request.admin_phone,
        passwordHash: request.password_hash,
        companyId,
        role: 'admin',
        createdBy: req.user!.user_id,
      });
      if (!userResult.ok) {
        const compensated = await deactivateCompany(companyId);
        if (!compensated) {
          logger.error({ companyId, requestId: id }, 'Failed to compensate (deactivate) an orphaned company after user-creation failure - manual operator cleanup required');
        } else {
          await db.clearResultingCompany(id);
        }
        return res.status(502).json({ error: `Failed to create admin user: ${userResult.error}. Please try again.` });
      }

      // Step 3: finalize - both remote resources now durably exist.
      const finalized = await db.finalizeApproval(id, req.user!.user_id, userResult.user.id);
      if (!finalized) {
        logger.error({ requestId: id, companyId, userId: userResult.user.id }, 'Company and admin user were created but finalizing the request record failed - verify and correct manually');
        return res.status(500).json({ error: 'The company and admin user were created, but recording final approval failed. Please verify manually.' });
      }

      res.json({ request: sanitizeRequest(finalized), company: companyDetail, adminUser: userResult.user });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [id]);
    }
  } catch (error: any) {
    console.error('Failed to approve company registration request:', error);
    res.status(500).json({ error: 'Failed to approve company registration request: ' + error.message });
  } finally {
    client.release();
  }
});

const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

router.patch('/admin/company-requests/:id/reject', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid request ID' });

    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'A rejection reason is required', details: parsed.error.flatten() });
    }

    const result = await db.rejectCompanyRegistrationRequest(id, req.user!.user_id, parsed.data.reason);
    if (!result) return res.status(404).json({ error: 'Request not found' });
    if ('error' in result) return res.status(400).json({ error: result.error });

    res.json(sanitizeRequest(result));
  } catch (error: any) {
    console.error('Failed to reject company registration request:', error);
    res.status(500).json({ error: 'Failed to reject company registration request: ' + error.message });
  }
});

export default router;
