import pg from 'pg';

const { Client } = pg;

async function setup() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: '3268',
  });

  try {
    await client.connect();

    // Create database
    try {
      await client.query('CREATE DATABASE tejoma_analytics');
      console.log('✓ Created tejoma_analytics database');
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('✓ tejoma_analytics database already exists');
      } else {
        throw e;
      }
    }

    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }

  // Connect to new database and create tables
  const analyticsClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_analytics',
    user: 'postgres',
    password: '3268',
  });

  try {
    await analyticsClient.connect();

    const tables = [
      `CREATE TABLE IF NOT EXISTS analytics_dashboard_cache (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL UNIQUE,
        total_reviewed INTEGER DEFAULT 0,
        matches_made INTEGER DEFAULT 0,
        avg_score NUMERIC(5,2) DEFAULT 0,
        acceptance_rate NUMERIC(5,2) DEFAULT 0,
        total_swipes_today INTEGER DEFAULT 0,
        total_swipes_yesterday INTEGER DEFAULT 0,
        pending_candidates INTEGER DEFAULT 0,
        model_accuracy NUMERIC(5,2),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_daily_trends (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        date DATE NOT NULL,
        swipe_count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, date)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_recent_activity (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        swipe_id INTEGER NOT NULL UNIQUE,
        recruiter_name VARCHAR(255),
        candidate_name VARCHAR(255),
        job_title VARCHAR(255),
        action VARCHAR(20),
        match_score NUMERIC(5,2),
        timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_job_stats (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL UNIQUE,
        total_reviewed INTEGER DEFAULT 0,
        acceptance_rate NUMERIC(5,2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_skill_distribution (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        skill_name VARCHAR(255) NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, skill_name)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_recruiter_profile (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL UNIQUE,
        name VARCHAR(255),
        email VARCHAR(255),
        swipes_count INTEGER DEFAULT 0,
        accepted INTEGER DEFAULT 0,
        rejected INTEGER DEFAULT 0,
        saved INTEGER DEFAULT 0,
        acceptance_rate NUMERIC(5,2) DEFAULT 0,
        average_match_score NUMERIC(5,2),
        avg_decision_time_seconds INTEGER,
        last_login_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_company ON analytics_dashboard_cache(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_trends_company_date ON analytics_daily_trends(company_id, date)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_activity_company ON analytics_recent_activity(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_job_company ON analytics_job_stats(company_id, job_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_skill_company ON analytics_skill_distribution(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_recruiter_company ON analytics_recruiter_profile(company_id, user_id)`,
    ];

    for (const sql of tables) {
      try {
        await analyticsClient.query(sql);
      } catch (e) {
        if (!e.message.includes('already exists')) {
          console.error('Error:', e.message, '\nSQL:', sql);
        }
      }
    }

    console.log('✓ Created all analytics tables');
    await analyticsClient.end();
  } catch (e) {
    console.error('Error creating tables:', e.message);
    process.exit(1);
  }
}

setup().catch(e => {
  console.error(e);
  process.exit(1);
});
