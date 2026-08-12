/**
 * Ported from the monolith's src/api/users.routes.ts (Batch 21) - byte-identical validation,
 * byte-identical response shapes, byte-identical business rules (self-lockout guard, last-active-
 * admin guard, generated-password convention). Reads/writes this service's own database directly
 * (no monolith proxy needed - users/refresh_tokens/password_history are fully owned here since
 * Phase 11/12's original Identity Service extraction; this batch only adds the admin-facing
 * management routes that were left on the monolith until now).
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validatePassword } from '../utils/password.js';
import { refreshRecruiterReviewViewForRecruiters } from '../services/matchingDecisionServiceClient.js';
import type { User } from '../types.js';

const router = Router();
// Company Admins only - a recruiter gets a 403 from every route below, not just a hidden UI tab.
router.use(requireAuth, requireRole('admin'));

function sanitizeUser(user: User) {
  const { password_hash, ...rest } = user;
  return rest;
}

/**
 * A generated password is never derived from anything guessable and is always long/varied
 * enough to satisfy validatePassword() by construction, so it deliberately skips the zxcvbn
 * check that admin-entered passwords go through below.
 */
function generateSecurePassword(length = 14): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+';
  const all = lower + upper + digits + symbols;
  const pick = (charset: string) => charset[crypto.randomInt(charset.length)];

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const parsed = parsePhoneNumberFromString(phone.trim(), 'IN');
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** Resolves the plaintext password for a create/reset request, validating admin-entered ones. */
function resolvePassword(input: { password?: string; generatePassword?: boolean }, userInputs: string[]): { password: string; generated: boolean } | { error: string } {
  if (input.generatePassword) {
    return { password: generateSecurePassword(), generated: true };
  }
  if (!input.password) {
    return { error: 'Provide a password or set generatePassword to true' };
  }
  const strength = validatePassword(input.password, userInputs);
  if (!strength.valid) {
    return { error: strength.errors[0] };
  }
  return { password: input.password, generated: false };
}

/**
 * Blocks self-service lockout: an admin may never disable/demote/delete their own account
 * (via this module), and a company may never be left with zero active admins.
 */
async function guardAdminRemoval(companyId: number, target: User, actorId: number): Promise<string | null> {
  if (target.id === actorId) {
    return 'You cannot perform this action on your own account';
  }
  if (target.role === 'admin' && target.is_active) {
    const activeAdmins = await db.countActiveAdmins(companyId);
    if (activeAdmins <= 1) {
      return 'This company must have at least one active admin';
    }
  }
  return null;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
  role: z.enum(['admin', 'recruiter']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  sortBy: z.enum(['name_asc', 'name_desc', 'created_desc', 'created_asc', 'last_login_desc']).optional(),
});

// GET /api/users - paginated/filtered/searched/sorted recruiter list, plus company-wide
// summary stats for the dashboard cards (unfiltered, same convention as Recruiter Review).
router.get('/users', async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const companyId = req.user!.company_id;

    const [{ rows, totalRecords }, stats] = await Promise.all([
      db.getUsersByCompany(companyId, q),
      db.getUserManagementStats(companyId),
    ]);

    res.json({
      data: rows.map(sanitizeUser),
      page: q.page,
      pageSize: q.pageSize,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / q.pageSize)),
      stats,
    });
  } catch (error: any) {
    console.error('Failed to load users:', error);
    res.status(500).json({ error: 'Failed to load users: ' + error.message });
  }
});

// GET /api/users/:id
router.get('/users/:id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = await db.getUserByIdForCompany(id, companyId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (error: any) {
    console.error('Failed to load user:', error);
    res.status(500).json({ error: 'Failed to load user: ' + error.message });
  }
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().min(1).optional().nullable(),
  role: z.enum(['admin', 'recruiter']),
  password: z.string().optional(),
  generatePassword: z.boolean().optional().default(false),
}).refine((data) => data.email || data.phone, { message: 'Email or phone is required', path: ['email'] })
  .refine((data) => data.generatePassword || data.password, { message: 'Provide a password or enable password generation', path: ['password'] });

// POST /api/users - Add Recruiter. company_id and created_by are always derived from the
// caller's JWT (req.user), never accepted from the request body - this is the entire point
// of the module: new recruiters join the admin's existing tenant, never a new one.
router.post('/users', async (req, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid recruiter details', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const companyId = req.user!.company_id;

    const email = normalizeEmail(data.email);
    if (data.email && !email) return res.status(400).json({ error: 'Invalid email address' });
    const phone = normalizePhone(data.phone);
    if (data.phone && !phone) return res.status(400).json({ error: 'Invalid phone number' });

    if (email && (await db.getUserByEmail(email))) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }
    if (phone && (await db.getUserByPhone(phone))) {
      return res.status(400).json({ error: 'An account with this phone number already exists' });
    }

    const resolved = resolvePassword(data, [data.name, email || '', phone || '']);
    if ('error' in resolved) return res.status(400).json({ error: resolved.error });

    const passwordHash = await bcrypt.hash(resolved.password, 10);
    const newUser = await db.createUserByAdmin({
      companyId, name: data.name, email, phone, role: data.role, passwordHash, createdBy: req.user!.user_id,
    });
    if (!newUser) return res.status(500).json({ error: 'Failed to create recruiter' });

    await db.addPasswordHistory(newUser.id, passwordHash);

    res.status(201).json({
      ...sanitizeUser(newUser),
      // Returned exactly once, only when the server generated it - never stored in plaintext.
      generated_password: resolved.generated ? resolved.password : undefined,
    });
  } catch (error: any) {
    console.error('Failed to create recruiter:', error);
    res.status(500).json({ error: 'Failed to create recruiter: ' + error.message });
  }
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().min(1).optional().nullable(),
  role: z.enum(['admin', 'recruiter']).optional(),
});

