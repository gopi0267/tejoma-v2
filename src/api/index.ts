import { Express } from 'express';
import healthRouter from './health.routes.js';
import recruiterNotificationsRouter from './recruiter-notifications.routes.js';

export function registerApiRoutes(app: Express) {
    // Only health and recruiter notifications remain active.
    // All other /api/* routes are now handled by the API Gateway routing to microservices.
    app.use('/api', healthRouter);
    app.use('/api', recruiterNotificationsRouter);
}
