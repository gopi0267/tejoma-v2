/**
 * Startup environment validation for Matching Scoring Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * JWT_SECRET: this service NOW has a real, gateway-routed, staff-facing HTTP surface (the ML
 * admin remainder - /ml/config, /ml/train, /ml/model/status, /ml/model/versions, ported from
 * src/api/ml.routes.ts) - verifies the exact HS256 staff token the monolith issues today, same
 * pattern/reasoning as matching-evaluation-service's/analytics-service's own
 * middleware/auth.middleware.ts. Its OTHER surface (/internal/*) remains network-boundary-trusted,
 * no auth - unchanged.
 *
 * MONOLITH_INTERNAL_URL: the ML admin routes (/ml/config, /ml/train, /ml/model/status,
 * /ml/model/versions) delegate their actual state mutation/reads to the monolith's own
 * activeModelType/trainModelOnStartup/matching_model_config (src/matching/services.ts) via new
 * src/api/matching-scoring-internal.routes.ts endpoints there - NOT duplicated here. Deliberate:
 * the monolith's own live-scoring engine (src/matching/services.ts's calculateMatchScoresBatch)
 * remains the sole thing that actually reads activeModelType for real production scoring today
 * (this service's own copy takes modelType as an explicit per-request parameter, never a shared
 * mutable value) - moving the WRITE authority here before the scoring engine itself is cut over
 * would silently decouple "admin changes the model" from "what real scoring actually uses". This
 * service becomes the real gateway-facing front door (auth + routing) for these 4 admin actions
 * without changing where the authoritative state lives, exactly the strangler-fig discipline used
 * everywhere else in this migration - move the edge first, migrate authority later.
 *
 * MATCHING_ML_SERVICE_URL: the shared RandomForest/XGBoost/LightGBM ensemble
 * (python-services/matching-ml-service) - called directly by this service's own ported
 * algorithms/ml-models.ts, same client, same "return null, never throw" contract as the monolith's
 * own copy.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4021', 10);
// Identity Service's RS256 public key - staff access tokens are issued by Identity Service and
// verified here. JWT_SECRET below is retained only for any remaining legacy/internal use.
export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY || '';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for matching-scoring-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
