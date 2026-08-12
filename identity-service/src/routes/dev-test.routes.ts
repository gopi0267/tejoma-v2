/**
 * Development-only test endpoints for creating test users.
 * ONLY available when NODE_ENV !== 'production'
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db.js';
import { signAccessToken, signCandidateAccessToken } from '../utils/tokens.js';
import { IS_PRODUCTION } from '../config/env.js';

const router = Router();

if (!IS_PRODUCTION) {
  router.post('/test/create-user', async (req, res) => {
    try {
      const { email, password, role = 'recruiter', company_id = 1, name = 'Test User' } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
      }

      if (!['recruiter', 'admin', 'superadmin', 'candidate'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      if (role === 'candidate') {
        // Create candidate account
        const candidateAccount = await db.createCandidateAccount({
          name,
          email,
          phone: null,
          password_hash: passwordHash,
        });

        if (!candidateAccount) {
          return res.status(500).json({ error: 'Failed to create candidate' });
        }

        const accessToken = signCandidateAccessToken({
          candidate_id: candidateAccount.id,
          email: candidateAccount.email,
          phone: candidateAccount.phone,
          name: candidateAccount.name,
        });

        return res.status(201).json({
          message: 'Test candidate created',
          email,
          password,
          access_token: accessToken,
          role: 'candidate',
        });
      } else {
        // Create staff user
        const staffUser = await db.createStaffUser({
          name,
          email,
          phone: null,
          passwordHash,
          companyId: company_id,
          role: role as 'recruiter' | 'admin' | 'superadmin',
          createdBy: null,
        });

        if (!staffUser) {
          return res.status(500).json({ error: 'Failed to create user' });
        }

        const accessToken = signAccessToken({
          user_id: staffUser.id,
          email: staffUser.email,
          name: staffUser.name,
          company_id: staffUser.company_id,
          role: staffUser.role,
        });

        return res.status(201).json({
          message: 'Test user created',
          email,
          password,
          access_token: accessToken,
          role,
          company_id,
        });
      }
    } catch (error: any) {
      console.error('Test user creation error:', error);
      res.status(500).json({ error: error.message || 'Failed to create test user' });
    }
  });
}

export default router;
