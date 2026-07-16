// One-off operator action: promotes an existing user to the platform-wide 'superadmin' role,
// which grants access to the Tenant Requests page (approve/reject company registrations) on
// top of whatever role-cascaded permissions they already had (see ROLE_HIERARCHY in
// src/middleware/auth.middleware.ts - superadmin still passes every admin-gated check too).
// Deliberately a script, not a migration, so promoting someone is an explicit, auditable action
// rather than a silent side-effect of running migrations.
//
// Usage: npx tsx scripts/promote-superadmin.ts admin@tejoma.com

import { db } from '../src/db.js';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/promote-superadmin.ts <email>');
    process.exit(1);
  }

  const user = await db.promoteUserToSuperadmin(email);
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  console.log('Promoted to superadmin:', user);
  process.exit(0);
}

main().catch((err) => {
  console.error('Promotion failed:', err);
  process.exit(1);
});
