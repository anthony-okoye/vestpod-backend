-- =====================================================
-- Vestpod - Create API Cost Tracking Table
-- =====================================================
-- Creates table for tracking API costs per service
-- Requirements: 10.1, 10.2

-- Create api_cost_tracking table
CREATE TABLE IF NOT EXISTS api_cost_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL CHECK (service_name IN ('gemini', 'newsapi', 'alphavantage', 'fred')),
  endpoint TEXT NOT NULL,
  tokens_used INTEGER,
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE api_cost_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can write costs
CREATE POLICY "Service role can write costs"
ON api_cost_tracking FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Policy: Admins can read all costs
CREATE POLICY "Admins can read all costs"
ON api_cost_tracking FOR SELECT
USING (auth.role() = 'service_role');

-- Indexes for cost analysis
CREATE INDEX IF NOT EXISTS idx_api_cost_user 
ON api_cost_tracking(user_id);

CREATE INDEX IF NOT EXISTS idx_api_cost_service 
ON api_cost_tracking(service_name);

CREATE INDEX IF NOT EXISTS idx_api_cost_timestamp 
ON api_cost_tracking(timestamp DESC);

-- Index for monthly cost aggregation (DATE_TRUNC done in queries)
CREATE INDEX IF NOT EXISTS idx_api_cost_monthly 
ON api_cost_tracking(service_name, timestamp);

-- Add comments for documentation
COMMENT ON TABLE api_cost_tracking IS 'Tracks API costs per service for monitoring and alerting';
COMMENT ON COLUMN api_cost_tracking.service_name IS 'API service name: gemini, newsapi, alphavantage, or fred';
COMMENT ON COLUMN api_cost_tracking.endpoint IS 'Specific API endpoint called';
COMMENT ON COLUMN api_cost_tracking.tokens_used IS 'Number of tokens used (for Gemini API)';
COMMENT ON COLUMN api_cost_tracking.cost_cents IS 'Cost in cents for this API call';
