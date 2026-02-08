-- =====================================================
-- Vestpod - Create Insights Cache Table
-- =====================================================
-- Creates table for caching multi-modal insights
-- Requirements: 9.1, 9.2, 9.3

-- Create insights_cache table
CREATE TABLE IF NOT EXISTS insights_cache (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  insights_data JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT valid_expiry CHECK (expires_at > cached_at)
);

-- Enable RLS
ALTER TABLE insights_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own cache
CREATE POLICY "Users can access own cache"
ON insights_cache FOR ALL
USING (auth.uid() = user_id);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_insights_cache_expires 
ON insights_cache(expires_at);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_insights_cache_user 
ON insights_cache(user_id);

-- Add comment for documentation
COMMENT ON TABLE insights_cache IS 'Caches multi-modal insights for 30 minutes to reduce API costs';
COMMENT ON COLUMN insights_cache.insights_data IS 'Complete insights response including charts and analysis';
COMMENT ON COLUMN insights_cache.expires_at IS 'Cache expiration timestamp (30-minute TTL)';
