#!/bin/bash

# =====================================================
# Vestpod - Authentication System Deployment Script
# =====================================================
# This script deploys the authentication Edge Functions
# and verifies the setup

set -e

echo "🚀 Deploying Vestpod Authentication System..."
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found"
    echo "Please install: https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Check if project is linked
if [ ! -f ".supabase/config.toml" ]; then
    echo "❌ Project not linked to Supabase"
    echo "Run: supabase link --project-ref your-project-id"
    exit 1
fi

echo "✅ Project linked"
echo ""

# Deploy auth-handler function
echo "📦 Deploying auth-handler function..."
supabase functions deploy auth-handler

if [ $? -eq 0 ]; then
    echo "✅ auth-handler deployed successfully"
else
    echo "❌ auth-handler deployment failed"
    exit 1
fi

echo ""

# Deploy oauth-callback function
echo "📦 Deploying oauth-callback function..."
supabase functions deploy oauth-callback

if [ $? -eq 0 ]; then
    echo "✅ oauth-callback deployed successfully"
else
    echo "❌ oauth-callback deployment failed"
    exit 1
fi

echo ""
echo "🎉 Authentication system deployed successfully!"
echo ""
echo "Next steps:"
echo "1. Set environment variables in Supabase Dashboard"
echo "2. Configure OAuth providers (Google, Apple)"
echo "3. Enable email confirmations"
echo "4. Test authentication flows (see AUTH_TESTING.md)"
echo ""
echo "For detailed instructions, see DEPLOYMENT.md"
