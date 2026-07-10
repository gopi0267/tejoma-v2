import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import util from 'util';
import { execFile } from 'child_process';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { config } from 'dotenv';
import * as pdf from 'pdf-parse';
import WordExtractor from 'word-extractor';

import { db } from './src/db.js';
import { parseResume } from './parser.service.js';
import { extractEmail } from './emailExtractor.js';
import { extractPhone } from './phoneExtractor.js';
import { extractName } from './nameExtractor.js';
import { candidateSchema } from './src/validation.js';

config({ path: '.env.local' });

const execFilePromise = util.promisify(execFile);
const RESUMES_DIR = path.join(process.cwd(), 'resumes');
const STATUS_FILE = path.join(process.cwd(), 'import-status.json');
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'];

interface ImportStatus {
  completed: string[];
  failed: { [fileName: string]: string };
}

// Load progress from state file
function loadStatus(): ImportStatus {
  if (fs.existsSync(STATUS_FILE)) {
    try {
      const content = fs.readFileSync(STATUS_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error('Error reading status file, starting fresh:', e);
    }
  }
  return { completed: [], failed: {} };
}

// Save progress to state file
function saveStatus(status: ImportStatus) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

// Helper to extract text from Word and TXT files
async function extractText(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);

  if (extension === '.pdf') {
    return '';
  } else if (extension === '.docx' || extension === '.doc') {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(fileBuffer);
    return [
      doc.getBody(),
      doc.getHeaders(),
      doc.getFooters(),
      doc.getTextboxes()
    ].filter(t => t && typeof t === 'string' && t.trim()).join('\n');
  } else if (extension === '.txt') {
    return fileBuffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported extension: ${extension}`);
  }
}

// Generate vector embeddings using Ollama's nomic-embed-text model
async function getEmbeddings(text: string): Promise<number[] | null> {
  try {
    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: `search_document: ${text.slice(0, 8000)}` // Safe context boundary
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama returned status ${response.status}`);
    }
    const result = await response.json() as any;
    return result.embedding || null;
  } catch (err: any) {
    console.error('  ⚠️ Embedding generation failed:', err.message);
    return null;
  }
}

