import { Express } from 'express';
import healthRouter from './health.routes.js';
import authRouter from './auth.routes.js';
import candidateRouter from './candidate.routes.js';
import jobRouter from './job.routes.js';
import swipeRouter from './swipe.routes.js';
import analyticsRouter from './analytics.routes.js';
import mlRouter from './ml.routes.js';
import uploadRouter from './upload.routes.js';
import chatRouter from './chat.routes.js';
import jdParserRouter from './jd-parser.routes.js';
import recruiterReviewRouter from './recruiter-review.routes.js';
import usersRouter from './users.routes.js';
import companyRequestsRouter from './company-requests.routes.js';

export function registerApiRoutes(app: Express) {
    app.use('/api', healthRouter);
    app.use('/api', authRouter);
    // companyRequestsRouter must be mounted here, before any router below that applies
    // `router.use(requireAuth, ...)` unconditionally (candidate/job/swipe/analytics/ml/upload/
    // chat/jd-parser/recruiter-review/users) - that pattern gates every path reaching that
    // router, not just its own routes, since it's mounted at the same '/api' prefix with no
    // sub-path. companyRequestsRouter's POST /company-registration is deliberately public, so
    // it has to be reached before any of those blanket auth gates short-circuit the request.
    app.use('/api', companyRequestsRouter);
    app.use('/api', candidateRouter);
    app.use('/api', jobRouter);
    app.use('/api', swipeRouter);
    app.use('/api', analyticsRouter);
    app.use('/api', mlRouter);
    app.use('/api', uploadRouter);
    app.use('/api', chatRouter);
    app.use('/api', jdParserRouter);
    app.use('/api', recruiterReviewRouter);
    app.use('/api', usersRouter);
}
