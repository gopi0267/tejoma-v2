import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_analytics',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
});

pool.on('error', (err) => {
  console.error('analytics-service PostgreSQL pool error:', err);
});

export async function initializeSchema(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_dashboard_cache (
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
      );

      CREATE TABLE IF NOT EXISTS analytics_daily_trends (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        date DATE NOT NULL,
        swipe_count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, date)
      );

      CREATE TABLE IF NOT EXISTS analytics_recent_activity (
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
      );

      CREATE TABLE IF NOT EXISTS analytics_job_stats (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL UNIQUE,
        total_reviewed INTEGER DEFAULT 0,
        acceptance_rate NUMERIC(5,2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS analytics_skill_distribution (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        skill_name VARCHAR(255) NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, skill_name)
      );

      CREATE TABLE IF NOT EXISTS analytics_recruiter_profile (
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
      );

      CREATE INDEX IF NOT EXISTS idx_analytics_company ON analytics_dashboard_cache(company_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_trends_company_date ON analytics_daily_trends(company_id, date);
      CREATE INDEX IF NOT EXISTS idx_analytics_activity_company ON analytics_recent_activity(company_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_job_company ON analytics_job_stats(company_id, job_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_skill_company ON analytics_skill_distribution(company_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_recruiter_company ON analytics_recruiter_profile(company_id, user_id);
    `);
    console.log('Analytics schema initialized');
  } catch (error) {
    console.error('Failed to initialize analytics schema:', error);
    throw error;
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardStats(companyId: number): Promise<any> {
  try {
    const result = await pool.query(
      `SELECT * FROM analytics_dashboard_cache WHERE company_id = $1`,
      [companyId]
    );
    if (result.rows.length === 0) {
      return {
        total_reviewed: 0,
        matches_made: 0,
        avg_score: 0,
        acceptance_rate: 0,
        totalSwipesToday: 0,
        acceptanceRate: 0,
        totalCandidatesReviewed: 0,
        pendingCandidates: 0,
        swipesTrend: [],
        recentActivity: [],
        swipesYesterday: 0,
        swipesTodayChangePct: null,
        modelAccuracy: null,
      };
    }
    const row = result.rows[0];
    return {
      total_reviewed: row.total_reviewed,
      matches_made: row.matches_made,
      avg_score: row.avg_score,
      acceptance_rate: row.acceptance_rate,
      totalSwipesToday: row.total_swipes_today,
      acceptanceRate: row.acceptance_rate,
      totalCandidatesReviewed: row.total_reviewed,
      pendingCandidates: row.pending_candidates,
      swipesYesterday: row.total_swipes_yesterday,
      swipesTodayChangePct: null,
      modelAccuracy: row.model_accuracy,
    };
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    throw error;
  }
}

export async function getDailyTrends(companyId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT date, swipe_count FROM analytics_daily_trends WHERE company_id = $1 ORDER BY date DESC LIMIT 7`,
      [companyId]
    );
    return result.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      swipes: row.swipe_count,
    }));
  } catch (error) {
    console.error('Error getting daily trends:', error);
    return [];
  }
}

export async function getRecentActivity(companyId: number, limit: number = 5): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM analytics_recent_activity WHERE company_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [companyId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      recruiterName: row.recruiter_name,
      candidateName: row.candidate_name,
      jobTitle: row.job_title,
      action: row.action,
      matchScore: row.match_score,
      timestamp: row.timestamp,
    }));
  } catch (error) {
    console.error('Error getting recent activity:', error);
    return [];
  }
}

export async function getJobStats(jobId: number, companyId: number): Promise<any> {
  try {
    const result = await pool.query(
      `SELECT * FROM analytics_job_stats WHERE job_id = $1 AND company_id = $2`,
      [jobId, companyId]
    );
    if (result.rows.length === 0) {
      return { total_reviewed: 0, acceptance_rate: 0 };
    }
    const row = result.rows[0];
    return {
      total_reviewed: row.total_reviewed,
      acceptance_rate: row.acceptance_rate,
    };
  } catch (error) {
    console.error('Error getting job stats:', error);
    return { total_reviewed: 0, acceptance_rate: 0 };
  }
}

