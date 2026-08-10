/**
 * Schema validation script. Mirrors every other Tier 0 service's scripts/validate-schema.ts
 * exactly.
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
    name: 'skill_nodes',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'canonical_name', dataType: 'character varying', nullable: false },
      { name: 'category', dataType: 'character varying', nullable: false },
      { name: 'technology_domain', dataType: 'character varying', nullable: true },
      { name: 'aliases', dataType: 'ARRAY', nullable: false },
      { name: 'popularity_score', dataType: 'numeric', nullable: true },
      { name: 'confidence', dataType: 'numeric', nullable: false },
      { name: 'is_deprecated', dataType: 'boolean', nullable: false },
      { name: 'is_emerging', dataType: 'boolean', nullable: false },
      { name: 'source', dataType: 'character varying', nullable: false },
      { name: 'embedding', dataType: 'ARRAY', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: false },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: false },
    ],
  },
  {
    name: 'skill_discovery_proposals',
    columns: [
      { name: 'id', dataType: 'integer', nullable: false },
      { name: 'raw_token', dataType: 'character varying', nullable: false },
      { name: 'normalized_token', dataType: 'character varying', nullable: false },
      { name: 'source_type', dataType: 'character varying', nullable: false },
      { name: 'context_text', dataType: 'text', nullable: true },
      { name: 'mention_count', dataType: 'integer', nullable: false },
      { name: 'is_skill', dataType: 'boolean', nullable: true },
      { name: 'proposed_category', dataType: 'character varying', nullable: true },
      { name: 'nearest_neighbors', dataType: 'jsonb', nullable: true },
      { name: 'proposed_relationship_type', dataType: 'character varying', nullable: true },
      { name: 'proposed_related_skill_id', dataType: 'integer', nullable: true },
      { name: 'confidence', dataType: 'numeric', nullable: true },
      { name: 'status', dataType: 'character varying', nullable: false },
      { name: 'promoted_skill_node_id', dataType: 'integer', nullable: true },
      { name: 'created_at', dataType: 'timestamp without time zone', nullable: false },
      { name: 'updated_at', dataType: 'timestamp without time zone', nullable: false },
      { name: 'reviewed_at', dataType: 'timestamp without time zone', nullable: true },
      { name: 'reviewed_by', dataType: 'integer', nullable: true },
    ],
  },
];

const EXPECTED_INDEXES: string[] = ['idx_skill_nodes_category', 'idx_skill_nodes_aliases', 'idx_skill_discovery_proposals_status'];

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
      `✓ Schema validation passed - ${EXPECTED_TABLES.length} tables match migrations/001_initial_schema.up.sql exactly.`
    );
  }

  await pool.end();
}

main();
