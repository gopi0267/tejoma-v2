/**
 * Refresh-token rotation decision logic - pure, no database access, so the security-critical
 * reuse-detection rule can be fully unit tested in isolation. The database-wired route handler
 * that looks up a stored token and calls this function is added in a later batch, once the
 * Identity DB schema exists.
 *
 * Implements the exact rule confirmed across every prior architecture phase (originally Phase
 * 2(original) section 9): refresh tokens rotate on every use, and presenting a token that has
 * already been rotated once (i.e. already revoked) is treated as evidence of token theft -
 * every session for that identity is revoked, not just the one being used. This is a real,
 * already-implemented behavior in the monolith; this module is the DB-free extraction of its
 * decision logic, not a new design.
 */

export interface StoredRefreshTokenRecord {
  hash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type RefreshValidationResult =
  | { outcome: 'valid' }
  | { outcome: 'expired' }
  /** The presented token was already rotated/revoked - the caller must revoke every refresh
   *  token for this identity, not just this one, per the theft-detection rule above. */
  | { outcome: 'reused' }
  | { outcome: 'not_found' };

export function evaluateRefreshToken(
  presentedHash: string,
  stored: StoredRefreshTokenRecord | null,
  now: Date = new Date()
): RefreshValidationResult {
  if (!stored) return { outcome: 'not_found' };
  if (stored.hash !== presentedHash) return { outcome: 'not_found' };
  if (stored.revokedAt) return { outcome: 'reused' };
  if (stored.expiresAt.getTime() < now.getTime()) return { outcome: 'expired' };
  return { outcome: 'valid' };
}
