// Ported from the monolith's root-level parser.service.ts - same two-pass Gemini pipeline, same
// system instructions, same schema, same regex-fallback extractors, same post-extraction sanity
// checks. Only the imports changed (extractors are now local to this service, and GEMINI_API_KEY
// comes from config/env.ts's fail-fast-checked export rather than reading process.env directly).
import { GoogleGenAI, Type } from '@google/genai';
import { extractEmail } from './emailExtractor.js';
import { extractPhone } from './phoneExtractor.js';
import { extractSkills } from './skillsExtractor.js';
import { extractName } from './nameExtractor.js';
import { calculateExperienceFromText } from './dateParser.js';
import { GEMINI_API_KEY } from '../config/env.js';

// Only this model is currently reachable on the available API key(s) - every other tier
// (2.5-flash/pro, 2.0-flash*, 3.5-flash, 3-pro-preview, 3.1-pro-preview, pro-latest) returns
// either a 404 (retired for new users) or 429 (quota exceeded), confirmed across two separate
// API keys. If billing/quota is upgraded later, swap this constant - nothing else needs to change.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// How long a single Gemini call is allowed to run before we give up and error out clearly.
const GEMINI_CALL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
// Cloud calls can hit transient 429 (quota burst)/503 (overloaded) errors that succeed on retry -
// unlike the old local-Ollama path, retrying here is cheap and fast, so we do it automatically
// instead of failing the whole resume on a blip.
const MAX_GEMINI_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Gemini's structured-output schema (its equivalent of Ollama's `format` JSON-schema constraint).
// Mirrors the same 32-column master sequence so every field is forced to be present in the response.
const WORK_HISTORY_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    company: { type: Type.STRING, nullable: true },
    title: { type: Type.STRING, nullable: true },
    start_date: { type: Type.STRING, nullable: true },
    end_date: { type: Type.STRING, nullable: true },
    is_current: { type: Type.BOOLEAN },
  },
  required: ['company', 'title', 'start_date', 'end_date', 'is_current'],
};

const PROJECT_ENTRY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, nullable: true },
    description: { type: Type.STRING, nullable: true },
    technologies: { type: Type.ARRAY, items: { type: Type.STRING } },
    start_date: { type: Type.STRING, nullable: true },
    end_date: { type: Type.STRING, nullable: true },
  },
  required: ['name', 'description', 'technologies', 'start_date', 'end_date'],
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    Name: { type: Type.STRING, nullable: true },
    Email: { type: Type.STRING, nullable: true },
    Phone: { type: Type.STRING, nullable: true },
    Skills: { type: Type.STRING, nullable: true },
    Primary_Skills: { type: Type.STRING, nullable: true },
    Secondary_Skills: { type: Type.STRING, nullable: true },
    Years_of_Experience: { type: Type.STRING, nullable: true },
    Current_Location: { type: Type.STRING, nullable: true },
    Preferred_Location: { type: Type.STRING, nullable: true },
    Current_Company: { type: Type.STRING, nullable: true },
    Previous_Companies: { type: Type.STRING, nullable: true },
    Current_Job_Title: { type: Type.STRING, nullable: true },
    Industry_Domain: { type: Type.STRING, nullable: true },
    Education: { type: Type.STRING, nullable: true },
    Highest_Qualification: { type: Type.STRING, nullable: true },
    Graduation_Year: { type: Type.STRING, nullable: true },
    University: { type: Type.STRING, nullable: true },
    Certifications: { type: Type.STRING, nullable: true },
    Projects: { type: Type.STRING, nullable: true },
    Technical_Tools: { type: Type.STRING, nullable: true },
    Languages_Known: { type: Type.STRING, nullable: true },
    Current_CTC: { type: Type.STRING, nullable: true },
    Expected_CTC: { type: Type.STRING, nullable: true },
    Notice_Period: { type: Type.STRING, nullable: true },
    Willingness_to_Relocate: { type: Type.STRING, nullable: true },
    LinkedIn_URL: { type: Type.STRING, nullable: true },
    GitHub_or_Portfolio_URL: { type: Type.STRING, nullable: true },
    Resume_Summary: { type: Type.STRING, nullable: true },
    AI_Confidence_Score: { type: Type.STRING, nullable: true },
    Data_Status: { type: Type.STRING, nullable: true },
    Work_History: { type: Type.ARRAY, items: WORK_HISTORY_ITEM_SCHEMA },
    Project_Entries: { type: Type.ARRAY, items: PROJECT_ENTRY_SCHEMA },
  },
  required: [
    'Name', 'Email', 'Phone', 'Skills', 'Primary_Skills', 'Secondary_Skills',
    'Years_of_Experience', 'Current_Location', 'Preferred_Location', 'Current_Company',
    'Previous_Companies', 'Current_Job_Title', 'Industry_Domain', 'Education',
    'Highest_Qualification', 'Graduation_Year', 'University', 'Certifications',
    'Projects', 'Technical_Tools', 'Languages_Known', 'Current_CTC', 'Expected_CTC',
    'Notice_Period', 'Willingness_to_Relocate', 'LinkedIn_URL', 'GitHub_or_Portfolio_URL',
    'Resume_Summary', 'AI_Confidence_Score', 'Data_Status', 'Work_History', 'Project_Entries',
  ],
};

