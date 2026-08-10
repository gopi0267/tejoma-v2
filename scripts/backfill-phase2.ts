#!/usr/bin/env node

/**
 * Phase 2 Backfill Script
 *
 * Backfills all Phase 2 service databases from monolith:
 * - uploads (tejoma_uploads) from tejoma_recruiting.uploads
 * - resumes (tejoma_resume) from tejoma_recruiting.candidate_resumes
 * - notifications (tejoma_notifications) from tejoma_recruiting.notifications
 *
 * Run: npm run backfill:phase2
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

async function backfillPhase2() {
  let uploads = [];
  let resumes = [];
  let notifications = [];

  try {
    logger.info('Starting Phase 2 backfill...');

    // ============================================================
    // Backfill Uploads (expected: table doesn't exist in monolith yet)
    // ============================================================
    logger.info('Backfilling uploads...');
    try {
      const uploadsResult = await monolith.query('SELECT * FROM uploads ORDER BY id');
      uploads = uploadsResult.rows;
      logger.info(`Found ${uploads.length} uploads to backfill`);

      for (const upload of uploads) {
        await uploadService.query(
          `INSERT INTO uploads (id, company_id, candidate_id, recruiter_id, file_name, file_type, mime_type, file_size_bytes, storage_key, upload_status, error_message, file_hash, virus_scan_status, virus_scan_timestamp, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
          [
            upload.id,
            upload.company_id,
            upload.candidate_id,
            upload.recruiter_id,
            upload.file_name,
            upload.file_type,
            upload.mime_type,
            upload.file_size_bytes,
            upload.storage_key,
            upload.upload_status,
            upload.error_message,
            upload.file_hash,
            upload.virus_scan_status,
            upload.virus_scan_timestamp,
            upload.created_at,
            upload.updated_at,
          ]
        );
      }
      logger.info(`✓ Backfilled ${uploads.length} uploads`);
    } catch (error: any) {
      if (error.code === '42P01') {
        logger.info('✓ No uploads table in monolith (expected - Phase 1 new table)');
        uploads = [];
      } else {
        throw error;
      }
    }

    // ============================================================
    // Backfill Resumes (expected: table doesn't exist in monolith yet)
    // ============================================================
    logger.info('Backfilling resumes...');
    try {
      const resumesResult = await monolith.query(
        `SELECT id, upload_id, company_id, candidate_id, recruiter_id, extracted_text, skills, experience_years, education, extraction_status, extraction_error, skills_confidence, extracted_at, created_at, updated_at FROM candidate_resumes ORDER BY id`
      );
      resumes = resumesResult.rows;
      logger.info(`Found ${resumes.length} resumes to backfill`);

      for (const resume of resumes) {
        await resumeService.query(
          `INSERT INTO resumes (id, upload_id, company_id, candidate_id, recruiter_id, extracted_text, skills, experience_years, education, extraction_status, extraction_error, skills_confidence, extracted_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
          [
            resume.id,
            resume.upload_id,
            resume.company_id,
            resume.candidate_id,
            resume.recruiter_id,
            resume.extracted_text,
            resume.skills,
            resume.experience_years,
            resume.education,
            resume.extraction_status,
            resume.extraction_error,
            resume.skills_confidence,
            resume.extracted_at,
            resume.created_at,
            resume.updated_at,
          ]
        );
      }
      logger.info(`✓ Backfilled ${resumes.length} resumes`);
    } catch (error: any) {
      if (error.code === '42P01') {
        logger.info('✓ No resumes table in monolith (expected - Phase 1 new table)');
        resumes = [];
      } else {
        throw error;
      }
    }

    // ============================================================
    // Backfill Notifications
    // ============================================================
    logger.info('Backfilling notifications...');
    try {
      const notificationsResult = await monolith.query('SELECT * FROM notifications ORDER BY id');
      notifications = notificationsResult.rows;
      logger.info(`Found ${notifications.length} notifications to backfill`);

      for (const notif of notifications) {
        await notificationsService.query(
          `INSERT INTO notifications (id, company_id, recipient_user_id, sender_user_id, notification_type, title, message, data, read_at, deleted_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
          [
            notif.id,
            notif.company_id,
            notif.recipient_user_id,
            notif.sender_user_id,
            notif.notification_type,
            notif.title,
            notif.message,
            notif.data,
            notif.read_at,
            notif.deleted_at,
            notif.created_at,
            notif.updated_at,
          ]
        );
      }
      logger.info(`✓ Backfilled ${notifications.length} notifications`);
    } catch (error: any) {
      if (error.code === '42P01') {
        logger.info('✓ No notifications table in monolith (expected if Phase 1 is isolated)');
        notifications = [];
      } else {
        throw error;
      }
    }

    // ============================================================
    // Summary
    // ============================================================
    logger.info('');
    logger.info('========================================');
    logger.info('Phase 2 Backfill Complete');
    logger.info('========================================');
    logger.info(`Uploads:       ${uploads.length}`);
    logger.info(`Resumes:       ${resumes.length}`);
    logger.info(`Notifications: ${notifications.length}`);
    logger.info('========================================');
    logger.info('Next: Run validation script to check for zero drift');

    process.exit(0);
  } catch (error) {
    logger.error({ err: (error as Error).message, stack: (error as Error).stack }, 'Backfill failed');
    process.exit(1);
  } finally {
    await Promise.all([monolith.end(), uploadService.end(), resumeService.end(), notificationsService.end()]);
  }
}

backfillPhase2();
