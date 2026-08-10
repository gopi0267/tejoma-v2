import pg from 'pg';

const { Client } = pg;

// Connection configs for each service database
const databases = {
  tejoma_recruiting: {
    host: 'localhost',
    port: 5432,
    database: 'tejoma_recruiting',
    user: 'postgres',
    password: '3268',
  },
  tejoma_analytics: {
    host: 'localhost',
    port: 5432,
    database: 'tejoma_analytics',
    user: 'postgres',
    password: '3268',
  },
};

async function populateAnalytics() {
  console.log('🔄 Starting analytics population from real Tejoma data...\n');

  const recruitingClient = new Client(databases.tejoma_recruiting);
  const analyticsClient = new Client(databases.tejoma_analytics);

  try {
    await recruitingClient.connect();
    await analyticsClient.connect();

    console.log('✓ Connected to all databases\n');

    // Query real swipes - from recruiting db (source of truth)
    const swipesResult = await recruitingClient.query(`
      SELECT s.id, s.recruiter_id, s.candidate_id, s.job_id,
             s.action as decision, s.match_score, s.timestamp as created_at,
             c.name as candidate_name,
             j.title as job_title,
             u.name as recruiter_name,
             s.company_id
      FROM swipes s
      LEFT JOIN candidates c ON s.candidate_id = c.id
      LEFT JOIN jobs j ON s.job_id = j.id
      LEFT JOIN users u ON s.recruiter_id = u.id
      LIMIT 50
    `);

    console.log(`✓ Found ${swipesResult.rows.length} swipes to migrate\n`);

    // Populate analytics_recent_activity from swipes
    for (const swipe of swipesResult.rows) {
      const actionMap = {
        '0': 'pass',
        '1': 'like',
        0: 'pass',
        1: 'like',
      };

      await analyticsClient.query(`
        INSERT INTO analytics_recent_activity
        (company_id, swipe_id, recruiter_name, candidate_name, job_title, action, match_score, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (swipe_id) DO UPDATE SET
          recruiter_name = EXCLUDED.recruiter_name,
          candidate_name = EXCLUDED.candidate_name,
          job_title = EXCLUDED.job_title,
          action = EXCLUDED.action,
          match_score = EXCLUDED.match_score,
          timestamp = EXCLUDED.timestamp
      `, [
        swipe.company_id,
        swipe.id,
        swipe.recruiter_name || 'Unknown',
        swipe.candidate_name || 'Unknown',
        swipe.job_title || 'Unknown',
        actionMap[swipe.decision] || 'unknown',
        swipe.match_score || 0,
        swipe.created_at || new Date(),
      ]);
    }

    console.log(`✓ Populated ${swipesResult.rows.length} recent activity records\n`);

    // Aggregate dashboard stats by company from swipes
    const statsResult = await recruitingClient.query(`
      SELECT
        company_id,
        COUNT(*) as total_reviewed,
        COUNT(CASE WHEN CAST(action AS INTEGER) = 1 THEN 1 END) as matches_made,
        COALESCE(AVG(CAST(match_score AS NUMERIC)), 0) as avg_score,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE (COUNT(CASE WHEN CAST(action AS INTEGER) = 1 THEN 1 END)::NUMERIC / COUNT(*) * 100)
        END as acceptance_rate,
        COUNT(CASE WHEN DATE(timestamp) = CURRENT_DATE THEN 1 END) as total_swipes_today,
        COUNT(CASE WHEN DATE(timestamp) = CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as total_swipes_yesterday
      FROM swipes
      GROUP BY company_id
    `);

    console.log(`✓ Computed dashboard stats for ${statsResult.rows.length} companies\n`);

    // Populate analytics_dashboard_cache
    for (const stats of statsResult.rows) {
      await analyticsClient.query(`
        INSERT INTO analytics_dashboard_cache
        (company_id, total_reviewed, matches_made, avg_score, acceptance_rate,
         total_swipes_today, total_swipes_yesterday, model_accuracy)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (company_id) DO UPDATE SET
          total_reviewed = EXCLUDED.total_reviewed,
          matches_made = EXCLUDED.matches_made,
          avg_score = EXCLUDED.avg_score,
          acceptance_rate = EXCLUDED.acceptance_rate,
          total_swipes_today = EXCLUDED.total_swipes_today,
          total_swipes_yesterday = EXCLUDED.total_swipes_yesterday,
          model_accuracy = EXCLUDED.model_accuracy,
          updated_at = CURRENT_TIMESTAMP
      `, [
        stats.company_id,
        stats.total_reviewed || 0,
        stats.matches_made || 0,
        parseFloat(stats.avg_score) || 0,
        parseFloat(stats.acceptance_rate) || 0,
        stats.total_swipes_today || 0,
        stats.total_swipes_yesterday || 0,
        null,
      ]);
    }

    console.log(`✓ Populated dashboard cache for ${statsResult.rows.length} companies\n`);

    // Populate daily trends
    const trendsResult = await recruitingClient.query(`
      SELECT
        company_id,
        DATE(timestamp) as date,
        COUNT(*) as swipe_count
      FROM swipes
      GROUP BY company_id, DATE(timestamp)
      ORDER BY date DESC
      LIMIT 30
    `);

    console.log(`✓ Found ${trendsResult.rows.length} daily trend records\n`);

    for (const trend of trendsResult.rows) {
      await analyticsClient.query(`
        INSERT INTO analytics_daily_trends (company_id, date, swipe_count)
        VALUES ($1, $2, $3)
        ON CONFLICT (company_id, date) DO UPDATE SET
          swipe_count = EXCLUDED.swipe_count,
          updated_at = CURRENT_TIMESTAMP
      `, [trend.company_id, trend.date, trend.swipe_count]);
    }

    console.log(`✓ Populated ${trendsResult.rows.length} daily trend records\n`);

    // Populate job stats
    const jobStatsResult = await recruitingClient.query(`
      SELECT
        company_id,
        job_id,
        COUNT(*) as total_reviewed,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE (COUNT(CASE WHEN CAST(action AS INTEGER) = 1 THEN 1 END)::NUMERIC / COUNT(*) * 100)
        END as acceptance_rate
      FROM swipes
      WHERE job_id IS NOT NULL
      GROUP BY company_id, job_id
      LIMIT 50
    `);

    console.log(`✓ Found ${jobStatsResult.rows.length} job stats records\n`);

    for (const jobStat of jobStatsResult.rows) {
      await analyticsClient.query(`
        INSERT INTO analytics_job_stats (company_id, job_id, total_reviewed, acceptance_rate)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (job_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          total_reviewed = EXCLUDED.total_reviewed,
          acceptance_rate = EXCLUDED.acceptance_rate,
          updated_at = CURRENT_TIMESTAMP
      `, [jobStat.company_id, jobStat.job_id, jobStat.total_reviewed, parseFloat(jobStat.acceptance_rate)]);
    }

    console.log(`✓ Populated ${jobStatsResult.rows.length} job stats records\n`);

    // Populate recruiter profiles
    const recruitersResult = await recruitingClient.query(`
      SELECT DISTINCT
        s.recruiter_id as user_id,
        s.company_id,
        u.name,
        u.email
      FROM swipes s
      LEFT JOIN users u ON s.recruiter_id = u.id
      WHERE u.id IS NOT NULL
      LIMIT 50
    `);

    console.log(`✓ Found ${recruitersResult.rows.length} recruiter records\n`);

    for (const recruiter of recruitersResult.rows) {
      // Get swipe stats for this recruiter
      const recruiterStats = await recruitingClient.query(`
        SELECT
          COUNT(*) as swipes_count,
          COUNT(CASE WHEN CAST(action AS INTEGER) = 1 THEN 1 END) as accepted,
          COUNT(CASE WHEN CAST(action AS INTEGER) = 0 THEN 1 END) as rejected,
          COALESCE(AVG(CAST(match_score AS NUMERIC)), 0) as average_match_score
        FROM swipes
        WHERE recruiter_id = $1 AND company_id = $2
      `, [recruiter.user_id, recruiter.company_id]);

      const stats = recruiterStats.rows[0] || {};

      const acceptanceRate = stats.swipes_count && stats.swipes_count > 0
        ? (stats.accepted / stats.swipes_count * 100)
        : 0;

      await analyticsClient.query(`
        INSERT INTO analytics_recruiter_profile
        (company_id, user_id, name, email, swipes_count, accepted, rejected, saved,
         acceptance_rate, average_match_score, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          swipes_count = EXCLUDED.swipes_count,
          accepted = EXCLUDED.accepted,
          rejected = EXCLUDED.rejected,
          saved = EXCLUDED.saved,
          acceptance_rate = EXCLUDED.acceptance_rate,
          average_match_score = EXCLUDED.average_match_score,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
      `, [
        recruiter.company_id,
        recruiter.user_id,
        recruiter.name || 'Unknown',
        recruiter.email || null,
        stats.swipes_count || 0,
        stats.accepted || 0,
        stats.rejected || 0,
        0,
        acceptanceRate,
        parseFloat(stats.average_match_score) || 0,
        true,
      ]);
    }

    console.log(`✓ Populated ${recruitersResult.rows.length} recruiter profiles\n`);

    // Verify final state
    const dashboardCount = await analyticsClient.query('SELECT COUNT(*) FROM analytics_dashboard_cache');
    const recentCount = await analyticsClient.query('SELECT COUNT(*) FROM analytics_recent_activity');
    const jobsCount = await analyticsClient.query('SELECT COUNT(*) FROM analytics_job_stats');
    const trendsCountResult = await analyticsClient.query('SELECT COUNT(*) FROM analytics_daily_trends');
    const recruitersCount = await analyticsClient.query('SELECT COUNT(*) FROM analytics_recruiter_profile');

    console.log('✅ Analytics tables populated:\n');
    console.log(`  • analytics_dashboard_cache: ${dashboardCount.rows[0].count} records`);
    console.log(`  • analytics_recent_activity: ${recentCount.rows[0].count} records`);
    console.log(`  • analytics_job_stats: ${jobsCount.rows[0].count} records`);
    console.log(`  • analytics_daily_trends: ${trendsCountResult.rows[0].count} records`);
    console.log(`  • analytics_recruiter_profile: ${recruitersCount.rows[0].count} records`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await recruitingClient.end();
    await analyticsClient.end();
  }
}

populateAnalytics();
