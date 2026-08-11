/**
 * Chat Service Internal API (Mirror endpoints for RAG indexing)
 *
 * Item 8 (RAG Indexing Cutover): Receive mirrored RAG chunks from job-service and
 * candidate-core-service for dual-write consistency during transition.
 * Network-boundary trusted, no JWT.
 */
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.post('/knowledge-base/upsert', async (req, res) => {
  try {
    const { company_id, source_type, source_id, content, embedding } = req.body;
    if (!company_id || !source_type || !source_id || !content || !embedding) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await db.upsertKnowledgeChunk({ company_id, source_type, source_id, content, embedding });
    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal] knowledge-base/upsert error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/knowledge-base/delete', async (req, res) => {
  try {
    const { source_type, source_id } = req.body;
    if (!source_type || !source_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await db.query(
      'DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2',
      [source_type, source_id]
    );
    res.status(200).json({ deleted: true });
  } catch (error: any) {
    console.error('[internal] knowledge-base/delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
