import { Router } from 'express';
import { pool } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Health check failed');
    res.status(503).json({ status: 'error' });
  }
});

router.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Ready check failed');
    res.status(503).json({ status: 'not ready' });
  }
});

export default router;
