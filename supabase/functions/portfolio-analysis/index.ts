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
  generateMultiModalInsights,
  PortfolioContext,
  AssetContext,
  MultiModalContext,
  EnhancedAIInsight,
  GeminiAPIError,
} from "../_shared/gemini-client.ts";
import { ChartGenerator } from "../_shared/chart-generator.ts";
import { MarketDataAggregator } from "../_shared/market-data-aggregator.ts";
import { NewsAggregator } from "../_shared/news-aggregator.ts";
import {
  logApiCost,
  estimateMultiModalCost,
  estimateTextOnlyCost,
  shouldUseMultiModal,
  checkCostThreshold,
} from "../_shared/cost-monitor.ts";

// Token usage constants (imported from cost-monitor)
const MULTIMODAL_ESTIMATED_INPUT_TOKENS = 15000;
const MULTIMODAL_ESTIMATED_OUTPUT_TOKENS = 2000;
const TEXT_ONLY_ESTIMATED_INPUT_TOKENS = 3000;
const TEXT_ONLY_ESTIMATED_OUTPUT_TOKENS = 1500;

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with service role for database operations
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";
const newsApiKey = Deno.env.get("NEWS_API_KEY") || "";
const alphaVantageApiKey = Deno.env.get("ALPHA_VANTAGE_API_KEY") || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize components for multi-modal analysis
const chartGenerator = new ChartGenerator({
  width: 800,
  height: 600,
  backgroundColor: "#ffffff",
});
const marketDataAggregator = new MarketDataAggregator(alphaVantageApiKey);
const newsAggregator = new NewsAggregator(newsApiKey, geminiApiKey);

// Cache TTL for insights (30 minutes)
const INSIGHTS_CACHE_TTL = 30 * 60 * 1000;

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
 * Check insights cache
 * Returns cached insights if fresh (within 30 minutes)
 */
async function getCachedInsights(userId: string): Promise<EnhancedAIInsight | null> {
  try {
    const { data, error } = await supabase
      .from("insights_cache")
      .select("insights_data, expires_at")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if cache is still valid
    const expiresAt = new Date(data.expires_at).getTime();
    if (Date.now() > expiresAt) {
      // Cache expired, delete it
      await supabase
        .from("insights_cache")
        .delete()
        .eq("user_id", userId);
      return null;
    }

    console.log("Insights cache hit for user:", userId);
    return data.insights_data as EnhancedAIInsight;
  } catch (error) {
    console.error("Error checking insights cache:", error);
    return null;
  }
}

/**
 * Cache insights for user
 * Stores insights with 30-minute TTL
 */
async function cacheInsights(userId: string, insights: EnhancedAIInsight): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + INSIGHTS_CACHE_TTL);

    await supabase
      .from("insights_cache")
      .upsert({
        user_id: userId,
        insights_data: insights,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      });

    console.log("Insights cached for user:", userId);
  } catch (error) {
    console.error("Error caching insights:", error);
    // Non-critical error, continue
  }
}

/**
 * Store enhanced insights in database
 * Includes multi-modal metadata (charts, sentiment, benchmark, macro)
 */
