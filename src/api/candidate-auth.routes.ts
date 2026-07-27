import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db.js';
import { generateOTP, hashOTP, compareOTP, normalizeIdentifier } from '../utils/otp.js';
import { sendOTPEmail } from '../utils/email.js';
import { sendOTPSms } from '../utils/sms.js';
import {
  signCandidateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  candidateAccessTokenCookieOptions,
  candidateRefreshTokenCookieOptions,
  clearCandidateAuthCookies,
  CANDIDATE_ACCESS_TOKEN_COOKIE,
  CANDIDATE_REFRESH_TOKEN_COOKIE,
} from '../utils/tokens.js';
import { otpRequestLimiter } from '../middleware/rateLimit.middleware.js';
import { validatePassword } from '../utils/password.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Modeled directly on auth.routes.ts's equivalent constants/helpers - kept as separate copies
// (rather than importing from auth.routes.ts) so the candidate auth surface has zero coupling
// to the staff auth route module.
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
const OTP_PURPOSE = 'candidate_signup' as const;
const FORGOT_PASSWORD_OTP_PURPOSE = 'candidate_reset' as const; // otp_verification.purpose is VARCHAR(20)

// Google OAuth is optional - if unset, /google responds with a clear redirect instead of
// crashing, and the client-side "Continue with Google" button always renders. No client-supplied
// identity is ever trusted; the email always comes from Google's verified ID token.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const googleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
const googleClient = googleOAuthConfigured
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  : null;
if (!googleOAuthConfigured) {
  console.warn('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI not set - candidate Google sign-in is disabled (button will show a friendly error).');
}

function toCandidateInfo(candidate: any) {
  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email || '',
    phone: candidate.phone || '',
    headline: candidate.headline,
    skills: candidate.skills || [],
    years_of_experience: candidate.years_of_experience,
    location: candidate.location,
    education: candidate.education,
    summary: candidate.summary,
    onboarding_completed_at: candidate.onboarding_completed_at || null,
  };
}

async function findCandidateByIdentifier(identifier: { type: 'email' | 'phone'; value: string }) {
  return identifier.type === 'email' ? db.getCandidateAccountByEmail(identifier.value) : db.getCandidateAccountByPhone(identifier.value);
}

async function sendOtp(identifier: { type: 'email' | 'phone'; value: string }, otp: string, name: string) {
  if (identifier.type === 'email') {
    await sendOTPEmail(identifier.value, otp, name);
  } else {
    await sendOTPSms(identifier.value, otp);
  }
}

async function enforceOtpRequestLimits(identifier: { type: 'email' | 'phone'; value: string }, purpose: typeof OTP_PURPOSE | typeof FORGOT_PASSWORD_OTP_PURPOSE = OTP_PURPOSE): Promise<string | null> {
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

/** Issues a candidate access+refresh token pair, persists the refresh token, and sets cookies. Mirrors issueSession in auth.routes.ts. */
async function issueCandidateSession(req: Request, res: Response, candidate: any, remember: boolean = true): Promise<string> {
  const accessToken = signCandidateAccessToken({
    candidate_id: candidate.id,
    email: candidate.email,
    phone: candidate.phone,
    name: candidate.name,
  });

  const { token: refreshToken, hash, expiresAt } = generateRefreshToken();
  await db.createCandidateRefreshToken({
    candidateId: candidate.id,
    tokenHash: hash,
    userAgent: (req.headers['user-agent'] as string) || null,
    ip: req.ip || null,
    expiresAt,
    remember,
  });

  res.cookie(CANDIDATE_ACCESS_TOKEN_COOKIE, accessToken, candidateAccessTokenCookieOptions());
  res.cookie(CANDIDATE_REFRESH_TOKEN_COOKIE, refreshToken, candidateRefreshTokenCookieOptions(remember));

  return accessToken;
}

// ==================== REGISTER: START (send OTP) ====================
router.post('/candidate-auth/register/start', otpRequestLimiter, async (req, res) => {
  try {
    const { name, identifier: rawIdentifier } = req.body;
    if (!name || !rawIdentifier) {
      return res.status(400).json({ error: 'Name and email/phone are required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Enter a valid email address or phone number' });
    }

    const existing = await findCandidateByIdentifier(identifier);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email/phone already exists' });
    }

    const limitError = await enforceOtpRequestLimits(identifier);
    if (limitError) {
      return res.status(429).json({ error: limitError });
    }

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    await db.createOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: OTP_PURPOSE,
      otpHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    await sendOtp(identifier, otp, name);

    res.status(200).json({
      message: `Verification code sent via ${identifier.type}`,
      identifier: identifier.value,
      identifier_type: identifier.type,
      name,
    });
  } catch (error) {
    console.error('Candidate register start error:', error);
    res.status(500).json({ error: 'Failed to start registration' });
  }
});

