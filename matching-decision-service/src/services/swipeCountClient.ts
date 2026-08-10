import fetch from 'node-fetch';

interface SwipeCountResponse {
  [jobId: string]: {
    total: number;
    accepted: number;
    rejected: number;
    pending: number;
  };
}

export class SwipeCountClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getSwipeCountsByJob(companyId: string, timeout = 5000): Promise<SwipeCountResponse> {
    try {
      const response = await Promise.race([
        fetch(`${this.baseUrl}/internal/swipes/counts-by-job?companyId=${companyId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeout)
        ),
      ]) as any;

      if (!response.ok) {
        console.error(`SwipeCountClient error: ${response.status}`);
        return {}; // Graceful degradation
      }

      return await response.json();
    } catch (error) {
      console.error('SwipeCountClient.getSwipeCountsByJob error:', error);
      return {}; // Fire-and-forget: never block
    }
  }
}
