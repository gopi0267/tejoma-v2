import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validatePassword } from '../utils/password.js';
import { CompanyRegistrationRequest } from '../types.js';

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

// POST /api/company-registration - public, unauthenticated. Creates a *request*, never a
// company or user directly - nothing is activated until a superadmin approves it below.
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

    if (await db.getCompanyByName(data.companyName)) {
      return res.status(400).json({ error: 'A company with this name is already registered' });
    }
    if (await db.getUserByEmail(adminEmail)) {
      return res.status(400).json({ error: 'An account with this admin email already exists' });
    }
    if (adminPhone && (await db.getUserByPhone(adminPhone))) {
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

// GET /api/admin/company-requests - superadmin only. Deliberately not company-scoped: a
// superadmin oversees every prospective tenant, not one company's data.
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

router.patch('/admin/company-requests/:id/approve', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid request ID' });

    const result = await db.approveCompanyRegistrationRequest(id, req.user!.user_id);
    if (!result) return res.status(404).json({ error: 'Request not found' });
    if ('error' in result) return res.status(400).json({ error: result.error });

    const { password_hash, ...adminUser } = result.adminUser;
    res.json({ request: sanitizeRequest(result.request), company: result.company, adminUser });
  } catch (error: any) {
    console.error('Failed to approve company registration request:', error);
    res.status(500).json({ error: 'Failed to approve company registration request: ' + error.message });
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
