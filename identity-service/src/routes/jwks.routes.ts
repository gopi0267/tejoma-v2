/**
 * Publishes Identity Service's RS256 public key as a JWKS (JSON Web Key Set) document at the
 * standard /.well-known/jwks.json path, per Phase 2(technical) section 3: every other service
 * fetches and caches this once, verifying tokens locally without a per-request call back to
 * Identity Service.
 */
import { Router } from 'express';
import { jwtKeyPair, publicKeyToJwk } from '../config/keys.js';

const router = Router();

router.get('/.well-known/jwks.json', (_req, res) => {
  const jwk = publicKeyToJwk(jwtKeyPair.publicKey, jwtKeyPair.kid);
  // Cache-Control signals consumers it's safe to cache this response - the whole point of JWKS
  // is that verification never needs a live call back to this service.
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ keys: [jwk] });
});

export default router;
