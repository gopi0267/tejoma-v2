import { describe, it, expect } from 'vitest';
import { evaluateRefreshToken, type StoredRefreshTokenRecord } from '../src/services/refreshTokenRotation.js';

const now = new Date('2026-01-15T12:00:00Z');

function record(overrides: Partial<StoredRefreshTokenRecord> = {}): StoredRefreshTokenRecord {
  return {
    hash: 'abc123',
    expiresAt: new Date('2026-02-14T12:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('evaluateRefreshToken', () => {
  it('returns not_found when no stored record exists', () => {
    expect(evaluateRefreshToken('abc123', null, now)).toEqual({ outcome: 'not_found' });
  });

  it('returns not_found when the presented hash does not match the stored hash', () => {
    expect(evaluateRefreshToken('wrong-hash', record(), now)).toEqual({ outcome: 'not_found' });
  });

  it('returns valid for a matching, unexpired, unrevoked token', () => {
    expect(evaluateRefreshToken('abc123', record(), now)).toEqual({ outcome: 'valid' });
  });

  it('returns expired for a matching token past its expiry, even if never revoked', () => {
    const expired = record({ expiresAt: new Date('2026-01-01T00:00:00Z') });
    expect(evaluateRefreshToken('abc123', expired, now)).toEqual({ outcome: 'expired' });
  });

  it('returns reused for an already-revoked token, even if not yet expired - the theft-detection signal', () => {
    const revoked = record({ revokedAt: new Date('2026-01-10T00:00:00Z') });
    expect(evaluateRefreshToken('abc123', revoked, now)).toEqual({ outcome: 'reused' });
  });

  it('reused takes priority over expired when a token is both revoked and expired', () => {
    const both = record({
      revokedAt: new Date('2026-01-10T00:00:00Z'),
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(evaluateRefreshToken('abc123', both, now)).toEqual({ outcome: 'reused' });
  });
});
