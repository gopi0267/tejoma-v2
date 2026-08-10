import { Express } from 'express';
import healthRouter from './health.routes.js';

export function registerApiRoutes(app: Express) {
    // Only health remains active on the monolith.
    // All other /api/* routes are now handled by the API Gateway routing to microservices.
    // (Recruiter notifications were migrated to recruiting-service via gateway routing)
    app.use('/api', healthRouter);
}
