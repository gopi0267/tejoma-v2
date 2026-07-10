import http from 'http';
import { config } from 'dotenv';
import { extractEmail } from './emailExtractor.js';
import { extractPhone } from './phoneExtractor.js';
import { extractSkills } from './skillsExtractor.js';
import { extractName } from './nameExtractor.js';
import { calculateExperienceFromText } from './src/utils/dateParser.js';

config({ path: '.env.local' });

// How long a single Ollama call is allowed to run before we give up and error out clearly,
// instead of hanging silently forever (which is what was happening before this fix - a stuck
// call had no timeout at all and could run indefinitely with no way to detect or recover).
const OLLAMA_CALL_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

// Query Ollama local API with custom JSON Schema validation
function queryOllama(modelName: string, systemPrompt: string, promptText: string, schema: any, externalSignal?: AbortSignal, keepAlive: string | number = 0): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: modelName,
      system: systemPrompt,
      prompt: promptText,
      stream: false,
      options: {
        temperature: 0,
        // Widen the context window explicitly. Ollama was defaulting to 4096 tokens - the
        // system prompt alone is long, plus a full resume, plus a 31-field JSON response can
        // plausibly exceed that on longer resumes, causing the model to silently lose context
        // on earlier content (i.e. missed skills) rather than erroring. This directly protects
        // against that failure mode.
        num_ctx: 8192,
        // Use the machine's actual CPU threads (this box has no usable GPU for Ollama) instead
        // of relying on Ollama's own auto-detection.
        num_thread: 10,
      },
      format: schema,
      // Pass 1 (Llama) unloads immediately (keepAlive=0) so it's fully out of memory before
      // Pass 2 (Qwen) loads - on this machine's limited RAM, having both ~5GB models resident
      // at once (which a longer keep_alive would cause, since Pass 2 starts before Pass 1's
      // keep-alive window would expire) was found to make things slower, not faster. Only the
      // very last call in the pipeline gets a short keep_alive, for the rare case another
      // resume needs the same model again within that window.
      keep_alive: keepAlive,
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = http.request({
      hostname: 'localhost',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: OLLAMA_CALL_TIMEOUT_MS,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          finish(() => reject(new Error(`Ollama model ${modelName} returned status ${res.statusCode}: ${body}`)));
          return;
        }
        try {
          const result = JSON.parse(body);
          const parsed = JSON.parse(result.response || '{}');
          console.log(`  🤖 Local model ${modelName} successfully parsed response.`);
          finish(() => resolve(parsed));
        } catch (err) {
          finish(() => reject(err));
        }
      });
    });

    // Node's own socket-level timeout (belt-and-suspenders alongside the abort signal below).
    req.on('timeout', () => {
      req.destroy(new Error(`Ollama model ${modelName} timed out after ${OLLAMA_CALL_TIMEOUT_MS / 1000}s`));
    });
    req.on('error', (err) => finish(() => reject(err)));

    // If the caller cancels (e.g. the browser disconnected), actually stop this request instead
    // of letting it run orphaned in the background, where it was previously found to keep
    // consuming RAM/CPU and starving the *next* real upload of resources.
    if (externalSignal) {
      if (externalSignal.aborted) {
        req.destroy(new Error('Request cancelled before it started'));
      } else {
        externalSignal.addEventListener('abort', () => {
          req.destroy(new Error('Request cancelled - client disconnected'));
        }, { once: true });
      }
    }

    req.write(payload);
    req.end();
  });
}

