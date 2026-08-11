/**
 * HTTP client for job-service's /internal/* APIs
 * Replaces monolith's unscoped job reads for RAG knowledge base
 */
import { JOB_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 30000; // Longer timeout for potentially large /all endpoint

export class JobServiceError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Job service returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  try {
    const res = await fetch(`${JOB_SERVICE_URL}/internal/jobs${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new JobServiceError(res.status, body);
    }
    return body as T;
  } catch (error) {
    if (!(error instanceof JobServiceError)) {
      logger.error({ err: (error as Error).message, target }, 'Job service call failed');
      throw new JobServiceError(502, { error: (error as Error).message });
    }
    throw error;
  }
}

export interface Job {
  id: number;
  company_id: number;
  title: string;
  description: string;
  location: string;
  required_skills: string[];
  experience_years: number;
  salary_min: number;
  salary_max: number;
  status: string;
}

/**
 * Get all jobs (unscoped, for RAG knowledge base reindex)
 * Used by: chat-service for /chat/reindex endpoint
 */
export async function getAllJobs(): Promise<{ jobs: Job[] }> {
  return call('all', '/all');
}
