/**
 * Backfill recruiter_review_view materialized table (Item 5)
 *
 * Populates recruiter_review_view in matching-decision-service from the monolith's
 * swipes, candidates, jobs, users, and recruiter_notes tables. One row per latest
 * (candidate_id, job_id) pair, denormalized for direct filter/sort/paginate.
 *
 * Runs one-time before enabling RECRUITER_REVIEW_LIST_CUTOVER_ENABLED. Idempotent.
 *
 * Usage: npx tsx scripts/backfill-matching-decision-recruiter-review-view.ts
 */

import { Pool } from 'pg';

const CONNECT_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 60000;

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

    // Fetch from monolith: latest swipe per (candidate_id, job_id) pair, joined with all needed data
    console.log('Fetching data from monolith...');
    const result = await monolithPool.query(`
      SELECT DISTINCT ON (s.candidate_id, s.job_id)
        s.candidate_id,
        s.job_id,
        s.company_id,
        c.name AS candidate_name,
        c.email AS candidate_email,
        c.phone AS candidate_phone,
        c.skills AS candidate_skills,
        c.current_location AS candidate_location,
        c.years_of_experience AS candidate_years_exp,
        c.current_company AS candidate_company,
        j.title AS job_title,
        j.location AS job_location,
        com.name AS job_company_name,
        u.full_name AS recruiter_name,
        s.recruiter_id,
        s.action AS latest_action,
        s.timestamp AS latest_decision_date,
        s.match_score,
        s.reason,
        rn.note AS note_text
      FROM swipes s
      LEFT JOIN candidates c ON s.candidate_id = c.id
      LEFT JOIN jobs j ON s.job_id = j.id
      LEFT JOIN companies com ON j.company_id = com.id
      LEFT JOIN users u ON s.recruiter_id = u.id
      LEFT JOIN recruiter_notes rn ON s.company_id = rn.company_id AND s.candidate_id = rn.candidate_id AND s.job_id = rn.job_id
      ORDER BY s.candidate_id, s.job_id, s.timestamp DESC
    `);

    console.log(`Found ${result.rows.length} latest swipes to backfill`);

    // Upsert into matching-decision-service
    let backfilled = 0;
    for (const row of result.rows) {
      try {
        await matchingDecisionServicePool.query(
          `INSERT INTO recruiter_review_view (
            candidate_id, job_id, company_id, candidate_name, candidate_email, candidate_phone,
            candidate_skills, candidate_location, candidate_years_exp, candidate_company,
            job_title, job_location, job_company_name, recruiter_name, recruiter_id,
            latest_action, latest_decision_date, match_score, reason, note_text
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
          ON CONFLICT (candidate_id, job_id) DO UPDATE SET
            candidate_name = $4, candidate_email = $5, candidate_phone = $6,
            candidate_skills = $7, candidate_location = $8, candidate_years_exp = $9, candidate_company = $10,
            job_title = $11, job_location = $12, job_company_name = $13, recruiter_name = $14, recruiter_id = $15,
            latest_action = $16, latest_decision_date = $17, match_score = $18, reason = $19, note_text = $20,
            updated_at = CURRENT_TIMESTAMP`,
          [
            row.candidate_id, row.job_id, row.company_id, row.candidate_name, row.candidate_email, row.candidate_phone,
            row.candidate_skills, row.candidate_location, row.candidate_years_exp, row.candidate_company,
            row.job_title, row.job_location, row.job_company_name, row.recruiter_name, row.recruiter_id,
            row.latest_action, row.latest_decision_date, row.match_score, row.reason, row.note_text,
          ]
        );
        backfilled++;
      } catch (error) {
        console.error(`Error inserting row (candidate_id=${row.candidate_id}, job_id=${row.job_id}):`, error);
      }
    }

    console.log(`\nBackfill complete: ${backfilled}/${result.rows.length} rows`);
  } catch (error) {
    console.error('Fatal error during backfill:', error);
    process.exit(1);
  } finally {
    await monolithPool.end();
    await matchingDecisionServicePool.end();
  }
}

main();
