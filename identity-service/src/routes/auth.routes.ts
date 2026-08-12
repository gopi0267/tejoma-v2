/**
 * Staff authentication routes - ported from the monolith's src/api/auth.routes.ts. Batch 4 added
 * login/refresh/logout/logout-all/me. Batch 6 added OTP-based password reset + password history.
 * This batch (7) adds Google OAuth (start + callback) - fully self-contained, since staff OAuth
 * deliberately never auto-provisions (requires an existing `users` row, unlike the candidate
 * side) - no Tenant Directory dependency at all, unlike signup.
 *
 * Testing limitation, stated honestly rather than worked around with a mock: the callback's
 * success path (exchanging a real authorization code, verifying a real Google-issued ID token)
 * cannot be exercised by an automated test without real Google OAuth credentials and a real
 * user-consented authorization code - mocking google-auth-library would violate this service's
 * "never mock the database/external dependency, only ever gracefully degrade or genuinely call
 * it" discipline used throughout this series. Every branch reachable without a real Google call
 * (not-configured, missing-code, the shape of the generated authorization URL) is tested for
 * real. The success path needs a manual verification pass against a real Google OAuth app before
 * this endpoint is trusted with production traffic - tracked as a pre-cutover requirement.
 *
 * Explicitly NOT ported, and why:
 *   - signup/start: from Batch 4 through Batch 10, tracked as "deferred, needs Tenant Directory
 *     Service." Batch 11 built Tenant Directory Service - but investigating what signup/start
 *     would need to call revealed it should NOT be ported at all: the monolith's own
 *     `POST /auth/signup/complete` (the endpoint that would ever finish a signup/start flow) is
 *     permanently disabled (returns 403 unconditionally - "Public self-signup has been replaced
 *     by Company Registration"), and a full repo audit found zero frontend callers of
 *     signup/start or of verify-otp with purpose='signup' (Login.tsx's only verify-otp call
 *     always sends purpose='password_reset'). signup/start is confirmed orphaned dead code in
 *     the monolith itself - it still executes `db.getOrCreateCompany()` on every hit with no
 *     reachable caller. Porting dead code here would violate this service's own
 *     "no placeholder/unused code" discipline (the same reasoning Batch 6's email.ts already
 *     applied to skip sendPasswordResetEmail). The real "start a signup" flow in this system is
 *     Platform Governance Service's `POST /company-registration` (Batch 10).
 *   - An authenticated "change password" endpoint: doesn't exist in the monolith. Not invented.
 *
 * Cross-service enrichments:
 *   1. Company detail enrichment (name/logo/plan) - see services/tenantDirectoryClient.ts. WIRED
 *      in Batch 11, now that Tenant Directory Service exists.
 *   2. Differentiated pending/rejected registration login error messaging - WIRED in Batch 10,
 *      now that Platform Governance Service exists. See services/platformGovernanceClient.ts and
 *      the login route's `!user` branch below.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db.js';
import {
  signAccessToken,
  signCandidateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  clearAuthCookies,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../utils/tokens.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { getCompanyById } from '../services/tenantDirectoryClient.js';
import { getRegistrationStatusByIdentifier } from '../services/platformGovernanceClient.js';
import { generateOTP, hashOTP, compareOTP, normalizeIdentifier } from '../utils/otp.js';
import { sendOTPEmail } from '../utils/email.js';
import { sendOTPSms } from '../utils/sms.js';
import { otpRequestLimiter } from '../middleware/rateLimit.middleware.js';
import { validatePassword } from '../utils/password.js';
import { IS_PRODUCTION } from '../config/env.js';
import type { User } from '../types.js';

const router = Router();

// Recruiter/staff Google sign-in - optional, exactly as in the monolith. If unset, /google
// responds with a clear redirect instead of crashing, and the client-side "Continue with Google"
// button always renders.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const STAFF_GOOGLE_REDIRECT_URI = process.env.STAFF_GOOGLE_REDIRECT_URI || '';
const staffGoogleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && STAFF_GOOGLE_REDIRECT_URI);
const staffGoogleClient = staffGoogleOAuthConfigured
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, STAFF_GOOGLE_REDIRECT_URI)
  : null;
if (!staffGoogleOAuthConfigured) {
  console.warn('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/STAFF_GOOGLE_REDIRECT_URI not set - recruiter Google sign-in is disabled (button will show a friendly error).');
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_REQUESTS_PER_HOUR = 5;

async function isPasswordReused(userId: number, newPassword: string): Promise<boolean> {
  const history = await db.getPasswordHistory(userId);
  for (const entry of history) {
    if (await bcrypt.compare(newPassword, entry.password_hash)) {
      return true;
    }
  }
  return false;
}

async function sendOtp(identifier: { type: 'email' | 'phone'; value: string }, otp: string, name: string) {
  if (identifier.type === 'email') {
    await sendOTPEmail(identifier.value, otp, name);
  } else {
    await sendOTPSms(identifier.value, otp);
  }
}

/**
 * Enforces the per-identifier OTP abuse controls before a new code is sent: a resend cooldown
 * (stops rapid-fire re-requests) and an hourly request cap (bounds the total number of fresh
 * 5-attempt budgets an attacker can farm). Returns an error message to send back to the client,
 * or null if the request is allowed. Unchanged from the monolith.
 */
