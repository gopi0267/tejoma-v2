import { Express } from 'express';
import authRouter from './auth.routes.js';
import candidateRouter from './candidate.routes.js';
import jobRouter from './job.routes.js';
import swipeRouter from './swipe.routes.js';
import analyticsRouter from './analytics.routes.js';
import mlRouter from './ml.routes.js';
import uploadRouter from './upload.routes.js';
import chatRouter from './chat.routes.js';
import jdParserRouter from './jd-parser.routes.js';

export function registerApiRoutes(app: Express) {
    app.use('/api', authRouter);
    app.use('/api', candidateRouter);
    app.use('/api', jobRouter);
    app.use('/api', swipeRouter);
    app.use('/api', analyticsRouter);
    app.use('/api', mlRouter);
    app.use('/api', uploadRouter);
    app.use('/api', chatRouter);
    app.use('/api', jdParserRouter);
}
