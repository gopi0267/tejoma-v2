/**
 * Unit tests for requireRole/ROLE_HIERARCHY (Batch 9's "RBAC formalization") - real gap closed
 * here: this logic was ported byte-for-byte from the monolith in Batch 4 but has had no test
 * coverage of its own until now, since no route in Identity Service currently calls requireRole
 * (Identity Service's own routes are all self-service auth, not role-gated - grep-confirmed
 * against the monolith's src/api/auth.routes.ts too: it has no requireRole-gated endpoint
 * either). Platform Governance Service (Batch 10) will be the first real consumer. Tested here as
 * pure middleware logic (no HTTP layer needed) since requireRole takes/returns nothing but
 * Express's (req, res, next) contract.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireRole } from '../src/middleware/auth.middleware.js';

function mockReqRes(role: string | undefined) {
  const req = { user: role ? { role } : undefined } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, status, json };
}

describe('requireRole', () => {
  it('rejects with 401 when req.user is not set (must run after requireAuth)', () => {
    const { req, res, next, status, json } = mockReqRes(undefined);
    requireRole('admin')(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a role that is directly in the allowed list', () => {
    const { req, res, next } = mockReqRes('recruiter');
    requireRole('recruiter', 'admin')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 a role that is not in the allowed list and has no hierarchy entry', () => {
    const { req, res, next, status, json } = mockReqRes('candidate');
    requireRole('admin')(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'You do not have permission to perform this action' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a lower role (recruiter) from an admin-only route', () => {
    const { req, res, next, status } = mockReqRes('recruiter');
    requireRole('admin')(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('superadmin implicitly satisfies a check for any lower role, per ROLE_HIERARCHY', () => {
    const { req, res, next } = mockReqRes('superadmin');
    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('superadmin satisfies a recruiter-only check too (bottom of the hierarchy)', () => {
    const { req, res, next } = mockReqRes('superadmin');
    requireRole('recruiter')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('admin does NOT implicitly satisfy a superadmin-only check (hierarchy is one-directional)', () => {
    const { req, res, next, status } = mockReqRes('admin');
    requireRole('superadmin')(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
