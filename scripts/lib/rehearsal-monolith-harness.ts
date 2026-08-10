// Rehearsal-only harness (Batch 2.5 cutover-mechanism rehearsal) - boots a minimal Express app
// exposing the REAL src/api/candidate-profile.routes.ts (unmodified, same file real traffic
// would hit), so the real shadow-validation hook (src/candidateShadow.ts) can be exercised
// end-to-end against a real running candidate-service instance. Not part of the application -
// the real monolith's own server.ts has many unrelated startup dependencies (Gemini, Twilio,
// Gmail, Vite) this harness deliberately skips, exactly like tests/candidate-internal.routes.test.ts
// already does for the internal API.
import express from 'express';
import cookieParser from 'cookie-parser';
import candidateProfileRoutes from '../../src/api/candidate-profile.routes.js';
import candidateInternalRoutes from '../../src/api/candidate-internal.routes.js';
import chatInternalRoutes from '../../src/api/chat-internal.routes.js';
import resumeInternalRoutes from '../../src/api/resume-internal.routes.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', candidateProfileRoutes);
app.use('/internal/candidate', candidateInternalRoutes);
app.use('/internal/chat', chatInternalRoutes);
app.use('/internal/resume', resumeInternalRoutes);

const PORT = parseInt(process.env.REHEARSAL_PORT || '14007', 10);
app.listen(PORT, () => {
  console.log(`rehearsal monolith harness listening on ${PORT}`);
});
