// Ported from the monolith's src/middleware/rateLimit.middleware.ts - otpRequestLimiter only
// (the IP-based layer stacked on top of the per-identifier cooldown/hourly-cap check already in
// routes/auth.routes.ts's enforceOtpRequestLimits). authLimiter/globalLimiter are Gateway-layer
// concerns per the already-approved target architecture (Phase 5(technical) section 2) - not
// duplicated at the service layer here.
import rateLimit from 'express-rate-limit';

// Extra layer specifically on the two endpoints that trigger an OTP send (signup/start,
// forgot-password/start), stacked on top of the Gateway's future authLimiter. IP-based; the
// per-identifier hourly cap + resend cooldown is the complementary check that stops abuse of a
// single email/phone regardless of which IP it comes from.
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification code requests from this network, please try again later.' },
});