async function enforceOtpRequestLimits(identifier: { type: 'email' | 'phone'; value: string }, purpose: 'signup' | 'password_reset'): Promise<string | null> {
  const email = identifier.type === 'email' ? identifier.value : null;
  const phone = identifier.type === 'phone' ? identifier.value : null;

  const latest = await db.getLatestOtpRecord({ email, phone, purpose });
  if (latest) {
    const elapsedMs = Date.now() - new Date(latest.created_at).getTime();
    if (elapsedMs < OTP_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      return `Please wait ${waitSec}s before requesting another code`;
    }
  }

  const requestCount = await db.countOtpRequestsSince({ email, phone, purpose, since: new Date(Date.now() - 60 * 60 * 1000) });
  if (requestCount >= OTP_MAX_REQUESTS_PER_HOUR) {
    return 'Too many verification code requests. Please try again in an hour.';
  }

  return null;
}

function toUserInfo(user: User) {
  return { id: user.id, name: user.name, email: user.email || '', role: user.role };
}

/** Extracts the two fields every audit_log row records for "where this came from" - see migrations/002_audit_log.up.sql. */
function auditContext(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip || null, userAgent: (req.headers['user-agent'] as string) || null };
}

async function toCompanyInfo(companyId: number) {
  const company = await getCompanyById(companyId);
  if (!company) return null;
  return { id: company.id, name: company.name, logo_url: company.logo_url, plan: company.plan };
}

async function findUserByIdentifier(identifier: { type: 'email' | 'phone'; value: string }): Promise<User | null> {
  return identifier.type === 'email' ? db.getUserByEmail(identifier.value) : db.getUserByPhone(identifier.value);
}

/**
 * Issues a fresh access token + refresh token pair for `user`, persists the refresh token
 * (hashed) as a new session row, and sets both as httpOnly cookies on `res` - unchanged from the
 * monolith's issueSession, including device/IP tracking on the refresh_tokens row.
 */
async function issueSession(req: Request, res: Response, user: User, remember: boolean = true): Promise<string> {
  const accessToken = signAccessToken({
    user_id: user.id,
    email: user.email,
    name: user.name,
    company_id: user.company_id,
    role: user.role,
  });

  const { token: refreshToken, hash, expiresAt } = generateRefreshToken();
  await db.createRefreshToken({
    userId: user.id,
    tokenHash: hash,
    userAgent: (req.headers['user-agent'] as string) || null,
    ip: req.ip || null,
    expiresAt,
    remember,
  });

  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions());
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshTokenCookieOptions(remember));

  return accessToken;
}

