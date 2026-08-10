/**
 * Migration runner for Matching BGE Shadow Service's database. Mirrors every other Tier 0
 * service's scripts/migrate.ts exactly.
 *
 * Usage:
 *   tsx scripts/migrate.ts up              - applies every migration not yet recorded as applied
 *   tsx scripts/migrate.ts down --confirm  - rolls back the single most recently applied migration
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`FATAL: ${key} is not set. Refusing to run migrations without an explicit target database.`);
    process.exit(1);
  }
  return value;
}

const pool = new Pool({
  host: requireEnv('DB_HOST'),
  port: parseInt(requireEnv('DB_PORT'), 10),
  database: requireEnv('DB_NAME'),
  user: requireEnv('DB_USER'),
  password: String(process.env.DB_PASSWORD || ''),
});

interface MigrationFile {
  version: string;
  upPath: string;
  downPath: string;
}

function discoverMigrations(): MigrationFile[] {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.up.sql'));
  return files
    .map((f) => {
      const version = f.replace('.up.sql', '');
      return {
        version,
        upPath: path.join(MIGRATIONS_DIR, `${version}.up.sql`),
        downPath: path.join(MIGRATIONS_DIR, `${version}.down.sql`),
      };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function ensureMigrationsTableExists(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(20) PRIMARY KEY,
      applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedVersions(): Promise<Set<string>> {
  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map((r) => r.version));
}

async function up(): Promise<void> {
  await ensureMigrationsTableExists();
  const applied = await getAppliedVersions();
  const migrations = discoverMigrations();
  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    console.log('✓ No pending migrations. Database is up to date.');
    return;
  }

  for (const migration of pending) {
    console.log(`→ Applying ${migration.version}...`);
    const sql = fs.readFileSync(migration.upPath, 'utf-8');
    await pool.query(sql);
    console.log(`✓ Applied ${migration.version}`);
  }
}

async function down(confirmed: boolean): Promise<void> {
  if (!confirmed) {
    console.error(
      'Refusing to run a rollback migration without --confirm. This is a destructive operation ' +
        'that may delete real data once this database holds real shadow-comparison records - see ' +
        'migrations/001_initial_schema.down.sql for exactly what it removes.'
    );
    process.exit(1);
  }

  await ensureMigrationsTableExists();
  const applied = await getAppliedVersions();
  const migrations = discoverMigrations();
  const appliedMigrations = migrations.filter((m) => applied.has(m.version)).sort((a, b) => b.version.localeCompare(a.version));

  if (appliedMigrations.length === 0) {
    console.log('✓ No applied migrations to roll back.');
    return;
  }

  const target = appliedMigrations[0];
  console.log(`→ Rolling back ${target.version}...`);
  const sql = fs.readFileSync(target.downPath, 'utf-8');
  await pool.query(sql);
  console.log(`✓ Rolled back ${target.version}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const confirmed = process.argv.includes('--confirm');

  try {
    if (command === 'up') {
      await up();
    } else if (command === 'down') {
      await down(confirmed);
    } else {
      console.error('Usage: tsx scripts/migrate.ts <up|down> [--confirm]');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('✗ Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
