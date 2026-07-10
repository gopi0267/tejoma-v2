import { GoogleGenAI } from '@google/genai';
import { db } from './db.js';
import { RandomForestClassifier, extractFeatures } from './ml.js';
import { Candidate, Job, MatchBreakdown } from './types.js';

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not defined. Using local matching heuristics.');
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

export let trainedModel = new RandomForestClassifier(100, 15, 5);
export let isModelTrained = false;

export let activeModelType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted' = 'random_forest';
export let isRetrainingInProgress = false;
export let lastTrainingTimestamp = new Date().toISOString();

export async function trainModelOnStartup() {
  try {
    const swipes = await db.getSwipes();
    if (swipes.length === 0) {
      console.warn('No swipes available for ML training.');
      return;
    }

    const X: number[][] = [];
    const y: number[] = [];

    const candidates = await db.getCandidates();
    const jobs = await db.getJobs();

    for (const swipe of swipes) {
      const candidate = candidates.find(c => c.id === swipe.candidate_id);
      const job = jobs.find(j => j.id === swipe.job_id);
      if (!candidate || !job) continue;

      const { skillScore, expDiff, locDist, salOverlap, embedSim } = computeBaseMatchMetrics(job, candidate);
      const features = extractFeatures(skillScore, expDiff, locDist, salOverlap, embedSim);
      
      X.push(features);
      y.push(swipe.action);
    }

    if (X.length > 0) {
      trainedModel.fit(X, y);
      isModelTrained = true;
      console.log(`Random Forest ML model trained successfully on ${X.length} swipes.`);
    }
  } catch (error) {
    console.error('Failed to train machine learning model on startup:', error);
  }
}

export function computeBaseMatchMetrics(job: Job, candidate: Candidate) {
    const candidateSkills = Array.isArray(candidate?.skills) ? candidate.skills : [];
    const jobSkills = Array.isArray(job?.required_skills) ? job.required_skills : [];
  
    const matchedSkills = candidateSkills.filter(s => 
      s && jobSkills.some(rs => rs && rs.toLowerCase().trim() === s.toLowerCase().trim())
    );
    
    const totalSkillsCount = Array.from(new Set([
      ...candidateSkills.map(s => s ? s.toLowerCase().trim() : ''), 
      ...jobSkills.map(rs => rs ? rs.toLowerCase().trim() : '')
    ].filter(Boolean))).length;
    
    const skillScore = totalSkillsCount > 0 
      ? (matchedSkills.length / Math.max(1, jobSkills.length)) * 100 
      : 0;
  
    const candidateExp = typeof candidate?.years_of_experience === 'number' ? candidate.years_of_experience : 0;
    const jobExp = typeof job?.experience_years === 'number' ? job.experience_years : 0;
    const expDiff = candidateExp - jobExp;
    let expScore = 0;
    if (candidateExp >= jobExp) {
      expScore = 100;
    } else {
      expScore = jobExp > 0 ? (candidateExp / jobExp) * 100 : 100;
    }
  
    const candidateLoc = (candidate?.current_location || 'San Francisco').toLowerCase().trim();
    const jobLoc = (job?.location || 'Remote').toLowerCase().trim();
    let locDist = 0;
    if (candidateLoc !== jobLoc && jobLoc !== 'remote' && candidateLoc !== 'remote') {
      const locs = [candidateLoc, jobLoc].sort();
      const key = locs.join('-');
      const matrix: Record<string, number> = {
        'austin-san francisco': 2400,
        'new york-san francisco': 4100,
        'chicago-san francisco': 3000,
        'austin-new york': 2700,
        'austin-chicago': 1600,
        'chicago-new york': 1100,
      };
      locDist = matrix[key] || 1200;
    }
  
    let locScore = 100;
    if (locDist > 0) {
      locScore = Math.max(0, 100 - (locDist * 0.05));
    }
  
    const candidateSal = typeof candidate?.salary_expectation === 'number' ? candidate.salary_expectation : 100000;
    const jobSalMin = typeof job?.salary_min === 'number' ? job.salary_min : 50000;
    const jobSalMax = typeof job?.salary_max === 'number' ? job.salary_max : 120000;
    let salOverlap = 0;
    if (candidateSal >= jobSalMin && candidateSal <= jobSalMax) {
      salOverlap = 100;
    } else if (candidateSal < jobSalMin) {
      const diff = jobSalMin - candidateSal;
      salOverlap = Math.max(0, 100 - (diff / 100000) * 30);
    } else {
      const diff = candidateSal - jobSalMax;
      salOverlap = Math.max(0, 100 - (diff / 100000) * 50);
    }
    const salScore = salOverlap;
  
    const resumeText = candidate?.resume_text || '';
    const jobDesc = job?.description || '';
    const resumeWords = resumeText.toLowerCase().split(/\W+/);
    const jobWords = jobDesc.toLowerCase().split(/\W+/);
    const stopWords = new Set(['the', 'and', 'we', 'are', 'looking', 'for', 'a', 'to', 'in', 'of', 'our', 'with', 'you', 'will', 'lead']);
    
    const resumeFilter = resumeWords.filter(w => w.length > 3 && !stopWords.has(w));
    const jobFilter = jobWords.filter(w => w.length > 3 && !stopWords.has(w));
    
    const intersection = resumeFilter.filter(w => jobFilter.includes(w));
    const uniqueIntersect = Array.from(new Set(intersection));
    const uniqueJobWords = Array.from(new Set(jobFilter));
    
    const embedSim = uniqueJobWords.length > 0 
      ? (uniqueIntersect.length / uniqueJobWords.length) * 100 
      : 50;
  
    return {
      skillScore,
      matchedSkills,
      missingSkills: jobSkills.filter(rs => 
        !candidateSkills.some(s => s && s.toLowerCase().trim() === rs.toLowerCase().trim())
      ),
      expDiff,
      expScore,
      locDist,
      locScore,
      salOverlap,
      salScore,
      embedSim
    };
  }