// ==================== REGISTER: VERIFY OTP ====================
router.post('/candidate-auth/register/verify-otp', async (req, res) => {
  try {
    const { identifier: rawIdentifier, otp } = req.body;
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
      purpose: OTP_PURPOSE,
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
    console.error('Candidate OTP verification error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// ==================== REGISTER: COMPLETE (after OTP verified, sets password, creates account) ====================
router.post('/candidate-auth/register/complete', async (req, res) => {
  try {
    const { name, identifier: rawIdentifier, password, confirm_password } = req.body;
    if (!name || !rawIdentifier || !password || !confirm_password) {
      return res.status(400).json({ error: 'Name, identifier, and both password fields are required' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid email or phone number' });
    }

    const otpRecord = await db.getLatestOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: OTP_PURPOSE,
    });
    if (!otpRecord || !otpRecord.verified) {
      return res.status(400).json({ error: 'Please verify your code first' });
    }

    const existing = await findCandidateByIdentifier(identifier);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email/phone already exists' });
    }

    const strength = validatePassword(password, [name, identifier.value]);
    if (!strength.valid) {
      return res.status(400).json({ error: strength.errors[0], errors: strength.errors, password_strength: strength.label });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const candidate = await db.createCandidateAccount({
      name,
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      password_hash: passwordHash,
    });
    if (!candidate) {
      return res.status(500).json({ error: 'Failed to create account' });
    }

    await db.deleteOtpRecords({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: OTP_PURPOSE,
    });

    const access_token = await issueCandidateSession(req, res, candidate, true);
    res.status(201).json({ access_token, candidate: toCandidateInfo(candidate) });
  } catch (error) {
    console.error('Candidate register complete error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ==================== LOGIN ====================
router.post('/candidate-auth/login', async (req, res) => {
  try {
    const { identifier: rawIdentifier, password, remember } = req.body;
    if (!rawIdentifier || !password) {
      return res.status(400).json({ error: 'Email/phone and password are required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const candidate = await findCandidateByIdentifier(identifier);
    if (!candidate) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!candidate.is_active || candidate.deleted_at) {
      return res.status(401).json({ error: 'This account has been deactivated' });
    }

    const passwordMatch = await bcrypt.compare(password, candidate.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const access_token = await issueCandidateSession(req, res, candidate, remember !== false);
    res.json({ access_token, candidate: toCandidateInfo(candidate) });
  } catch (error) {
    console.error('Candidate login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==================== REFRESH ====================
router.post('/candidate-auth/refresh', async (req, res) => {
  try {
    const rawToken = req.cookies?.[CANDIDATE_REFRESH_TOKEN_COOKIE];
    if (!rawToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const tokenHash = hashRefreshToken(rawToken);
    const record = await db.findCandidateRefreshTokenByHash(tokenHash);

    if (!record) {
      clearCandidateAuthCookies(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    if (record.revoked_at) {
      await db.revokeAllCandidateRefreshTokensForCandidate(record.candidate_id);
      clearCandidateAuthCookies(res);
      return res.status(401).json({ error: 'Session invalid. Please log in again.' });
    }

    if (new Date(record.expires_at) < new Date()) {
      clearCandidateAuthCookies(res);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const candidate = await db.getCandidateAccountById(record.candidate_id);
    if (!candidate || !candidate.is_active || candidate.deleted_at) {
      await db.revokeCandidateRefreshTokenByHash(tokenHash);
      clearCandidateAuthCookies(res);
      return res.status(401).json({ error: 'Account unavailable' });
    }

    await db.revokeCandidateRefreshTokenByHash(tokenHash);
    const access_token = await issueCandidateSession(req, res, candidate, record.remember !== false);

    res.json({ access_token, candidate: toCandidateInfo(candidate) });
  } catch (error) {
    console.error('Candidate refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

// ==================== ME ====================
router.get('/candidate-auth/me', requireCandidateAuth, async (req, res) => {
  try {
    const candidate = await db.getCandidateAccountById(req.candidate!.candidate_id);
    if (!candidate || !candidate.is_active || candidate.deleted_at) {
      return res.status(401).json({ error: 'Session invalid' });
    }
    res.json({ candidate: toCandidateInfo(candidate) });
  } catch (error) {
    console.error('Candidate me error:', error);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

// ==================== LOGOUT (this device/session only) ====================
router.post('/candidate-auth/logout', async (req, res) => {
  try {
    const rawToken = req.cookies?.[CANDIDATE_REFRESH_TOKEN_COOKIE];
    if (rawToken) {
      await db.revokeCandidateRefreshTokenByHash(hashRefreshToken(rawToken));
    }
  } catch (error) {
    console.error('Candidate logout error:', error);
  }
  clearCandidateAuthCookies(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ==================== LOGOUT FROM ALL DEVICES ====================
router.post('/candidate-auth/logout-all', async (req, res) => {
  try {
    const rawToken = req.cookies?.[CANDIDATE_REFRESH_TOKEN_COOKIE];
    if (rawToken) {
      const record = await db.findCandidateRefreshTokenByHash(hashRefreshToken(rawToken));
      if (record) {
        await db.revokeAllCandidateRefreshTokensForCandidate(record.candidate_id);
      }
    }
  } catch (error) {
    console.error('Candidate logout-all error:', error);
  }
  clearCandidateAuthCookies(res);
  res.json({ success: true, message: 'Logged out from all devices' });
});

// ==================== FORGOT PASSWORD: START (send OTP) ====================
router.post('/candidate-auth/forgot-password/start', otpRequestLimiter, async (req, res) => {
  try {
    const { identifier: rawIdentifier } = req.body;
    if (!rawIdentifier) {
      return res.status(400).json({ error: 'Email or phone number is required' });
    }

    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return res.status(400).json({ error: 'Enter a valid email address or phone number' });
    }

    const candidate = await findCandidateByIdentifier(identifier);
    if (!candidate) {
      // Don't reveal whether the account exists.
      return res.status(200).json({ message: 'If an account exists, a verification code has been sent', identifier: identifier.value, identifier_type: identifier.type });
    }

    const limitError = await enforceOtpRequestLimits(identifier, FORGOT_PASSWORD_OTP_PURPOSE);
    if (limitError) {
      return res.status(429).json({ error: limitError });
    }

    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    await db.createOtpRecord({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: FORGOT_PASSWORD_OTP_PURPOSE,
      otpHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    await sendOtp(identifier, otp, candidate.name);

    res.status(200).json({
      message: `Verification code sent via ${identifier.type}`,
      identifier: identifier.value,
      identifier_type: identifier.type,
    });
  } catch (error) {
    console.error('Candidate forgot password start error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ==================== FORGOT PASSWORD: VERIFY OTP ====================
router.post('/candidate-auth/forgot-password/verify-otp', async (req, res) => {
  try {
    const { identifier: rawIdentifier, otp } = req.body;
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
      purpose: FORGOT_PASSWORD_OTP_PURPOSE,
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
    console.error('Candidate forgot password OTP verification error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// ==================== FORGOT PASSWORD: RESET (after OTP verified) ====================
router.post('/candidate-auth/forgot-password/reset', async (req, res) => {
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
      purpose: FORGOT_PASSWORD_OTP_PURPOSE,
    });
    if (!otpRecord || !otpRecord.verified) {
      return res.status(400).json({ error: 'Please verify your code first' });
    }

    const candidate = await findCandidateByIdentifier(identifier);
    if (!candidate) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const strength = validatePassword(new_password, [candidate.name, identifier.value]);
    if (!strength.valid) {
      return res.status(400).json({ error: strength.errors[0], errors: strength.errors, password_strength: strength.label });
    }

    // candidate_accounts has no password-history table of its own (password_history is FK'd to
    // users only) - the reuse check here is against the current hash, the strongest check
    // available without introducing a parallel history table for a single-account-type check.
    const reusesCurrentPassword = await bcrypt.compare(new_password, candidate.password_hash);
    if (reusesCurrentPassword) {
      return res.status(400).json({ error: 'You cannot reuse your current password. Please choose a different one.' });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    await db.updateCandidateAccountPasswordHash(candidate.id, passwordHash);

    await db.deleteOtpRecords({
      email: identifier.type === 'email' ? identifier.value : null,
      phone: identifier.type === 'phone' ? identifier.value : null,
      purpose: FORGOT_PASSWORD_OTP_PURPOSE,
    });

    // A password reset invalidates any existing sessions - force re-login everywhere.
    await db.revokeAllCandidateRefreshTokensForCandidate(candidate.id);

    res.status(200).json({ message: 'Password updated successfully. Please log in with your new password.' });
  } catch (error) {
    console.error('Candidate reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ==================== GOOGLE OAUTH: START ====================
router.get('/candidate-auth/google', (req, res) => {
  if (!googleClient) {
    return res.redirect('/candidate?auth_error=google_not_configured');
  }
  const url = googleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
  res.redirect(url);
});

// ==================== GOOGLE OAUTH: CALLBACK ====================
router.get('/candidate-auth/google/callback', async (req, res) => {
  if (!googleClient) {
    return res.redirect('/candidate?auth_error=google_not_configured');
  }
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      return res.redirect('/candidate?auth_error=google_auth_failed');
    }

    const { tokens } = await googleClient.getToken(code);
    if (!tokens.id_token) {
      return res.redirect('/candidate?auth_error=google_auth_failed');
    }

    // Identity comes only from Google's verified ID token - never from request body/query.
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.redirect('/candidate?auth_error=google_auth_failed');
    }

    const email = payload.email.toLowerCase();
    let candidate = await db.getCandidateAccountByEmail(email);
    if (!candidate) {
      // candidate_accounts.email is UNIQUE, so find-by-email above is the entire "safe linking"
      // mechanism - an existing account is always reused, never duplicated. password_hash stays
      // NOT NULL and gets a random hash that can never be produced by any real login attempt.
      const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      candidate = await db.createCandidateAccount({
        name: payload.name || email.split('@')[0],
        email,
        phone: null,
        password_hash: randomPasswordHash,
      });
      if (!candidate) {
        return res.redirect('/candidate?auth_error=google_auth_failed');
      }
    }

    if (!candidate.is_active || candidate.deleted_at) {
      return res.redirect('/candidate?auth_error=account_deactivated');
    }

    await issueCandidateSession(req, res, candidate, true);
    res.redirect('/candidate');
  } catch (error) {
    console.error('Candidate Google auth error:', error);
    res.redirect('/candidate?auth_error=google_auth_failed');
  }
});

// ==================== COMPLETE ONBOARDING (first-login wizard) ====================
router.put('/candidate-auth/complete-onboarding', requireCandidateAuth, async (req, res) => {
  try {
    const ok = await db.markCandidateOnboardingComplete(req.candidate!.candidate_id);
    if (!ok) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const candidate = await db.getCandidateAccountById(req.candidate!.candidate_id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    res.json({ candidate: toCandidateInfo(candidate) });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

export default router;
