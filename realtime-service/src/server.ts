/**
 * Realtime Service - Phase D Item 2
 * Dedicated microservice for real-time event streaming via SSE (Server-Sent Events).
 * Subscribes to Redis pub/sub channel and forwards events to connected SSE clients.
 * This removes SSE responsibility from the monolith, making it stateless.
 */

import express, { Express, Response } from 'express';
import pinoHttp from 'pino-http';
import Redis from 'ioredis';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '4030', 10);
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const CHANNEL = 'tejoma-realtime';

const app: Express = express();
const clients: Response[] = [];
let subscriber: Redis | null = null;

app.use(pinoHttp({ logger }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// SSE endpoint - replaced from monolith's GET /api/realtime/stream
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  clients.push(res);
  logger.info({ clientCount: clients.length }, 'SSE client connected');

  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
      logger.info({ clientCount: clients.length }, 'SSE client disconnected');
    }
  });
});

function broadcastEvent(event: string, data: any): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let disconnected = 0;

  clients.forEach((client) => {
    try {
      client.write(payload);
    } catch (e) {
      disconnected++;
      logger.warn({ err: e }, 'Failed to send SSE payload to client');
    }
  });

  if (disconnected > 0) {
    // Clean up dead clients in next iteration
    const alive = clients.filter((c) => !c.writableEnded);
    clients.length = 0;
    clients.push(...alive);
  }
}

async function initializeRedisSubscription(): Promise<void> {
  try {
    subscriber = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });

    subscriber.on('message', (_channel: string, message: string) => {
      try {
        const { event, data } = JSON.parse(message);
        broadcastEvent(event, data);
      } catch (err) {
        logger.warn({ err }, 'Failed to parse realtime event from Redis');
      }
    });

    subscriber.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis subscriber connection error');
    });

    await subscriber.subscribe(CHANNEL);
    logger.info({ channel: CHANNEL }, 'Subscribed to Redis pub/sub channel');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to initialize Redis subscription');
    throw err;
  }
}

async function closeRedisSubscription(): Promise<void> {
  if (subscriber) {
    await subscriber.unsubscribe();
    subscriber.disconnect();
    subscriber = null;
  }
}

async function startServer() {
  try {
    await initializeRedisSubscription();

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'Realtime service started');
    });

    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'Shutdown signal received');

      server.close(async () => {
        await closeRedisSubscription();
        logger.info('Shutdown complete');
        process.exit(0);
      });

      setTimeout(() => {
        logger.warn('Force exit after 10s');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to start realtime service');
    process.exit(1);
  }
}

startServer();
