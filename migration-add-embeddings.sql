-- Migration: Add resume_embedding column to candidates table
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_embedding double precision[] DEFAULT NULL;
