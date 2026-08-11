/**
 * HTTP client for candidate-core-service's /internal/* APIs
 * Replaces monolith's unscoped candidate reads for RAG knowledge base
 */
import { CANDIDATE_CORE_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 30000; // Longer timeout for potentially large /all endpoint

export class CandidateCoreServiceError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Candidate core service returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  try {
    const res = await fetch(`${CANDIDATE_CORE_SERVICE_URL}/internal/candidates${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new CandidateCoreServiceError(res.status, body);
    }
    return body as T;
  } catch (error) {
    if (!(error instanceof CandidateCoreServiceError)) {
      logger.error({ err: (error as Error).message, target }, 'Candidate core service call failed');
      throw new CandidateCoreServiceError(502, { error: (error as Error).message });
    }
    throw error;
  }
}

export interface Candidate {
  id: number;
  company_id: number;
  name: string;
  email: string;
  skills: string[];
  years_of_experience: number;
  current_location: string;
  resume_text: string;
}

/**
 * Get all candidates (unscoped, for RAG knowledge base reindex)
 * Used by: chat-service for /chat/reindex endpoint
 */
export async function getAllCandidates(): Promise<{ candidates: Candidate[] }> {
  return call('all', '/all');
}
