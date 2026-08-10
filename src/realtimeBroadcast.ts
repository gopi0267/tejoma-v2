// Item 2: Decentralize real-time notifications via Redis pub/sub.
// This module replaces the monolith's in-process broadcastEvent with Redis pub/sub,
// so services can publish events without round-tripping through the monolith.
// The monolith still hosts GET /api/realtime/stream (SSE), but now subscribes to Redis
// and forwards messages to its connected clients instead of receiving calls directly.

import Redis from 'ioredis';
import { logger } from './utils/logger.js';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const CHANNEL = 'tejoma-realtime';

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });
    publisher.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis publisher connection failed (realtime events will not be published)');
    });
  }
  return publisher;
}

// Publish an event to Redis - never fails (fail-open: if Redis is unavailable, the event is silently dropped).
export async function publishRealtimeEvent(event: string, data: any): Promise<void> {
  try {
    const publisher = getPublisher();
    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    await publisher.publish(CHANNEL, payload);
  } catch (err: any) {
    logger.warn({ err: err.message, event }, 'Failed to publish realtime event (fail-open)');
  }
}

// Subscribe to events and call a callback for each one.
// Used by the monolith's SSE endpoint to forward Redis events to connected clients.
export async function subscribeToRealtimeEvents(callback: (event: string, data: any) => void): Promise<() => Promise<void>> {
  try {
    const subscriber = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });

    subscriber.on('message', (_channel: string, message: string) => {
      try {
        const { event, data } = JSON.parse(message);
        callback(event, data);
      } catch (err) {
        logger.warn({ err }, 'Failed to parse realtime event from Redis');
      }
    });

    subscriber.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis subscriber connection failed (realtime events will not be received)');
    });

    await subscriber.subscribe(CHANNEL);
    logger.info('Subscribed to realtime events on Redis');

    // Return an unsubscribe function.
    return async () => {
      await subscriber.unsubscribe();
      subscriber.disconnect();
    };
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to subscribe to realtime events');
    throw err;
  }
}

export async function closePublisher(): Promise<void> {
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }
}
