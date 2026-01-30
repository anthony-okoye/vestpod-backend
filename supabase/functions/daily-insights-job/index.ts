// =====================================================
// Vestpod - Daily AI Insights Job Edge Function
// =====================================================
// Scheduled job that generates AI insights for premium users
// - Fetches all premium users
// - Generates portfolio insights for each user
// - Stores insights in database
// - Sends push notifications for critical insights
// - Runs daily at 6 AM via cron trigger
// Requirements: 8

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  generatePortfolioInsights,
  PortfolioContext,
  AssetContext,
  GeminiAPIError,
} from "../_shared/gemini-client.ts";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Premium user from database
 */
interface PremiumUser {
  id: string;
  email: string;
  currency_preference: string;
}

/**
 * Insight generation result
 */
interface InsightResult {
  user_id: string;
  success: boolean;
  insight_id?: string;
  is_critical?: boolean;
  notification_sent?: boolean;
  error?: string;
}

/**
 * Send JSON response
 */
function jsonResponse(data: Record<string, unknown> | { error: string }, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Fetch portfolio data for a user
 * Builds complete portfolio context including all assets
 */
async function fetchPortfolioData(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  currency: string
): Promise<PortfolioContext | null> {
  try {
    // Get default portfolio
    const { data: defaultPortfolio } = await supabase
      .from("portfolios")
      .select("id, name")
      .eq("user_id", userId)
      .eq("is_default", true)
      .single();

    if (!defaultPortfolio) {
      // Fallback to first portfolio
      const { data: firstPortfolio } = await supabase
        .from("portfolios")
        .select("id, name")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (!firstPortfolio) {
        return null;
      }
    }

    const portfolioId = defaultPortfolio?.id || "";

    // Get all assets in portfolio
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("portfolio_id", portfolioId)
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
      portfolioId,
      totalValue: Number(totalValue.toFixed(2)),
      currency,
      assets: assetContexts,
    };
  } catch (error) {
    console.error(`Error fetching portfolio data for user ${userId}:`, error);
    return null;
  }
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
        `High concentration in ${country}: ${percentage.toFixed(1)}% of portfolio`
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
        `High concentration in ${sector} sector: ${percentage.toFixed(1)}% of portfolio`
      );
    }
  }

  return { exposure, warnings };
}

/**
 * Store insights in database
 */
async function storeInsights(
  supabase: ReturnType<typeof createClient>,
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
      console.error(`Error storing insights for user ${userId}:`, error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error(`Error storing insights for user ${userId}:`, error);
    return null;
  }
}

/**
 * Send push notification to user
 * Requirement 8.9: Send push notification for critical insights
 */
async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  insightId: string
): Promise<boolean> {
  try {
    // In a production environment, this would integrate with:
    // - Firebase Cloud Messaging (FCM) for Android
    // - Apple Push Notification Service (APNs) for iOS
    // - Or a service like OneSignal, Pusher, etc.
    
    console.log(`[PUSH NOTIFICATION] User: ${userId}`);
    console.log(`  Title: ${title}`);
    console.log(`  Body: ${body}`);
    console.log(`  Insight ID: ${insightId}`);

    // TODO: Implement actual push notification service integration
    // Example with FCM:
    // const fcmToken = await getUserFCMToken(userId);
    // await sendFCMNotification(fcmToken, { title, body, data: { insight_id: insightId } });

    return true;
  } catch (error) {
    console.error("Error sending push notification:", error);
    return false;
  }
}

/**
 * Generate insights for a single user
 */
