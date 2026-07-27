// Deletes expired/long-revoked refresh_tokens, candidate_refresh_tokens, and otp_verification
// rows - see db.ts's cleanupExpiredSessions() for exactly which rows qualify and why (a 30-day
// retention on revoked/expired tokens, 24 hours on expired OTPs). Safe to run repeatedly; touches
// only rows that are already functionally dead, never an active session or a still-valid OTP.
//
// This project has no in-process scheduler - matching that, this is meant to be run on a
// recurring external schedule (cron/Task Scheduler/CI scheduled job), not wired into server.ts.
// Recommended cadence: daily.
//
// Usage: npx tsx scripts/cleanup-expired-sessions.ts

import { db } from '../src/db.js';

async function main() {
  console.log('Cleaning up expired/revoked sessions and OTP records...');
  const result = await db.cleanupExpiredSessions();
  console.log('refresh_tokens deleted:', result.refreshTokensDeleted);
  console.log('candidate_refresh_tokens deleted:', result.candidateRefreshTokensDeleted);
  console.log('otp_verification deleted:', result.otpRecordsDeleted);
  process.exit(0);
}

main().catch((err) => {
  console.error('Session cleanup failed:', err);
  process.exit(1);
});
