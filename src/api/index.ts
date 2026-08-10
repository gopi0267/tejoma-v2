import { Express } from 'express';
import healthRouter from './health.routes.js';
import authRouter from './auth.routes.js';
import jobRouter from './job.routes.js';
import swipeRouter from './swipe.routes.js';
import analyticsRouter from './analytics.routes.js';
import mlRouter from './ml.routes.js';
import chatRouter from './chat.routes.js';
import jdParserRouter from './jd-parser.routes.js';
import recruiterReviewRouter from './recruiter-review.routes.js';
import usersRouter from './users.routes.js';
import companyRequestsRouter from './company-requests.routes.js';
import candidateAuthRouter from './candidate-auth.routes.js';
import candidateProfileRouter from './candidate-profile.routes.js';
import candidateResumeRouter from './candidate-resume.routes.js';
import candidateJobsRouter from './candidate-jobs.routes.js';
import candidateDecisionsRouter from './candidate-decisions.routes.js';
import candidateMatchesRouter from './candidate-matches.routes.js';
import recruiterMatchesRouter from './recruiter-matches.routes.js';
import candidateNotificationsRouter from './candidate-notifications.routes.js';
import recruiterNotificationsRouter from './recruiter-notifications.routes.js';
import candidateApplicationsRouter from './candidate-applications.routes.js';
import candidateAnalyticsRouter from './candidate-analytics.routes.js';
import candidateSearchRouter from './candidate-search.routes.js';

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
    // Same reasoning applies to every candidate-facing router and jobRouter below - they each
    // apply `router.use(requireAuth, requireRole('recruiter', 'admin'))` to all sub-paths
    // unconditionally, which would 401 every /api/candidate-*/* request (a candidate never holds
    // a staff access_token cookie) before it ever reached these routers, even though each one is
    // already self-gated by requireCandidateAuth per-route. All must be mounted first.
    app.use('/api', candidateAuthRouter);
    app.use('/api', candidateProfileRouter);
    app.use('/api', candidateResumeRouter);
    app.use('/api', candidateJobsRouter);
    app.use('/api', candidateDecisionsRouter);
    app.use('/api', candidateMatchesRouter);
    app.use('/api', candidateNotificationsRouter);
    app.use('/api', candidateApplicationsRouter);
    app.use('/api', candidateAnalyticsRouter);
    app.use('/api', jobRouter);
    app.use('/api', swipeRouter);
    app.use('/api', analyticsRouter);
    app.use('/api', mlRouter);
    app.use('/api', chatRouter);
    app.use('/api', jdParserRouter);
    app.use('/api', recruiterReviewRouter);
    app.use('/api', recruiterMatchesRouter);
    app.use('/api', recruiterNotificationsRouter);
    app.use('/api', candidateSearchRouter);
    app.use('/api', usersRouter);
}
