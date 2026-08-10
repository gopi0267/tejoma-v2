import { logger } from '../../utils/logger.js';
import type { ParsedJobDescription } from '../types.js';

// HTTP client for the Python NLP microservice (spaCy PhraseMatcher + GLiNER, see
// python-services/jd-nlp-service). This tier is intentionally optional and resilient: if the
// service is unreachable, slow, or returns nothing useful, the pipeline still returns a fully
// valid result built from Tiers 1-2 alone - a down Python service must never break JD parsing.
const NLP_SERVICE_URL = process.env.JD_NLP_SERVICE_URL || 'http://localhost:8008';
const NLP_TIMEOUT_MS = 2000;

export interface NlpTierRequest {
  text: string;
  // Only ask the NLP tier for fields Tiers 1-2 didn't resolve, to protect the latency budget -
  // most JDs won't need this tier invoked for most fields at all.
  neededFields: string[];
}

interface NlpServiceResponse {
  jobTitle?: string | null;
  industry?: string | null;
  department?: string | null;
  responsibilities?: string[];
  jobSummary?: string | null;
  location?: string[];
}

export interface NlpTierResult {
  fields: Partial<Pick<ParsedJobDescription, 'jobTitle' | 'industry' | 'department' | 'responsibilities' | 'jobSummary' | 'location'>>;
  resolvedFields: string[];
  serviceAvailable: boolean;
}

export async function runNlpTier(request: NlpTierRequest): Promise<NlpTierResult> {
  if (request.neededFields.length === 0) {
    return { fields: {}, resolvedFields: [], serviceAvailable: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NLP_TIMEOUT_MS);

  try {
    const res = await fetch(`${NLP_SERVICE_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      logger.warn({ status: res.status }, 'JD NLP service returned a non-OK status');
      return { fields: {}, resolvedFields: [], serviceAvailable: false };
    }

    const data = (await res.json()) as NlpServiceResponse;
    const fields: NlpTierResult['fields'] = {};
    const resolvedFields: string[] = [];

    if (data.jobTitle) { fields.jobTitle = data.jobTitle; resolvedFields.push('jobTitle'); }
    if (data.industry) { fields.industry = data.industry; resolvedFields.push('industry'); }
    if (data.department) { fields.department = data.department; resolvedFields.push('department'); }
    if (data.jobSummary) { fields.jobSummary = data.jobSummary; resolvedFields.push('jobSummary'); }
    if (data.responsibilities?.length) { fields.responsibilities = data.responsibilities; resolvedFields.push('responsibilities'); }
    if (data.location?.length) { fields.location = data.location; resolvedFields.push('location'); }

    return { fields, resolvedFields, serviceAvailable: true };
  } catch (err: any) {
    clearTimeout(timeoutId);
    // Not an error-level log - an unreachable NLP service is an expected, handled condition
    // (e.g. in dev, or before the microservice is deployed), not a pipeline failure.
    logger.debug({ err: err.message }, 'JD NLP service unavailable, continuing with Tier 1-2 results only');
    return { fields: {}, resolvedFields: [], serviceAvailable: false };
  }
}
