// One-off production migration: replaces the demo/dev accounts on Tejoma's own tenant with the
// real platform owner account. Reuses the existing company row (no new tenant is ever created);
// creates razi.m@tejoma.com as superadmin; then, only once that succeeds, soft-deletes the two
// demo accounts (admin@tejoma.com / recruiter@tejoma.com) that previously had elevated or
// standing access on this tenant, so neither remains a way into the platform. Soft delete (not
// hard delete) is used so their historical swipes/recruiter_notes/audit-trail references stay
// correctly attributed - only db.softDeleteUser's `deleted_at` is set, no rows are removed.
//
// Usage: NEW_SUPERADMIN_PASSWORD='...' npx tsx scripts/migrate-production-owner.ts

import bcrypt from 'bcrypt';
import { db } from '../src/db.js';
import { validatePassword } from '../src/utils/password.js';

const NEW_OWNER_EMAIL = 'razi.m@tejoma.com';
const NEW_OWNER_NAME = 'Razi M';
const TEJOMA_COMPANY_ID = 1;
const OLD_ACCOUNT_EMAILS = ['admin@tejoma.com', 'recruiter@tejoma.com'];

async function main() {
  const password = process.env.NEW_SUPERADMIN_PASSWORD;
  if (!password) {
    console.error('Set NEW_SUPERADMIN_PASSWORD in the environment before running this script.');
    process.exit(1);
  }

  const strength = validatePassword(password, [NEW_OWNER_NAME, NEW_OWNER_EMAIL]);
  if (!strength.valid) {
    console.error('Password does not meet strength requirements:', strength.errors);
    process.exit(1);
  }

  const existing = await db.getUserByEmail(NEW_OWNER_EMAIL);
  if (existing) {
    console.error(`${NEW_OWNER_EMAIL} already exists (id=${existing.id}, role=${existing.role}). Aborting - nothing changed.`);
    process.exit(1);
  }

  // Reuse the existing Tejoma company row - never create a new one.
  const company = await db.getCompanyById(TEJOMA_COMPANY_ID);
  if (!company) {
    console.error(`Could not find company_id=${TEJOMA_COMPANY_ID} (expected to be Tejoma's own tenant). Aborting.`);
    process.exit(1);
  }
  console.log(`Reusing existing company: id=${company.id}, name="${company.name}", slug=${company.company_slug}`);

  const passwordHash = await bcrypt.hash(password, 10);
  const newOwner = await db.createSuperadminUser({
    companyId: company.id,
    name: NEW_OWNER_NAME,
    email: NEW_OWNER_EMAIL,
    passwordHash,
  });
  if (!newOwner) {
    console.error('Failed to create the new owner account. Aborting before touching old accounts.');
    process.exit(1);
  }
  await db.addPasswordHistory(newOwner.id, passwordHash);
  console.log(`Created new Super Admin: id=${newOwner.id}, email=${newOwner.email}, role=${newOwner.role}, company_id=${newOwner.company_id}`);

  // Only now that the new owner is confirmed to exist, retire the old demo accounts.
  for (const email of OLD_ACCOUNT_EMAILS) {
    const user = await db.getUserByEmail(email);
    if (!user) {
      console.log(`Skipping ${email} - no such user found.`);
      continue;
    }
    const deleted = await db.softDeleteUser(user.id, user.company_id, newOwner.id);
    await db.revokeAllRefreshTokensForUser(user.id);
    console.log(`Soft-deleted ${email} (id=${user.id}, was role=${user.role}): ${deleted ? 'ok' : 'FAILED'}`);
  }

  console.log(`\nDone. ${NEW_OWNER_EMAIL} is now the Super Admin for company_id=${company.id} ("${company.name}").`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
