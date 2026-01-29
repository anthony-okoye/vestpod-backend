-- =====================================================
-- Migration: Split full_name into first_name and last_name
-- =====================================================
-- Changes user_profiles table to use separate first and last name fields
-- for better data structure and mobile app requirements

-- Drop the full_name column
ALTER TABLE user_profiles DROP COLUMN IF EXISTS full_name;

-- Add first_name and last_name columns (both required)
ALTER TABLE user_profiles ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN last_name TEXT NOT NULL DEFAULT '';

-- Remove default constraints after adding columns
ALTER TABLE user_profiles ALTER COLUMN first_name DROP DEFAULT;
ALTER TABLE user_profiles ALTER COLUMN last_name DROP DEFAULT;

-- Update comments
COMMENT ON COLUMN user_profiles.first_name IS 'User first name';
COMMENT ON COLUMN user_profiles.last_name IS 'User last name';