const SYSTEM_INSTRUCTION = `You are an elite, production-grade Resume Parsing AI. Your absolute core directive is ZERO DATA LOSS. Missing, omitting, or truncating details or lists directly results in revenue loss for our company. You must extract every single item, word, and technical detail with 100% fidelity.

Analyze the raw resume text provided at the end and map the data precisely into a single, valid JSON object following the 32-column schema specified below (Resume_Text is added programmatically afterward, not by you).

EXTRACTION LAWS:
1. DO NOT TRUNCATE OR SUMMARIZE arrays or skill sections (Never use "...", "etc.", or "and others"). If a candidate lists 50 tools, you must extract all 50.
2. Maintain exact spelling, capitalization, and formatting as present in the original text.
3. If an explicit column data point cannot be found anywhere in the text, map its value strictly as null (do not use string "NULL", use the JSON null literal).
4. SEPARATOR RULE: Previous_Companies and Certifications specifically must use SEMICOLONS between items (e.g., "Company A; Company B; Company C"). Skills, Primary_Skills, Secondary_Skills, Technical_Tools, and Languages_Known must specifically use COMMAS between items (e.g., "Python, Java, SQL") - do NOT use semicolons for these skill/tool fields even though Previous_Companies/Certifications use semicolons. Getting this wrong merges an entire list into one unusable item.
5. YEARS OF EXPERIENCE (accuracy-critical, two-tier rule):
   a. FIRST, check if the resume itself explicitly states a total years-of-experience figure anywhere (e.g. a summary/profile line like "6+ years of experience" or "Total Experience: 8 years"). If such a statement exists, that is the authoritative answer - use it, since it reflects what the candidate meant at the time they wrote the resume.
   b. ONLY IF no such explicit statement exists anywhere in the text, calculate it yourself from the chronological employment blocks (e.g., '2023 - 2026' or '06.2023 - Present'). Do NOT assume "Present"/"Till date"/"Current" means today's real-world date - resumes are historical documents that may have been written years ago. Instead, treat the LATEST year mentioned anywhere in the resume's own employment history as the effective "Present" for that calculation, so you don't inflate experience for an old resume. Sum the durations and output a clear number or string (e.g., '3 Years').
   NEVER fall back to 'Not specified' if either an explicit statement or dates are present anywhere in the text.
6. IMPLICIT FEATURE DEDUCTION: If any secondary feature is implicit in the text (such as Location inferred from a known local company name), you must deduce it rather than outputting null.
7. ROW-BY-ROW SCHEMA ALIGNMENT: Ensure strict row-by-row structural alignment matching our exact master sequence: Name, Email, Phone, Skills, Primary_Skills, Secondary_Skills, Years_of_Experience, Current_Location, Preferred_Location, Current_Company, Previous_Companies, Current_Job_Title, Industry_Domain, Education, Highest_Qualification, Graduation_Year, University, Certifications, Projects, Technical_Tools, Languages_Known, Current_CTC, Expected_CTC, Notice_Period, Willingness_to_Relocate, LinkedIn_URL, GitHub_or_Portfolio_URL, Resume_Summary, AI_Confidence_Score, Data_Status, Work_History, Project_Entries.
8. VERBATIM COPY RULE (NO AUTOCORRECT): You are forbidden from normalizing, correcting, or abbreviating email addresses. You must perform VERBATIM EXTRACTION. The email string must be character-for-character identical to the text provided in the resume. Never truncate, never guess, and never use common-word patterns to shorten names. The contact group (Email, Phone, LinkedIn_URL, GitHub_or_Portfolio_URL) must follow this strict verbatim extraction law.
9. SKILL EXTRACTION AUDIT: Perform an aggressive keyword audit on the Skills, Primary_Skills, and Technical_Tools fields. Ensure advanced variations and industry roles (like 'Salesforce QA', 'SDET', 'Automation Testing', 'SDET-Automation') are explicitly maintained instead of being collapsed into a generic tool word. Do not drop any skill that appears anywhere in the resume text, including ones mentioned only once in a sentence rather than listed in a dedicated "Skills" section.
10. EMPLOYER vs CLIENT DISAMBIGUATION (critical for staffing/consulting-style resumes): Many resumes (especially IT consulting/staffing formats) list project blocks with BOTH a "Client:"/"Customer:" name AND an "Organization:"/"Employer:"/"Company:" name. The "Client" is who the work was performed FOR (an end customer), NOT who employed the candidate. Current_Company and Previous_Companies must contain ONLY the actual employer/organization names (deduplicated - if the same employer appears across multiple project blocks, list it once), NEVER the client names. Client names belong only in the Projects field, not in Current_Company/Previous_Companies.
11. Current_Company is the employer of the MOST RECENT/current role (e.g. still "Till date"/"Present", or the latest date range). Previous_Companies is every OTHER distinct past employer, semicolon-separated, excluding whichever one you already placed in Current_Company.
12. WORK_HISTORY (structured, dated - separate from and in addition to Current_Company/Previous_Companies above, which stay exactly as already specified): one array entry per distinct employment block in the resume, each with company, title, start_date, end_date, is_current. Dates MUST be formatted as "YYYY-MM" (e.g. "2021-06") when the resume states a month and year; if only a year is given, do NOT invent a month like "YYYY-01" - instead set start_date/end_date to just "YYYY" (four digits only, no fabricated month). If a date cannot be determined at all, use JSON null - never guess a date the text does not support. is_current is true only for a role explicitly marked "Present"/"Till date"/"Current" (or with no end date and it is the most recent block); end_date must be null whenever is_current is true, never a fabricated date. If the resume states no parseable employment dates anywhere, return an empty array [], not fabricated entries.
13. PROJECT_ENTRIES (structured, decomposed - separate from and in addition to the flat Projects string field above, which stays exactly as already specified and must still contain the full original project text): decompose the same project information into individual entries, one per distinct project, each with name, description (a concise 1-3 sentence summary of what the project involved, drawn only from the resume's own text - never invented), technologies (the specific technologies/tools/frameworks named in connection with that project, as an array), start_date, end_date (same "YYYY-MM"/"YYYY"/null format and no-fabrication rule as Work_History above - most resumes do not date individual projects, and null is the correct, expected answer far more often than not). If the resume's project section cannot be reasonably split into distinct projects (e.g. it is truly one continuous undifferentiated block), return a single entry covering it rather than fabricating an artificial split. If there is no project information at all, return an empty array [].`;

