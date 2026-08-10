import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { jwtKeyPair, publicKeyToJwk } from '../src/config/keys.js';

describe('jwtKeyPair', () => {
  it('loads a usable RSA private/public key pair (ephemeral, since no env vars are set in this test run)', () => {
    expect(jwtKeyPair.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(jwtKeyPair.publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('derives a stable, deterministic kid from the public key', () => {
    const kidAgain = crypto.createHash('sha256').update(jwtKeyPair.publicKey).digest('hex').slice(0, 16);
    expect(jwtKeyPair.kid).toBe(kidAgain);
    expect(jwtKeyPair.kid).toHaveLength(16);
  });

  it('the private key can actually sign and the public key can actually verify (real RSA operations, not mocked)', () => {
    const signature = crypto.sign('sha256', Buffer.from('test-payload'), jwtKeyPair.privateKey);
    const valid = crypto.verify('sha256', Buffer.from('test-payload'), jwtKeyPair.publicKey, signature);
    expect(valid).toBe(true);
  });
});

describe('publicKeyToJwk', () => {
  it('produces a valid RSA JWK with the expected fields', () => {
    const jwk = publicKeyToJwk(jwtKeyPair.publicKey, jwtKeyPair.kid);
    expect(jwk.kty).toBe('RSA');
    expect(jwk.alg).toBe('RS256');
    expect(jwk.use).toBe('sig');
    expect(jwk.kid).toBe(jwtKeyPair.kid);
    expect(jwk.n).toBeTruthy(); // RSA modulus
    expect(jwk.e).toBeTruthy(); // RSA exponent
  });
});
