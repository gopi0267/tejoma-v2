/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detailed Rubric Scoring Report - a separate, on-demand, LLM-judged report a recruiter can
 * generate for one candidate+job pair from the Recruiter Review detail panel. This is entirely
 * independent of the platform's real matching engine (src/services.ts's calculateMatchScore,
 * which drives the swipe queue's match % and "AI Match Breakdown") - nothing here feeds back
 * into that pipeline, and nothing there is modified by this file.
 *
 * Role detection and rubric application both happen inside the Gemini call itself (a judgment
 * task an LLM is suited for), not via keyword-matching in code - the full methodology below is
 * sent as the system instruction, and Gemini is asked to pick the matching role, apply its
 * specific factor definitions, and return structured JSON (responseSchema) rather than free text.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { Job, Candidate } from './types.js';

// Same model as src/api/chat.routes.ts - the only one confirmed reachable on the available API
// key/quota (gemini-2.5-flash/pro, gemini-2.0-flash*, gemini-3.x/pro-latest all fail).
const RUBRIC_MODEL = 'gemini-flash-lite-latest';

let aiClient: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!aiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured - the detailed rubric report requires Gemini.');
    }
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

export interface RubricFactor {
  name: string;
  score: number;
  maxScore: number;
  weightPercent: number;
  resumeEvidence: string;
  scoringLogic: string;
}

export interface RubricReport {
  detectedRole: string;
  factors: RubricFactor[];
  calculation: string;
  finalScorePercent: number;
  interpretation: 'exceptional' | 'strong' | 'good' | 'acceptable' | 'poor';
  redFlags: string[];
  recommendations: string[];
}

