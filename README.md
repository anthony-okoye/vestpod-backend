# Investment Portfolio Tracker - Backend

This is the backend infrastructure for the Investment Portfolio Tracker application, built on Supabase (PostgreSQL + Edge Functions).

## Architecture

- **Database**: PostgreSQL with Row Level Security (RLS)
- **Edge Functions**: Supabase Edge Functions (Deno runtime)
- **Authentication**: Supabase Auth with OAuth support
- **Storage**: Supabase Storage for avatars and exports
- **Real-time**: Supabase Realtime for live price updates

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- [Node.js](https://nodejs.org/) v18+ (for local development)
- [Deno](https://deno.land/) v1.30+ (for Edge Functions)
- Supabase account (free tier available)

## Setup Instructions

### 1. Create Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Click "New Project"
3. Fill in project details:
   - **Name**: investment-portfolio-tracker
   - **Database Password**: (save this securely)
   - **Region**: Choose closest to your users
4. Wait for project to be provisioned (~2 minutes)

### 2. Get API Keys

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key**
   - **service_role key** (keep this secret!)

### 3. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and fill in your values
nano .env
```

Required variables:
- `SUPABASE_URL`: Your project URL
- `SUPABASE_ANON_KEY`: Your anon key
- `SUPABASE_SERVICE_ROLE_KEY`: Your service role key

### 4. Link Local Project to Supabase

```bash
# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref your-project-id
```

### 5. Run Database Migrations

```bash
# Apply the initial schema migration
supabase db push

# Or if using migration files
supabase migration up
```

This will create:
- 8 database tables
- Row Level Security (RLS) policies
- Performance indexes
- Triggers for automatic timestamps
- Default portfolio and subscription creation

### 6. Verify Database Setup

```bash
# Check migration status
supabase migration list

# Open database in browser
supabase db studio
```

### 7. Configure OAuth Providers (Optional)

#### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Add authorized redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`
4. Copy Client ID and Secret to `.env`
5. In Supabase Dashboard → **Authentication** → **Providers** → Enable Google

#### Apple OAuth
1. Go to [Apple Developer Portal](https://developer.apple.com/)
2. Create Sign in with Apple service
3. Configure redirect URI
4. Copy credentials to `.env`
5. In Supabase Dashboard → **Authentication** → **Providers** → Enable Apple

## Database Schema

### Tables

1. **user_profiles** - Extended user information
2. **portfolios** - User investment portfolios
3. **assets** - Listed and non-listed assets
4. **price_history** - Historical price data
5. **alerts** - Price alerts and notifications
6. **subscriptions** - Premium subscription status
7. **ai_insights** - AI-generated portfolio analysis
8. **ai_chat_history** - Conversational AI messages

### Security

All tables have Row Level Security (RLS) enabled:
- Users can only access their own data
- Policies enforce user_id matching
- Service role bypasses RLS for admin operations

### Indexes

Performance indexes are created on:
- Foreign keys (user_id, portfolio_id, asset_id)
- Frequently queried columns (symbol, timestamp, status)
- Composite indexes for common query patterns

## Edge Functions

Edge Functions will be added in subsequent tasks. They will be located in:

```
backend/functions/
├── portfolio-crud/
├── asset-crud/
├── price-updater/
├── alert-checker/
├── ai-insights/
├── ai-chat/
├── revenuecat-webhook/
└── data-export/
```

## Local Development

### Start Supabase Locally

```bash
# Start all Supabase services
supabase start

# This starts:
# - PostgreSQL database (port 54322)
# - API server (port 54321)
# - Studio UI (port 54323)
# - Inbucket email testing (port 54324)
```

### Access Local Services

- **API**: http://localhost:54321
- **Studio**: http://localhost:54323
- **Database**: postgresql://postgres:postgres@localhost:54322/postgres

### Stop Services

```bash
supabase stop
```

## Testing Database

### Insert Test Data

```sql
-- Create test user profile (after signup via Supabase Auth)
INSERT INTO user_profiles (id, email, full_name)
VALUES ('user-uuid-here', 'test@example.com', 'Test User');

-- Default portfolio is created automatically via trigger

-- Add test asset
INSERT INTO assets (portfolio_id, user_id, asset_type, symbol, name, quantity, purchase_price, purchase_date, current_price)
VALUES (
    'portfolio-uuid-here',
    'user-uuid-here',
    'stock',
    'AAPL',
    'Apple Inc.',
    10,
    150.00,
    '2024-01-01',
    175.00
);
```

### Query Examples

```sql
-- Get user's portfolios with asset count
SELECT 
    p.id,
    p.name,
    COUNT(a.id) as asset_count,
    SUM(a.quantity * a.current_price) as total_value
FROM portfolios p
LEFT JOIN assets a ON a.portfolio_id = p.id
WHERE p.user_id = 'user-uuid-here'
GROUP BY p.id, p.name;

-- Get price history for chart
SELECT 
    timestamp,
    price
FROM price_history
WHERE asset_id = 'asset-uuid-here'
ORDER BY timestamp DESC
LIMIT 100;
```

## Deployment

### Deploy to Production

```bash
# Push migrations to production
supabase db push --linked

# Deploy Edge Functions (when created)
supabase functions deploy function-name
```

### Environment Variables in Production

Set environment variables in Supabase Dashboard:
1. Go to **Settings** → **Edge Functions**
2. Add secrets for API keys
3. Never commit `.env` to version control

## Monitoring

### Database Performance

```sql
-- Check slow queries
SELECT * FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Logs

```bash
# View Edge Function logs
supabase functions logs function-name

# View database logs
supabase db logs
```

## Troubleshooting

### Migration Fails

```bash
# Reset local database
supabase db reset

# Re-run migrations
supabase migration up
```

### RLS Policy Issues

```bash
# Test RLS policies
SET ROLE authenticated;
SET request.jwt.claim.sub = 'user-uuid-here';
SELECT * FROM portfolios;
```

### Connection Issues

- Verify `.env` file has correct values
- Check Supabase project is not paused (free tier)
- Ensure IP is whitelisted (if using IP restrictions)

## Next Steps

1. ✅ Database schema created
2. ⏳ Implement Authentication System (Task 2)
3. ⏳ Implement Portfolio CRUD Operations (Task 3)
4. ⏳ Integrate Financial APIs (Tasks 5-9)
5. ⏳ Implement Edge Functions (Tasks 11-28)

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Deno Documentation](https://deno.land/manual)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)

## Support

For issues or questions:
1. Check Supabase [Discord](https://discord.supabase.com/)
2. Review [GitHub Issues](https://github.com/supabase/supabase/issues)
3. Consult project requirements document