export async function parseResume(resumeText: string, options?: { maxRetries?: number; fallbackToRegex?: boolean; signal?: AbortSignal }) {
  const fallbackToRegex = options?.fallbackToRegex !== false;
  const signal = options?.signal;

  try {
    const systemInstruction = `You are an elite, production-grade Resume Parsing AI. Your absolute core directive is ZERO DATA LOSS. Missing, omitting, or truncating details or lists directly results in revenue loss for our company. You must extract every single item, word, and technical detail with 100% fidelity.

Analyze the raw resume text provided at the end and map the data precisely into a single, valid JSON object following the 31-column schema specified below.

EXTRACTION LAWS:
1. DO NOT TRUNCATE OR SUMMARIZE arrays or skill sections (Never use "...", "etc.", or "and others"). If a candidate lists 50 tools, you must extract all 50.
2. Maintain exact spelling, capitalization, and formatting as present in the original text.
3. If an explicit column data point cannot be found anywhere in the text, map its value strictly as null (do not use string "NULL", use the JSON null literal).
4. Extract structured arrays as comma-separated values inside a clean string where indicated.
5. FORCE LOGICAL TIMELINE MATH (Years of Experience Fix): You must mathematically calculate the total Years_of_Experience. Look for all chronological employment blocks (e.g., '2023 - 2026' or '06.2023 - Present'). Calculate the duration of each block assuming 'Present' refers to the current year 2026, sum them up, and output the total as a clear number or string (e.g., '3 Years'). NEVER fall back to 'Not specified' if dates are present anywhere in the text.
6. IMPLICIT FEATURE DEDUCTION: If any secondary feature is implicit in the text (such as Location inferred from a known local company name), you must deduce it rather than outputting null.
7. ROW-BY-ROW SCHEMA ALIGNMENT: Ensure strict row-by-row structural alignment matching our exact master sequence: Name, Email, Phone, Skills, Primary_Skills, Secondary_Skills, Years_of_Experience, Current_Location, Preferred_Location, Current_Company, Previous_Companies, Current_Job_Title, Industry_Domain, Education, Highest_Qualification, Graduation_Year, University, Certifications, Projects, Technical_Tools, Languages_Known, Current_CTC, Expected_CTC, Notice_Period, Willingness_to_Relocate, LinkedIn_URL, GitHub_or_Portfolio_URL, Resume_Summary, Resume_Text, AI_Confidence_Score, Data_Status.
8. VERBATIM COPY RULE (NO AUTOCORRECT): You are forbidden from normalizing, correcting, or abbreviating email addresses. You must perform VERBATIM EXTRACTION. The email string must be character-for-character identical to the text provided in the resume. If the resume says 'shamala123@gmail.com', you MUST output exactly 'shamala123@gmail.com'. Never truncate, never guess, and never use common-word patterns to shorten names. The contact group (Email, Phone, LinkedIn_URL, GitHub_or_Portfolio_URL) must follow this strict verbatim extraction law.`;

    const prompt = `Parse the raw resume text provided at the end and map the data precisely into a single, valid JSON object matching the 31-column required schema parameters.

SKILL EXTRACTION AUDIT (apply this yourself before finalizing - this used to be a separate
cross-check pass, now folded into this single request):
Perform an aggressive keyword audit on the 'Skills', 'Primary_Skills', and 'Technical_Tools'
fields: combine, cross-verify, and clean these blocks. Ensure advanced variations and industry
roles (like 'Salesforce QA', 'SDET', 'Automation Testing', 'SDET-Automation') are explicitly
maintained in the values instead of being collapsed into a generic tool word. Do not drop any
skill that appears anywhere in the resume text, including ones mentioned only once in a
sentence rather than listed in a dedicated "Skills" section.

CRITICAL OUTPUT CONSTRAINT:
Return ONLY the raw, minified JSON object. Do not wrap it in markdown code blocks like \`\`\`json ... \`\`\`. Do not provide introductory or concluding conversational prose. Your response must begin with '{' and end with '}'.

INPUT RESUME TEXT TO PARSE:
${resumeText}`;

    // Schema constraint for Ollama API format
    const formatSchema = {
      type: "object",
      properties: {
        "Name": { type: "string" },
        "Email": { type: "string" },
        "Phone": { type: "string" },
        "Skills": { type: "string" },
        "Primary_Skills": { type: "string" },
        "Secondary_Skills": { type: "string" },
        "Years_of_Experience": { type: "string" },
        "Current_Location": { type: "string" },
        "Preferred_Location": { type: "string" },
        "Current_Company": { type: "string" },
        "Previous_Companies": { type: "string" },
        "Current_Job_Title": { type: "string" },
        "Industry_Domain": { type: "string" },
        "Education": { type: "string" },
        "Highest_Qualification": { type: "string" },
        "Graduation_Year": { type: "string" },
        "University": { type: "string" },
        "Certifications": { type: "string" },
        "Projects": { type: "string" },
        "Technical_Tools": { type: "string" },
        "Languages_Known": { type: "string" },
        "Current_CTC": { type: "string" },
        "Expected_CTC": { type: "string" },
        "Notice_Period": { type: "string" },
        "Willingness_to_Relocate": { type: "string" },
        "LinkedIn_URL": { type: "string" },
        "GitHub_or_Portfolio_URL": { type: "string" },
        "Resume_Summary": { type: "string" },
        "Resume_Text": { type: "string" },
        "AI_Confidence_Score": { type: "string" },
        "Data_Status": { type: "string" }
      },
      required: [
        "Name", "Email", "Phone", "Skills", "Primary_Skills", "Secondary_Skills", 
        "Years_of_Experience", "Current_Location", "Preferred_Location", "Current_Company", 
        "Previous_Companies", "Current_Job_Title", "Industry_Domain", "Education", 
        "Highest_Qualification", "Graduation_Year", "University", "Certifications", 
        "Projects", "Technical_Tools", "Languages_Known", "Current_CTC", "Expected_CTC", 
        "Notice_Period", "Willingness_to_Relocate", "LinkedIn_URL", "GitHub_or_Portfolio_URL", 
        "Resume_Summary", "Resume_Text", "AI_Confidence_Score", "Data_Status"
      ]
    };

    // Single-model pipeline: llama3.1 only. The two-pass Llama+Qwen cross-verification was
    // removed to hit a ~1-2 minute per-resume target on this machine's CPU-only, RAM-limited
    // hardware - two sequential ~5GB model loads was the dominant cost (see prior diagnosis).
    // The Qwen pass's skill-audit instructions were folded into the prompt above instead of
    // being dropped outright, so extraction thoroughness is still explicitly requested even
    // without the separate cross-check call.
    console.log('📡 Running Single-Model Extraction (llama3.1)...');
    let llamaResult: any = null;
    const qwenResult: any = null;

    try {
      llamaResult = await queryOllama('llama3.1', systemInstruction, prompt, formatSchema, signal, '2m');
    } catch (err) {
      console.error('  ❌ llama3.1 extraction failed:', err);
    }

    const mistralResult = null;

    if (!qwenResult && !llamaResult) {
      throw new Error('All local Ollama sequential models failed to execute.');
    }

    const getMergedField = (key: string, priority: 'qwen' | 'llama' | 'none' = 'none') => {
      if (priority === 'qwen') {
        const val = qwenResult?.[key] ?? llamaResult?.[key] ?? mistralResult?.[key];
        if (val === undefined || val === null) return null;
        const s = String(val).trim();
        return s === '' || s.toLowerCase() === 'null' ? null : s;
      } else if (priority === 'llama') {
        const val = llamaResult?.[key] ?? qwenResult?.[key] ?? mistralResult?.[key];
        if (val === undefined || val === null) return null;
        const s = String(val).trim();
        return s === '' || s.toLowerCase() === 'null' ? null : s;
      } else {
        const val = qwenResult?.[key] ?? llamaResult?.[key] ?? mistralResult?.[key];
        if (val === undefined || val === null) return null;
        const s = String(val).trim();
        return s === '' || s.toLowerCase() === 'null' ? null : s;
      }
    };

    const allSkillsList: string[] = [];
    [qwenResult, llamaResult, mistralResult].forEach(res => {
      if (res && res.Skills) {
        const list = String(res.Skills).split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null');
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

    const parseList = (val: any, sep = ',') => {
      if (val === undefined || val === null) return [];
      const s = String(val).trim();
      if (s === '' || s.toLowerCase() === 'null') return [];
      return s.split(sep).map(item => item.trim()).filter(item => item);
    };

    const finalGradYear = llamaResult?.Graduation_Year ?? qwenResult?.Graduation_Year ?? mistralResult?.Graduation_Year;

    let nameVal = getMergedField('Name') || extractName(resumeText);
    let emailVal = getMergedField('Email') || extractEmail(resumeText);
    let phoneVal = getMergedField('Phone') || extractPhone(resumeText);
    const skillsVal = uniqueSkills.length > 0 ? uniqueSkills : extractSkills(resumeText);
    
    let expVal = getMergedField('Years_of_Experience', 'llama');
    const programmaticExp = calculateExperienceFromText(resumeText);
    if (!expVal || expVal.toLowerCase() === 'n/a' || expVal.toLowerCase() === 'not specified' || expVal.toLowerCase() === 'null') {
      expVal = programmaticExp;
    }
    
    const titleVal = getMergedField('Current_Job_Title', 'llama');

    let dataStatus = 'Complete';
    
    // Post-extraction sanity check for Email
    if (emailVal && emailVal !== 'N/A' && !emailVal.startsWith('hash_')) {
      const cleanEmail = emailVal.trim().toLowerCase();
      if (!resumeText.toLowerCase().includes(cleanEmail)) {
        console.warn(`⚠️ Post-Extraction sanity check failed! Extracted email "${emailVal}" is not present in raw resume text. Discarding email extraction.`);
        emailVal = 'N/A'; // Discard the extraction
        dataStatus = 'Review Required'; // Flag as Review Required
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
      primary_skills: getMergedField('Primary_Skills', 'qwen'),
      secondary_skills: getMergedField('Secondary_Skills', 'qwen'),
      years_of_experience: expVal,
      current_location: getMergedField('Current_Location', 'llama'),
      preferred_location: getMergedField('Preferred_Location', 'llama'),
      current_company: getMergedField('Current_Company', 'llama'),
      previous_companies: parseList(getMergedField('Previous_Companies', 'llama'), ';'),
      current_job_title: titleVal,
      industry_domain: getMergedField('Industry_Domain'),
      education: getMergedField('Education'),
      highest_qualification: getMergedField('Highest_Qualification'),
      graduation_year: finalGradYear !== undefined && finalGradYear !== null ? String(finalGradYear) : null,
      university: getMergedField('University'),
      certifications: parseList(getMergedField('Certifications'), ';'),
      projects: getMergedField('Projects'),
      technical_tools: getMergedField('Technical_Tools', 'qwen'),
      languages_known: getMergedField('Languages_Known'),
      current_ctc: getMergedField('Current_CTC'),
      expected_ctc: getMergedField('Expected_CTC'),
      notice_period: getMergedField('Notice_Period', 'llama'),
      willingness_to_relocate: getMergedField('Willingness_to_Relocate', 'llama'),
      linkedin_url: getMergedField('LinkedIn_URL'),
      github_or_portfolio_url: getMergedField('GitHub_or_Portfolio_URL'),
      resume_summary: getMergedField('Resume_Summary'),
      resume_text: resumeText,
      ai_confidence_score: getMergedField('AI_Confidence_Score') || '90%',
      extraction_status: dataStatus
    };
  } catch (error) {
    console.error('Error parsing resume with local Ollama:', error);
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
    extraction_status: 'Partial'
  };
}
