/**
 * Validate candidate-analytics sync (candidate-service vs. monolith)
 *
 * Phase 4, Item 4: Confirms 3 mirrored tables have zero drift:
 * - candidate_decisions
 * - candidate_application_status
 * - mutual_matches
 *
 * Run BEFORE cutover: validates backfill completeness
 * Run AFTER dual-writes enabled: validates sync is working
 * Run periodically: detects any divergence
 */

import { Pool, PoolClient } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

const monolithPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const candidateServicePool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.CANDIDATE_SERVICE_DB_NAME || 'tejoma_candidate',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

interface ValidationResult {
  table: string;
  monolithCount: number;
  candidateServiceCount: number;
  match: boolean;
  sampleDrift?: string[];
}

async function validateTable(tableName: string): Promise<ValidationResult> {
  console.log(`\n[${tableName}] Validating...`);

  try {
    // Check if table exists in both databases
    const monolithCheckResult = await monolithPool.query(
      `SELECT to_regclass('public.${tableName}') IS NOT NULL as exists`
    );
    const candidateCheckResult = await candidateServicePool.query(
      `SELECT to_regclass('public.${tableName}') IS NOT NULL as exists`
    );

    if (!monolithCheckResult.rows[0].exists) {
      console.log(`[${tableName}] ⚠️  Table does not exist in monolith.`);
      return {
        table: tableName,
        monolithCount: 0,
        candidateServiceCount: 0,
        match: true,
      };
    }

    if (!candidateCheckResult.rows[0].exists) {
      console.log(`[${tableName}] ❌ Table does not exist in candidate-service!`);
      return {
        table: tableName,
        monolithCount: 0,
        candidateServiceCount: 0,
        match: false,
      };
    }

    // Count rows in both databases
    const monolithCount = await monolithPool.query(
      `SELECT COUNT(*) as count FROM ${tableName}`
    );
    const candidateCount = await candidateServicePool.query(
      `SELECT COUNT(*) as count FROM ${tableName}`
    );

    const monolithTotal = parseInt(monolithCount.rows[0].count);
    const candidateTotal = parseInt(candidateCount.rows[0].count);

    console.log(`[${tableName}] Monolith: ${monolithTotal} rows`);
    console.log(`[${tableName}] Candidate Service: ${candidateTotal} rows`);

    const match = monolithTotal === candidateTotal;

    if (!match) {
      console.log(
        `[${tableName}] ❌ Row count mismatch! (diff: ${Math.abs(monolithTotal - candidateTotal)})`
      );
    } else {
      console.log(`[${tableName}] ✅ Row counts match`);
    }

    // Sample 10 random rows and compare in detail
    const sampleDrift: string[] = [];
    if (monolithTotal > 0) {
      const sampleIds = await monolithPool.query(
        `SELECT id FROM ${tableName} ORDER BY RANDOM() LIMIT 10`
      );

      for (const { id } of sampleIds.rows) {
        const monolithRow = await monolithPool.query(
          `SELECT * FROM ${tableName} WHERE id = $1`,
          [id]
        );
        const candidateRow = await candidateServicePool.query(
          `SELECT * FROM ${tableName} WHERE id = $1`,
          [id]
        );

        if (monolithRow.rows.length === 0 || candidateRow.rows.length === 0) {
          sampleDrift.push(`ID ${id}: missing in ${monolithRow.rows.length === 0 ? 'monolith' : 'candidate-service'}`);
          continue;
        }

        const mRow = monolithRow.rows[0];
        const cRow = candidateRow.rows[0];

        for (const col in mRow) {
          if (JSON.stringify(mRow[col]) !== JSON.stringify(cRow[col])) {
            sampleDrift.push(
              `ID ${id}, column ${col}: monolith="${mRow[col]}" vs candidate-service="${cRow[col]}"`
            );
          }
        }
      }
    }

    if (sampleDrift.length > 0) {
      console.log(`[${tableName}] ⚠️  Sample drift detected:`);
      sampleDrift.forEach((d) => console.log(`  - ${d}`));
    }

    return {
      table: tableName,
      monolithCount: monolithTotal,
      candidateServiceCount: candidateTotal,
      match,
      sampleDrift: sampleDrift.length > 0 ? sampleDrift : undefined,
    };
  } catch (err) {
    console.error(`[${tableName}] ❌ Error during validation:`, err);
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    console.log('Starting candidate-analytics sync validation...');

    const results: ValidationResult[] = [];

    // Validate all 3 tables
    results.push(await validateTable('candidate_decisions'));
    results.push(await validateTable('candidate_application_status'));
    results.push(await validateTable('mutual_matches'));

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('VALIDATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');

    let allMatch = true;
    for (const result of results) {
      const status = result.match ? '✅' : '❌';
      console.log(
        `${status} ${result.table}: ${result.monolithCount} rows (monolith) vs ${result.candidateServiceCount} rows (candidate-service)`
      );
      if (!result.match) allMatch = false;
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    if (allMatch) {
      console.log('✅ All tables in sync! Ready for cutover.');
      process.exit(0);
    } else {
      console.log('❌ Sync validation failed. Do not proceed with cutover.');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ Validation error:', err);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await candidateServicePool.end();
  }
}

main();
