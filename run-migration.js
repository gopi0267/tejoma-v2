import fs from 'fs';
import path from 'path';
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
    console.log('🚀 Running database migration script...');
    const sqlPath = path.join(process.cwd(), 'migration-31-cols.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    await pool.query(sqlContent);
    console.log('✅ Database migration executed successfully! Tables recreated.');
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

main();
