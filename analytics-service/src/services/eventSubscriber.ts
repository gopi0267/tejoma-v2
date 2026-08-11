/**
 * Event Subscriber Infrastructure for Analytics CQRS
 * Listens to Redis pub/sub channel and routes events to appropriate handlers
 */
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const CHANNEL = 'tejoma-realtime';

let subscriber: Redis | null = null;
let unsubscribe: (() => Promise<void>) | null = null;

export async function initializeEventSubscriber(
  handleJobCreated: (event: any) => Promise<void>,
  handleSwiped: (event: any) => Promise<void>,
  handleDecisionChanged: (event: any) => Promise<void>,
  handleCandidateUpdated: (event: any) => Promise<void>
): Promise<() => Promise<void>> {
  try {
    subscriber = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });

    subscriber.on('message', async (_channel: string, message: string) => {
      try {
        const { event, data } = JSON.parse(message);

        switch (event) {
          case 'job-created':
            await handleJobCreated(data);
            break;
          case 'swipe-completed':
            await handleSwiped(data);
            break;
          case 'recruiter-review-decision-changed':
            await handleDecisionChanged(data);
            break;
          case 'candidate-updated':
            await handleCandidateUpdated(data);
            break;
          default:
            // Ignore unknown events
            break;
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to process realtime event');
      }
    });

    subscriber.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis subscriber connection error');
    });

    await subscriber.subscribe(CHANNEL);
    logger.info({ channel: CHANNEL }, 'Subscribed to realtime events');

    // Return unsubscribe function
    return async () => {
      if (subscriber) {
        await subscriber.unsubscribe();
        subscriber.disconnect();
        subscriber = null;
      }
    };
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to initialize event subscriber');
    throw err;
  }
}

export async function closeEventSubscriber(): Promise<void> {
  if (unsubscribe) {
    await unsubscribe();
    unsubscribe = null;
  }
}

export function setUnsubscribe(fn: () => Promise<void>) {
  unsubscribe = fn;
}
