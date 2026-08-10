// Ported verbatim from the monolith's src/middleware/rateLimit.middleware.ts - only
// resumeParseLimiter, the one limiter this service's routes actually use (globalLimiter/
// authLimiter/otpRequestLimiter belong to routes that stay on the monolith/Identity Service).
import rateLimit from 'express-rate-limit';

// Candidate-facing resume parsing calls the same paid Gemini pipeline as the recruiter path,
// but candidate accounts are self-registered (lower trust bar than a company-approved
// recruiter account), so this caps it separately rather than relying on a global limiter alone.
export const resumeParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resume uploads from this network, please try again later.' },
});
