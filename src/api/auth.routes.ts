import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db.js';
import { generateOTP, hashOTP, compareOTP, normalizeIdentifier } from '../utils/otp.js';
import { sendOTPEmail } from '../utils/email.js';
import { sendOTPSms } from '../utils/sms.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  clearAuthCookies,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../utils/tokens.js';
import { otpRequestLimiter } from '../middleware/rateLimit.middleware.js';
import { validatePassword } from '../utils/password.js';
import { requireAuth } from '../middleware/auth.middleware.js';
// Tier 0 migration (Batch 13c) - see src/shadowRead.ts's header comment for the full contract.
// Disabled by default (SHADOW_READ_ENABLED); a no-op until an operator opts in.
import { shadowReadLogin, type LoginOutcome } from '../shadowRead.js';

const router = Router();

async function isPasswordReused(userId: number, newPassword: string): Promise<boolean> {
  const history = await db.getPasswordHistory(userId);
  for (const entry of history) {
    if (await bcrypt.compare(newPassword, entry.password_hash)) {
      return true;
    }
  }
  return false;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds between requests for the same identifier
const OTP_MAX_REQUESTS_PER_HOUR = 5;

// Recruiter/staff Google sign-in reuses the same Google Cloud OAuth client as the candidate
// portal (candidate-auth.routes.ts) but needs its own registered redirect URI, since it lands
// on a different callback route - both must be added under the one client's "Authorized redirect
// URIs" in Google Cloud Console. Optional - if unset, /google responds with a clear redirect
// instead of crashing, and the client-side "Continue with Google" button always renders.
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

function toUserInfo(user: any) {
  return { id: user.id, name: user.name, email: user.email || '', role: user.role };
}

// Best-effort company lookup for session responses - falls back to null so a missing/deleted
// company row never breaks login/refresh/me (company_id itself is what actually gates access).
async function toCompanyInfo(companyId: number) {
  const company = await db.getCompanyById(companyId);
  if (!company) return null;
  return { id: company.id, name: company.name, logo_url: company.logo_url, plan: company.plan };
}

async function findUserByIdentifier(identifier: { type: 'email' | 'phone'; value: string }) {
  return identifier.type === 'email' ? db.getUserByEmail(identifier.value) : db.getUserByPhone(identifier.value);
}

async function sendOtp(identifier: { type: 'email' | 'phone'; value: string }, otp: string, name: string) {
  if (identifier.type === 'email') {
    await sendOTPEmail(identifier.value, otp, name);
  } else {
    await sendOTPSms(identifier.value, otp);
  }
}

/**
 * Enforces the per-identifier OTP abuse controls before a new code is sent:
 * a resend cooldown (stops rapid-fire re-requests) and an hourly request cap
 * (bounds the total number of fresh 5-attempt budgets an attacker can farm).
 * Returns an error message to send back to the client, or null if the request is allowed.
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

/**
 * Issues a fresh access token + refresh token pair for `user`, persists the refresh
 * token (hashed) as a new session row, and sets both as httpOnly cookies on `res`.
 * The access token is also returned so callers can keep including it in the JSON body
 * for the current frontend, which still reads `data.access_token` (see Step 2 notes).
 */
async function issueSession(req: Request, res: Response, user: any, remember: boolean = true): Promise<string> {
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

// ==================== SIGN UP: START (send OTP) ====================
router.post('/auth/signup/start', otpRequestLimiter, async (req, res) => {
  try {
    const { name, identifier: rawIdentifier, company_name } = req.body;
    if (!name || !rawIdentifier || !company_name) {
      return res.status(400).json({ error: 'Name, email/phone, and company name are required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Enter a valid email address or phone number' });
    }

    const existingUser = await findUserByIdentifier(identifier);
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email/phone already exists' });
    }

    const limitError = await enforceOtpRequestLimits(identifier, 'signup');
    if (limitError) {
      return res.status(429).json({ error: limitError });
    }

    // Always creates a brand-new company - there is no join-an-existing-company-by-name flow
    // (that previously let anyone join or silently create a company just by typing its exact
    // name). Joining an existing teammate's company is deferred to a future invite feature.
    const company = await db.getOrCreateCompany(company_name);
    if (!company) {
      return res.status(500).json({ error: 'Failed to set up company workspace' });
    }

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    await db.createOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: 'signup',
      otpHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    await sendOtp(identifier, otp, name);

    res.status(200).json({
      message: `Verification code sent via ${identifier.type}`,
      identifier: identifier.value,
      identifier_type: identifier.type,
      company_id: company.id,
      name,
    });
  } catch (error) {
    console.error('Signup start error:', error);
    res.status(500).json({ error: 'Failed to start signup' });
  }
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

// ==================== SIGN UP: COMPLETE (retired - see Company Approval Workflow) ====================
// Public self-signup used to create a brand-new company/tenant instantly here with no review,
// which is exactly the gap the Company Approval Workflow closes. This endpoint is disabled
// (rather than deleted) so any stale client/bookmark gets a clear redirect instead of a 404 -
// /auth/signup/start and /auth/verify-otp are untouched since verify-otp is shared with
// password-reset.
router.post('/auth/signup/complete', async (_req, res) => {
  res.status(403).json({ error: 'Public self-signup has been replaced by Company Registration. Submit a request for review.' });
});

// ==================== LOGIN ====================
router.post('/auth/login', async (req, res) => {
  // Batch 13c shadow-read: registered before any early return, fires exactly once after the
  // response has actually been sent (res.on('finish')), regardless of which exit point below was
  // taken - a single, minimal-touch hook rather than restructuring this handler's existing
  // early-return control flow. See src/shadowRead.ts's header comment for the full contract.
  let shadowOutcome: LoginOutcome | null = null;
  res.on('finish', () => {
    const rawIdentifierForShadow = req.body?.identifier || req.body?.email;
    const passwordForShadow = req.body?.password;
    if (shadowOutcome && rawIdentifierForShadow && passwordForShadow) {
      shadowReadLogin(rawIdentifierForShadow, passwordForShadow, shadowOutcome);
    }
  });

  try {
    const { email, identifier: rawIdentifierBody, password, remember } = req.body;
    const rawIdentifier = rawIdentifierBody || email; // supports both the new `identifier` field and legacy `email` field

    if (!rawIdentifier || !password) {
      return res.status(400).json({ error: 'Email/phone and password are required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      shadowOutcome = { success: false, reason: 'invalid_identifier_format' };
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // No account yet - check whether this identifier belongs to a company registration
      // request instead, so a prospective admin gets a meaningful status message rather than
      // a generic "invalid credentials" (which would be indistinguishable from a typo).
      const request = await db.getCompanyRegistrationRequestByIdentifier(identifier);
      if (request?.status === 'pending') {
        shadowOutcome = { success: false, reason: 'registration_pending' };
        return res.status(401).json({ error: 'Your company registration is pending administrator approval.' });
      }
      if (request?.status === 'rejected') {
        shadowOutcome = { success: false, reason: 'registration_rejected' };
        return res.status(401).json({ error: 'Your company registration has been rejected.' });
      }
      shadowOutcome = { success: false, reason: 'unknown_identifier' };
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active || user.deleted_at) {
      shadowOutcome = { success: false, reason: 'account_deactivated' };
      return res.status(401).json({ error: 'This account has been deactivated' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      shadowOutcome = { success: false, reason: 'wrong_password' };
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const access_token = await issueSession(req, res, user, remember !== false);
    db.updateLastLogin(user.id).catch((err) => console.error('Failed to record last login:', err));
    shadowOutcome = { success: true, userId: user.id, role: user.role, companyId: user.company_id };
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
// requires a company_id (NOT NULL, FK to companies), and there is no sensible company to assign
// an unrecognized Google email to - that would mean silently spinning up a new company with no
// name/plan/setup. Recruiters must exist already (created directly, via admin invite, or via
// "Register your company") before Google sign-in will work for them; an unmatched email gets a
// clear, actionable error instead.
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
    res.redirect('/');
  } catch (error) {
    console.error('Staff Google auth error:', error);
    res.redirect('/?auth_error=google_auth_failed');
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

    // Reuse of an already-revoked token is a strong signal of theft (a legitimate client
    // would only ever hold the newest, not-yet-rotated token). Kill every session for the
    // user as a defensive measure rather than just rejecting this one request.
    if (record.revoked_at) {
      await db.revokeAllRefreshTokensForUser(record.user_id);
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

    // Rotate: revoke the presented token, issue a brand new access+refresh pair,
    // carrying forward the original "remember me" choice so it doesn't drift to persistent.
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
// The access token cookie can't be read by frontend JS by design (httpOnly), so this is the
// only correct way for AuthContext to know "am I logged in" and with what role on page load.
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

    res.status(200).json({ message: 'Password updated successfully. Please log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ==================== LOGOUT (this device/session only) ====================
router.post('/auth/logout', async (req, res) => {
  try {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (rawToken) {
      await db.revokeRefreshTokenByHash(hashRefreshToken(rawToken));
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
      }
    }
  } catch (error) {
    console.error('Logout-all error:', error);
  }
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out from all devices' });
});

export default router;