const AUDIT_SYSTEM_INSTRUCTION = `You are a meticulous Resume Extraction Auditor. You will be given the ORIGINAL raw resume text and a DRAFT JSON extraction of it (32 fields). Your job is to re-read the original text line by line and correct the draft, NOT to start over blindly.

RULES:
1. Treat the draft as a first attempt that may have MISSED skills, tools, certifications, previous companies, or miscalculated Years_of_Experience. Cross-check every field against the raw text.
2. If you find any skill, tool, technology, certification, or company mentioned anywhere in the raw text (including inside prose/sentences, not just bullet lists) that is missing from the draft's Skills/Primary_Skills/Secondary_Skills/Technical_Tools/Certifications/Previous_Companies fields, ADD it. Never remove a correct item the draft already found.
3. Re-verify Years_of_Experience: if the resume explicitly states a total (e.g. "6+ years of experience"), that stated figure is authoritative and should override any date-math the draft did. Otherwise, independently sum the employment date ranges found in the text, treating the LATEST year mentioned anywhere in the resume (not today's real-world date) as "Present"/"Till date" - correct the draft if its math or its assumed "current date" is wrong.
4. Re-verify Email and Phone are character-for-character identical to what appears in the raw text (verbatim, no autocorrect). If the draft altered them, restore the exact original text.
5. If the draft is already fully correct and complete for a field, keep it unchanged - do not invent new values that are not supported by the text.
6. Re-verify Current_Company/Previous_Companies contain ONLY actual employer/organization names, never "Client:"/"Customer:" names from project blocks (those belong only in Projects). If the draft mistakenly included a client name as a company, remove it. Ensure Previous_Companies is semicolon-separated with each distinct past employer listed once.
7. Re-verify Work_History against the raw text: every employment block you can identify should have a corresponding entry, with dates matching the "YYYY-MM"/"YYYY"/null rules (never a fabricated month). Re-verify Project_Entries similarly - add a missed project, but never invent technologies or dates a project's own text doesn't support. If the draft left either array empty when the text clearly supports entries, populate it; if the draft fabricated a date, correct it to null rather than removing the entry.
8. Output the corrected, complete 32-field JSON object using the exact same schema and field names as the draft. Never use "...", "etc." or truncate lists.`;

