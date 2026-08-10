/**
 * Global and auth rate limiting - the Gateway-layer concern every service built before this one
 * explicitly deferred rather than duplicated. See identity-service/src/middleware/
 * rateLimit.middleware.ts's own comment: "authLimiter/globalLimiter are Gateway-layer concerns
 * per the already-approved target architecture (Phase 5(technical) section 2) - not duplicated
 * at the service layer here." This is that completion, not a new decision.
 *
 * Two limiters, layered with what already exists downstream, not replacing it:
 *   - globalLimiter: a broad safety net across all traffic through the Gateway.
 *   - authLimiter: a stricter, IP-based limit across the full set of auth-sensitive endpoints
 *     (login, OTP send, registration, password reset - both staff and candidate). This is
 *     deliberately broader than identity-service's own otpRequestLimiter (10/15min, and only on
 *     the two OTP-sending endpoints) - that one is a per-identifier+IP guard against OTP-budget
 *     farming; this one is a per-IP guard across every credential-testing surface, including
 *     login itself, which otpRequestLimiter never covered at all.
 */
import rateLimit from 'express-rate-limit';

// Overridable via env (not just for tests - a real operator may need to tune these without a
// code change/redeploy). Defaults match the values described in this file's header comment.
const GLOBAL_WINDOW_MS = parseInt(process.env.GATEWAY_GLOBAL_RATE_WINDOW_MS || String(15 * 60 * 1000), 10);
const GLOBAL_MAX = parseInt(process.env.GATEWAY_GLOBAL_RATE_MAX || '300', 10);
const AUTH_WINDOW_MS = parseInt(process.env.GATEWAY_AUTH_RATE_WINDOW_MS || String(15 * 60 * 1000), 10);
const AUTH_MAX = parseInt(process.env.GATEWAY_AUTH_RATE_MAX || '30', 10);

export const globalLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  max: GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this network. Please try again later.' },
});

export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication requests from this network. Please try again later.' },
});
