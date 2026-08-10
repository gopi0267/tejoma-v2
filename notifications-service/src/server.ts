import './config/env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { logger } from './utils/logger.js';
import { IS_PRODUCTION } from './config/env.js';
import healthRoutes from './routes/health.routes.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3006',
    credentials: true,
  },
});

app.disable('x-powered-by');

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3006')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

// Request ID middleware
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  (req as any).requestId = req.headers['x-request-id'] || require('crypto').randomUUID();
  res.setHeader('x-request-id', (req as any).requestId);
  next();
});

// Logging middleware
app.use(pinoHttp({ logger }));

app.use('/', healthRoutes);

app.get('/metrics', async (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), connections: io.engine.clientsCount });
});

// Socket.io connection handler
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Client connected');

  // Authenticate user (would verify JWT in production)
  socket.on('authenticate', (data: { token: string; userId: number; companyId: number }) => {
    socket.data.userId = data.userId;
    socket.data.companyId = data.companyId;
    socket.join(`user:${data.userId}`);
    socket.join(`company:${data.companyId}`);
    logger.info({ socketId: socket.id, userId: data.userId }, 'User authenticated');
  });

  // Handle notification read
  socket.on('notification:read', (notificationId: number) => {
    logger.debug({ socketId: socket.id, notificationId }, 'Notification marked read');
    socket.emit('notification:read-ack', { id: notificationId });
  });

  // Handle notification delete
  socket.on('notification:delete', (notificationId: number) => {
    logger.debug({ socketId: socket.id, notificationId }, 'Notification deleted');
    socket.emit('notification:delete-ack', { id: notificationId });
  });

  // Heartbeat/ping
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, 'Client disconnected');
  });
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err?.message, stack: err?.stack, path: req.path, method: req.method }, 'Unhandled request error');
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: IS_PRODUCTION ? 'Internal server error' : err?.message || 'Internal server error',
  });
});

export { app, httpServer, io };