// Execute the Python layout-parsing and NLP extraction child process
async function runPythonExtractor(filePath: string, text: string, jobsParam: string): Promise<any> {
  const pythonBin = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  try {
    const { stdout } = await execFilePromise(pythonBin, [
      'extract_resume_features.py',
      '--file', filePath,
      '--skills', 'skills.json',
      '--text', text,
      '--jobs', jobsParam
    ], { maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer safety
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error('  ⚠️ Python feature extractor process error:', err.message);
    return null;
  }
}

// Score overlap between candidate skills and job requirements
function calculateFeatureScore(skills: string[], requiredSkills: string[]): number {
  if (!requiredSkills || requiredSkills.length === 0) return 100;
  if (!skills || skills.length === 0) return 0;
  const matching = skills.filter(s => 
    requiredSkills.some(rs => rs.toLowerCase() === s.toLowerCase())
  );
  return Math.round((matching.length / requiredSkills.length) * 100);
}

// Global runtime counters
let successCount = 0;
let skipCount = 0;
let failCount = 0;

// Shared Job Processing Core Logic
async function processResumeJob(file: string, resumesDir: string, status: ImportStatus, existingEmails: Set<string>, existingFingerprints: Set<string>, activeJobs: any[], jobsParam: string) {
  const filePath = path.join(resumesDir, file);
  console.log(`⚡ Processing resume: ${file}...`);

  try {
    // 1. Text Layer Extraction
    let text = await extractText(filePath);

    // 2. Run Python Extractor
    const pyResult = await runPythonExtractor(filePath, text, jobsParam);
    if (!pyResult) {
      throw new Error('Python feature extractor failed to return results.');
    }

    if (pyResult.text && pyResult.text.trim()) {
      text = pyResult.text;
    }

    // NER extracts
    const localEmail = pyResult.ner.email !== 'N/A' ? pyResult.ner.email : extractEmail(text);
    const localPhone = pyResult.ner.phone !== 'N/A' ? pyResult.ner.phone : extractPhone(text);
    const localName = pyResult.ner.name !== 'N/A' ? pyResult.ner.name : extractName(text);

    let fingerprintKey = '';
    let emailKey = '';

    if (localEmail && localEmail !== 'N/A') {
      emailKey = localEmail.trim().toLowerCase();
      const nameNorm = localName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const phoneNorm = localPhone.replace(/\D/g, '');
      fingerprintKey = `${nameNorm}|${emailKey}|${phoneNorm}`;
    } else {
      const contactBlock = text.slice(0, 300).replace(/\s+/g, '').toLowerCase();
      const hash = crypto.createHash('sha256').update(contactBlock || localPhone).digest('hex');
      emailKey = `hash_${hash.substring(0, 16)}`;
      const nameNorm = localName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const phoneNorm = localPhone.replace(/\D/g, '');
      fingerprintKey = `${nameNorm}|${emailKey}|${phoneNorm}`;
    }

    let coreDetail = (localEmail && localEmail !== 'N/A') ? localEmail.trim().toLowerCase() : 
                     (localPhone && localPhone !== 'N/A' ? localPhone.replace(/\D/g, '') : 
                      text.slice(0, 300).replace(/\s+/g, '').toLowerCase());
    const candidateHash = crypto.createHash('sha256').update(coreDetail).digest('hex');

    // DB duplicate check
    const existingCandidate = await db.getCandidateByHash(candidateHash);
    if (existingCandidate) {
      console.log(`  ℹ️ DUPLICATE_SKIPPED: Hash found in DB (${candidateHash})`);
      status.completed.push(file);
      delete status.failed[file];
      skipCount++;
      return;
    }

    // Memory duplicate check
    if (existingEmails.has(emailKey) || existingFingerprints.has(fingerprintKey)) {
      console.log(`  ℹ️ DUPLICATE_SKIPPED: Signature match (${emailKey} / ${fingerprintKey})`);
      status.completed.push(file);
      delete status.failed[file];
      skipCount++;
      return;
    }

    // 3. Generate Semantic Text Embeddings
    const embedding = await getEmbeddings(text);

    // 4. Run Sequential LLM Double-Pass Parsing
    const candidate = await parseResume(text, { maxRetries: 5, fallbackToRegex: false });

    let parsedEmail = (candidate.email && candidate.email !== 'N/A' && candidate.email.toLowerCase() !== 'null') ? candidate.email.trim().toLowerCase() : '';
    let parsedPhone = (candidate.phone && candidate.phone !== 'N/A' && candidate.phone.toLowerCase() !== 'null') ? candidate.phone.trim() : '';

    let isVerified = true;

    if (parsedEmail) {
      if (!text.toLowerCase().includes(parsedEmail.toLowerCase())) {
        console.warn(`  ⚠️ Email verbatim check failed! Restoring regex.`);
        parsedEmail = localEmail || emailKey;
        isVerified = false;
      }
    } else {
      parsedEmail = emailKey;
    }

    if (parsedPhone) {
      const number = parsePhoneNumberFromString(parsedPhone, 'IN');
      if (number && number.isValid()) {
        parsedPhone = number.format('E.164');
      } else {
        const cleanPhone = parsedPhone.replace(/\D/g, '');
        if (cleanPhone && !text.replace(/\D/g, '').includes(cleanPhone)) {
          console.warn(`  ⚠️ Phone verbatim check failed! Restoring regex.`);
          parsedPhone = localPhone || 'N/A';
          isVerified = false;
        }
      }
    } else {
      parsedPhone = localPhone || 'N/A';
    }

    candidate.name = candidate.name && candidate.name !== 'N/A' ? candidate.name : (localName || 'N/A');
    candidate.email = parsedEmail;
    candidate.phone = parsedPhone;

    // Merge FlashText/spaCy matched skills into candidates JSON object
    const combinedSkills = new Set<string>();
    if (Array.isArray(candidate.skills)) {
      candidate.skills.forEach((s: string) => combinedSkills.add(s));
    } else if (typeof candidate.skills === 'string') {
      candidate.skills.split(',').forEach((s: string) => combinedSkills.add(s.trim()));
    }
    pyResult.skills.forEach((s: string) => combinedSkills.add(s));
    candidate.skills = Array.from(combinedSkills).filter(s => s);

    // Parse status classification
    let dataStatus = 'Complete';
    if (!isVerified) {
      dataStatus = 'Review Required';
    } else {
      const isContactMissing = !candidate.name || candidate.name.toLowerCase() === 'n/a' ||
                               !candidate.email || candidate.email.startsWith('hash_') || 
                               !candidate.phone || candidate.phone.toLowerCase() === 'n/a';
                               
      const isKeyParamMissing = !candidate.skills || candidate.skills.length === 0 ||
                                !candidate.years_of_experience || candidate.years_of_experience.toLowerCase() === 'n/a' ||
                                !candidate.current_job_title || candidate.current_job_title.toLowerCase() === 'n/a';

      if (isContactMissing || isKeyParamMissing) {
        dataStatus = 'Partial';
      }
    }
    candidate.extraction_status = dataStatus;

    // Validate candidates using Zod validations
    const zodValidation = candidateSchema.safeParse(candidate);
    if (!zodValidation.success) {
      console.warn(`  ⚠️ Zod validation warnings for ${file}:`, zodValidation.error.format());
    }

    // 5. Database Insertion
    const insertedCandidate = await db.createCandidate({
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      skills: candidate.skills,
      primary_skills: candidate.primary_skills,
      secondary_skills: candidate.secondary_skills,
      years_of_experience: candidate.years_of_experience,
      current_location: candidate.current_location,
      preferred_location: candidate.preferred_location,
      current_company: candidate.current_company,
      previous_companies: candidate.previous_companies,
      current_job_title: candidate.current_job_title,
      industry_domain: candidate.industry_domain,
      education: candidate.education,
      highest_qualification: candidate.highest_qualification,
      graduation_year: candidate.graduation_year,
      university: candidate.university,
      certifications: candidate.certifications,
      projects: candidate.projects,
      technical_tools: candidate.technical_tools,
      languages_known: candidate.languages_known,
      current_ctc: candidate.current_ctc,
      expected_ctc: candidate.expected_ctc,
      notice_period: candidate.notice_period,
      willingness_to_relocate: candidate.willingness_to_relocate,
      linkedin_url: candidate.linkedin_url,
      github_or_portfolio_url: candidate.github_or_portfolio_url,
      resume_summary: candidate.resume_summary,
      resume_text: text,
      ai_confidence_score: candidate.ai_confidence_score,
      resume_file_path: file,
      extraction_status: candidate.extraction_status,
      candidate_hash: candidateHash,
      resume_embedding: embedding || undefined
    });

    if (insertedCandidate) {
      status.completed.push(file);
      delete status.failed[file];
      
      const parsedFingerprint = `${candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${candidate.email}|${candidate.phone.replace(/\D/g, '')}`;
      existingEmails.add(candidate.email);
      existingFingerprints.add(parsedFingerprint);
      successCount++;

      // 6. Match Score Calculation and Store (BGE Reranker)
      for (const job of activeJobs) {
        const rerankScore = pyResult.job_scores[String(job.id)] || 0.0;
        const mlScore = Math.round(rerankScore * 100);
        const fScore = calculateFeatureScore(candidate.skills, job.required_skills);
        
        await db.saveMatchScore({
          job_id: job.id,
          candidate_id: insertedCandidate.id,
          feature_score: fScore,
          embedding_score: mlScore,
          ml_score: mlScore,
          final_score: Math.round((fScore + mlScore) / 2),
          rank: 1
        });
      }

      console.log(`  ✅ Candidate successfully imported: ${candidate.name} (${candidate.email})`);
    } else {
      throw new Error('Database insertion returned null.');
    }
  } catch (e: any) {
    failCount++;
    const errorMsg = e.message || String(e);
    status.failed[file] = errorMsg;
    console.error(`  ❌ Parsing failure for ${file}:`, errorMsg);
    fs.appendFileSync('import_errors.log', `[${new Date().toISOString()}] File: ${file} - Error: ${errorMsg}\n`, 'utf-8');
    throw e;
  } finally {
    saveStatus(status);
  }
}

async function startImport() {
  console.log('🚀 Starting Advanced Resume Import CLI Script...');
  console.log(`📂 Resumes directory: ${RESUMES_DIR}`);

  if (!fs.existsSync(RESUMES_DIR)) {
    console.error('❌ Resumes directory not found!');
    process.exit(1);
  }

  const status = loadStatus();

  // Fresh tables boot if progress is empty
  if (status.completed.length === 0) {
    console.log('🔄 Wiping out database tables (TRUNCATE) because import is starting from scratch...');
    await db.truncateAll();
    console.log('✅ Database tables truncated.');
  } else {
    console.log('📊 Resuming progress status. Skipping database truncation.');
  }

  // Load existing database candidates
  const existingCandidates = await db.getCandidates();
  const existingEmails = new Set(existingCandidates.map((c) => c.email.toLowerCase()));
  console.log(`📊 Found ${existingEmails.size} unique candidate emails already in database.`);

  const existingFingerprints = new Set<string>();
  existingCandidates.forEach(cand => {
    const nameNorm = cand.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const emailNorm = cand.email.toLowerCase().trim();
    const phoneNorm = cand.phone.replace(/\D/g, '');
    const signature = `${nameNorm}|${emailNorm}|${phoneNorm}`;
    existingFingerprints.add(signature);
  });

  // Get files
  const allFiles = fs.readdirSync(RESUMES_DIR);
  const resumeFiles = allFiles.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  });

  const filesToProcess = resumeFiles.filter((file) => !status.completed.includes(file));
  console.log(`🔍 Found ${resumeFiles.length} supported resume files, ${filesToProcess.length} remaining.`);

  if (filesToProcess.length === 0) {
    console.log('✅ All resumes already processed!');
    process.exit(0);
  }

  // Load active jobs for batch BGE matching
  const activeJobs = await db.getJobs();
  const jobsParam = JSON.stringify(activeJobs.map(j => ({ id: j.id, description: j.description })));

  // Test Redis connection for BullMQ
  let redisConnection: any = null;
  let useBullMQ = false;

  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379');
  
  try {
    redisConnection = new Redis({
      host: redisHost,
      port: redisPort,
      connectTimeout: 2000, // Fail fast if Redis server is not running
      lazyConnect: true
    });
    
    await redisConnection.connect();
    useBullMQ = true;
    console.log(`🔌 Connected to Redis server at ${redisHost}:${redisPort}. Using BullMQ queue.`);
  } catch (err: any) {
    console.log(`🔌 Redis not running at ${redisHost}:${redisPort}. Falling back to high-accuracy local queue.`);
    if (redisConnection) {
      redisConnection.disconnect();
      redisConnection = null;
    }
  }

  if (useBullMQ && redisConnection) {
    // ----------------------------------------------------
    // BULLMQ MODE
    // ----------------------------------------------------
    await resumeQueue.obliterate({ force: true });

    // Enqueue jobs
    for (const file of filesToProcess) {
      await resumeQueue.add('import-resume-job', { fileName: file });
    }
    console.log(`📥 Enqueued ${filesToProcess.length} jobs in BullMQ queue "${queueName}".`);

    // Worker
    const worker = new Worker(queueName, async (job) => {
      await processResumeJob(job.data.fileName, RESUMES_DIR, status, existingEmails, existingFingerprints, activeJobs, jobsParam);
    }, {
      connection: redisConnection,
      concurrency: 1 // Sequential safety
    });

    const waitForQueueDrain = () => {
      const checkStatus = async () => {
        const counts = await resumeQueue.getJobCounts('active', 'waiting', 'delayed');
        const remaining = counts.active + counts.waiting + counts.delayed;
        if (remaining === 0) {
          console.log('\n=============================================');
          console.log('🎉 BullMQ Ingestion Queue Completed!');
          console.log(`✅ Successes in this run: ${successCount}`);
          console.log(`ℹ️ Skipped duplicates: ${skipCount}`);
          console.log(`❌ Failures in this run: ${failCount}`);
          console.log(`📈 Overall: ${status.completed.length} imported, ${Object.keys(status.failed).length} failed.`);
          console.log('=============================================\n');
          
          await worker.close();
          await resumeQueue.close();
          await db.closeConnection();
          await redisConnection.disconnect();
          process.exit(0);
        } else {
          setTimeout(checkStatus, 2000);
        }
      };
      setTimeout(checkStatus, 2000);
    };

    waitForQueueDrain();

  } else {
    // ----------------------------------------------------
    // LOCAL FALLBACK QUEUE MODE
    // ----------------------------------------------------
    console.log('⚙️ Running in sequential local fallback queue mode...');
    
    for (const file of filesToProcess) {
      try {
        await processResumeJob(file, RESUMES_DIR, status, existingEmails, existingFingerprints, activeJobs, jobsParam);
      } catch (err: any) {
        // Log handled in processResumeJob, continue to next file
      }
    }

    console.log('\n=============================================');
    console.log('🎉 Local Ingestion Completed!');
    console.log(`✅ Successes in this run: ${successCount}`);
    console.log(`ℹ️ Skipped duplicates: ${skipCount}`);
    console.log(`❌ Failures in this run: ${failCount}`);
    console.log(`📈 Overall: ${status.completed.length} imported, ${Object.keys(status.failed).length} failed.`);
    console.log('=============================================\n');
    
    await db.closeConnection();
    process.exit(0);
  }
}

startImport().catch((err) => {
  console.error('Fatal error in import queue setup:', err);
  process.exit(1);
});
