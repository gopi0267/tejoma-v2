import rateLimit from 'express-rate-limit';

// Generous - just a backstop against abuse, not meant to throttle normal swipe/browse usage.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Tight limiter for login/signup/OTP endpoints specifically, to blunt brute-force and OTP spam.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Extra layer specifically on the two endpoints that trigger an OTP send (signup/start,
// forgot-password/start), stacked on top of authLimiter above. This is IP-based; the
// per-identifier hourly cap + resend cooldown (auth.routes.ts) is the complementary check
// that stops abuse of a single email/phone regardless of which IP it comes from.
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification code requests from this network, please try again later.' },
});

// Candidate-facing resume parsing calls the same paid Gemini pipeline as the recruiter path,
// but candidate accounts are self-registered (lower trust bar than a company-approved
// recruiter account), so this caps it separately rather than relying on globalLimiter alone.
export const resumeParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resume uploads from this network, please try again later.' },
});
