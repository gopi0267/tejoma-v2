import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tejoma_recruiting',
  user: 'postgres',
  password: '3268',
});

async function main() {
  try {
    console.log('🔄 Altering all candidates columns to TEXT to prevent length constraints...');
    const alterQuery = `
      ALTER TABLE candidates 
        ALTER COLUMN name TYPE TEXT,
        ALTER COLUMN email TYPE TEXT,
        ALTER COLUMN phone TYPE TEXT,
        ALTER COLUMN years_of_experience TYPE TEXT,
        ALTER COLUMN current_location TYPE TEXT,
        ALTER COLUMN preferred_location TYPE TEXT,
        ALTER COLUMN current_company TYPE TEXT,
        ALTER COLUMN current_job_title TYPE TEXT,
        ALTER COLUMN industry_domain TYPE TEXT,
        ALTER COLUMN education TYPE TEXT,
        ALTER COLUMN highest_qualification TYPE TEXT,
        ALTER COLUMN graduation_year TYPE TEXT,
        ALTER COLUMN university TYPE TEXT,
        ALTER COLUMN current_ctc TYPE TEXT,
        ALTER COLUMN expected_ctc TYPE TEXT,
        ALTER COLUMN notice_period TYPE TEXT,
        ALTER COLUMN willingness_to_relocate TYPE TEXT,
        ALTER COLUMN linkedin_url TYPE TEXT,
        ALTER COLUMN github_or_portfolio_url TYPE TEXT,
        ALTER COLUMN ai_confidence_score TYPE TEXT,
        ALTER COLUMN resume_file_path TYPE TEXT,
        ALTER COLUMN extraction_status TYPE TEXT
    `;
    await pool.query(alterQuery);
    console.log('✅ Successfully converted all columns to TEXT!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Alter failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

main();
