-- =====================================================
-- Fix Subscriptions RLS Policy
-- =====================================================
-- Add missing INSERT policy for subscriptions table
-- This allows the trigger to create subscription records

CREATE POLICY "Users can insert own subscription" ON subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
