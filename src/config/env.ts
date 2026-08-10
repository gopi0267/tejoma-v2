/**
 * Startup environment validation. Imported first (before anything else) by server.ts so
 * misconfiguration is caught before the app ever accepts a request, not discovered later
 * as a runtime 500 - this is exactly the class of bug we found earlier with the leaked
 * placeholder Gemini key sitting in .env.example.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

const DEV_ONLY_JWT_SECRET = 'dev-only-insecure-secret';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];
const REQUIRED_IN_PRODUCTION = ['FRONTEND_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION) {
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!process.env[key]) fatal.push(key);
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_ONLY_JWT_SECRET) {
    fatal.push('JWT_SECRET (missing, or still set to the insecure development default)');
  }
}

if (fatal.length > 0) {
  console.error('\nFATAL: invalid environment configuration. Refusing to start.\n' + fatal.map((k) => `  - ${k}`).join('\n') + '\n');
  process.exit(1);
}

// Soft warnings only - the app has documented, working fallbacks for these (console-logged
// OTP for phone, console-logged OTP for email if Gmail send fails), so they don't block boot.
const warnings: string[] = [];
if (!process.env.GMAIL_USER || process.env.GMAIL_USER === 'your-email@gmail.com' || !process.env.GMAIL_APP_PASSWORD) {
  warnings.push('GMAIL_USER/GMAIL_APP_PASSWORD not fully configured - email OTP will fall back to console logging');
}
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
  warnings.push('Twilio not configured - phone OTP will fall back to console logging');
}
if (!IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_ONLY_JWT_SECRET)) {
  warnings.push('JWT_SECRET is using the insecure development default - fine for local dev, must be set before production');
}

if (warnings.length > 0) {
  console.warn('\n⚠ Configuration warnings:\n' + warnings.map((w) => `  - ${w}`).join('\n') + '\n');
}

// ============================================================
// Phase 1 Microservices - Feature Flags
// Default: false (routes stay on monolith) for safe gradual rollout
// ============================================================

export const UPLOAD_SERVICE_ENABLED = process.env.UPLOAD_SERVICE_ENABLED === 'true';
export const RESUME_SERVICE_ENABLED = process.env.RESUME_SERVICE_ENABLED === 'true';
export const NOTIFICATIONS_SERVICE_ENABLED = process.env.NOTIFICATIONS_SERVICE_ENABLED === 'true';
export const DUAL_WRITE_ENABLED = process.env.DUAL_WRITE_ENABLED === 'true';

// ============================================================
// Microservice URLs
// ============================================================

export const UPLOAD_SERVICE_URL = process.env.UPLOAD_SERVICE_URL || 'http://localhost:4030';
export const RESUME_SERVICE_URL = process.env.RESUME_SERVICE_URL || 'http://localhost:4031';
export const NOTIFICATIONS_SERVICE_URL = process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:4032';
export const MATCHING_EVALUATION_SERVICE_URL = process.env.MATCHING_EVALUATION_SERVICE_URL || 'http://localhost:4023';
export const MATCHING_REASONING_SERVICE_URL = process.env.MATCHING_REASONING_SERVICE_URL || 'http://localhost:4024';

// ============================================================
// Phase D Cutover Flags - Full Monolith-to-Microservices Migration
// ============================================================

export const REASONING_CONCLUSIONS_CUTOVER_ENABLED = process.env.REASONING_CONCLUSIONS_CUTOVER_ENABLED === 'true';
export const CAREER_TRAJECTORIES_CUTOVER_ENABLED = process.env.CAREER_TRAJECTORIES_CUTOVER_ENABLED === 'true';
export const RAG_INDEXING_CUTOVER_ENABLED = process.env.RAG_INDEXING_CUTOVER_ENABLED === 'true';
