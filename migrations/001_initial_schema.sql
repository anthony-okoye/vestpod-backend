-- =====================================================
-- Vestpod - Initial Database Schema
-- =====================================================
-- Vestpod: Investment Portfolio Tracker Application
-- This migration creates all tables, RLS policies, and indexes
-- Requirements: 1, 2, 14

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- TABLE 1: user_profiles
-- =====================================================
-- Stores extended user profile information beyond Supabase Auth
-- Requirements: 1, 12

CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    currency_preference TEXT DEFAULT 'USD' NOT NULL,
    language_preference TEXT DEFAULT 'en' NOT NULL,
    notifications_enabled BOOLEAN DEFAULT true NOT NULL,
    dark_mode_enabled BOOLEAN DEFAULT false NOT NULL,
    default_chart_view TEXT DEFAULT '1M' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================
-- TABLE 2: portfolios
-- =====================================================
-- Stores user portfolios
-- Requirements: 2

CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(user_id, name)
);

-- =====================================================
-- TABLE 3: assets
-- =====================================================
-- Stores both listed and non-listed assets
-- Requirements: 3, 4

CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Asset identification
    asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'crypto', 'commodity', 'real_estate', 'fixed_income', 'other')),
    symbol TEXT, -- For listed assets (stocks, crypto, commodities)
    name TEXT NOT NULL,
    
    -- Purchase information
    quantity DECIMAL(20, 8) NOT NULL,
    purchase_price DECIMAL(20, 8) NOT NULL,
    purchase_date DATE NOT NULL,
    
    -- Current valuation
    current_price DECIMAL(20, 8),
    last_price_update TIMESTAMPTZ,
    
    -- Additional metadata (JSONB for flexibility)
    -- For real_estate: {address, property_type, square_feet}
    -- For fixed_income: {maturity_date, interest_rate, issuer}
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================
-- TABLE 4: price_history
-- =====================================================
-- Stores historical price data for charts
-- Requirements: 5, 6

CREATE TABLE price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    source TEXT, -- API source (massive, coingecko, metals-api, etc.)
    
    UNIQUE(asset_id, timestamp)
);

-- =====================================================
-- TABLE 5: alerts
-- =====================================================
-- Stores user-configured price alerts
-- Requirements: 7

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    
    -- Alert configuration
    alert_type TEXT NOT NULL CHECK (alert_type IN ('price_target', 'percentage_change', 'maturity_reminder')),
    condition_value DECIMAL(20, 8), -- Target price or percentage
    condition_operator TEXT CHECK (condition_operator IN ('above', 'below', 'change_up', 'change_down')),
    
    -- Alert status
    is_active BOOLEAN DEFAULT true NOT NULL,
    triggered_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    
    -- Maturity reminder specific
    reminder_days_before INTEGER, -- For maturity reminders
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================
-- TABLE 6: subscriptions
-- =====================================================
-- Stores RevenueCat subscription status
-- Requirements: 10

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- RevenueCat data
    revenuecat_customer_id TEXT UNIQUE,
    subscription_status TEXT DEFAULT 'free' NOT NULL CHECK (subscription_status IN ('free', 'trial', 'active', 'expired', 'cancelled')),
    subscription_tier TEXT CHECK (subscription_tier IN ('monthly', 'annual')),
    
    -- Subscription dates
    trial_start_date TIMESTAMPTZ,
    trial_end_date TIMESTAMPTZ,
    subscription_start_date TIMESTAMPTZ,
    subscription_end_date TIMESTAMPTZ,
    next_billing_date TIMESTAMPTZ,
    
    -- Features
    is_premium BOOLEAN DEFAULT false NOT NULL,
    max_alerts INTEGER DEFAULT 3 NOT NULL,
    price_update_frequency_minutes INTEGER DEFAULT 15 NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================
-- TABLE 7: ai_insights
-- =====================================================
-- Stores AI-generated portfolio insights
-- Requirements: 8

CREATE TABLE ai_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Portfolio health metrics
    health_score DECIMAL(3, 1) CHECK (health_score >= 0 AND health_score <= 10),
    risk_score DECIMAL(3, 1) CHECK (risk_score >= 0 AND risk_score <= 10),
    
    -- Exposure analysis
    geographic_exposure JSONB DEFAULT '{}'::jsonb, -- {country: percentage}
    sector_exposure JSONB DEFAULT '{}'::jsonb, -- {sector: percentage}
    
    -- AI recommendations
    recommendations JSONB DEFAULT '[]'::jsonb, -- Array of recommendation objects
    
    -- Metadata
    generated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    is_critical BOOLEAN DEFAULT false NOT NULL,
    notification_sent BOOLEAN DEFAULT false NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================
-- TABLE 8: ai_chat_history
-- =====================================================
-- Stores conversational AI chat messages
-- Requirements: 9

