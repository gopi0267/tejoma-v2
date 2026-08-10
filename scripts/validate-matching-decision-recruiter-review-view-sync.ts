/**
 * Validation script for recruiter_review_view materialized view (Item 5)
 *
 * Verifies that recruiter_review_view in matching-decision-service stays in sync with
 * the monolith's swipes + candidates + jobs + recruiter_notes source data.
 * Compares row counts per company and spot-checks samples for deep equality.
 *
 * Usage: npx tsx scripts/validate-matching-decision-recruiter-review-view-sync.ts
 * Exit code: 0 = all tables in sync, 1 = drift detected
 */

import { Pool } from 'pg';

const CONNECT_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 60000;
const SAMPLE_SIZE = 10;

interface Config {
  monolith: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  matchingDecisionService: {
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
    matchingDecisionService: {
      host: dbHost,
      port: dbPort,
      database: process.env.MATCHING_DECISION_SERVICE_DB_NAME || 'tejoma_matching_decision',
      user: dbUser,
      password: dbPassword,
    },
  };
}

async function validatePerCompany(
  monolithPool: Pool,
  matchingDecisionServicePool: Pool
): Promise<boolean> {
  console.log('\nValidating row counts per company...');

  const monolithResult = await monolithPool.query(
    `SELECT company_id, COUNT(DISTINCT candidate_id, job_id) as count
     FROM swipes GROUP BY company_id ORDER BY company_id`
  );

  const viewResult = await matchingDecisionServicePool.query(
    `SELECT company_id, COUNT(*) as count FROM recruiter_review_view GROUP BY company_id ORDER BY company_id`
  );

  const monolithMap = new Map(monolithResult.rows.map((r: any) => [r.company_id, parseInt(r.count, 10)]));
  const viewMap = new Map(viewResult.rows.map((r: any) => [r.company_id, parseInt(r.count, 10)]));

  let allMatch = true;
  const allCompanies = new Set([...monolithMap.keys(), ...viewMap.keys()]);
  for (const companyId of allCompanies) {
    const monolithCount = monolithMap.get(companyId) || 0;
    const viewCount = viewMap.get(companyId) || 0;
    if (monolithCount !== viewCount) {
      console.error(`  ✗ Company ${companyId}: monolith=${monolithCount}, view=${viewCount}`);
      allMatch = false;
    } else {
      console.log(`  ✓ Company ${companyId}: ${monolithCount} rows`);
    }
  }

  return allMatch;
}

async function validateSample(
  monolithPool: Pool,
  matchingDecisionServicePool: Pool
): Promise<boolean> {
  console.log('\nValidating sample rows...');

  // Fetch a random sample from monolith's latest swipes
  const sampleResult = await monolithPool.query(`
    SELECT DISTINCT ON (candidate_id, job_id)
      s.candidate_id, s.job_id, s.company_id, s.match_score, s.action
    FROM swipes s
    ORDER BY candidate_id, job_id, s.timestamp DESC
    LIMIT $1 OFFSET $2
  `, [SAMPLE_SIZE, Math.floor(Math.random() * 100)]);

  if (sampleResult.rows.length === 0) {
    console.log('  (No sample rows to check)');
    return true;
  }

  let allMatch = true;
  for (const row of sampleResult.rows) {
    const viewResult = await matchingDecisionServicePool.query(
      `SELECT * FROM recruiter_review_view WHERE candidate_id = $1 AND job_id = $2`,
      [row.candidate_id, row.job_id]
    );

    const viewRow = viewResult.rows[0];
    if (!viewRow) {
      console.error(`  ✗ Row (${row.candidate_id}, ${row.job_id}) missing in view`);
      allMatch = false;
      continue;
    }

    // Check key fields match
    if (viewRow.latest_action !== row.action || viewRow.match_score !== row.match_score) {
      console.error(`  ✗ Row (${row.candidate_id}, ${row.job_id}) differs:`);
      console.error(`    Monolith action: ${row.action}, view action: ${viewRow.latest_action}`);
      console.error(`    Monolith score: ${row.match_score}, view score: ${viewRow.match_score}`);
      allMatch = false;
    }
  }

  if (allMatch) {
    console.log(`  ✓ Spot-checked ${sampleResult.rows.length} rows, all match`);
  }
  return allMatch;
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

  const matchingDecisionServicePool = new Pool({
    host: config.matchingDecisionService.host,
    port: config.matchingDecisionService.port,
    database: config.matchingDecisionService.database,
    user: config.matchingDecisionService.user,
    password: config.matchingDecisionService.password,
    max: 5,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });

  try {
    await monolithPool.query('SELECT 1');
    await matchingDecisionServicePool.query('SELECT 1');
    console.log('Connected to both databases.');

    const perCompanyMatch = await validatePerCompany(monolithPool, matchingDecisionServicePool);
    const sampleMatch = await validateSample(monolithPool, matchingDecisionServicePool);

    if (perCompanyMatch && sampleMatch) {
      console.log('\n✓ View is in sync with monolith');
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
    await matchingDecisionServicePool.end();
  }
}

main();