// ==================== LOGIN ====================
router.post('/auth/login', async (req, res) => {
  try {
    const { email, identifier: rawIdentifierBody, password, remember } = req.body;
    const rawIdentifier = rawIdentifierBody || email; // supports both the new `identifier` field and legacy `email` field

    if (!rawIdentifier || !password) {
      return res.status(400).json({ error: 'Email/phone and password are required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      await db.recordAuditEvent({ actorType: 'staff', actorId: null, eventType: 'login_failed', ...auditContext(req), metadata: { reason: 'invalid_identifier_format' } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // No account yet - check whether this identifier belongs to a company registration request
      // instead, so a prospective admin gets a meaningful status message rather than a generic
      // "invalid credentials" (which would be indistinguishable from a typo). Ported from the
      // monolith's src/api/auth.routes.ts:262-274, now a real cross-service call to Platform
      // Governance Service (Batch 10) instead of a direct query - gracefully falls back to the
      // generic message if that service is unreachable (see platformGovernanceClient.ts).
      const registrationStatus = await getRegistrationStatusByIdentifier(identifier);
      if (registrationStatus === 'pending') {
        await db.recordAuditEvent({ actorType: 'staff', actorId: null, eventType: 'login_failed', ...auditContext(req), metadata: { reason: 'registration_pending', identifier: identifier.value } });
        return res.status(401).json({ error: 'Your company registration is pending administrator approval.' });
      }
      if (registrationStatus === 'rejected') {
        await db.recordAuditEvent({ actorType: 'staff', actorId: null, eventType: 'login_failed', ...auditContext(req), metadata: { reason: 'registration_rejected', identifier: identifier.value } });
        return res.status(401).json({ error: 'Your company registration has been rejected.' });
      }
      await db.recordAuditEvent({ actorType: 'staff', actorId: null, eventType: 'login_failed', ...auditContext(req), metadata: { reason: 'unknown_identifier', identifier: identifier.value } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active || user.deleted_at) {
      await db.recordAuditEvent({ actorType: 'staff', actorId: user.id, eventType: 'login_failed', ...auditContext(req), metadata: { reason: 'account_deactivated' } });
      return res.status(401).json({ error: 'This account has been deactivated' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      await db.recordAuditEvent({ actorType: 'staff', actorId: user.id, eventType: 'login_failed', ...auditContext(req), metadata: { reason: 'wrong_password' } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const access_token = await issueSession(req, res, user, remember !== false);
    db.updateLastLogin(user.id).catch((err) => console.error('Failed to record last login:', err));
    await db.recordAuditEvent({ actorType: 'staff', actorId: user.id, eventType: 'login_success', ...auditContext(req) });
    res.json({
      access_token,
      user_info: toUserInfo(user),
      company_id: user.company_id,
      company: await toCompanyInfo(user.company_id),
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==================== REFRESH ====================
router.post('/auth/refresh', async (req, res) => {
  try {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!rawToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const tokenHash = hashRefreshToken(rawToken);
    const record = await db.findRefreshTokenByHash(tokenHash);

    if (!record) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Reuse of an already-revoked token is a strong signal of theft (a legitimate client would
    // only ever hold the newest, not-yet-rotated token). Kill every session for the user as a
    // defensive measure rather than just rejecting this one request - unchanged from the monolith.
    if (record.revoked_at) {
      await db.revokeAllRefreshTokensForUser(record.user_id);
      await db.recordAuditEvent({ actorType: 'staff', actorId: record.user_id, eventType: 'refresh_token_reuse_detected', ...auditContext(req) });
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session invalid. Please log in again.' });
    }

    if (new Date(record.expires_at) < new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const user = await db.getUserById(record.user_id);
    if (!user || !user.is_active || user.deleted_at) {
      await db.revokeRefreshTokenByHash(tokenHash);
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Account unavailable' });
    }

    // Rotate: revoke the presented token, issue a brand new access+refresh pair, carrying forward
    // the original "remember me" choice so it doesn't drift to persistent.
    await db.revokeRefreshTokenByHash(tokenHash);
    const access_token = await issueSession(req, res, user, record.remember !== false);

    res.json({
      access_token,
      user_info: toUserInfo(user),
      company_id: user.company_id,
      company: await toCompanyInfo(user.company_id),
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

// ==================== ME (bootstrap auth state from the httpOnly cookie) ====================
router.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.user!.user_id);
    if (!user || !user.is_active || user.deleted_at) {
      return res.status(401).json({ error: 'Session invalid' });
    }
    res.json({ user_info: toUserInfo(user), company_id: user.company_id, company: await toCompanyInfo(user.company_id) });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

// ==================== LOGOUT (this device/session only) ====================
router.post('/auth/logout', async (req, res) => {
  try {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (rawToken) {
      const record = await db.findRefreshTokenByHash(hashRefreshToken(rawToken));
      await db.revokeRefreshTokenByHash(hashRefreshToken(rawToken));
      if (record) {
        await db.recordAuditEvent({ actorType: 'staff', actorId: record.user_id, eventType: 'logout', ...auditContext(req) });
      }
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ==================== LOGOUT FROM ALL DEVICES ====================
router.post('/auth/logout-all', async (req, res) => {
  try {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (rawToken) {
      const record = await db.findRefreshTokenByHash(hashRefreshToken(rawToken));
      if (record) {
        await db.revokeAllRefreshTokensForUser(record.user_id);
        await db.recordAuditEvent({ actorType: 'staff', actorId: record.user_id, eventType: 'logout_all', ...auditContext(req) });
      }
    }
  } catch (error) {
    console.error('Logout-all error:', error);
  }
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out from all devices' });
});

// ==================== SIGN UP: COMPLETE (retired - see Company Approval Workflow) ====================
// Public self-signup used to create a brand-new company/tenant instantly here with no review,
// which is exactly the gap the Company Approval Workflow closes. Ported as-is from the monolith -
// this endpoint has no dependency (it's a static 403), unlike signup/start (deferred, see header).
router.post('/auth/signup/complete', async (_req, res) => {
  res.status(403).json({ error: 'Public self-signup has been replaced by Company Registration. Submit a request for review.' });
});

// ==================== VERIFY OTP (shared by signup + password reset) ====================
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { identifier: rawIdentifier, otp, purpose } = req.body;
    const otpPurpose = purpose === 'password_reset' ? 'password_reset' : 'signup';

    if (!rawIdentifier || !otp) {
      return res.status(400).json({ error: 'Identifier and OTP are required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid email or phone number' });
    }

    const record = await db.getLatestOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: otpPurpose,
    });

    if (!record) {
      return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
    }
    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }
    if (record.attempts >= record.max_attempts) {
      return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }

    const matches = await compareOTP(otp, record.otp_hash);
    if (!matches) {
      await db.incrementOtpAttempts(record.id);
      return res.status(400).json({ error: 'Incorrect verification code' });
    }

    await db.markOtpVerified(record.id);
    res.status(200).json({ message: 'Verified successfully', identifier: identifier.value });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// ==================== FORGOT PASSWORD: START (send OTP) ====================
router.post('/auth/forgot-password/start', otpRequestLimiter, async (req, res) => {
  try {
    const { identifier: rawIdentifier } = req.body;
    if (!rawIdentifier) {
      return res.status(400).json({ error: 'Email or phone number is required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Enter a valid email address or phone number' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // Don't reveal whether the account exists.
      return res.status(200).json({ message: 'If an account exists, a verification code has been sent', identifier: identifier.value, identifier_type: identifier.type });
    }

    const limitError = await enforceOtpRequestLimits(identifier, 'password_reset');
    if (limitError) {
      return res.status(429).json({ error: limitError });
    }

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    await db.createOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: 'password_reset',
      otpHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    await sendOtp(identifier, otp, user.name);

    res.status(200).json({
      message: `Verification code sent via ${identifier.type}`,
      identifier: identifier.value,
      identifier_type: identifier.type,
    });
  } catch (error) {
    console.error('Forgot password start error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ==================== FORGOT PASSWORD: RESET (after OTP verified) ====================
router.post('/auth/forgot-password/reset', async (req, res) => {
  try {
    const { identifier: rawIdentifier, new_password, confirm_password } = req.body;

    if (!rawIdentifier || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'Identifier and both password fields are required' });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid email or phone number' });
    }

    const otpRecord = await db.getLatestOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: 'password_reset',
    });
    if (!otpRecord || !otpRecord.verified) {
      return res.status(400).json({ error: 'Please verify your code first' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const strength = validatePassword(new_password, [user.name, identifier.value]);
    if (!strength.valid) {
      return res.status(400).json({ error: strength.errors[0], errors: strength.errors, password_strength: strength.label });
    }

    if (await isPasswordReused(user.id, new_password)) {
      return res.status(400).json({ error: 'You cannot reuse a recent password. Please choose a different one.' });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    await db.updateUserPasswordHash(user.id, passwordHash);
    await db.addPasswordHistory(user.id, passwordHash);

    await db.deleteOtpRecords({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: 'password_reset',
    });

    // A password reset invalidates any existing sessions - force re-login everywhere.
    await db.revokeAllRefreshTokensForUser(user.id);
    await db.recordAuditEvent({ actorType: 'staff', actorId: user.id, eventType: 'password_reset', ...auditContext(req) });

    res.status(200).json({ message: 'Password updated successfully. Please log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ==================== GOOGLE OAUTH: START ====================
router.get('/auth/google', (req, res) => {
  if (!staffGoogleClient) {
    return res.redirect('/?auth_error=google_not_configured');
  }
  const url = staffGoogleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
  res.redirect(url);
});

// ==================== GOOGLE OAUTH: CALLBACK ====================
// Unlike the candidate portal, sign-in never auto-provisions a new account here: a `users` row
// requires a company_id, and there is no sensible company to assign an unrecognized Google email
// to - that would mean silently spinning up a new company with no name/plan/setup. Recruiters
// must exist already (created directly, via admin invite, or via "Register your company") before
// Google sign-in will work for them; an unmatched email gets a clear, actionable error instead.
router.get('/auth/google/callback', async (req, res) => {
  if (!staffGoogleClient) {
    return res.redirect('/?auth_error=google_not_configured');
  }
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      return res.redirect('/?auth_error=google_auth_failed');
    }

    const { tokens } = await staffGoogleClient.getToken(code);
    if (!tokens.id_token) {
      return res.redirect('/?auth_error=google_auth_failed');
    }

    // Identity comes only from Google's verified ID token - never from request body/query.
    const ticket = await staffGoogleClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.redirect('/?auth_error=google_auth_failed');
    }

    const email = payload.email.toLowerCase();
    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.redirect('/?auth_error=google_no_account');
    }
    if (!user.is_active || user.deleted_at) {
      return res.redirect('/?auth_error=account_deactivated');
    }

    await issueSession(req, res, user, true);
    db.updateLastLogin(user.id).catch((err) => console.error('Failed to record last login:', err));
    await db.recordAuditEvent({ actorType: 'staff', actorId: user.id, eventType: 'oauth_signin', ...auditContext(req) });
    res.redirect('/');
  } catch (error) {
    console.error('Staff Google auth error:', error);
    res.redirect('/?auth_error=google_auth_failed');
  }
});

export default router;
