import fs from 'fs';
import path from 'path';
import pkg from 'pg';
import { parse } from 'csv-parse/sync';

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
    console.log('🔄 Cleaning up imported candidates for a fresh high-accuracy run...');

    // 1. Gather original seed emails from resumedata.csv
    const csvPath = path.join(process.cwd(), 'resumedata.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const csvRecords = parse(csvContent, { columns: true, skip_empty_lines: true });
    const seedEmails = new Set(csvRecords.map((r) => r.Email.toLowerCase().trim()));

    // 2. Gather original mock emails from db_store.json
    const dbStorePath = path.join(process.cwd(), 'db_store.json');
    if (fs.existsSync(dbStorePath)) {
      const dbStore = JSON.parse(fs.readFileSync(dbStorePath, 'utf-8'));
      if (dbStore.candidates) {
        dbStore.candidates.forEach((c) => {
          if (c.email) {
            seedEmails.add(c.email.toLowerCase().trim());
          }
        });
      }
    }

    console.log(`Loaded ${seedEmails.size} original seed emails to protect.`);

    // 3. Fetch all current candidates
    const allCandResult = await pool.query('SELECT id, email FROM candidates');
    const candidates = allCandResult.rows;

    const toDelete = [];
    for (const cand of candidates) {
      const email = cand.email.toLowerCase().trim();
      // If candidate is not a seed candidate, schedule for deletion
      if (!seedEmails.has(email)) {
        toDelete.push(cand.id);
      }
    }

    console.log(`Found ${toDelete.length} imported candidates to delete.`);

    if (toDelete.length > 0) {
      const placeholders = toDelete.map((_, idx) => `$${idx + 1}`).join(',');
      // First delete associated swipes and match scores to avoid foreign key violations
      await pool.query(`DELETE FROM swipes WHERE candidate_id IN (${placeholders})`, toDelete);
      await pool.query(`DELETE FROM match_scores WHERE candidate_id IN (${placeholders})`, toDelete);
      await pool.query(`DELETE FROM candidates WHERE id IN (${placeholders})`, toDelete);
      console.log('✅ Successfully deleted imported candidates and associated swipes/scores.');
    } else {
      console.log('ℹ️ No candidates needed deletion.');
    }

    // 4. Reset import-status.json
    const statusPath = path.join(process.cwd(), 'import-status.json');
    const freshStatus = { completed: [], failed: {} };
    fs.writeFileSync(statusPath, JSON.stringify(freshStatus, null, 2), 'utf-8');
    console.log('✅ Reset import-status.json to initial empty state.');

    await pool.end();
    console.log('🎉 Cleanup complete. Ready for a clean high-accuracy import!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

main();