export async function getSkillDistribution(companyId: number, limit: number = 8): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT skill_name, count FROM analytics_skill_distribution WHERE company_id = $1 ORDER BY count DESC LIMIT $2`,
      [companyId, limit]
    );
    return result.rows.map((row) => ({
      name: row.skill_name,
      value: row.count,
    }));
  } catch (error) {
    console.error('Error getting skill distribution:', error);
    return [];
  }
}

export async function getRecruiterProfile(userId: number, companyId: number): Promise<any> {
  try {
    const result = await pool.query(
      `SELECT * FROM analytics_recruiter_profile WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      swipesCount: row.swipes_count,
      accepted: row.accepted,
      rejected: row.rejected,
      saved: row.saved,
      acceptanceRate: row.acceptance_rate,
      averageMatchScore: row.average_match_score,
      avgDecisionTimeSeconds: row.avg_decision_time_seconds,
      lastLoginAt: row.last_login_at,
      isActive: row.is_active,
    };
  } catch (error) {
    console.error('Error getting recruiter profile:', error);
    return null;
  }
}

export async function upsertDashboardStats(companyId: number, stats: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_dashboard_cache (company_id, total_reviewed, matches_made, avg_score, acceptance_rate, total_swipes_today, total_swipes_yesterday, pending_candidates, model_accuracy, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       ON CONFLICT (company_id) DO UPDATE SET
         total_reviewed = $2, matches_made = $3, avg_score = $4, acceptance_rate = $5,
         total_swipes_today = $6, total_swipes_yesterday = $7, pending_candidates = $8,
         model_accuracy = $9, updated_at = CURRENT_TIMESTAMP`,
      [companyId, stats.totalReviewed, stats.matchesMade, stats.avgScore, stats.acceptanceRate,
       stats.totalSwipesToday, stats.swipesYesterday, stats.pendingCandidates, stats.modelAccuracy]
    );
  } catch (error) {
    console.error('Error upserting dashboard stats:', error);
    throw error;
  }
}

export async function upsertRecentActivity(companyId: number, activity: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_recent_activity (company_id, swipe_id, recruiter_name, candidate_name, job_title, action, match_score, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (swipe_id) DO UPDATE SET
         recruiter_name = $3, candidate_name = $4, job_title = $5, action = $6, match_score = $7, timestamp = $8`,
      [companyId, activity.swipeId, activity.recruiterName, activity.candidateName, activity.jobTitle, activity.action, activity.matchScore, activity.timestamp]
    );
  } catch (error) {
    console.error('Error upserting recent activity:', error);
  }
}

export async function upsertJobStats(companyId: number, jobId: number, stats: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_job_stats (company_id, job_id, total_reviewed, acceptance_rate)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_id) DO UPDATE SET total_reviewed = $3, acceptance_rate = $4`,
      [companyId, jobId, stats.totalReviewed, stats.acceptanceRate]
    );
  } catch (error) {
    console.error('Error upserting job stats:', error);
  }
}

export async function upsertSkillDistribution(companyId: number, skill: string, count: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_skill_distribution (company_id, skill_name, count)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, skill_name) DO UPDATE SET count = $3`,
      [companyId, skill, count]
    );
  } catch (error) {
    console.error('Error upserting skill distribution:', error);
  }
}

export async function upsertRecruiterProfile(companyId: number, profile: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_recruiter_profile (company_id, user_id, name, email, swipes_count, accepted, rejected, saved, acceptance_rate, average_match_score, avg_decision_time_seconds, last_login_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (user_id) DO UPDATE SET
         name = $3, email = $4, swipes_count = $5, accepted = $6, rejected = $7, saved = $8,
         acceptance_rate = $9, average_match_score = $10, avg_decision_time_seconds = $11, last_login_at = $12, is_active = $13`,
      [companyId, profile.userId, profile.name, profile.email, profile.swipesCount, profile.accepted, profile.rejected, profile.saved,
       profile.acceptanceRate, profile.averageMatchScore, profile.avgDecisionTimeSeconds, profile.lastLoginAt, profile.isActive]
    );
  } catch (error) {
    console.error('Error upserting recruiter profile:', error);
  }
}

export const db = {
  healthCheck,
  getDashboardStats,
  getDailyTrends,
  getRecentActivity,
  getJobStats,
  getSkillDistribution,
  getRecruiterProfile,
  upsertDashboardStats,
  upsertRecentActivity,
  upsertJobStats,
  upsertSkillDistribution,
  upsertRecruiterProfile,
  initializeSchema,
};

export { pool };