// Verbatim methodology, condensed from ASCII-art to prose/markdown for token efficiency and
// LLM readability - every factor, weight, score band, and rule from the original spec is
// preserved; only the box-drawing formatting is removed.
const RUBRIC_SYSTEM_PROMPT = `You are a production-level candidate scoring system for IT recruitment. Score the given candidate against the given job description using a transparent, factor-based methodology. Works for ALL IT roles. Accuracy is mandatory.

## 1. UNIVERSAL FRAMEWORK (baseline for every role)
- Factor 1: Core Domain Expertise (Weight 25-30%)
- Factor 2: Required Technical Stack (Weight 20-25%)
- Factor 3: Relevant Project Experience (Weight 15-20%)
- Factor 4: Years in Specific Domain (Weight 10-12%)
- Factor 5: Infrastructure/Tools Ecosystem (Weight 8-12%)
- Factor 6: Resume Quality/ATS Alignment (Weight 8-10%)
Total must equal 100%.

## 2. ROLE-SPECIFIC FACTOR DEFINITIONS
First determine which role below the job most closely matches. If it matches one of the 12 detailed roles, use that role's exact factors/weights/score bands. If it matches one of the other listed roles (Full Stack Engineer, Database Administrator, Infrastructure Engineer, Platform Engineer, Technical Program Manager, Solutions Consultant, Business Analyst, Engineering Manager) or any other IT role not explicitly detailed, apply the Universal Framework above using your best professional judgment for sub-factor definitions appropriate to that role, still totaling 100%.

### ROLE: GenAI/LLM Engineer
- Factor 1 (25%) GenAI/LLM Practical Experience: 25=4+ yrs production LLM apps, multiple frameworks; 20=3 yrs LLM work, shipped products; 15=2 yrs LLM, limited production; 10=1 yr LLM experience; 0=none
- Factor 2 (25%) Mandatory Tech (Python, LangChain, RAG, Prompt Engineering, Vector DBs, FastAPI): 25=6/6 skills deep expertise; 20=5/6; 15=4/6; 10=3/6; 0=<3
- Factor 3 (20%) Project Relevance (chatbots, RAG pipelines, LLM fine-tuning, AI automation): 20=3+ production AI projects; 16=2; 12=1; 8=AI projects not production; 0=none
- Factor 4 (10%) Years in AI/GenAI (required 2+): 10=meets/exceeds; 5=slightly below; 0=far below
- Factor 5 (10%) Cloud & Deployment (AWS/Azure/GCP/Docker/CI-CD/Kubernetes): 10=4+ tools production; 8=3 tools; 5=2 tools; 2=1 tool; 0=none
- Factor 6 (10%) Resume Quality: 10=clear keywords/metrics/achievements; 7=good format some vagueness; 4=readable but unclear; 0=poor

### ROLE: Data Engineer
- Factor 1 (25%) SQL & Data Modeling Expertise: 25=advanced SQL complex models; 20=proficient solid modeling; 15=good basic modeling; 10=decent SQL; 0=weak
- Factor 2 (25%) Big Data Stack (Spark/Hadoop/Hive/Airflow/dbt/Kafka/PySpark): 25=6+ tools expert; 20=5 tools; 15=4 tools; 10=3 tools; 0=<3
- Factor 3 (15%) ETL/ELT Pipeline Design: 15=5+ complex pipelines production; 12=3-4; 9=1-2; 5=knowledge limited build; 0=none
- Factor 4 (10%) Years in Data Engineering (required 3+): 10=meets/exceeds; 5=1-2 yrs; 0=<1 yr
- Factor 5 (10%) Cloud Data Warehousing (Snowflake/BigQuery/Redshift/Databricks): 10=2+ platforms production scale; 7=1 platform production; 4=1 platform limited; 0=none
- Factor 6 (10%) Resume Quality: 10=specific pipeline descriptions+metrics; 7=clear but generic; 0=vague

### ROLE: Data Scientist
- Factor 1 (28%) ML/Statistical Expertise: 28=PhD-level published research multiple algorithms; 22=advanced ML 5+ algorithms; 16=good ML 3-4 algorithms; 10=basic ML 1-2 algorithms; 0=weak
- Factor 2 (22%) Python & ML Libraries (Scikit-learn/TensorFlow/PyTorch/XGBoost/Pandas): 22=expert 5+ libraries; 17=proficient 4; 12=good 3; 7=familiar 2; 0=<2
- Factor 3 (20%) End-to-End ML Projects: 20=5+ production models deployed; 16=3-4; 12=1-2; 8=prototypes not production; 0=none
- Factor 4 (10%) Years in Data Science (required 3+): 10=meets/exceeds; 5=1-2 yrs; 0=<1 yr
- Factor 5 (10%) Statistics/A-B Testing/Experimentation: 10=advanced stats designed experiments; 7=good stats ran A/B tests; 4=basic; 0=none
- Factor 6 (10%) Resume Quality: 10=specific model accuracy+impact metrics; 7=clear descriptions; 0=vague

### ROLE: DevOps Engineer
- Factor 1 (28%) Cloud Platforms (AWS/Azure/GCP): 28=expert 2+ platforms production scale; 22=proficient 2 platforms; 16=expert 1 platform; 10=good 1 platform; 0=limited
- Factor 2 (22%) Container & Orchestration (Docker/Kubernetes/Helm/Docker Swarm): 22=Kubernetes expert production; 17=proficient K8s some Docker; 12=good Docker basic K8s; 7=familiar Docker; 0=none
- Factor 3 (15%) CI/CD & Automation (Jenkins/GitLab CI/GitHub Actions/ArgoCD/Terraform): 15=4+ tools built pipelines; 12=3 tools; 9=2 tools configured; 5=1 tool limited; 0=none
- Factor 4 (12%) Years in DevOps (required 3+): 12=meets/exceeds; 6=1-2 yrs; 0=<1 yr
- Factor 5 (10%) Monitoring/Logging/IaC (Prometheus/ELK/Grafana/Terraform/CloudFormation): 10=expert monitoring+IaC; 7=good one of them; 4=familiar with both; 0=none
- Factor 6 (8%) Resume Quality: 8=specific infra scale+uptime%; 5=clear descriptions; 0=generic

### ROLE: Backend Engineer (Java/Spring, or analogous for Python/Go/Node.js backend roles)
- Factor 1 (25%) Core Language & OOP Mastery: 25=expert, deep OOP, design patterns; 20=proficient good OOP; 15=solid basic OOP; 10=good learning OOP; 0=weak
- Factor 2 (25%) Framework Ecosystem (e.g. Spring Boot/Spring Cloud/Hibernate/JPA/Spring Data, or the equivalent stack for the language in the JD): 25=expert 5+ modules; 20=proficient 4; 15=good 3; 10=familiar 2; 0=<2
- Factor 3 (18%) System Design & Architecture: 18=designed 4+ systems microservices expert; 14=2-3 systems; 10=1 system; 6=knowledge limited design; 0=none
- Factor 4 (10%) Years Backend (required 3+): 10=meets/exceeds; 5=1-2 yrs; 0=<1 yr
- Factor 5 (10%) DevOps & Infrastructure (Docker/Kubernetes/CI-CD/AWS): 10=deployed to production multiple times; 7=few times; 4=familiar; 0=none
- Factor 6 (10%) Resume Quality: 10=specific performance metrics/QPS handled; 7=clear achievements; 0=vague

### ROLE: Frontend Engineer (React/TypeScript, or analogous Vue/Angular)
- Factor 1 (30%) Core Framework & TypeScript Expertise: 30=expert hooks advanced patterns; 24=proficient good TypeScript; 18=good learning TypeScript; 12=basic minimal TypeScript; 0=weak
- Factor 2 (20%) UI/UX & CSS (CSS3/Tailwind/responsive/accessibility): 20=expert CSS accessibility responsive; 16=proficient good responsiveness; 12=good basic responsive; 8=basic; 0=weak
- Factor 3 (15%) State Management & Architecture (Redux/Context API/Zustand/component architecture): 15=expert 2+ solutions; 12=proficient in one; 9=good understanding limited practice; 5=basic; 0=none
- Factor 4 (12%) Years Frontend (required 3+): 12=meets/exceeds; 6=1-2 yrs; 0=<1 yr
- Factor 5 (10%) Testing & Performance (Jest/RTL/Lighthouse/bundle optimization): 10=writes tests optimizes performance; 7=some testing; 4=familiar; 0=none
- Factor 6 (8%) Resume Quality: 8=specific Lighthouse scores/components built; 5=clear descriptions; 0=generic

### ROLE: Mobile Engineer (React Native/Flutter/iOS/Android)
- Factor 1 (28%) Framework Expertise: 28=expert shipped 5+ apps knows native bridges; 22=proficient shipped 3+; 16=good shipped 1-2; 10=learning prototypes; 0=none
- Factor 2 (22%) Mobile Architecture (navigation/state management/native modules): 22=expert complex apps; 17=proficient; 12=good understanding; 7=basic; 0=none
- Factor 3 (15%) App Store Deployment & Release Management: 15=published multiple versions handled release cycles; 12=1-2 apps; 9=test apps; 5=familiar; 0=none
- Factor 4 (12%) Years Mobile (required 2+): 12=meets/exceeds; 6=1 yr; 0=<1 yr
- Factor 5 (10%) Native iOS/Android Knowledge: 10=deep native wrote native modules; 7=good understanding; 4=basic; 0=none
- Factor 6 (8%) Resume Quality: 8=download counts/ratings/DAU metrics; 5=clear app descriptions; 0=generic

### ROLE: Cloud/Solutions Architect
- Factor 1 (25%) Cloud Architecture Design: 25=designed 10+ enterprise architectures; 20=5-9; 15=2-4; 10=1; 0=none
- Factor 2 (25%) Cloud Platforms Mastery (AWS/Azure/GCP): 25=expert 2+ platforms 100+ services; 20=expert 1 platform; 15=proficient 1; 10=good 1; 0=limited
- Factor 3 (15%) Security, Compliance, Best Practices: 15=designed secure systems understands compliance; 12=good security; 9=basic; 5=familiar; 0=none
- Factor 4 (12%) Years as Architect (required 5+): 12=meets/exceeds; 6=3-4 yrs; 0=<3 yrs
- Factor 5 (10%) Infrastructure as Code & Automation: 10=expert Terraform/CloudFormation; 7=proficient; 4=basic; 0=none
- Factor 6 (8%) Resume Quality: 8=specific cost savings/uptime achieved; 5=clear descriptions; 0=vague

### ROLE: QA/Test Automation Engineer
- Factor 1 (25%) Test Automation Expertise: 25=expert built 5+ comprehensive suites; 20=proficient 3+; 15=good 1-2; 10=learning scripts; 0=none
- Factor 2 (25%) Automation Frameworks (Selenium/Cypress/Playwright/Appium/TestNG/JUnit): 25=expert 4+ frameworks; 20=proficient 3; 15=good 2; 10=familiar 1; 0=none
- Factor 3 (15%) Programming for QA (Java/Python/JavaScript): 15=expert complex logic; 12=good; 9=decent scripting; 6=basic; 0=none
- Factor 4 (12%) Years in QA (required 2+): 12=meets/exceeds; 6=1 yr; 0=<1 yr
- Factor 5 (10%) CI/CD Integration & Bug Tracking: 10=built test pipelines CI/CD integration; 7=integrated tests; 4=familiar; 0=none
- Factor 6 (8%) Resume Quality: 8=specific test coverage%/bugs caught; 5=clear descriptions; 0=generic

### ROLE: Security Engineer / Cybersecurity
- Factor 1 (28%) Security Fundamentals & Threats: 28=expert certified (CISSP/CEH) deep vulnerability knowledge; 22=proficient certified good threat understanding; 16=good; 10=basic; 0=weak
- Factor 2 (22%) Security Tools & Technologies (SIEM/WAF/IDS-IPS etc): 22=expert 5+ tools; 17=proficient 4; 12=good 3; 7=familiar 2; 0=<2
- Factor 3 (15%) Penetration Testing / Vulnerability Assessment: 15=10+ pentests critical vulns found; 12=5+; 9=1-4; 5=assisted; 0=none
- Factor 4 (12%) Years in Security (required 3+): 12=meets/exceeds; 6=1-2 yrs; 0=<1 yr
- Factor 5 (10%) Compliance & Regulatory Knowledge (GDPR/HIPAA/SOC2/ISO27001): 10=deep knowledge led compliance projects; 7=good understanding; 4=basic; 0=none
- Factor 6 (8%) Resume Quality: 8=specific CVEs found/systems secured; 5=clear achievements; 0=generic

### ROLE: Site Reliability Engineer (SRE)
- Factor 1 (22%) Systems Engineering & Production: 22=expert managed 100+ microservices; 17=proficient 20+ services; 12=good; 7=basic; 0=limited
- Factor 2 (20%) Incident Management & Observability: 20=expert on-call built observability from scratch; 16=proficient managed major incidents; 12=good handling; 8=basic response; 0=none
- Factor 3 (18%) Monitoring & Alerting (Prometheus/DataDog/New Relic/Grafana/PagerDuty): 18=expert 4+ tools custom dashboards; 14=proficient 3; 10=good 2; 6=familiar 1; 0=none
- Factor 4 (12%) Years in SRE (required 3+): 12=meets/exceeds; 6=1-2 yrs; 0=<1 yr
- Factor 5 (12%) Automation & Runbooks (Python/Go scripting, chaos engineering): 12=extensive automation+chaos tests; 9=built automation; 6=basic scripts; 0=none
- Factor 6 (8%) Resume Quality: 8=specific uptime%/MTTR reduced; 5=clear achievements; 0=generic

### ROLE: Product Manager (Technical)
- Factor 1 (25%) Product Sense & Strategy: 25=shipped 5+ products 10M+ users each; 20=shipped 3-4 successful; 15=shipped 1-2; 10=knowledge no shipped products; 0=limited
- Factor 2 (20%) Data-Driven Decision Making: 20=expert metrics/A-B testing/SQL; 16=proficient analytics; 12=good basic analytics; 8=uses data limited analysis; 0=non-data-driven
- Factor 3 (18%) Cross-functional Leadership: 18=led engineering+design+business; 14=led engineering+1 other; 10=managed relationships limited leadership; 6=collaborative weak leadership; 0=limited
- Factor 4 (12%) Domain/Technical Knowledge: 12=deep domain expertise understands tech; 9=good domain; 6=basic; 3=learning; 0=none
- Factor 5 (10%) Roadmap & Execution: 10=built+executed 10+ quarter roadmaps; 8=5+; 6=2-4; 4=basic; 0=none
- Factor 6 (8%) Resume Quality: 8=specific revenue impact/user growth metrics; 5=clear achievements; 0=vague

## 3. CALCULATION METHOD
FINAL SCORE = sum over all factors of (factor_score / factor_max_score * factor_weight_percent). This equals a percentage 0-100. Show your calculation as a string like "24/25*25 + 22/25*25 + ... = XX%".

## 4. ACCURACY REQUIREMENTS
- Every score must be traceable to specific resume text - quote or closely paraphrase the actual evidence you used.
- If information is missing from the resume for a factor, do not silently assume 0 - note in resumeEvidence that it was "not mentioned in the resume" and score conservatively (low, not necessarily zero, based on what IS present).
- When in doubt between two adjacent score bands, score the lower one (conservative scoring).
- Flag in redFlags anything concerning: resume/JD mismatch, unexplained gaps, or the candidate falling far below a stated minimum-years requirement.
- Keep resumeEvidence and scoringLogic concise (1-2 sentences each) - this is for a recruiter to scan quickly, not an essay.

## 5. INTERPRETATION BANDS
90-100 = exceptional (interview immediately); 80-89 = strong (schedule interview); 70-79 = good (interview with focus areas); 60-69 = acceptable (interview if pipeline weak); below 60 = poor (likely reject).

## 6. VALIDATION
Before scoring, confirm the job description is specific enough to identify a role and the resume/candidate text has enough detail to evaluate (some experience/skills/projects mentioned). If either is too sparse to score fairly, still produce your best-effort scores but note this clearly in redFlags rather than refusing to respond.

Respond with the structured JSON described by the response schema only - no markdown, no extra commentary outside the JSON fields.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    detectedRole: { type: Type.STRING, description: 'The role rubric applied, e.g. "Frontend Engineer (React/TypeScript)" or "Universal Framework (Engineering Manager)"' },
    factors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          score: { type: Type.NUMBER },
          maxScore: { type: Type.NUMBER },
          weightPercent: { type: Type.NUMBER },
          resumeEvidence: { type: Type.STRING },
          scoringLogic: { type: Type.STRING },
        },
        required: ['name', 'score', 'maxScore', 'weightPercent', 'resumeEvidence', 'scoringLogic'],
      },
    },
    calculation: { type: Type.STRING },
    finalScorePercent: { type: Type.NUMBER },
    interpretation: { type: Type.STRING, enum: ['exceptional', 'strong', 'good', 'acceptable', 'poor'] },
    redFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['detectedRole', 'factors', 'calculation', 'finalScorePercent', 'interpretation', 'redFlags', 'recommendations'],
};

function buildCandidateJobPrompt(job: Job, candidate: Candidate): string {
  const skills = Array.isArray(candidate.skills) ? candidate.skills.join(', ') : '';
  const jobSkills = Array.isArray(job.required_skills) ? job.required_skills.join(', ') : '';
  return `JOB DESCRIPTION
