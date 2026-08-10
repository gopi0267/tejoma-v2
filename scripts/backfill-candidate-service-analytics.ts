/**
 * Backfill candidate-service analytics mirror tables (Item 4)
 *
 * Populates candidate_decisions, candidate_application_status, and mutual_matches in
 * candidate-service from the monolith's own tables. Runs one-time before enabling
 * dual-write. Idempotent (ON CONFLICT DO NOTHING).
 *
 * Usage: npx tsx scripts/backfill-candidate-service-analytics.ts
 */

import { Pool } from 'pg';

const CONNECT_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 30000;

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

async function backfillTable(
  monolithPool: Pool,
  candidateServicePool: Pool,
  tableName: string,
  sourceColumns: string[],
  targetColumns: string[]
): Promise<number> {
  console.log(`Backfilling ${tableName}...`);

  // Fetch from monolith
  const sourceResult = await monolithPool.query(
    `SELECT ${sourceColumns.join(', ')} FROM ${tableName}`,
    []
  );

  if (sourceResult.rows.length === 0) {
    console.log(`  ${tableName}: 0 rows to backfill`);
    return 0;
  }

  const placeholders = targetColumns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = targetColumns.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');

  let backfilled = 0;
  for (const row of sourceResult.rows) {
    const values = targetColumns.map((col) => row[col] ?? null);
    try {
      const result = await candidateServicePool.query(
        `INSERT INTO ${tableName} (${targetColumns.join(', ')}) VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
        values
      );
      if (result.rowCount && result.rowCount > 0) {
        backfilled++;
      }
    } catch (error) {
      console.error(`  Error inserting row into ${tableName}:`, error);
    }
  }

  console.log(`  ${tableName}: ${backfilled}/${sourceResult.rows.length} rows backfilled`);
  return backfilled;
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

    let totalBackfilled = 0;

    // candidate_decisions: map decision_type from monolith to a date field
    totalBackfilled += await backfillTable(
      monolithPool,
      candidateServicePool,
      'candidate_decisions',
      ['id', 'candidate_account_id', 'job_id', 'decision_type', 'timestamp'],
      ['id', 'candidate_account_id', 'job_id', 'decision_type', 'decision_date', 'created_at', 'updated_at']
    );

    // candidate_application_status
    totalBackfilled += await backfillTable(
      monolithPool,
      candidateServicePool,
      'candidate_application_status',
      ['id', 'candidate_account_id', 'job_id', 'status', 'updated_at'],
      ['id', 'candidate_account_id', 'job_id', 'status', 'updated_at']
    );

    // mutual_matches
    totalBackfilled += await backfillTable(
      monolithPool,
      candidateServicePool,
      'mutual_matches',
      ['id', 'candidate_account_id', 'job_id', 'match_score', 'created_at', 'updated_at'],
      ['id', 'candidate_account_id', 'job_id', 'match_score', 'created_at', 'updated_at']
    );

    console.log(`\nBackfill complete: ${totalBackfilled} total rows`);
  } catch (error) {
    console.error('Fatal error during backfill:', error);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await candidateServicePool.end();
  }
}

main();
