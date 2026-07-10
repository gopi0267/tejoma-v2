import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
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

function toUserInfo(user: any) {
  return { id: user.id, name: user.name, email: user.email || '', role: user.role };
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

// ==================== SIGN UP: COMPLETE (set password, create account, issue session) ====================
router.post('/auth/signup/complete', async (req, res) => {
  try {
    const { name, identifier: rawIdentifier, company_id, password, confirm_password, remember } = req.body;

    if (!name || !rawIdentifier || !company_id || !password || !confirm_password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid email or phone number' });
    }

    const strength = validatePassword(password, [name, identifier.value]);
    if (!strength.valid) {
      return res.status(400).json({ error: strength.errors[0], errors: strength.errors, password_strength: strength.label });
    }

    const otpRecord = await db.getLatestOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: 'signup',
    });
    if (!otpRecord || !otpRecord.verified) {
      return res.status(400).json({ error: 'Please verify your email/phone first' });
    }

    const existingUser = await findUserByIdentifier(identifier);
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email/phone already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await db.createUser({
      name,
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      password_hash: passwordHash,
      company_id: Number(company_id),
      role: 'recruiter',
      is_active: true,
    } as any);

    if (!newUser) {
      return res.status(500).json({ error: 'Failed to create account' });
    }

    await db.addPasswordHistory(newUser.id, passwordHash);

    await db.deleteOtpRecords({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: 'signup',
    });

    const access_token = await issueSession(req, res, newUser, remember !== false);
    res.status(201).json({
      message: 'Account created successfully',
      access_token,
      user_info: toUserInfo(newUser),
      company_id: newUser.company_id,
    });
  } catch (error) {
    console.error('Signup complete error:', error);
    res.status(500).json({ error: 'Account creation failed' });
  }
});

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
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) {
      return res.status(401).json({ error: 'This account has been deactivated' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const access_token = await issueSession(req, res, user, remember !== false);
    res.json({
      access_token,
      user_info: toUserInfo(user),
      company_id: user.company_id,
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
    if (!user || !user.is_active) {
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
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Session invalid' });
    }
    res.json({ user_info: toUserInfo(user), company_id: user.company_id });
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
