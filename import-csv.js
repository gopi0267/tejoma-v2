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

async function importCandidates() {
  try {
    // Read CSV file
    const filePath = path.join(process.cwd(), 'resumedata.csv');
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Found ${records.length} records to import...`);

    // Insert each candidate
    for (const record of records) {
      // Parse skills array
      const skills = record.Skills
        ? record.Skills.split(',').map(s => s.trim())
        : [];

      // Parse previous companies array
      const prevCompanies = record.Previous_Companies
        ? record.Previous_Companies.split(',').map(c => c.trim())
        : [];

      // Parse salary (convert "22-25 Lakhs" to 23.5 lakhs or similar)
      let salaryExpectation = 0;
      if (record.Salary_Expectation) {
        const salaryStr = record.Salary_Expectation.toLowerCase();
        if (salaryStr.includes('lakhs')) {
          const match = salaryStr.match(/(\d+)-(\d+)/);
          if (match) {
            const min = parseInt(match[1]);
            const max = parseInt(match[2]);
            salaryExpectation = ((min + max) / 2) * 100000; // Convert lakhs to actual salary
          }
        }
      }

      // Parse years of experience
      const yearsStr = record.Years_of_Experience || '0';
      const yearsOfExp = parseInt(yearsStr) || 0;

      // Parse willingness to relocate
      const willRelocate = record.Willingness_to_Relocate?.toLowerCase() === 'yes' ? true : false;

      // Parse certifications array
      const certs = record.Certifications
        ? [record.Certifications.trim()]
        : [];

      // Insert into database
      await pool.query(
        `INSERT INTO candidates 
         (name, email, phone, skills, years_of_experience, current_location, 
          current_company, previous_companies, current_job_title, salary_expectation, 
          education, notice_period, willingness_to_relocate, industry_domain, certifications, resume_text) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          record.Name,
          record.Email,
          record.Phone,
          skills,
          yearsOfExp,
          record.Current_Location,
          record.Current_Company,
          prevCompanies,
          record.Current_Job_Title,
          salaryExpectation,
          record.Education,
          record.Notice_Period,
          willRelocate,
          record.Industry_Domain,
          certs,
          `${record.Current_Job_Title} at ${record.Current_Company}. Skills: ${skills.join(', ')}`,
        ]
      );

      console.log(`✓ Imported: ${record.Name}`);
    }

    console.log(`\n✅ Successfully imported ${records.length} candidates!`);
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

importCandidates();