function buildExtractionPrompt(resumeText: string): string {
  return `Parse the raw resume text provided at the end and map the data precisely into a single, valid JSON object matching the 32-column required schema parameters.

CRITICAL OUTPUT CONSTRAINT:
Return ONLY the raw JSON object matching the provided schema. Do not provide introductory or concluding conversational prose.

INPUT RESUME TEXT TO PARSE:
${resumeText}`;
}

function buildAuditPrompt(resumeText: string, draftJson: any): string {
  return `ORIGINAL RAW RESUME TEXT:
${resumeText}

DRAFT JSON EXTRACTION TO AUDIT AND CORRECT:
${JSON.stringify(draftJson)}

Re-check the draft against the original text field by field per your instructions and return the corrected, complete JSON object matching the same schema.`;
}

interface GeminiCallOptions {
  signal?: AbortSignal;
}

async function queryGemini(systemInstruction: string, promptText: string, options: GeminiCallOptions = {}): Promise<any> {
  const { signal } = options;

  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_GEMINI_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request cancelled - client disconnected');
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), GEMINI_CALL_TIMEOUT_MS);

    const onExternalAbort = () => timeoutController.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: promptText,
        config: {
          systemInstruction,
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          abortSignal: timeoutController.signal,
        },
      });

      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);

      const text = response.text;
      if (!text) {
        throw new Error('Gemini returned an empty response');
      }
      return JSON.parse(text);
    } catch (err: any) {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
      lastError = err;

      if (signal?.aborted) {
        throw new Error('Request cancelled - client disconnected');
      }

      const status = err?.status ?? err?.error?.code;
      const isRetryable = status === 429 || status === 503 || status === 500 || /overloaded|unavailable/i.test(String(err?.message));

      if (isRetryable && attempt < MAX_GEMINI_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * attempt;
        console.warn(`  ⚠️ Gemini call attempt ${attempt} failed (${err?.message || err}). Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

export async function parseResume(resumeText: string, options?: { maxRetries?: number; fallbackToRegex?: boolean; signal?: AbortSignal }) {
  const fallbackToRegex = options?.fallbackToRegex !== false;
  const signal = options?.signal;

  try {
    // Pass 1: primary extraction against the 30-field schema.
    console.log('📡 Running Gemini Pass 1 (extraction)...');
    const draftResult = await queryGemini(SYSTEM_INSTRUCTION, buildExtractionPrompt(resumeText), { signal });
    console.log('  🤖 Gemini Pass 1 complete.');

    // Pass 2: dedicated audit/cross-check pass against the original text, catching anything
    // Pass 1 missed.
    let finalResult = draftResult;
    try {
      console.log('📡 Running Gemini Pass 2 (audit/cross-check)...');
      finalResult = await queryGemini(AUDIT_SYSTEM_INSTRUCTION, buildAuditPrompt(resumeText, draftResult), { signal });
      console.log('  🤖 Gemini Pass 2 complete.');
    } catch (auditErr) {
      console.error('  ⚠️ Gemini Pass 2 (audit) failed, using Pass 1 draft result:', auditErr);
    }

    const getField = (key: string) => {
      const val = finalResult?.[key] ?? draftResult?.[key];
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      return s === '' || s.toLowerCase() === 'null' ? null : s;
    };

    const parseList = (val: any, sep: RegExp = /[,;]/) => {
      if (val === undefined || val === null) return [];
      const s = String(val).trim();
      if (s === '' || s.toLowerCase() === 'null') return [];
      return s.split(sep).map(item => item.trim()).filter(item => item);
    };

    const DATE_PATTERN = /^\d{4}(-\d{2})?$/;
    const normalizeDateField = (val: any): string | null => {
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      if (s === '' || s.toLowerCase() === 'null') return null;
      return DATE_PATTERN.test(s) ? s : null;
    };
    const normalizeText = (val: any): string | null => {
      if (typeof val !== 'string') return null;
      const s = val.trim();
      return s === '' || s.toLowerCase() === 'null' ? null : s;
    };
    const normalizeWorkHistory = (val: any) => {
      if (!Array.isArray(val)) return [];
      return val
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          company: normalizeText(item.company),
          title: normalizeText(item.title),
          start_date: normalizeDateField(item.start_date),
          end_date: normalizeDateField(item.end_date),
          is_current: Boolean(item.is_current),
        }))
        .filter((entry) => entry.company || entry.title);
    };
    const normalizeProjectEntries = (val: any) => {
      if (!Array.isArray(val)) return [];
      return val
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          name: normalizeText(item.name),
          description: normalizeText(item.description) || '',
          technologies: Array.isArray(item.technologies)
            ? item.technologies.map((t: any) => String(t).trim()).filter((t: string) => t)
            : [],
          start_date: normalizeDateField(item.start_date),
          end_date: normalizeDateField(item.end_date),
        }))
        .filter((entry) => entry.name || entry.description);
    };
    const workHistoryVal = normalizeWorkHistory(finalResult?.Work_History?.length ? finalResult.Work_History : draftResult?.Work_History);
    const projectEntriesVal = normalizeProjectEntries(finalResult?.Project_Entries?.length ? finalResult.Project_Entries : draftResult?.Project_Entries);

    const allSkillsList: string[] = [];
    [draftResult, finalResult].forEach(res => {
      if (res && res.Skills) {
        const list = String(res.Skills).split(/[,;]/).map((s: string) => s.trim()).filter((s: string) => s && s.toLowerCase() !== 'null');
        allSkillsList.push(...list);
      }
    });
    const seenSkills = new Set<string>();
    const uniqueSkills: string[] = [];
    allSkillsList.forEach(skill => {
      const lower = skill.toLowerCase();
      if (!seenSkills.has(lower)) {
        seenSkills.add(lower);
        uniqueSkills.push(skill);
      }
    });

    let nameVal = getField('Name') || extractName(resumeText);
    let emailVal = getField('Email') || extractEmail(resumeText);
    let phoneVal = getField('Phone') || extractPhone(resumeText);
    const skillsVal = uniqueSkills.length > 0 ? uniqueSkills : extractSkills(resumeText);

    let expVal = getField('Years_of_Experience');
    const programmaticExp = calculateExperienceFromText(resumeText);
    if (!expVal || expVal.toLowerCase() === 'n/a' || expVal.toLowerCase() === 'not specified' || expVal.toLowerCase() === 'null') {
      expVal = programmaticExp;
    }

    const titleVal = getField('Current_Job_Title');

    let dataStatus = 'Complete';

    if (emailVal && emailVal !== 'N/A' && !emailVal.startsWith('hash_')) {
      const cleanEmail = emailVal.trim().toLowerCase();
      if (!resumeText.toLowerCase().includes(cleanEmail)) {
        console.warn(`⚠️ Post-Extraction sanity check failed! Extracted email "${emailVal}" is not present in raw resume text. Discarding email extraction.`);
        emailVal = 'N/A';
        dataStatus = 'Review Required';
      }
    }

    const isContactMissing = !nameVal || nameVal.toLowerCase() === 'n/a' ||
                             !emailVal || emailVal.startsWith('hash_') ||
                             !phoneVal || phoneVal.toLowerCase() === 'n/a';

    const isKeyParamMissing = !skillsVal || skillsVal.length === 0 ||
                              !expVal || expVal.toLowerCase() === 'n/a' ||
                              !titleVal || titleVal.toLowerCase() === 'n/a';

    if (isContactMissing || isKeyParamMissing) {
      if (dataStatus !== 'Review Required') {
        dataStatus = 'Partial';
      }
    }

    return {
      name: nameVal,
      email: emailVal,
      phone: phoneVal,
      skills: skillsVal,
      primary_skills: getField('Primary_Skills'),
      secondary_skills: getField('Secondary_Skills'),
      years_of_experience: expVal,
      current_location: getField('Current_Location'),
      preferred_location: getField('Preferred_Location'),
      current_company: getField('Current_Company'),
      previous_companies: parseList(getField('Previous_Companies')),
      current_job_title: titleVal,
      industry_domain: getField('Industry_Domain'),
      education: getField('Education'),
      highest_qualification: getField('Highest_Qualification'),
      graduation_year: getField('Graduation_Year'),
      university: getField('University'),
      certifications: parseList(getField('Certifications')),
      projects: getField('Projects'),
      technical_tools: getField('Technical_Tools'),
      languages_known: getField('Languages_Known'),
      current_ctc: getField('Current_CTC'),
      expected_ctc: getField('Expected_CTC'),
      notice_period: getField('Notice_Period'),
      willingness_to_relocate: getField('Willingness_to_Relocate'),
      linkedin_url: getField('LinkedIn_URL'),
      github_or_portfolio_url: getField('GitHub_or_Portfolio_URL'),
      resume_summary: getField('Resume_Summary'),
      resume_text: resumeText,
      ai_confidence_score: getField('AI_Confidence_Score') || '90%',
      extraction_status: dataStatus,
      work_history: workHistoryVal,
      project_entries: projectEntriesVal,
    };
  } catch (error) {
    console.error('Error parsing resume with Gemini:', error);
    if (!fallbackToRegex) {
      throw error;
    }
    return getFallbackData(resumeText);
  }
}

function getFallbackData(resumeText: string) {
  return {
    name: extractName(resumeText),
    email: extractEmail(resumeText),
    phone: extractPhone(resumeText),
    skills: extractSkills(resumeText),
    primary_skills: null,
    secondary_skills: null,
    years_of_experience: calculateExperienceFromText(resumeText),
    current_location: null,
    preferred_location: null,
    current_company: null,
    previous_companies: [],
    current_job_title: null,
    industry_domain: null,
    education: null,
    highest_qualification: null,
    graduation_year: null,
    university: null,
    certifications: [],
    projects: null,
    technical_tools: null,
    languages_known: null,
    current_ctc: null,
    expected_ctc: null,
    notice_period: null,
    willingness_to_relocate: null,
    linkedin_url: null,
    github_or_portfolio_url: null,
    resume_summary: null,
    resume_text: resumeText,
    ai_confidence_score: '50%',
    extraction_status: 'Partial',
    work_history: [],
    project_entries: [],
  };
}
