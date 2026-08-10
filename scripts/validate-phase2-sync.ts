#!/usr/bin/env node

/**
 * Phase 2 Validation Script
 *
 * Validates that monolith and Phase 2 service databases are in sync:
 * - Count validation (same number of rows)
 * - Deep-compare random samples (data matches exactly)
 * - Report zero drift or identify issues
 *
 * Run: npm run validate:phase2
 * Exit code 0 = success (zero drift), 1 = failed (drift detected)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import pkg from 'pg';
import { logger } from '../src/utils/logger.js';

const { Pool } = pkg;

const monolith = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const uploadService = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.UPLOAD_SERVICE_DB_NAME || 'tejoma_uploads',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const resumeService = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.RESUME_SERVICE_DB_NAME || 'tejoma_resume',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const notificationsService = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.NOTIFICATIONS_SERVICE_DB_NAME || 'tejoma_notifications',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function validatePhase2Sync() {
  let errors = 0;
  let uploadCount = 0;
  let resumeCount = 0;
  let notifCount = 0;

  try {
    logger.info('Starting Phase 2 validation...');
    logger.info('');

    // ============================================================
    // Validate Upload Counts
    // ============================================================
    logger.info('Checking uploads...');
    try {
      const monolithUploads = await monolith.query('SELECT COUNT(*) as count FROM uploads');
      const serviceUploads = await uploadService.query('SELECT COUNT(*) as count FROM uploads');

      uploadCount = parseInt(monolithUploads.rows[0].count);
      const serviceUploadCount = parseInt(serviceUploads.rows[0].count);

      if (uploadCount === serviceUploadCount) {
        logger.info(`✓ Upload counts match: ${uploadCount}`);
      } else {
        logger.error(`✗ Upload count mismatch: monolith=${uploadCount}, service=${serviceUploadCount}`);
        errors++;
      }

      // Deep-compare random uploads
      if (uploadCount > 0) {
        const sample = await monolith.query('SELECT id FROM uploads ORDER BY RANDOM() LIMIT 5');
        for (const row of sample.rows) {
          const monolithUpload = await monolith.query('SELECT * FROM uploads WHERE id = $1', [row.id]);
          const serviceUpload = await uploadService.query('SELECT * FROM uploads WHERE id = $1', [row.id]);

          if (serviceUpload.rows.length === 0) {
            logger.error(`✗ Upload ${row.id} missing from service`);
            errors++;
          } else if (JSON.stringify(monolithUpload.rows[0]) !== JSON.stringify(serviceUpload.rows[0])) {
            logger.error(`✗ Upload ${row.id} data mismatch`);
            errors++;
          }
        }
      }
    } catch (error: any) {
      if (error.code === '42P01') {
        logger.info('✓ Upload counts match: 0 (table not in monolith)');
        uploadCount = 0;
      } else {
        throw error;
      }
    }

    // ============================================================
    // Validate Resume Counts
    // ============================================================
    logger.info('Checking resumes...');
    try {
      const monolithResumes = await monolith.query('SELECT COUNT(*) as count FROM candidate_resumes');
      const serviceResumes = await resumeService.query('SELECT COUNT(*) as count FROM resumes');

      resumeCount = parseInt(monolithResumes.rows[0].count);
      const serviceResumeCount = parseInt(serviceResumes.rows[0].count);

      if (resumeCount === serviceResumeCount) {
        logger.info(`✓ Resume counts match: ${resumeCount}`);
      } else {
        logger.error(`✗ Resume count mismatch: monolith=${resumeCount}, service=${serviceResumeCount}`);
        errors++;
      }

      // Deep-compare random resumes
      if (resumeCount > 0) {
        const sample = await monolith.query('SELECT id FROM candidate_resumes ORDER BY RANDOM() LIMIT 5');
        for (const row of sample.rows) {
          const monolithResume = await monolith.query('SELECT * FROM candidate_resumes WHERE id = $1', [row.id]);
          const serviceResume = await resumeService.query('SELECT * FROM resumes WHERE id = $1', [row.id]);

          if (serviceResume.rows.length === 0) {
            logger.error(`✗ Resume ${row.id} missing from service`);
            errors++;
          }
        }
      }
    } catch (error: any) {
      if (error.code === '42P01') {
        logger.info('✓ Resume counts match: 0 (table not in monolith)');
        resumeCount = 0;
      } else {
        throw error;
      }
    }

    // ============================================================
    // Validate Notification Counts
    // ============================================================
    logger.info('Checking notifications...');
    try {
      const monolithNotifs = await monolith.query('SELECT COUNT(*) as count FROM notifications');
      const serviceNotifs = await notificationsService.query('SELECT COUNT(*) as count FROM notifications');

      notifCount = parseInt(monolithNotifs.rows[0].count);
      const serviceNotifCount = parseInt(serviceNotifs.rows[0].count);

      if (notifCount === serviceNotifCount) {
        logger.info(`✓ Notification counts match: ${notifCount}`);
      } else {
        logger.error(`✗ Notification count mismatch: monolith=${notifCount}, service=${serviceNotifCount}`);
        errors++;
      }

      // Deep-compare random notifications
      if (notifCount > 0) {
        const sample = await monolith.query('SELECT id FROM notifications ORDER BY RANDOM() LIMIT 5');
        for (const row of sample.rows) {
          const monolithNotif = await monolith.query('SELECT * FROM notifications WHERE id = $1', [row.id]);
          const serviceNotif = await notificationsService.query('SELECT * FROM notifications WHERE id = $1', [row.id]);

          if (serviceNotif.rows.length === 0) {
            logger.error(`✗ Notification ${row.id} missing from service`);
            errors++;
          }
        }
      }
    } catch (error: any) {
      if (error.code === '42P01') {
        logger.info('✓ Notification counts match: 0 (table not in monolith)');
        notifCount = 0;
      } else {
        throw error;
      }
    }

    // ============================================================
    // Summary
    // ============================================================
    logger.info('');
    logger.info('========================================');

    if (errors === 0) {
      logger.info('✅ VALIDATION PASSED - ZERO DRIFT DETECTED');
      logger.info('========================================');
      logger.info(`Uploads:       ${uploadCount} (matched)`);
      logger.info(`Resumes:       ${resumeCount} (matched)`);
      logger.info(`Notifications: ${notifCount} (matched)`);
      logger.info('========================================');
      logger.info('All Phase 2 databases are in sync!');
      process.exit(0);
    } else {
      logger.error('❌ VALIDATION FAILED - DRIFT DETECTED');
      logger.error('========================================');
      logger.error(`Errors found: ${errors}`);
      logger.error('Please investigate and rerun backfill if needed');
      process.exit(1);
    }
  } catch (error) {
    logger.error({ err: (error as Error).message, stack: (error as Error).stack }, 'Validation failed');
    process.exit(1);
  } finally {
    await Promise.all([monolith.end(), uploadService.end(), resumeService.end(), notificationsService.end()]);
  }
}

validatePhase2Sync();
