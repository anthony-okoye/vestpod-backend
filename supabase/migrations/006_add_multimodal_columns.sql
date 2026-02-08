-- =====================================================
-- Vestpod - Add Multi-Modal Columns to AI Insights
-- =====================================================
-- Adds columns for multi-modal analysis metadata
-- Requirements: 7.1, 7.2, 7.3, 7.4, 7.5

-- Add multi-modal metadata columns to ai_insights table
ALTER TABLE ai_insights 
ADD COLUMN IF NOT EXISTS analysis_type TEXT DEFAULT 'text-only' CHECK (analysis_type IN ('text-only', 'multi-modal')),
ADD COLUMN IF NOT EXISTS chart_urls JSONB,
ADD COLUMN IF NOT EXISTS sentiment_data JSONB,
ADD COLUMN IF NOT EXISTS benchmark_data JSONB,
ADD COLUMN IF NOT EXISTS macro_context JSONB,
ADD COLUMN IF NOT EXISTS visual_patterns JSONB,
ADD COLUMN IF NOT EXISTS api_cost_cents INTEGER DEFAULT 0 CHECK (api_cost_cents >= 0);

-- Create index for analysis type filtering
CREATE INDEX IF NOT EXISTS idx_ai_insights_analysis_type 
ON ai_insights(analysis_type);

-- Create index for cost tracking queries
CREATE INDEX IF NOT EXISTS idx_ai_insights_cost 
ON ai_insights(api_cost_cents) WHERE api_cost_cents > 0;

-- Add comment for documentation
COMMENT ON COLUMN ai_insights.analysis_type IS 'Type of analysis: text-only or multi-modal';
COMMENT ON COLUMN ai_insights.chart_urls IS 'URLs to generated chart images (performance, allocation, correlation)';
COMMENT ON COLUMN ai_insights.sentiment_data IS 'Market sentiment scores per asset';
COMMENT ON COLUMN ai_insights.benchmark_data IS 'S&P 500 benchmark comparison data';
COMMENT ON COLUMN ai_insights.macro_context IS 'Macro-economic indicators (Fed rate, VIX, CPI)';
COMMENT ON COLUMN ai_insights.visual_patterns IS 'Visual pattern analysis from charts';
COMMENT ON COLUMN ai_insights.api_cost_cents IS 'API cost in cents for this analysis';
