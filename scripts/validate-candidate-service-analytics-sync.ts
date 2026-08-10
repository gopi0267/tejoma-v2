/**
 * Validation script for candidate-service analytics mirrors (Item 4)
 *
 * Verifies that candidate_decisions, candidate_application_status, and mutual_matches
 * in candidate-service match the monolith exactly. Compares row counts per table and
 * spot-checks a sample of rows for deep equality.
 *
 * Usage: npx tsx scripts/validate-candidate-service-analytics-sync.ts
 * Exit code: 0 = all tables in sync, 1 = drift detected
 */

import { Pool } from 'pg';

const CONNECT_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 30000;
const SAMPLE_SIZE = 10; // rows to spot-check per table

interface Config {
  monolith: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  candidateService: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

function getConfig(): Config {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const dbUser = process.env.DB_USER || 'postgres';
  const dbPassword = process.env.DB_PASSWORD || '';

  return {
    monolith: {
      host: dbHost,
      port: dbPort,
      database: process.env.MONOLITH_DB_NAME || 'tejoma',
      user: dbUser,
      password: dbPassword,
    },
    candidateService: {
      host: dbHost,
      port: dbPort,
      database: process.env.CANDIDATE_SERVICE_DB_NAME || 'tejoma_candidate',
      user: dbUser,
      password: dbPassword,
    },
  };
}

async function validateTable(
  monolithPool: Pool,
  candidateServicePool: Pool,
  tableName: string
): Promise<boolean> {
  console.log(`\nValidating ${tableName}...`);

  // Count rows
  const monolithCountResult = await monolithPool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
  const candidateServiceCountResult = await candidateServicePool.query(`SELECT COUNT(*) as count FROM ${tableName}`);

  const monolithCount = parseInt(monolithCountResult.rows[0]?.count || '0', 10);
  const candidateServiceCount = parseInt(candidateServiceCountResult.rows[0]?.count || '0', 10);

  if (monolithCount !== candidateServiceCount) {
    console.error(`  ✗ Row count mismatch: monolith=${monolithCount}, candidate-service=${candidateServiceCount}`);
    return false;
  }
  console.log(`  ✓ Row count matches: ${monolithCount}`);

  if (monolithCount === 0) {
    console.log(`  ✓ Table empty (nothing to spot-check)`);
    return true;
  }

  // Spot-check samples
  const limit = Math.min(SAMPLE_SIZE, monolithCount);
  const offset = Math.max(0, Math.floor(Math.random() * (monolithCount - limit)));
  const sampleResult = await monolithPool.query(
    `SELECT * FROM ${tableName} ORDER BY id LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  let spotCheckPassed = true;
  for (const row of sampleResult.rows) {
    const csResult = await candidateServicePool.query(
      `SELECT * FROM ${tableName} WHERE id = $1`,
      [row.id]
    );
    const csRow = csResult.rows[0];
    if (!csRow) {
      console.error(`  ✗ Row ${row.id} missing in candidate-service`);
      spotCheckPassed = false;
      continue;
    }

    // Deep compare (JSON.stringify for simplicity)
    const monolithJson = JSON.stringify(row);
    const csJson = JSON.stringify(csRow);
    if (monolithJson !== csJson) {
      console.error(`  ✗ Row ${row.id} differs:`);
      console.error(`    Monolith: ${monolithJson}`);
      console.error(`    Candidate-service: ${csJson}`);
      spotCheckPassed = false;
    }
  }

  if (spotCheckPassed) {
    console.log(`  ✓ Spot-checked ${limit} rows, all match`);
  }
  return spotCheckPassed;
}

async function main() {
  const config = getConfig();

  const monolithPool = new Pool({
    host: config.monolith.host,
    port: config.monolith.port,
    database: config.monolith.database,
    user: config.monolith.user,
    password: config.monolith.password,
    max: 5,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });

  const candidateServicePool = new Pool({
    host: config.candidateService.host,
    port: config.candidateService.port,
    database: config.candidateService.database,
    user: config.candidateService.user,
    password: config.candidateService.password,
    max: 5,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });

  try {
    await monolithPool.query('SELECT 1');
    await candidateServicePool.query('SELECT 1');
    console.log('Connected to both databases.');

    const results: boolean[] = [];

    results.push(await validateTable(monolithPool, candidateServicePool, 'candidate_decisions'));
    results.push(await validateTable(monolithPool, candidateServicePool, 'candidate_application_status'));
    results.push(await validateTable(monolithPool, candidateServicePool, 'mutual_matches'));

    const allPassed = results.every((r) => r);
    if (allPassed) {
      console.log('\n✓ All tables in sync');
      process.exit(0);
    } else {
      console.log('\n✗ Validation failed - drift detected');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during validation:', error);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await candidateServicePool.end();
  }
}

main();
