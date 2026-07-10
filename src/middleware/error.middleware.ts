import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Safety net for anything that escapes the try/catch already present in each route handler
// (malformed JSON bodies, synchronous throws, middleware failures, etc).
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }
  logger.error({ err: err?.message, stack: err?.stack, path: req.path, method: req.method }, 'Unhandled request error');
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err?.message || 'Internal server error'),
  });
}
