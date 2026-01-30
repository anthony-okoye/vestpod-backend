// =====================================================
// Vestpod - Portfolio Analysis Edge Function
// =====================================================
// Generates AI-powered portfolio insights including:
// - Risk score calculation
// - Geographic exposure analysis
// - Sector exposure analysis
// - AI recommendations
// Requirements: 8

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/auth.ts";
import {
  generatePortfolioInsights,
  PortfolioContext,
  AssetContext,
  GeminiAPIError,
} from "../_shared/gemini-client.ts";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with service role for database operations
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// Helper Functions
// =====================================================

/**
 * Send JSON response
 */
function jsonResponse(
  data: Record<string, unknown> | { error: string } | { success: boolean; [key: string]: unknown },
  status = 200
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Send error response
 */
function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// Import centralized subscription helper
import { checkPremiumStatus } from "../_shared/subscription-helper.ts";

/**
 * Fetch portfolio data for analysis
 * Builds complete portfolio context including all assets
 */
async function fetchPortfolioData(
  userId: string,
  portfolioId?: string
): Promise<PortfolioContext | null> {
  try {
    // Get user preferences
    const { data: userProfile } = await supabase
      .from("user_profiles")
      .select("currency_preference")
      .eq("id", userId)
      .single();

    const currency = userProfile?.currency_preference || "USD";

    // If no portfolio ID specified, use default portfolio
    let targetPortfolioId = portfolioId;
    if (!targetPortfolioId) {
      const { data: defaultPortfolio } = await supabase
        .from("portfolios")
        .select("id")
        .eq("user_id", userId)
        .eq("is_default", true)
        .single();

      if (!defaultPortfolio) {
        // Fallback to first portfolio
        const { data: firstPortfolio } = await supabase
          .from("portfolios")
          .select("id")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .single();

        if (!firstPortfolio) {
          return null;
        }
        targetPortfolioId = firstPortfolio.id;
      } else {
        targetPortfolioId = defaultPortfolio.id;
      }
    }

    // Verify portfolio belongs to user
    const { data: portfolio, error: portfolioError } = await supabase
      .from("portfolios")
      .select("id, name")
      .eq("id", targetPortfolioId)
      .eq("user_id", userId)
      .single();

    if (portfolioError || !portfolio) {
      return null;
    }

    // Get all assets in portfolio
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("portfolio_id", targetPortfolioId)
      .eq("user_id", userId);

    if (assetsError || !assets || assets.length === 0) {
      return null;
    }

    // Build asset contexts
    const assetContexts: AssetContext[] = assets.map((asset) => {
      const quantity = Number(asset.quantity);
      const purchasePrice = Number(asset.purchase_price);
      const currentPrice = asset.current_price
        ? Number(asset.current_price)
        : purchasePrice;

      const totalValue = quantity * currentPrice;
      const totalCost = quantity * purchasePrice;
      const gainLoss = totalValue - totalCost;
      const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;

      return {
        symbol: asset.symbol || asset.name,
        name: asset.name,
        type: asset.asset_type,
        quantity,
        currentPrice,
        purchasePrice,
        totalValue: Number(totalValue.toFixed(2)),
        gainLoss: Number(gainLoss.toFixed(2)),
        gainLossPercent: Number(gainLossPercent.toFixed(2)),
        sector: asset.metadata?.sector as string | undefined,
        country: asset.metadata?.country as string | undefined,
      };
    });

    // Calculate total portfolio value
    const totalValue = assetContexts.reduce(
      (sum, asset) => sum + asset.totalValue,
      0
    );

    return {
      userId,
      portfolioId: targetPortfolioId,
      totalValue: Number(totalValue.toFixed(2)),
      currency,
      assets: assetContexts,
    };
  } catch (error) {
    console.error("Error fetching portfolio data:", error);
    return null;
  }
}

/**
 * Calculate risk score based on volatility and concentration
 * Requirement 8.3: Calculate risk score
 */
function calculateRiskScore(context: PortfolioContext): {
  riskScore: number;
  volatilityScore: number;
  concentrationScore: number;
} {
  // Calculate concentration score (0-10)
  // Higher concentration = higher risk
  const totalValue = context.totalValue;
  const assetValues = context.assets.map((a) => a.totalValue);
  
  // Herfindahl-Hirschman Index (HHI) for concentration
  const hhi = assetValues.reduce((sum, value) => {
    const share = value / totalValue;
    return sum + share * share;
  }, 0);

  // Normalize HHI to 0-10 scale
  // HHI ranges from 1/n (perfectly diversified) to 1 (single asset)
  // We map this to 0-10 where 10 is highest concentration
  const concentrationScore = Math.min(10, hhi * 10);

  // Calculate volatility score based on performance variance
  // Higher variance in gains/losses = higher volatility
  const performances = context.assets.map((a) => a.gainLossPercent);
  const avgPerformance =
    performances.reduce((sum, p) => sum + p, 0) / performances.length;
  const variance =
    performances.reduce((sum, p) => sum + Math.pow(p - avgPerformance, 2), 0) /
    performances.length;
  const stdDev = Math.sqrt(variance);

  // Normalize standard deviation to 0-10 scale
  // Typical stock portfolio std dev is 15-25%
  // We map 0-30% to 0-10 scale
  const volatilityScore = Math.min(10, (stdDev / 30) * 10);

  // Overall risk score is weighted average
  // 60% concentration, 40% volatility
  const riskScore = concentrationScore * 0.6 + volatilityScore * 0.4;

  return {
    riskScore: Number(riskScore.toFixed(1)),
    volatilityScore: Number(volatilityScore.toFixed(1)),
    concentrationScore: Number(concentrationScore.toFixed(1)),
  };
}

/**
 * Analyze geographic exposure
 * Requirement 8.4: Analyze geographic exposure by country
 */
function analyzeGeographicExposure(context: PortfolioContext): {
  exposure: Record<string, number>;
  warnings: string[];
} {
  const totalValue = context.totalValue;
  const exposure: Record<string, number> = {};

  // Group assets by country
  for (const asset of context.assets) {
    const country = asset.country || "Unknown";
    if (!exposure[country]) {
      exposure[country] = 0;
    }
    exposure[country] += asset.totalValue;
  }

  // Convert to percentages
  for (const country in exposure) {
    exposure[country] = Number(((exposure[country] / totalValue) * 100).toFixed(2));
  }

  // Generate warnings for over-concentration
  // Requirement 8.6: Warning if country exposure exceeds 60%
  const warnings: string[] = [];
  for (const [country, percentage] of Object.entries(exposure)) {
    if (percentage > 60) {
      warnings.push(
        `High concentration in ${country}: ${percentage.toFixed(1)}% of portfolio. Consider diversifying across more countries.`
      );
    }
  }

  return { exposure, warnings };
}

/**
 * Analyze sector exposure
 * Requirement 8.5: Analyze sector exposure by industry
 */
function analyzeSectorExposure(context: PortfolioContext): {
  exposure: Record<string, number>;
  warnings: string[];
} {
  const totalValue = context.totalValue;
  const exposure: Record<string, number> = {};

  // Group assets by sector
  for (const asset of context.assets) {
    const sector = asset.sector || "Unknown";
    if (!exposure[sector]) {
      exposure[sector] = 0;
    }
    exposure[sector] += asset.totalValue;
  }

  // Convert to percentages
  for (const sector in exposure) {
    exposure[sector] = Number(((exposure[sector] / totalValue) * 100).toFixed(2));
  }

  // Generate warnings for over-concentration
  // Requirement 8.7: Warning if sector exposure exceeds 40%
  const warnings: string[] = [];
  for (const [sector, percentage] of Object.entries(exposure)) {
    if (percentage > 40) {
      warnings.push(
        `High concentration in ${sector} sector: ${percentage.toFixed(1)}% of portfolio. Consider diversifying across more sectors.`
      );
    }
  }

  return { exposure, warnings };
}

/**
 * Store insights in database
 */
async function storeInsights(
  userId: string,
  healthScore: number,
  riskScore: number,
  geographicExposure: Record<string, number>,
  sectorExposure: Record<string, number>,
  recommendations: unknown[],
  isCritical: boolean
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("ai_insights")
      .insert({
        user_id: userId,
        health_score: healthScore,
        risk_score: riskScore,
        geographic_exposure: geographicExposure,
        sector_exposure: sectorExposure,
        recommendations,
        is_critical: isCritical,
        notification_sent: false,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error storing insights:", error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error("Error storing insights:", error);
    return null;
  }
}

// =====================================================
// Route Handlers
// =====================================================

/**
 * POST /portfolio-analysis/analyze
 * Generate AI portfolio analysis
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
async function handleAnalyzePortfolio(req: Request, userId: string) {
  try {
    // Check premium status
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to access AI portfolio analysis",
        403
      );
    }

    // Check if Gemini API key is configured
    if (!geminiApiKey) {
      return errorResponse(
        "AI analysis service is not configured. Please contact support.",
        503
      );
    }

    // Get portfolio ID from request (optional)
    const body = await req.json().catch(() => ({}));
    const portfolioId = body.portfolio_id;

    // Fetch portfolio data
    const portfolioContext = await fetchPortfolioData(userId, portfolioId);
    if (!portfolioContext) {
      return errorResponse(
        "No portfolio data found. Please add assets to your portfolio first.",
        404
      );
    }

    // Calculate basic risk metrics
    const riskMetrics = calculateRiskScore(portfolioContext);

    // Analyze geographic exposure
    const geoAnalysis = analyzeGeographicExposure(portfolioContext);

    // Analyze sector exposure
    const sectorAnalysis = analyzeSectorExposure(portfolioContext);

    // Generate AI insights using Gemini
    let aiInsight;
    try {
      aiInsight = await generatePortfolioInsights(
        portfolioContext,
        geminiApiKey
      );
    } catch (error) {
      if (error instanceof GeminiAPIError) {
        console.error("Gemini API error:", error.message);
        return errorResponse(
          `AI analysis failed: ${error.message}`,
          error.statusCode || 500
        );
      }
      throw error;
    }

    // Calculate health score (0-10)
    // Health score is inverse of risk score
    const healthScore = Number((10 - aiInsight.riskScore).toFixed(1));

    // Determine if insights are critical
    const isCritical =
      geoAnalysis.warnings.length > 0 ||
      sectorAnalysis.warnings.length > 0 ||
      aiInsight.riskScore >= 7.0;

    // Store insights in database
    const insightId = await storeInsights(
      userId,
      healthScore,
      aiInsight.riskScore,
      geoAnalysis.exposure,
      sectorAnalysis.exposure,
      aiInsight.recommendations,
      isCritical
    );

    // Return analysis results
    return jsonResponse({
      success: true,
      analysis: {
        id: insightId,
        healthScore,
        riskScore: aiInsight.riskScore,
        riskAnalysis: {
          volatilityScore: riskMetrics.volatilityScore,
          concentrationScore: riskMetrics.concentrationScore,
          reasoning: aiInsight.riskAnalysis.reasoning,
        },
        geographicExposure: {
          ...geoAnalysis.exposure,
          warnings: geoAnalysis.warnings,
        },
        sectorExposure: {
          ...sectorAnalysis.exposure,
          warnings: sectorAnalysis.warnings,
        },
        recommendations: aiInsight.recommendations,
        isCritical,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Analyze portfolio handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /portfolio-analysis/latest
 * Get latest AI insights for user
 */
async function handleGetLatestInsights(userId: string) {
  try {
    // Check premium status
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to access AI portfolio analysis",
        403
      );
    }

    // Get latest insight
    const { data: insight, error } = await supabase
      .from("ai_insights")
      .select("*")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !insight) {
      return errorResponse("No insights found. Generate your first analysis.", 404);
    }

    return jsonResponse({
      success: true,
      analysis: {
        id: insight.id,
        healthScore: insight.health_score,
        riskScore: insight.risk_score,
        geographicExposure: insight.geographic_exposure,
        sectorExposure: insight.sector_exposure,
        recommendations: insight.recommendations,
        isCritical: insight.is_critical,
        generatedAt: insight.generated_at,
      },
    });
  } catch (error) {
    console.error("Get latest insights handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /portfolio-analysis/history
 * Get historical insights for user
 */
async function handleGetInsightsHistory(req: Request, userId: string) {
  try {
    // Check premium status
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to access AI portfolio analysis",
        403
      );
    }

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");

    // Get insights history
    const { data: insights, error } = await supabase
      .from("ai_insights")
      .select("*")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(Math.min(limit, 50));

    if (error) {
      console.error("Error fetching insights history:", error);
      return errorResponse("Failed to fetch insights history", 500);
    }

    return jsonResponse({
      success: true,
      insights: insights.map((insight) => ({
        id: insight.id,
        healthScore: insight.health_score,
        riskScore: insight.risk_score,
        isCritical: insight.is_critical,
        generatedAt: insight.generated_at,
      })),
    });
  } catch (error) {
    console.error("Get insights history handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// =====================================================
// Main Request Handler
// =====================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate request using shared auth module
    let user;
    try {
      user = await authenticateRequest(req);
    } catch (error) {
      return errorResponse(error.message, 401);
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // Route requests
    if (path.endsWith("/analyze") && req.method === "POST") {
      return await handleAnalyzePortfolio(req, user.id);
    }

    if (path.endsWith("/latest") && req.method === "GET") {
      return await handleGetLatestInsights(user.id);
    }

    if (path.endsWith("/history") && req.method === "GET") {
      return await handleGetInsightsHistory(req, user.id);
    }

    // Route not found
    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