CREATE TABLE ai_chat_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Message data
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    message TEXT NOT NULL,
    
    -- Context
    portfolio_context JSONB, -- Snapshot of portfolio data at time of message
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================
-- Requirement: 14 (Security and Data Protection)

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_history ENABLE ROW LEVEL SECURITY;

-- user_profiles policies
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- portfolios policies
CREATE POLICY "Users can view own portfolios" ON portfolios
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolios" ON portfolios
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portfolios" ON portfolios
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own portfolios" ON portfolios
    FOR DELETE USING (auth.uid() = user_id);

-- assets policies
CREATE POLICY "Users can view own assets" ON assets
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own assets" ON assets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own assets" ON assets
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own assets" ON assets
    FOR DELETE USING (auth.uid() = user_id);

-- price_history policies
CREATE POLICY "Users can view price history for own assets" ON price_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM assets 
            WHERE assets.id = price_history.asset_id 
            AND assets.user_id = auth.uid()
        )
    );

-- alerts policies
CREATE POLICY "Users can view own alerts" ON alerts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alerts" ON alerts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts" ON alerts
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own alerts" ON alerts
    FOR DELETE USING (auth.uid() = user_id);

-- subscriptions policies
CREATE POLICY "Users can view own subscription" ON subscriptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription" ON subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

-- ai_insights policies
CREATE POLICY "Users can view own insights" ON ai_insights
    FOR SELECT USING (auth.uid() = user_id);

-- ai_chat_history policies
CREATE POLICY "Users can view own chat history" ON ai_chat_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chat messages" ON ai_chat_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- PERFORMANCE INDEXES
-- =====================================================
-- Requirement: 15 (Performance and Scalability)

-- user_profiles indexes
CREATE INDEX idx_user_profiles_email ON user_profiles(email);

-- portfolios indexes
CREATE INDEX idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX idx_portfolios_created_at ON portfolios(created_at DESC);

-- assets indexes
CREATE INDEX idx_assets_portfolio_id ON assets(portfolio_id);
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_symbol ON assets(symbol) WHERE symbol IS NOT NULL;
CREATE INDEX idx_assets_asset_type ON assets(asset_type);
CREATE INDEX idx_assets_created_at ON assets(created_at DESC);

-- price_history indexes
CREATE INDEX idx_price_history_asset_id ON price_history(asset_id);
CREATE INDEX idx_price_history_symbol ON price_history(symbol);
CREATE INDEX idx_price_history_timestamp ON price_history(timestamp DESC);
CREATE INDEX idx_price_history_asset_timestamp ON price_history(asset_id, timestamp DESC);

-- alerts indexes
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_asset_id ON alerts(asset_id);
CREATE INDEX idx_alerts_is_active ON alerts(is_active) WHERE is_active = true;
CREATE INDEX idx_alerts_last_checked ON alerts(last_checked_at);

-- subscriptions indexes
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_revenuecat_id ON subscriptions(revenuecat_customer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(subscription_status);
CREATE INDEX idx_subscriptions_is_premium ON subscriptions(is_premium) WHERE is_premium = true;

-- ai_insights indexes
CREATE INDEX idx_ai_insights_user_id ON ai_insights(user_id);
CREATE INDEX idx_ai_insights_generated_at ON ai_insights(generated_at DESC);
CREATE INDEX idx_ai_insights_is_critical ON ai_insights(is_critical) WHERE is_critical = true;

-- ai_chat_history indexes
CREATE INDEX idx_ai_chat_history_user_id ON ai_chat_history(user_id);
CREATE INDEX idx_ai_chat_history_created_at ON ai_chat_history(created_at DESC);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_portfolios_updated_at BEFORE UPDATE ON portfolios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INITIAL DATA SETUP FUNCTIONS
-- =====================================================

-- Function to create default portfolio on user signup
CREATE OR REPLACE FUNCTION create_default_portfolio()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO portfolios (user_id, name, is_default)
    VALUES (NEW.id, 'My Portfolio', true);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default portfolio
CREATE TRIGGER on_user_created AFTER INSERT ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION create_default_portfolio();

-- Function to create default subscription record
CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO subscriptions (user_id, subscription_status, is_premium, max_alerts, price_update_frequency_minutes)
    VALUES (NEW.id, 'free', false, 3, 15);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default subscription
CREATE TRIGGER on_user_subscription_created AFTER INSERT ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION create_default_subscription();

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE user_profiles IS 'Extended user profile information beyond Supabase Auth';
COMMENT ON TABLE portfolios IS 'User investment portfolios';
COMMENT ON TABLE assets IS 'Listed and non-listed investment assets';
COMMENT ON TABLE price_history IS 'Historical price data for charting';
COMMENT ON TABLE alerts IS 'User-configured price alerts and notifications';
COMMENT ON TABLE subscriptions IS 'RevenueCat subscription status and premium features';
COMMENT ON TABLE ai_insights IS 'AI-generated portfolio analysis and recommendations';
COMMENT ON TABLE ai_chat_history IS 'Conversational AI chat message history';
