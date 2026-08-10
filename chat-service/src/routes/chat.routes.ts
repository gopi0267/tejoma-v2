/**
 * Ported from the monolith's src/api/chat.routes.ts - same model, same system-instruction
 * template, same history-trimming, same response shape. The two things this domain doesn't own
 * (candidate/job counts for "PLATFORM STATS", and unscoped candidate/job lists for /chat/reindex)
 * are fetched from the monolith's new /internal/chat/* API (services/monolithClient.ts) instead
 * of computed locally - see that file's header comment.
 */
import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { retrieveRelevantChunks, reindexAllCandidates, reindexAllJobs } from '../services/ragService.js';
import { getPlatformStats, getAllCandidatesUnscoped, getAllJobsUnscoped, MonolithProxyError } from '../services/monolithClient.js';
import { GEMINI_API_KEY } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { chatRequestCount, chatGenerationDuration } from '../utils/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

// Same model as parser.service.ts/embeddings.ts - the only one confirmed reachable on the
// available API key/quota (gemini-2.5-flash/pro, gemini-2.0-flash* all 404; gemini-3.x/pro-latest
// all 429).
const CHAT_MODEL = 'gemini-flash-lite-latest';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MAX_HISTORY_TURNS = 10;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function buildSystemInstruction(candidateCount: number, jobCount: number, retrievedContext: string): string {
  return `You are the Tejoma AI Assistant, embedded inside a recruiting platform's dashboard. You help recruiters find and understand candidates and open job positions using ONLY the retrieved data below - you have no other source of truth.

RULES:
1. Answer using ONLY the retrieved context and the platform stats provided below. Never invent candidates, skills, companies, job titles, or numbers that are not present in the context.
2. If the retrieved context doesn't contain enough information to answer the question, say so plainly and suggest checking the Candidates or Job Positions page directly - do not guess.
3. When referencing a specific candidate or job, mention their name/title so the recruiter can find them in the platform.
4. For questions about exact totals or counts, use ONLY the platform-wide stats given below. The retrieved context below is a small relevant sample, not the full dataset, so never infer a count from how many items happen to appear in it.
5. Be concise and professional - this is a workplace productivity tool, not a general-purpose chatbot. Do not discuss anything unrelated to recruiting, candidates, or jobs on this platform.

PLATFORM STATS (authoritative - use these for any "how many" questions):
- Total candidates in the talent pool: ${candidateCount}
- Open job positions at your company: ${jobCount}

RETRIEVED CONTEXT (most relevant candidates/jobs for the current question, ranked by relevance):
${retrievedContext || '(No sufficiently relevant candidates or jobs were found for this question.)'}`;
}

router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body as { message?: string; history?: ChatTurn[] };
    const companyId = req.user!.company_id;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const [chunks, stats] = await Promise.all([
      retrieveRelevantChunks(message, companyId),
      getPlatformStats(companyId),
    ]);

    const retrievedContext = chunks
      .map((c, i) => `[${i + 1}] (${c.source_type}, relevance ${(c.score * 100).toFixed(0)}%) ${c.content}`)
      .join('\n\n');

    const systemInstruction = buildSystemInstruction(stats.candidateCount, stats.jobCount, retrievedContext);

    const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
    const contents = [
      ...trimmedHistory.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const genStart = process.hrtime.bigint();
    const response = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction,
        temperature: 0.3,
      },
    });
    chatGenerationDuration.observe(Number(process.hrtime.bigint() - genStart) / 1e9);

    const reply = response.text?.trim() || "I couldn't generate a response - please try rephrasing your question.";

    chatRequestCount.inc({ outcome: 'success' });
    res.json({
      reply,
      sources: chunks.map((c) => ({ source_type: c.source_type, source_id: c.source_id, relevance: c.score })),
    });
  } catch (error: any) {
    chatRequestCount.inc({ outcome: 'error' });
    if (error instanceof MonolithProxyError) {
      logger.error({ status: error.status }, 'Chat request failed - could not reach monolith for platform stats');
      return res.status(502).json({ error: 'Failed to generate a response. Please try again.' });
    }
    logger.error({ err: error.message }, 'Chat request failed');
    res.status(500).json({ error: 'Failed to generate a response. Please try again.' });
  }
});

// Admin-triggered resync of the RAG knowledge base.
router.post('/chat/reindex', requireRole('admin'), async (_req, res) => {
  try {
    const [candidatesResult, jobsResult] = await Promise.all([getAllCandidatesUnscoped(), getAllJobsUnscoped()]);
    const [candidateResult, jobResult] = await Promise.all([
      reindexAllCandidates(candidatesResult.candidates),
      reindexAllJobs(jobsResult.jobs),
    ]);
    res.json({ success: true, candidates: candidateResult, jobs: jobResult });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Knowledge base reindex failed');
    const status = error instanceof MonolithProxyError ? 502 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
