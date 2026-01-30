# Vestpod - Backend

This is the backend infrastructure for **Vestpod**, an investment portfolio tracker application, built on Supabase (PostgreSQL + Edge Functions).

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
   - **Name**: vestpod
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
- `SUPABASE_PUBLISHABLE_KEY`: Your publishable key (for client-side, starts with `sb_publishable_...`)
- `SUPABASE_SECRET_KEY`: Your secret key (for server-side, starts with `sb_secret_...`)

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

### Deployed Functions

**auth-handler** - Authentication operations
- POST `/auth-handler/signup` - Initiate signup (sends OTP)
- POST `/auth-handler/verify-otp` - Verify OTP and complete signup
- POST `/auth-handler/resend-otp` - Resend OTP email
- POST `/auth-handler/signin` - Email/password signin
- POST `/auth-handler/reset-password` - Send password reset email
- POST `/auth-handler/update-password` - Update password after reset
- POST `/auth-handler/signout` - Sign out user

**oauth-callback** - OAuth callback handler
- Handles Google and Apple OAuth callbacks
- Creates user profile automatically

**portfolio-handler** - Portfolio CRUD operations
- POST `/portfolio-handler/create` - Create new portfolio
- GET `/portfolio-handler/list` - List all user portfolios
- GET `/portfolio-handler/:id` - Get single portfolio
- PUT `/portfolio-handler/:id` - Update portfolio
- DELETE `/portfolio-handler/:id` - Delete portfolio

### Deployment

```bash
# Deploy all functions
supabase functions deploy

# Or deploy individually
supabase functions deploy auth-handler
supabase functions deploy oauth-callback
supabase functions deploy portfolio-handler
```

**stock-price-handler** - Stock price API integration
- GET `/stock-price-handler/quote/:symbol` - Get current stock quote
- GET `/stock-price-handler/historical/:symbol` - Get historical data
- POST `/stock-price-handler/batch` - Get batch quotes

### Pending Functions

Functions to be implemented in subsequent tasks:

```
backend/functions/
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
2. ✅ Authentication System implemented (Task 2)
3. ✅ Portfolio CRUD Operations implemented (Task 3)
4. ✅ Swagger/OpenAPI documentation updated
5. ✅ CI/CD pipeline configured
6. ✅ Stock Price API Integration (Task 5) - Massive.com/Polygon.io
7. ✅ Backup Stock API Integration (Task 6) - Alpha Vantage with automatic fallback
8. ⏳ Integrate Cryptocurrency API (Task 7) - CoinGecko
9. ⏳ Integrate Commodities API (Task 8) - Metals-API
10. ⏳ Integrate Forex API (Task 9) - ExchangeRate-API
11. ⏳ Implement Asset Management (Task 11)
12. ⏳ Implement remaining Edge Functions (Tasks 12-28)

## CI/CD Pipeline

### Automated Deployment

The project uses GitHub Actions for continuous integration and deployment:

**Workflows:**
- **CI** (`ci.yml`) - Runs on PRs, validates code quality
- **Deploy** (`deploy.yml`) - Runs on push to main, auto-deploys to Supabase

**Setup:**
1. Add GitHub Secrets:
   - `SUPABASE_ACCESS_TOKEN` - Get via `npx supabase access-token`
   - `SUPABASE_PROJECT_ID` - `kymsclhnftswfftvlmip`
2. Push to `main` branch to trigger deployment

**Documentation:**
- Quick Start: `.github/QUICK_REFERENCE.md`
- Full Guide: `.github/CICD_SETUP.md`

## Authentication System

### Overview

The authentication system supports:
- ✅ Email/Password signup with OTP verification
- ✅ Email/Password signin
- ✅ Password reset flow
- ✅ Google OAuth
- ✅ Apple OAuth
- ✅ Automatic user profile creation
- ✅ Secure token management

### Edge Functions

**auth-handler** - Main authentication handler
- POST `/auth-handler/signup` - Initiate signup (sends OTP)
- POST `/auth-handler/verify-otp` - Verify OTP and complete signup
- POST `/auth-handler/resend-otp` - Resend OTP email
- POST `/auth-handler/signin` - Email/password signin
- POST `/auth-handler/reset-password` - Send password reset email
- POST `/auth-handler/update-password` - Update password after reset
- POST `/auth-handler/signout` - Sign out user

**oauth-callback** - OAuth callback handler
- Handles Google and Apple OAuth callbacks
- Creates user profile automatically

### Deploy Authentication Functions

```bash
# Deploy auth-handler
supabase functions deploy auth-handler

# Deploy oauth-callback
supabase functions deploy oauth-callback

# Set environment variables in Supabase Dashboard
# Settings → Edge Functions → Add secrets:
# - SUPABASE_URL
# - SUPABASE_SECRET_KEY (modern secret key: sb_secret_...)
# - SITE_URL
```

### Configure OAuth Providers

See `AUTH_TESTING.md` for detailed OAuth setup instructions.

**Quick Setup:**
1. Create OAuth credentials in Google Cloud Console / Apple Developer Portal
2. Add redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`
3. Enable providers in Supabase Dashboard → Authentication → Providers
4. Add Client ID and Secret

## Testing Authentication

See `AUTH_TESTING.md` for comprehensive testing guide including:
- Email/Password signup with OTP
- OAuth flows (Google, Apple)
- Password reset
- Security testing
- Mobile app integration examples

### Interactive API Testing

We provide multiple ways to test the API:

**1. Swagger UI (Recommended)**
- Open `swagger-ui.html` in browser (requires local server)
- Interactive documentation with "Try it out" feature
- See `SWAGGER_GUIDE.md` for setup instructions

**2. Postman Collection**
- Import `Vestpod-Auth-API.postman_collection.json`
- Pre-configured requests with examples
- Automatic token management

**3. OpenAPI Specification**
- `openapi.yaml` - Complete API specification
- Import into any OpenAPI-compatible tool
- Generate client SDKs automatically

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Deno Documentation](https://deno.land/manual)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Polygon.io API Documentation](https://polygon.io/docs/stocks)

## Financial API Integration

### Stock Price API (Massive.com/Polygon.io)

The stock price API client is implemented in `_shared/massive-client.ts` with:
- ✅ Current stock quote fetching
- ✅ Historical OHLC data fetching
- ✅ Batch quote fetching
- ✅ Automatic retry with exponential backoff
- ✅ Rate limit handling

**Documentation:** See `_shared/MASSIVE_API_README.md` for detailed usage

**Testing:**
```bash
# Set API key
export MASSIVE_API_KEY=your_polygon_api_key

# Run test suite
cd backend/supabase/functions/_shared
deno run --allow-net --allow-env massive-client.test.ts
```

**Example Usage:**
```typescript
import { fetchStockQuote } from "../_shared/massive-client.ts";

const quote = await fetchStockQuote("AAPL", apiKey);
console.log(`AAPL: $${quote.price} (${quote.changePercent}%)`);
```

## Support

For issues or questions:
1. Check Supabase [Discord](https://discord.supabase.com/)
2. Review [GitHub Issues](https://github.com/supabase/supabase/issues)
3. Consult project requirements document