async function storeEnhancedInsights(
  userId: string,
  insights: EnhancedAIInsight,
  context: MultiModalContext,
  apiCostCents: number
): Promise<string | null> {
  try {
    // Prepare chart URLs (in production, upload to storage and get URLs)
    const chartUrls = {
      performance: "data:image/png;base64," + context.charts.performance.substring(0, 50) + "...",
      allocation: "data:image/png;base64," + context.charts.allocation.substring(0, 50) + "...",
      correlation: "data:image/png;base64," + context.charts.correlation.substring(0, 50) + "...",
    };

    // Prepare sentiment data
    const sentimentData: Record<string, { score: number; magnitude: number; articles_count: number }> = {};
    if (context.sentiment) {
      context.sentiment.forEach((value, key) => {
        sentimentData[key] = value;
      });
    }

    // Prepare benchmark data
    const benchmarkData = context.benchmark ? {
      symbol: context.benchmark.symbol,
      current_price: context.benchmark.currentPrice,
      change_percent: context.benchmark.changePercent,
      period: context.benchmark.period,
    } : null;

    // Prepare macro context
    const macroContext = context.macroIndicators ? {
      fed_rate: context.macroIndicators.fedFundsRate,
      vix: context.macroIndicators.vixIndex,
      cpi: context.macroIndicators.cpiInflation,
      market_condition: insights.macroContext?.marketCondition || "neutral",
      volatility_level: insights.macroContext?.volatilityLevel || "medium",
    } : null;

    // Prepare visual patterns
    const visualPatterns = insights.visualPatterns ? {
      trend_analysis: insights.visualPatterns.trendAnalysis,
      allocation_insights: insights.visualPatterns.allocationInsights,
      correlation_insights: insights.visualPatterns.correlationInsights,
    } : null;

    const { data, error } = await supabase
      .from("ai_insights")
      .insert({
        user_id: userId,
        health_score: 10 - insights.riskScore,
        risk_score: insights.riskScore,
        geographic_exposure: insights.geographicExposure,
        sector_exposure: insights.sectorExposure,
        recommendations: insights.recommendations,
        is_critical: insights.riskScore >= 7.0,
        notification_sent: false,
        analysis_type: "multi-modal",
        chart_urls: chartUrls,
        sentiment_data: sentimentData,
        benchmark_data: benchmarkData,
        macro_context: macroContext,
        visual_patterns: visualPatterns,
        api_cost_cents: apiCostCents,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error storing enhanced insights:", error);
      return null;
    }

    console.log("Enhanced insights stored with ID:", data.id);
    return data.id;
  } catch (error) {
    console.error("Error storing enhanced insights:", error);
    return null;
  }
}

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
 * Generate AI portfolio analysis with multi-modal enhancements
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 * Task 7: Enhanced Portfolio Analysis Handler
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

    // Get request parameters
    const body = await req.json().catch(() => ({}));
    const portfolioId = body.portfolio_id;
    const forceRefresh = body.force === true;

    // Task 7.8: Check cache (30-minute TTL)
    if (!forceRefresh) {
      const cachedInsights = await getCachedInsights(userId);
      if (cachedInsights) {
        console.log("Returning cached insights for user:", userId);
        return jsonResponse({
          success: true,
          cached: true,
          analysis: cachedInsights,
        });
      }
    }

    // Fetch portfolio data
    const portfolioContext = await fetchPortfolioData(userId, portfolioId);
    if (!portfolioContext) {
      return errorResponse(
        "No portfolio data found. Please add assets to your portfolio first.",
        404
      );
    }

    // Task 8.4: Check cost threshold before analysis
    const costCheck = await shouldUseMultiModal();
    const costBasedFallback = !costCheck.allowed;
    
    if (costBasedFallback) {
      console.warn(`Cost-based fallback triggered: ${costCheck.reason}`);
    }

    // Track API costs
    let apiCostCents = 0;

    // Task 7.2: Integrate chart generator (parallel execution)
    console.log("Generating charts...");
    const [performanceChart, allocationChart, correlationChart] = await Promise.all([
      chartGenerator.generatePerformanceChart({
        dates: generateLast30Days(),
        values: portfolioContext.assets.map(a => a.totalValue),
        currency: portfolioContext.currency,
      }).catch(err => {
        console.error("Performance chart generation failed:", err);
        return null;
      }),
      chartGenerator.generateAllocationChart({
        labels: portfolioContext.assets.map(a => a.symbol),
        values: portfolioContext.assets.map(a => (a.totalValue / portfolioContext.totalValue) * 100),
      }).catch(err => {
        console.error("Allocation chart generation failed:", err);
        return null;
      }),
      generateCorrelationChartData(portfolioContext).catch(err => {
        console.error("Correlation chart generation failed:", err);
        return null;
      }),
    ]);

    // Task 7.3: Integrate market data aggregator (parallel execution)
    console.log("Fetching market data...");
    const [benchmarkData, macroIndicators] = await Promise.all([
      marketDataAggregator.fetchBenchmarkData("30D").catch(err => {
        console.error("Benchmark data fetch failed:", err);
        return null;
      }),
      marketDataAggregator.fetchMacroIndicators().catch(err => {
        console.error("Macro indicators fetch failed:", err);
        return null;
      }),
    ]);

    // Task 7.4: Integrate news aggregator (batch sentiment analysis)
    console.log("Fetching sentiment data...");
    const symbols = portfolioContext.assets.map(a => a.symbol);
    const sentimentMap = await newsAggregator.batchAnalyzeSentiment(symbols).catch(err => {
      console.error("Sentiment analysis failed:", err);
      return new Map();
    });

    // Convert sentiment map to simplified format for context
    const simplifiedSentiment = new Map<string, { score: number; magnitude: number; articles_count: number }>();
    sentimentMap.forEach((analysis, symbol) => {
      simplifiedSentiment.set(symbol, {
        score: analysis.score,
        magnitude: analysis.magnitude,
        articles_count: analysis.articles.length,
      });
    });

    // Determine if we can do multi-modal analysis
    // Task 8.4: Respect cost-based fallback
    const hasCharts = performanceChart && allocationChart && correlationChart;
    const useMultiModal = hasCharts && alphaVantageApiKey && newsApiKey && !costBasedFallback;

    let insights: EnhancedAIInsight;

    if (useMultiModal) {
      console.log("Generating multi-modal insights...");

      // Task 7.5: Build multi-modal context
      const multiModalContext: MultiModalContext = {
        ...portfolioContext,
        charts: {
          performance: performanceChart!,
          allocation: allocationChart!,
          correlation: correlationChart!,
        },
        sentiment: simplifiedSentiment,
        benchmark: benchmarkData || undefined,
        macroIndicators: macroIndicators || undefined,
      };

      // Task 7.6: Call enhanced Gemini client
      try {
        insights = await generateMultiModalInsights(multiModalContext, geminiApiKey);
        
        // Task 8.1: Calculate and log API cost
        apiCostCents = estimateMultiModalCost();
        await logApiCost(
          userId,
          "gemini",
          "gemini-3-flash-preview:generateContent",
          apiCostCents,
          MULTIMODAL_ESTIMATED_INPUT_TOKENS + MULTIMODAL_ESTIMATED_OUTPUT_TOKENS
        );
        
        console.log("Multi-modal insights generated successfully");
      } catch (error) {
        console.error("Multi-modal analysis failed, falling back to text-only:", error);
        
        // Fallback to text-only analysis
        const basicInsight = await generatePortfolioInsights(portfolioContext, geminiApiKey);
        insights = {
          ...basicInsight,
          visualPatterns: undefined,
          sentimentSummary: undefined,
          benchmarkComparison: undefined,
          macroContext: undefined,
        };
        
        // Task 8.1: Log text-only cost
        apiCostCents = estimateTextOnlyCost();
        await logApiCost(
          userId,
          "gemini",
          "gemini-3-flash-preview:generateContent",
          apiCostCents,
          TEXT_ONLY_ESTIMATED_INPUT_TOKENS + TEXT_ONLY_ESTIMATED_OUTPUT_TOKENS
        );
      }
    } else {
      const fallbackReason = costBasedFallback
        ? "cost threshold exceeded"
        : "missing components for multi-modal";
      console.log(`Generating text-only insights (${fallbackReason})...`);
      
      // Fallback to text-only analysis
      const basicInsight = await generatePortfolioInsights(portfolioContext, geminiApiKey);
      insights = {
        ...basicInsight,
        visualPatterns: undefined,
        sentimentSummary: undefined,
        benchmarkComparison: undefined,
        macroContext: undefined,
      };
      
      // Task 8.1: Log text-only cost
      apiCostCents = estimateTextOnlyCost();
      await logApiCost(
        userId,
        "gemini",
        "gemini-3-flash-preview:generateContent",
        apiCostCents,
        TEXT_ONLY_ESTIMATED_INPUT_TOKENS + TEXT_ONLY_ESTIMATED_OUTPUT_TOKENS
      );
    }

    // Calculate basic risk metrics
    const riskMetrics = calculateRiskScore(portfolioContext);

    // Analyze geographic exposure
    const geoAnalysis = analyzeGeographicExposure(portfolioContext);

    // Analyze sector exposure
    const sectorAnalysis = analyzeSectorExposure(portfolioContext);

    // Merge analysis results
    const finalInsights: EnhancedAIInsight = {
      ...insights,
      riskAnalysis: {
        ...insights.riskAnalysis,
        volatilityScore: riskMetrics.volatilityScore,
        concentrationScore: riskMetrics.concentrationScore,
      },
      geographicExposure: {
        ...geoAnalysis.exposure,
        warnings: geoAnalysis.warnings,
      } as typeof insights.geographicExposure,
      sectorExposure: {
        ...sectorAnalysis.exposure,
        warnings: sectorAnalysis.warnings,
      } as typeof insights.sectorExposure,
    };

    // Task 7.7: Store enhanced insights
    if (useMultiModal) {
      const multiModalContext: MultiModalContext = {
        ...portfolioContext,
        charts: {
          performance: performanceChart!,
          allocation: allocationChart!,
          correlation: correlationChart!,
        },
        sentiment: simplifiedSentiment,
        benchmark: benchmarkData || undefined,
        macroIndicators: macroIndicators || undefined,
      };
      
      await storeEnhancedInsights(userId, finalInsights, multiModalContext, apiCostCents);
    } else {
      // Store as text-only
      await storeInsights(
        userId,
        10 - finalInsights.riskScore,
        finalInsights.riskScore,
        finalInsights.geographicExposure,
        finalInsights.sectorExposure,
        finalInsights.recommendations,
        finalInsights.riskScore >= 7.0
      );
    }

    // Task 7.8: Cache results
    await cacheInsights(userId, finalInsights);

    // Task 8.3: Check cost threshold and log status
    const threshold = await checkCostThreshold();
    console.log(
      `Monthly API costs: $${(threshold.currentCents / 100).toFixed(2)} / $${(threshold.thresholdCents / 100).toFixed(2)} (${threshold.percentUsed}%)`
    );

    // Return analysis results
    return jsonResponse({
      success: true,
      cached: false,
      analysis: {
        healthScore: 10 - finalInsights.riskScore,
        riskScore: finalInsights.riskScore,
        riskAnalysis: finalInsights.riskAnalysis,
        geographicExposure: finalInsights.geographicExposure,
        sectorExposure: finalInsights.sectorExposure,
        recommendations: finalInsights.recommendations,
        visualPatterns: finalInsights.visualPatterns,
        sentimentSummary: finalInsights.sentimentSummary,
        benchmarkComparison: finalInsights.benchmarkComparison,
        macroContext: finalInsights.macroContext,
        isCritical: finalInsights.riskScore >= 7.0,
        analysisType: useMultiModal ? "multi-modal" : "text-only",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Analyze portfolio handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * Generate last 30 days of dates
 */
function generateLast30Days(): string[] {
  const dates: string[] = [];
  const now = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  return dates;
}

/**
 * Generate correlation chart data
 */
async function generateCorrelationChartData(context: PortfolioContext): Promise<string | null> {
  try {
    const symbols = context.assets.map(a => a.symbol);
    
    // Calculate simple correlation matrix based on performance
    const correlationMatrix: number[][] = [];
    
    for (let i = 0; i < symbols.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) {
          row.push(1.0); // Perfect correlation with self
        } else {
          // Simple correlation estimate based on asset types
          const asset1 = context.assets[i];
          const asset2 = context.assets[j];
          
          if (asset1.type === asset2.type) {
            row.push(0.6); // Same type = moderate correlation
          } else {
            row.push(0.2); // Different type = low correlation
          }
        }
      }
      correlationMatrix.push(row);
    }
    
    return await chartGenerator.generateCorrelationHeatmap({
      assets: symbols,
      correlationMatrix,
    });
  } catch (error) {
    console.error("Correlation chart generation failed:", error);
    return null;
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
