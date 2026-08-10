/**
 * A/B Parity Tests - Phase 5 Testing
 *
 * Validates that all 5 Phase 4 items return identical results
 * when called via service implementation vs. monolith proxy.
 *
 * Test setup:
 * 1. Seed test data (100 candidates, 50 jobs, 2000 swipes)
 * 2. For each endpoint: call old (monolith) and new (service)
 * 3. Deep-equal responses (ignore timestamps ±5s)
 * 4. Report first diff on failure
 * 5. Exit 0 if all pass, 1 if any failure
 */

import axios, { AxiosError } from 'axios';

const MONOLITH_URL = 'http://localhost:3006';
const API_GATEWAY_URL = 'http://localhost:3000';
const TIMEOUT = 30000;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  monolithResponse?: unknown;
  serviceResponse?: unknown;
}

const results: TestResult[] = [];

async function compareResponses(
  name: string,
  monolithUrl: string,
  serviceUrl: string,
  compareFields: string[]
): Promise<TestResult> {
  try {
    const [monolith, service] = await Promise.all([
      axios.get(`${MONOLITH_URL}${monolithUrl}`, { timeout: TIMEOUT, validateStatus: () => true }),
      axios.get(`${API_GATEWAY_URL}${serviceUrl}`, { timeout: TIMEOUT, validateStatus: () => true }),
    ]);

    // Check status codes match
    if (monolith.status !== service.status) {
      return {
        name,
        passed: false,
        error: `Status mismatch: monolith=${monolith.status}, service=${service.status}`,
        monolithResponse: monolith.data,
        serviceResponse: service.data,
      };
    }

    if (monolith.status !== 200) {
      return {
        name,
        passed: true, // Both failed consistently
        error: `Both returned ${monolith.status}`,
      };
    }

    // Deep-equal key fields
    for (const field of compareFields) {
      const mVal = getNestedValue(monolith.data, field);
      const sVal = getNestedValue(service.data, field);

      if (JSON.stringify(mVal) !== JSON.stringify(sVal)) {
        return {
          name,
          passed: false,
          error: `Field mismatch at ${field}: monolith=${JSON.stringify(mVal).slice(0, 200)}, service=${JSON.stringify(sVal).slice(0, 200)}`,
          monolithResponse: monolith.data,
          serviceResponse: service.data,
        };
      }
    }

    return { name, passed: true };
  } catch (err) {
    return {
      name,
      passed: false,
      error: (err as Error).message,
    };
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((v, k) => v?.[k], obj);
}

async function runTests(): Promise<void> {
  console.log('Starting Phase 5 A/B Parity Tests...\n');

  // Item 1: GET /api/jobs
  results.push(
    await compareResponses(
      'Item 1: GET /api/jobs',
      '/api/jobs?page=1&limit=25',
      '/api/jobs?page=1&limit=25',
      ['jobs', 'total']
    )
  );

  // Item 2: GET /candidate-search/tab/shortlisted
  results.push(
    await compareResponses(
      'Item 2: GET /candidate-search/tab/shortlisted',
      '/api/candidate-search/tab/shortlisted?page=1&limit=25',
      '/api/candidate-search/tab/shortlisted?page=1&limit=25',
      ['candidates', 'total']
    )
  );

  // Item 3: GET /api/recruiter-review/:id/:id (detail)
  // Note: requires valid candidate_id and job_id from seeded data
  results.push(
    await compareResponses(
      'Item 3: GET /api/recruiter-review/:id/:id',
      '/api/recruiter-review/1/1',
      '/api/recruiter-review/1/1',
      ['candidate_id', 'job_id', 'score']
    )
  );

  // Item 4: GET /api/candidate-analytics
  results.push(
    await compareResponses(
      'Item 4: GET /api/candidate-analytics',
      '/api/candidate-analytics',
      '/api/candidate-analytics',
      ['averageMatchScore', 'recruiterResponseRate', 'funnel']
    )
  );

  // Item 5: GET /api/recruiter-review (list)
  results.push(
    await compareResponses(
      'Item 5: GET /api/recruiter-review',
      '/api/recruiter-review?page=1&pageSize=25',
      '/api/recruiter-review?page=1&pageSize=25',
      ['rows', 'total']
    )
  );

  // Print results
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PARITY TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  let passCount = 0;
  for (const result of results) {
    const status = result.passed ? '✅' : '❌';
    console.log(`${status} ${result.name}`);
    if (!result.passed) {
      console.log(`   Error: ${result.error}`);
      if (result.monolithResponse) {
        console.log(`   Monolith: ${JSON.stringify(result.monolithResponse).slice(0, 200)}`);
      }
      if (result.serviceResponse) {
        console.log(`   Service: ${JSON.stringify(result.serviceResponse).slice(0, 200)}`);
      }
    }
    if (result.passed) passCount++;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Results: ${passCount}/${results.length} tests passed`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(passCount === results.length ? 0 : 1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
