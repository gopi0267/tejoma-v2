/**
 * Schema validation / data-verification script. Confirms the connected database's actual schema
 * (via information_schema introspection - the same discipline used to build schema.sql in the
 * first place) matches exactly what every applied migration in migrations/ declares - catching
 * drift if anyone manually alters the database outside the migration runner (the same "drift
 * detection" principle Phase 5(technical) section 7 specifies for Terraform, applied here to
 * schema).
 *
 * Usage: tsx scripts/validate-schema.ts
 * Exits non-zero with a clear diff if anything doesn't match.
 */
import pkg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

interface ExpectedColumn {
  name: string;
  dataType: string; // as reported by information_schema.columns.data_type
  nullable: boolean;
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

// Mirrors migrations/001_initial_schema.up.sql and 002_audit_log.up.sql exactly, column for column.
const EXPECTED_TABLES: ExpectedTable[] = [
  {
    name: 'users',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'email', dataType: 'character varying', nullable: true },
      { name: 'password_hash', dataType: 'character varying', nullable: false },
      { name: 'company_id', dataType: 'integer', nullable: false },
      { name: 'role', dataType: 'USER-DEFINED', nullable: true },
      { name: 'is_active', dataType: 'boolean', nullable: true },
      { name: 'name', dataType: 'character varying', nullable: false },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'phone', dataType: 'character varying', nullable: true },
      { name: 'deleted_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'created_by', dataType: 'integer', nullable: true },
      { name: 'updated_by', dataType: 'integer', nullable: true },
      { name: 'disabled_by', dataType: 'integer', nullable: true },
      { name: 'password_reset_by', dataType: 'integer', nullable: true },
      { name: 'last_login_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
  {
    name: 'refresh_tokens',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'user_id', dataType: 'integer', nullable: false },
      { name: 'token_hash', dataType: 'character varying', nullable: false },
      { name: 'user_agent', dataType: 'text', nullable: true },
      { name: 'ip_address', dataType: 'character varying', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'expires_at', dataType: 'timestamp without time zone', nullable: false },
      { name: 'revoked_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'remember', dataType: 'boolean', nullable: true },
    ],
  },
  {
    name: 'password_history',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'user_id', dataType: 'integer', nullable: false },
      { name: 'password_hash', dataType: 'character varying', nullable: false },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
  {
    name: 'candidate_accounts',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'name', dataType: 'character varying', nullable: false },
      { name: 'email', dataType: 'character varying', nullable: true },
      { name: 'phone', dataType: 'character varying', nullable: true },
      { name: 'password_hash', dataType: 'character varying', nullable: false },
      { name: 'is_active', dataType: 'boolean', nullable: true },
      { name: 'deleted_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
  {
    name: 'candidate_refresh_tokens',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'candidate_id', dataType: 'integer', nullable: false },
      { name: 'token_hash', dataType: 'character varying', nullable: false },
      { name: 'user_agent', dataType: 'text', nullable: true },
      { name: 'ip_address', dataType: 'character varying', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'expires_at', dataType: 'timestamp without time zone', nullable: false },
      { name: 'revoked_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'remember', dataType: 'boolean', nullable: true },
    ],
  },
  {
    name: 'otp_verification',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'email', dataType: 'character varying', nullable: true },
      { name: 'otp_hash', dataType: 'character varying', nullable: false },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'expires_at', dataType: 'timestamp without time zone', nullable: false },
      { name: 'attempts', dataType: 'integer', nullable: true },
      { name: 'max_attempts', dataType: 'integer', nullable: true },
      { name: 'verified', dataType: 'boolean', nullable: true },
      { name: 'phone', dataType: 'character varying', nullable: true },
      { name: 'purpose', dataType: 'character varying', nullable: false },
    ],
  },
  {
    name: 'audit_log',
    columns: [
      { name: 'id', dataType: 'bigint', nullable: false },
      { name: 'actor_type', dataType: 'character varying', nullable: false },
      { name: 'actor_id', dataType: 'integer', nullable: true },
      { name: 'event_type', dataType: 'character varying', nullable: false },
      { name: 'ip_address', dataType: 'character varying', nullable: true },
      { name: 'user_agent', dataType: 'text', nullable: true },
      { name: 'metadata', dataType: 'jsonb', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: false },
    ],
  },
];

const EXPECTED_INDEXES = [
  'idx_users_company_id',
  'idx_refresh_user',
  'idx_refresh_hash',
  'idx_password_history_user',
  'idx_candidate_refresh_candidate',
  'idx_candidate_refresh_hash',
  'idx_otp_email',
  'idx_otp_phone',
  'idx_audit_log_actor',
  'idx_audit_log_event_type',
];

async function fetchActualColumns(tableName: string): Promise<Map<string, { dataType: string; nullable: boolean }>> {
  const result = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const map = new Map<string, { dataType: string; nullable: boolean }>();
  for (const row of result.rows) {
    map.set(row.column_name, { dataType: row.data_type, nullable: row.is_nullable === 'YES' });
  }
  return map;
}

async function fetchActualIndexes(): Promise<Set<string>> {
  const result = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
  return new Set(result.rows.map((r) => r.indexname));
}

async function main(): Promise<void> {
  const errors: string[] = [];

  for (const expectedTable of EXPECTED_TABLES) {
    const actualColumns = await fetchActualColumns(expectedTable.name);

    if (actualColumns.size === 0) {
      errors.push(`Table "${expectedTable.name}" does not exist.`);
      continue;
    }

    for (const expectedColumn of expectedTable.columns) {
      const actual = actualColumns.get(expectedColumn.name);
      if (!actual) {
        errors.push(`Table "${expectedTable.name}": missing column "${expectedColumn.name}".`);
        continue;
      }
      if (actual.dataType !== expectedColumn.dataType) {
        errors.push(
          `Table "${expectedTable.name}", column "${expectedColumn.name}": expected type ` +
            `"${expectedColumn.dataType}", found "${actual.dataType}".`
        );
      }
      if (actual.nullable !== expectedColumn.nullable) {
        errors.push(
          `Table "${expectedTable.name}", column "${expectedColumn.name}": expected nullable=` +
            `${expectedColumn.nullable}, found nullable=${actual.nullable}.`
        );
      }
    }

    const expectedNames = new Set(expectedTable.columns.map((c) => c.name));
    for (const actualName of actualColumns.keys()) {
      if (!expectedNames.has(actualName)) {
        errors.push(`Table "${expectedTable.name}": unexpected column "${actualName}" present (schema drift).`);
      }
    }
  }

  const actualIndexes = await fetchActualIndexes();
  for (const expectedIndex of EXPECTED_INDEXES) {
    if (!actualIndexes.has(expectedIndex)) {
      errors.push(`Missing expected index "${expectedIndex}".`);
    }
  }

  if (errors.length > 0) {
    console.error(`✗ Schema validation FAILED - ${errors.length} issue(s):\n`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Schema validation passed - ${EXPECTED_TABLES.length} tables and ${EXPECTED_INDEXES.length} indexes ` +
        `match migrations/001_initial_schema.up.sql and 002_audit_log.up.sql exactly.`
    );
  }

  await pool.end();
}

main();