export async function calculateMatchScore(
    job: Job, 
    candidate: Candidate, 
    options?: { skipGeminiSummary?: boolean }
  ): Promise<{
    feature_score: number;
    embedding_score: number;
    ml_score: number;
    final_score: number;
    breakdown: MatchBreakdown;
    summary: string;
  }> {
    const metrics = computeBaseMatchMetrics(job, candidate);
  
    const feature_score = Math.round(
      (metrics.skillScore * 0.40) + 
      (metrics.expScore * 0.35) + 
      (metrics.locScore * 0.15) + 
      (metrics.salScore * 0.10)
    );
  
    let embedding_score = Math.round(metrics.embedSim);
  
    let ml_score = 70;
    if (isModelTrained) {
      const f = extractFeatures(
        metrics.skillScore, 
        metrics.expDiff, 
        metrics.locDist, 
        metrics.salOverlap, 
        metrics.embedSim
      );
      const prob = trainedModel.predictProbability(f);
      ml_score = Math.round(prob * 100);
    } else {
      ml_score = Math.round((metrics.skillScore * 0.5) + (metrics.expScore * 0.5));
    }
  
    let final_score = 0;
    if (activeModelType === 'heuristic') {
      final_score = feature_score;
    } else if (activeModelType === 'ml_tree') {
      final_score = Math.round(ml_score * 0.95);
    } else if (activeModelType === 'random_forest') {
      final_score = ml_score;
    } else {
      final_score = Math.round(
        (feature_score * 0.30) + 
        (embedding_score * 0.25) + 
        (ml_score * 0.45)
      );
    }
  
    const breakdown: MatchBreakdown = {
      skills: { 
        score: Math.round(metrics.skillScore), 
        matched: metrics.matchedSkills, 
        missing: metrics.missingSkills 
      },
      experience: { 
        score: Math.round(metrics.expScore), 
        candidate: candidate?.years_of_experience || 0, 
        required: job?.experience_years || 0 
      },
      location: { 
        score: Math.round(metrics.locScore), 
        candidate: candidate?.current_location || 'Remote', 
        required: job?.location || 'Remote', 
        distance: Math.round(metrics.locDist) 
      },
      salary: { 
        score: Math.round(metrics.salScore), 
        expectation: candidate?.salary_expectation || 0, 
        min: job?.salary_min || 0, 
        max: job?.salary_max || 0 
      }
    };
  
    let summary = '';
    if (!options?.skipGeminiSummary) {
      const ai = getGeminiClient();
      if (ai) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: `Analyze the fit between this Job and Candidate. Job Title: ${job?.title || 'Job Opening'}. Job Description: ${job?.description || ''}. Required Skills: ${(job?.required_skills || []).join(', ')}. Candidate Name: ${candidate?.name || 'Applicant'}. Candidate Job Title: ${candidate?.current_job_title || ''}. Candidate Experience: ${candidate?.years_of_experience || 0} years. Candidate Skills: ${(candidate?.skills || []).join(', ')}. Generate a concise ONE-SENTENCE recruiter summary explaining the match fit.`,
            config: {
              temperature: 0.3,
            }
          });
          summary = response.text ? response.text.trim() : '';
        } catch (e: any) {
          console.error('Gemini API error, using fallback summary');
        }
      }
    }
  
    if (!summary) {
      const matchedStr = metrics.matchedSkills.length > 0 
        ? `strong overlap in ${metrics.matchedSkills.slice(0, 3).join(', ')}` 
        : 'moderate background overlap';
      
      const locationStr = metrics.locDist === 0 
        ? 'perfectly local' 
        : `located in ${candidate?.current_location || 'Remote'} (${Math.round(metrics.locDist)}km away)`;
        
      summary = `Excellent alignment based on ${(candidate?.name || 'candidate')}'s ${(candidate?.years_of_experience || 0)} years of experience and ${matchedStr}. Candidate is ${locationStr} with salary expectations matching our parameters.`;
    }
  
    return {
      feature_score,
      embedding_score,
      ml_score,
      final_score,
      breakdown,
      summary
    };
}

export function setTrainedModel(model: RandomForestClassifier) {
    trainedModel = model;
    isModelTrained = true;
}

export function setActiveModelType(newType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted') {
    activeModelType = newType;
}

export function setRetrainingStatus(status: boolean) {
    isRetrainingInProgress = status;
}

export function updateLastTrainingTimestamp() {
    lastTrainingTimestamp = new Date().toISOString();
}
