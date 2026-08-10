/**
 * Schema validation script. Mirrors identity-service/scripts/validate-schema.ts exactly - see
 * that file's header comment for the full reasoning.
 *
 * Usage: tsx scripts/validate-schema.ts
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
  dataType: string;
  nullable: boolean;
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

// Mirrors migrations/001_initial_schema.up.sql exactly, column for column.
const EXPECTED_TABLES: ExpectedTable[] = [
  {
    name: 'company_registration_requests',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'company_name', dataType: 'character varying', nullable: false },
      { name: 'company_website', dataType: 'character varying', nullable: true },
      { name: 'industry', dataType: 'character varying', nullable: true },
      { name: 'company_size', dataType: 'character varying', nullable: true },
      { name: 'business_email', dataType: 'character varying', nullable: false },
      { name: 'company_phone', dataType: 'character varying', nullable: true },
      { name: 'country', dataType: 'character varying', nullable: true },
      { name: 'state', dataType: 'character varying', nullable: true },
      { name: 'city', dataType: 'character varying', nullable: true },
      { name: 'address', dataType: 'text', nullable: true },
      { name: 'admin_name', dataType: 'character varying', nullable: false },
      { name: 'admin_email', dataType: 'character varying', nullable: false },
      { name: 'admin_phone', dataType: 'character varying', nullable: true },
      { name: 'password_hash', dataType: 'character varying', nullable: false },
      { name: 'status', dataType: 'USER-DEFINED', nullable: false },
      { name: 'review_notes', dataType: 'text', nullable: true },
      { name: 'reviewed_by', dataType: 'integer', nullable: true },
      { name: 'reviewed_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'resulting_company_id', dataType: 'integer', nullable: true },
      { name: 'resulting_user_id', dataType: 'integer', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: true },
    ],
  },
];

const EXPECTED_INDEXES = [
  'idx_company_reg_status',
  'idx_company_reg_created_at',
  'idx_company_reg_pending_name',
  'idx_company_reg_pending_biz_email',
  'idx_company_reg_pending_admin_email',
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
      `✓ Schema validation passed - ${EXPECTED_TABLES.length} table and ${EXPECTED_INDEXES.length} indexes ` +
        `match migrations/001_initial_schema.up.sql exactly.`
    );
  }

  await pool.end();
}

main();
