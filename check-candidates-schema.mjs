import pg from 'pg';

const { Client } = pg;

async function checkSchema() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'tejoma_recruiting',
    user: 'postgres',
    password: '3268',
  });

  try {
    await client.connect();

    // Get candidates table schema
    const candidatesSchema = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'candidates'
      ORDER BY ordinal_position
    `);

    console.log('📊 candidates table schema:');
    candidatesSchema.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // Sample some data
    const sample = await client.query('SELECT * FROM candidates LIMIT 1');
    console.log('\n📋 Sample candidate data (fields shown):');
    if (sample.rows.length > 0) {
      const candidate = sample.rows[0];
      Object.keys(candidate).forEach(key => {
        const val = candidate[key];
        if (typeof val === 'string') {
          console.log(`  - ${key}: ${val.substring(0, 50)}`);
        } else {
          console.log(`  - ${key}: ${val}`);
        }
      });
    } else {
      console.log('  (no rows)');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkSchema();