// PUT /api/users/:id
router.put('/users/:id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid update', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const target = await db.getUserByIdForCompany(id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Demoting the last active admin (including demoting yourself) is blocked the same way
    // disabling/deleting them is - all three would otherwise leave the company unmanageable.
    if (data.role && data.role !== target.role && target.role === 'admin') {
      const guardError = await guardAdminRemoval(companyId, target, req.user!.user_id);
      if (guardError) return res.status(400).json({ error: guardError });
    }

    let email: string | null | undefined = undefined;
    if (data.email !== undefined) {
      email = normalizeEmail(data.email);
      if (data.email && !email) return res.status(400).json({ error: 'Invalid email address' });
      if (email && email !== target.email && (await db.getUserByEmail(email))) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    }
    let phone: string | null | undefined = undefined;
    if (data.phone !== undefined) {
      phone = normalizePhone(data.phone);
      if (data.phone && !phone) return res.status(400).json({ error: 'Invalid phone number' });
      if (phone && phone !== target.phone && (await db.getUserByPhone(phone))) {
        return res.status(400).json({ error: 'An account with this phone number already exists' });
      }
    }

    const updated = await db.updateUserDetails(id, companyId, { name: data.name, email, phone, role: data.role }, req.user!.user_id);
    if (!updated) return res.status(500).json({ error: 'Failed to update user' });

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter review view (fire-and-forget).
    // If recruiter name changed, refresh the view rows where this recruiter is involved.
    if (data.name && data.name !== target.full_name) {
      refreshRecruiterReviewViewForRecruiters([id]);
    }

    res.json(sanitizeUser(updated));
  } catch (error: any) {
    console.error('Failed to update user:', error);
    res.status(500).json({ error: 'Failed to update user: ' + error.message });
  }
});

const statusSchema = z.object({ is_active: z.boolean() });

// PATCH /api/users/:id/status - enable/disable
router.patch('/users/:id/status', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid status payload', details: parsed.error.flatten() });
    }

    const target = await db.getUserByIdForCompany(id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (!parsed.data.is_active) {
      const guardError = await guardAdminRemoval(companyId, target, req.user!.user_id);
      if (guardError) return res.status(400).json({ error: guardError });
    }

    const updated = await db.updateUserStatus(id, companyId, parsed.data.is_active, req.user!.user_id);
    if (!updated) return res.status(500).json({ error: 'Failed to update status' });
    if (!parsed.data.is_active) {
      await db.revokeAllRefreshTokensForUser(id);
    }
    res.json(sanitizeUser(updated));
  } catch (error: any) {
    console.error('Failed to update user status:', error);
    res.status(500).json({ error: 'Failed to update user status: ' + error.message });
  }
});

const resetPasswordSchema = z.object({
  password: z.string().optional(),
  generatePassword: z.boolean().optional().default(false),
}).refine((data) => data.generatePassword || data.password, { message: 'Provide a password or enable password generation', path: ['password'] });

// PATCH /api/users/:id/reset-password - no forced change-on-next-login: the new password
// simply works through the existing, unmodified POST /auth/login. Existing sessions for the
// target user are revoked so a stolen old session can't persist alongside the new password.
router.patch('/users/:id/reset-password', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: 'Invalid reset-password payload', details: parsed.error.flatten() });
    }

    const target = await db.getUserByIdForCompany(id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const resolved = resolvePassword(parsed.data, [target.name, target.email || '', target.phone || '']);
    if ('error' in resolved) return res.status(400).json({ error: resolved.error });

    const passwordHash = await bcrypt.hash(resolved.password, 10);
    const updated = await db.resetUserPasswordHash(id, companyId, passwordHash, req.user!.user_id);
    if (!updated) return res.status(500).json({ error: 'Failed to reset password' });

    await db.addPasswordHistory(id, passwordHash);
    await db.revokeAllRefreshTokensForUser(id);

    res.json({
      ...sanitizeUser(updated),
      generated_password: resolved.generated ? resolved.password : undefined,
    });
  } catch (error: any) {
    console.error('Failed to reset password:', error);
    res.status(500).json({ error: 'Failed to reset password: ' + error.message });
  }
});

// DELETE /api/users/:id - soft delete (reversible only via direct DB access, no "undelete" UI)
router.delete('/users/:id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const target = await db.getUserByIdForCompany(id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const guardError = await guardAdminRemoval(companyId, target, req.user!.user_id);
    if (guardError) return res.status(400).json({ error: guardError });

    const deleted = await db.softDeleteUser(id, companyId, req.user!.user_id);
    if (!deleted) return res.status(500).json({ error: 'Failed to delete user' });
    await db.revokeAllRefreshTokensForUser(id);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete user:', error);
    res.status(500).json({ error: 'Failed to delete user: ' + error.message });
  }
});

export default router;
