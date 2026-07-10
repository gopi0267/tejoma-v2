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
  const result = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'candidates'
    ORDER BY ordinal_position
  `);
  console.log('Columns in candidates table:');
  result.rows.forEach(r => console.log(`- ${r.column_name}: ${r.data_type}`));
  await pool.end();
}

main().catch(console.error);
