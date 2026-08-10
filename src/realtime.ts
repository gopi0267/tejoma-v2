import express from 'express';
import { subscribeToRealtimeEvents, publishRealtimeEvent } from './realtimeBroadcast.js';
import { logger } from './utils/logger.js';

export const clients: express.Response[] = [];
let unsubscribe: (() => Promise<void>) | null = null;

// Deprecated: use publishRealtimeEvent from realtimeBroadcast.ts instead (routes using this are dead code).
// This alias exists only to unblock compilation of dead route files awaiting cleanup.
export async function broadcastEvent(event: string, data: any): Promise<void> {
  await publishRealtimeEvent(event, data);
}

// Initialize Redis subscription for SSE forwarding.
// Called once at server startup by server.ts.
export async function initializeRealtimeSubscription(): Promise<void> {
  try {
    unsubscribe = await subscribeToRealtimeEvents((event: string, data: any) => {
      forwardToSSEClients(event, data);
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize realtime subscription - SSE will still work, but will not receive events from services');
  }
}

// Forward a realtime event to all connected SSE clients.
// Called by the Redis subscription handler to broadcast events.
function forwardToSSEClients(event: string, data: any): void {
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  clients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      logger.warn({ err: e }, 'Failed to send SSE payload to client');
    }
  });
}

export async function closeRealtimeSubscription(): Promise<void> {
  if (unsubscribe) {
    await unsubscribe();
    unsubscribe = null;
  }
}
