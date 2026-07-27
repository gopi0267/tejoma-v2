// Enterprise AI Matching Architecture, Phase 3 - Redis/BullMQ, fail-open.
//
// Replaces swipe.routes.ts's previous unconditional `trainModelOnStartup().catch(...)`
// fire-and-forget call after every swipe with a queued retrain job - but ONLY when Redis is
// actually reachable. Per explicit instruction: "Retraining jobs should be queued asynchronously
// when Redis is available and safely skipped with appropriate logging when it is not" - skipped,
// not a synchronous fallback. The swipe itself was already recorded and responded to before this
// runs either way, so recruiter/candidate workflows are completely unaffected by Redis's
// availability; only the background retrain side-effect is.
//
// Scope: this module only replaces the automatic per-swipe background retrain trigger. The
// admin-triggered POST /api/ml/train endpoint (src/api/ml.routes.ts) is a distinct, explicit
// user action expecting an immediate synchronous result and is deliberately left untouched -
// routing it through an async queue would change its response contract.
//
// Connection probing is intentionally short-timeout and re-attempted lazily on each call rather
// than cached as a permanent failure - so if Redis starts partway through a running server
// process, queued retraining picks up automatically on the next swipe without a restart.

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';
import { trainModelOnStartup } from '../services.js';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const QUEUE_NAME = 'match-ensemble-retrain';
const CONNECT_TIMEOUT_MS = 1500;

let queue: Queue | null = null;
let worker: Worker | null = null;
let queueConnection: Redis | null = null;
let workerConnection: Redis | null = null;
let establishing: Promise<Queue | null> | null = null;

async function probeRedis(): Promise<boolean> {
  const probe = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    connectTimeout: CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null, // never auto-retry the probe itself - one attempt, fail fast
  });
  // ioredis emits its own 'error' event on a failed connection attempt and logs an "Unhandled
  // error event" warning to the console if nothing is listening for it - the failure is already
  // handled below via the rejected connect() promise, so this only silences that redundant,
  // alarming-looking duplicate log line, not the actual failure handling.
  probe.on('error', () => {});
  try {
    await probe.connect();
    probe.disconnect();
    return true;
  } catch {
    try { probe.disconnect(); } catch { /* already disconnected */ }
    return false;
  }
}

async function getQueue(): Promise<Queue | null> {
  if (queue && queueConnection?.status === 'ready') return queue;
  if (establishing) return establishing;

  establishing = (async () => {
    const reachable = await probeRedis();
    if (!reachable) {
      logger.warn(
        { host: REDIS_HOST, port: REDIS_PORT },
        'Redis unavailable - background ensemble retraining skipped (fail-open; the swipe itself was still recorded normally)'
      );
      return null;
    }

    try {
      queueConnection = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });
      workerConnection = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });

      queue = new Queue(QUEUE_NAME, { connection: queueConnection });

      if (!worker) {
        worker = new Worker(
          QUEUE_NAME,
          async () => {
            await trainModelOnStartup();
          },
          { connection: workerConnection, concurrency: 1 }
        );
        worker.on('failed', (job, err) => {
          logger.warn({ err: err.message, jobId: job?.id }, 'Queued ensemble retrain job failed');
        });
      }

      logger.info({ host: REDIS_HOST, port: REDIS_PORT }, 'Connected to Redis - ensemble retraining is now queued via BullMQ');
      return queue;
    } catch (err: any) {
      logger.warn({ err: err.message, host: REDIS_HOST, port: REDIS_PORT }, 'Failed to establish BullMQ retrain queue - skipping (fail-open)');
      queue = null;
      return null;
    }
  })();

  const result = await establishing;
  establishing = null;
  return result;
}

// Never throws - a queueing failure must never break the swipe response that calls it.
export async function enqueueRetrain(): Promise<void> {
  try {
    const q = await getQueue();
    if (!q) return; // already logged in getQueue/probeRedis - genuinely skipped, not silently swallowed
    await q.add('retrain', {}, { removeOnComplete: true, removeOnFail: 50 });
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to enqueue ensemble retrain job - skipping (fail-open)');
  }
}

export async function closeRetrainQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await queueConnection?.quit().catch(() => {});
  await workerConnection?.quit().catch(() => {});
}
