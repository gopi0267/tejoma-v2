#!/usr/bin/env node

/**
 * Phase 1 Database Setup
 *
 * Creates the three Phase 1 service databases and runs their migrations.
 * Must be run before Phase 2 backfill.
 *
 * Run: npm run setup:phase1-dbs
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import pkg from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../src/utils/logger.js';

const { Pool, Client } = pkg;

async function setupPhase1Databases() {
  const adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    logger.info('Setting up Phase 1 service databases...');

    // Create upload-service database
    logger.info('Creating tejoma_uploads database...');
    try {
      await adminPool.query('CREATE DATABASE tejoma_uploads');
      logger.info('✓ Created tejoma_uploads');
    } catch (error: any) {
      if (error.code === '42P04') {
        logger.info('✓ tejoma_uploads already exists');
      } else {
        throw error;
      }
    }

    // Create resume-service database
    logger.info('Creating tejoma_resume database...');
    try {
      await adminPool.query('CREATE DATABASE tejoma_resume');
      logger.info('✓ Created tejoma_resume');
    } catch (error: any) {
      if (error.code === '42P04') {
        logger.info('✓ tejoma_resume already exists');
      } else {
        throw error;
      }
    }

    // Create notifications-service database
    logger.info('Creating tejoma_notifications database...');
    try {
      await adminPool.query('CREATE DATABASE tejoma_notifications');
      logger.info('✓ Created tejoma_notifications');
    } catch (error: any) {
      if (error.code === '42P04') {
        logger.info('✓ tejoma_notifications already exists');
      } else {
        throw error;
      }
    }

    await adminPool.end();

    // Run migrations for each database
    logger.info('Running migrations...');

    // Upload service migrations
    logger.info('Migrating tejoma_uploads...');
    const uploadPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: 'tejoma_uploads',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

    const uploadMigration = readFileSync(
      resolve('./upload-service/migrations/001_initial.up.sql'),
      'utf-8'
    );
    await uploadPool.query(uploadMigration);
    logger.info('✓ tejoma_uploads migrated');
    await uploadPool.end();

    // Resume service migrations
    logger.info('Migrating tejoma_resume...');
    const resumePool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: 'tejoma_resume',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

    const resumeMigration = readFileSync(
      resolve('./resume-service/migrations/001_initial.up.sql'),
      'utf-8'
    );
    await resumePool.query(resumeMigration);
    logger.info('✓ tejoma_resume migrated');
    await resumePool.end();

    // Notifications service migrations
    logger.info('Migrating tejoma_notifications...');
    const notificationsPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: 'tejoma_notifications',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

    const notificationsMigration = readFileSync(
      resolve('./notifications-service/migrations/001_initial.up.sql'),
      'utf-8'
    );
    await notificationsPool.query(notificationsMigration);
    logger.info('✓ tejoma_notifications migrated');
    await notificationsPool.end();

    logger.info('');
    logger.info('========================================');
    logger.info('Phase 1 Database Setup Complete');
    logger.info('========================================');
    logger.info('✓ tejoma_uploads ready for Phase 2');
    logger.info('✓ tejoma_resume ready for Phase 2');
    logger.info('✓ tejoma_notifications ready for Phase 2');
    logger.info('');
    logger.info('Next: Run npm run backfill:phase2');

    process.exit(0);
  } catch (error) {
    logger.error('Database setup failed', { error });
    process.exit(1);
  }
}

setupPhase1Databases();