async function generateInsightsForUser(
  supabase: ReturnType<typeof createClient>,
  user: PremiumUser,
  geminiApiKey: string
): Promise<InsightResult> {
  try {
    // Fetch portfolio data
    const portfolioContext = await fetchPortfolioData(
      supabase,
      user.id,
      user.currency_preference
    );

    if (!portfolioContext) {
      return {
        user_id: user.id,
        success: false,
        error: "No portfolio data found",
      };
    }

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
        console.error(`Gemini API error for user ${user.id}:`, error.message);
        return {
          user_id: user.id,
          success: false,
          error: `AI analysis failed: ${error.message}`,
        };
      }
      throw error;
    }

    // Calculate health score (0-10)
    // Health score is inverse of risk score
    const healthScore = Number((10 - aiInsight.riskScore).toFixed(1));

    // Determine if insights are critical
    // Requirement 8.9: Critical insights trigger notifications
    const isCritical =
      geoAnalysis.warnings.length > 0 ||
      sectorAnalysis.warnings.length > 0 ||
      aiInsight.riskScore >= 7.0;

    // Store insights in database
    const insightId = await storeInsights(
      supabase,
      user.id,
      healthScore,
      aiInsight.riskScore,
      geoAnalysis.exposure,
      sectorAnalysis.exposure,
      aiInsight.recommendations,
      isCritical
    );

    if (!insightId) {
      return {
        user_id: user.id,
        success: false,
        error: "Failed to store insights",
      };
    }

    // Send push notification if critical
    let notificationSent = false;
    if (isCritical) {
      const notificationTitle = "Portfolio Alert";
      const notificationBody = `Your portfolio has ${geoAnalysis.warnings.length + sectorAnalysis.warnings.length} critical insights. Tap to review.`;
      
      notificationSent = await sendPushNotification(
        user.id,
        notificationTitle,
        notificationBody,
        insightId
      );

      // Update notification_sent flag
      if (notificationSent) {
        await supabase
          .from("ai_insights")
          .update({ notification_sent: true })
          .eq("id", insightId);
      }
    }

    return {
      user_id: user.id,
      success: true,
      insight_id: insightId,
      is_critical: isCritical,
      notification_sent: notificationSent,
    };
  } catch (error) {
    console.error(`Error generating insights for user ${user.id}:`, error);
    return {
      user_id: user.id,
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Process all premium users
 * Requirement 8.8: Generate insights daily for all premium users
 */
async function processAllPremiumUsers(
  supabase: ReturnType<typeof createClient>,
  geminiApiKey: string
) {
  // Fetch all premium users
  const { data: premiumUsers, error: usersError } = await supabase
    .from("subscriptions")
    .select(`
      user_id,
      user_profiles!inner (
        id,
        email,
        currency_preference
      )
    `)
    .eq("is_premium", true);

  if (usersError) {
    console.error("Error fetching premium users:", usersError);
    throw new Error(`Failed to fetch premium users: ${usersError.message}`);
  }

  if (!premiumUsers || premiumUsers.length === 0) {
    return {
      total_users: 0,
      insights_generated: 0,
      critical_insights: 0,
      notifications_sent: 0,
      results: [],
    };
  }

  console.log(`Processing ${premiumUsers.length} premium users`);

  // Generate insights for each user
  const results: InsightResult[] = [];
  for (const subscription of premiumUsers) {
    const userProfile = subscription.user_profiles as unknown as PremiumUser;
    
    if (!userProfile) {
      console.error(`No user profile found for subscription ${subscription.user_id}`);
      results.push({
        user_id: subscription.user_id,
        success: false,
        error: "User profile not found",
      });
      continue;
    }

    const result = await generateInsightsForUser(
      supabase,
      userProfile,
      geminiApiKey
    );
    results.push(result);

    // Add small delay between users to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const successCount = results.filter((r) => r.success).length;
  const criticalCount = results.filter((r) => r.is_critical).length;
  const notificationCount = results.filter((r) => r.notification_sent).length;

  return {
    total_users: premiumUsers.length,
    insights_generated: successCount,
    critical_insights: criticalCount,
    notifications_sent: notificationCount,
    results,
  };
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
    // Get Supabase configuration
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Supabase configuration missing" }, 500);
    }

    if (!geminiApiKey) {
      return jsonResponse({ error: "Gemini API key not configured" }, 500);
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const startTime = Date.now();

    // Process all premium users
    const result = await processAllPremiumUsers(supabase, geminiApiKey);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`Daily insights job completed in ${duration}ms`);
    console.log(`  Total premium users: ${result.total_users}`);
    console.log(`  Insights generated: ${result.insights_generated}`);
    console.log(`  Critical insights: ${result.critical_insights}`);
    console.log(`  Notifications sent: ${result.notifications_sent}`);

    return jsonResponse({
      success: true,
      ...result,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Daily insights job error:", error);
    return jsonResponse(
      {
        error: "Daily insights job failed",
        message: (error as Error).message,
      },
      500
    );
  }
});