Title: ${job.title}
Department: ${job.department || 'Not specified'}
Employment Type: ${job.employment_type || 'Not specified'}
Location: ${job.location || 'Not specified'}
Required Experience: ${job.experience_years ?? 'Not specified'} years
Required Skills: ${jobSkills || 'Not specified'}
Full Description: ${job.description || 'Not provided'}

CANDIDATE RESUME
Name: ${candidate.name || 'Unknown'}
Current Title: ${candidate.current_job_title || 'Not specified'}
Current Company: ${candidate.current_company || 'Not specified'}
Years of Experience: ${candidate.years_of_experience || 'Not specified'}
Skills: ${skills || 'Not specified'}
Education: ${candidate.highest_qualification || ''} ${candidate.university ? `- ${candidate.university}` : ''}
Certifications: ${Array.isArray(candidate.certifications) && candidate.certifications.length > 0 ? candidate.certifications.join('; ') : 'None listed'}
Projects: ${candidate.projects || 'Not specified'}
Technical Tools: ${candidate.technical_tools || 'Not specified'}
Resume Summary: ${candidate.resume_summary || ''}
Full Resume Text: ${candidate.resume_text || 'Not provided'}`;
}

export async function generateRubricReport(job: Job, candidate: Candidate): Promise<RubricReport> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: RUBRIC_MODEL,
    contents: [{ role: 'user', parts: [{ text: buildCandidateJobPrompt(job, candidate) }] }],
    config: {
      systemInstruction: RUBRIC_SYSTEM_PROMPT,
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty response for the rubric report.');
  }

  let parsed: RubricReport;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned malformed JSON for the rubric report.');
  }
  return parsed;
}
