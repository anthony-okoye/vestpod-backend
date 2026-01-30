// =====================================================
// Vestpod - Automated Price Update Job Edge Function
// =====================================================
// Scheduled job that updates prices for all user assets
// - Fetches prices for stocks, crypto, commodities
// - Respects premium vs free user update frequency
// - Stores price history for charts
// - Handles batch operations efficiently
// Requirements: 5, 15

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  fetchBatchQuotes as fetchStockBatch,
  MassiveAPIError,
} from "../_shared/massive-client.ts";
import {
  fetchBatchQuotes as fetchAlphaVantageBatch,
  AlphaVantageAPIError,
  RateLimitError,
} from "../_shared/alphavantage-client.ts";
import {
  fetchBatchQuotesBySymbols as fetchCryptoBatch,
  CoinGeckoAPIError,
} from "../_shared/coingecko-client.ts";
import {
  fetchBatchQuotes as fetchCommodityBatch,
  CommoditySymbol,
  MetalsAPIError,
} from "../_shared/metals-api-client.ts";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Asset from database
 */
interface Asset {
  id: string;
  user_id: string;
  asset_type: string;
  symbol: string | null;
  name: string;
  current_price: number | null;
  last_price_update: string | null;
  portfolio_id: string;
}

/**
 * User subscription info
 */
interface UserSubscription {
  user_id: string;
  is_premium: boolean;
  price_update_frequency_minutes: number;
}

/**
 * Price update result
 */
interface PriceUpdateResult {
  asset_id: string;
  symbol: string;
  old_price: number | null;
  new_price: number;
  source: string;
  success: boolean;
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
 * Get users who need price updates based on their subscription tier
 */
async function getUsersNeedingUpdates(supabase: ReturnType<typeof createClient>) {
  const now = new Date();
  
  // Get all users with their subscription info
  const { data: subscriptions, error } = await supabase
    .from("subscriptions")
    .select("user_id, is_premium, price_update_frequency_minutes");

  if (error) {
    console.error("Error fetching subscriptions:", error);
    return [];
  }

  const usersNeedingUpdate: string[] = [];

  for (const sub of subscriptions as UserSubscription[]) {
    // Get user's assets to check last update time
    const { data: assets } = await supabase
      .from("assets")
      .select("last_price_update")
      .eq("user_id", sub.user_id)
      .not("symbol", "is", null)
      .limit(1);

    if (!assets || assets.length === 0) {
      continue; // User has no listed assets
    }

    const lastUpdate = assets[0].last_price_update
      ? new Date(assets[0].last_price_update)
      : new Date(0);

    const minutesSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);

    // Check if update is needed based on frequency
    if (minutesSinceUpdate >= sub.price_update_frequency_minutes) {
      usersNeedingUpdate.push(sub.user_id);
    }
  }

  return usersNeedingUpdate;
}

/**
 * Fetch and update stock prices
 */
async function updateStockPrices(
  assets: Asset[],
  massiveApiKey: string,
  alphaVantageApiKey: string
): Promise<PriceUpdateResult[]> {
  const results: PriceUpdateResult[] = [];
  const symbols = assets.map((a) => a.symbol!).filter((s) => s);

  if (symbols.length === 0) {
    return results;
  }

  let stockResults: Map<string, unknown> | null = null;
  let source = "massive";

  // Try Massive.com first
  try {
    stockResults = await fetchStockBatch(symbols, massiveApiKey);
  } catch (error) {
    console.log("Massive.com batch failed, trying Alpha Vantage:", error);
    
    // Fallback to Alpha Vantage
    try {
      stockResults = await fetchAlphaVantageBatch(symbols, alphaVantageApiKey);
      source = "alphavantage";
    } catch (fallbackError) {
      console.error("Both stock APIs failed:", fallbackError);
    }
  }

  if (!stockResults) {
    // Mark all as failed
    for (const asset of assets) {
      results.push({
        asset_id: asset.id,
        symbol: asset.symbol!,
        old_price: asset.current_price,
        new_price: 0,
        source: "none",
        success: false,
        error: "All stock APIs unavailable",
      });
    }
    return results;
  }

  // Process results
  for (const asset of assets) {
    const result = stockResults.get(asset.symbol!);

    if (result instanceof Error) {
      results.push({
        asset_id: asset.id,
        symbol: asset.symbol!,
        old_price: asset.current_price,
        new_price: 0,
        source,
        success: false,
        error: result.message,
      });
    } else if (result && typeof result === "object" && "price" in result) {
      results.push({
        asset_id: asset.id,
        symbol: asset.symbol!,
        old_price: asset.current_price,
        new_price: (result as { price: number }).price,
        source,
        success: true,
      });
    }
  }

  return results;
}

/**
 * Fetch and update cryptocurrency prices
 */
async function updateCryptoPrices(
  assets: Asset[],
  coingeckoApiKey?: string
): Promise<PriceUpdateResult[]> {
  const results: PriceUpdateResult[] = [];
  const symbols = assets.map((a) => a.symbol!).filter((s) => s);

  if (symbols.length === 0) {
    return results;
  }

  try {
    const cryptoResults = await fetchCryptoBatch(symbols, coingeckoApiKey);

    for (const asset of assets) {
      const result = cryptoResults.get(asset.symbol!);

      if (result instanceof Error) {
        results.push({
          asset_id: asset.id,
          symbol: asset.symbol!,
          old_price: asset.current_price,
          new_price: 0,
          source: "coingecko",
          success: false,
          error: result.message,
        });
      } else if (result && typeof result === "object" && "price" in result) {
        results.push({
          asset_id: asset.id,
          symbol: asset.symbol!,
          old_price: asset.current_price,
          new_price: (result as { price: number }).price,
          source: "coingecko",
          success: true,
        });
      }
    }
  } catch (error) {
    console.error("CoinGecko batch failed:", error);
    
    // Mark all as failed
    for (const asset of assets) {
      results.push({
        asset_id: asset.id,
        symbol: asset.symbol!,
        old_price: asset.current_price,
        new_price: 0,
        source: "coingecko",
        success: false,
        error: (error as Error).message,
      });
    }
  }

  return results;
}

/**
 * Fetch and update commodity prices
 */
async function updateCommodityPrices(
  assets: Asset[],
  metalsApiKey: string
): Promise<PriceUpdateResult[]> {
  const results: PriceUpdateResult[] = [];
  const symbols = assets.map((a) => a.symbol! as CommoditySymbol).filter((s) => s);

  if (symbols.length === 0) {
    return results;
  }

  try {
    const commodityResults = await fetchCommodityBatch(symbols, metalsApiKey);

    for (const asset of assets) {
      const result = commodityResults.get(asset.symbol! as CommoditySymbol);

      if (result instanceof Error) {
        results.push({
          asset_id: asset.id,
          symbol: asset.symbol!,
          old_price: asset.current_price,
          new_price: 0,
          source: "metals-api",
          success: false,
          error: result.message,
        });
      } else if (result && typeof result === "object" && "price" in result) {
        results.push({
          asset_id: asset.id,
          symbol: asset.symbol!,
          old_price: asset.current_price,
          new_price: (result as { price: number }).price,
          source: "metals-api",
          success: true,
        });
      }
    }
  } catch (error) {
    console.error("Metals-API batch failed:", error);
    
    // Mark all as failed
    for (const asset of assets) {
      results.push({
        asset_id: asset.id,
        symbol: asset.symbol!,
        old_price: asset.current_price,
        new_price: 0,
        source: "metals-api",
        success: false,
        error: (error as Error).message,
      });
    }
  }

  return results;
}

/**
 * Update asset prices in database and store price history
 */
async function savePriceUpdates(
  supabase: ReturnType<typeof createClient>,
  results: PriceUpdateResult[],
  userId: string
) {
  const now = new Date().toISOString();
  const successfulUpdates = results.filter((r) => r.success);

  if (successfulUpdates.length === 0) {
    return { updated: 0, history_stored: 0, broadcasted: 0 };
  }

  // Update current prices in assets table
  const updatePromises = successfulUpdates.map((result) =>
    supabase
      .from("assets")
      .update({
        current_price: result.new_price,
        last_price_update: now,
      })
      .eq("id", result.asset_id)
  );

  await Promise.all(updatePromises);

  // Store price history for charts
  const historyRecords = successfulUpdates.map((result) => ({
    asset_id: result.asset_id,
    symbol: result.symbol,
    asset_type: "", // Will be filled by trigger or we can query
    price: result.new_price,
    timestamp: now,
    source: result.source,
  }));

  // Get asset types for history records
  const assetIds = successfulUpdates.map((r) => r.asset_id);
  const { data: assets } = await supabase
    .from("assets")
    .select("id, asset_type, portfolio_id")
    .in("id", assetIds);

  if (assets) {
    const assetTypeMap = new Map(assets.map((a: { id: string; asset_type: string }) => [a.id, a.asset_type]));
    historyRecords.forEach((record) => {
      record.asset_type = assetTypeMap.get(record.asset_id) || "unknown";
    });
  }

  const { error: historyError } = await supabase
    .from("price_history")
    .insert(historyRecords);

  if (historyError) {
    console.error("Error storing price history:", historyError);
  }

  // Broadcast price updates via Realtime
  let broadcastCount = 0;
  try {
    // Create a channel for this user's price updates
    const channel = supabase.channel(`price-updates:${userId}`);

    // Prepare broadcast payload with all updated assets
    const priceUpdates = successfulUpdates.map((result) => {
      const asset = assets?.find((a: { id: string }) => a.id === result.asset_id);
      return {
        asset_id: result.asset_id,
        symbol: result.symbol,
        old_price: result.old_price,
        new_price: result.new_price,
        price_change: result.old_price 
          ? ((result.new_price - result.old_price) / result.old_price) * 100 
          : 0,
        timestamp: now,
        source: result.source,
        portfolio_id: asset?.portfolio_id,
      };
    });

    // Broadcast the price updates
    await channel.send({
      type: "broadcast",
      event: "price-update",
      payload: {
        user_id: userId,
        updates: priceUpdates,
        timestamp: now,
      },
    });

    broadcastCount = priceUpdates.length;
    console.log(`Broadcasted ${broadcastCount} price updates for user ${userId}`);
  } catch (broadcastError) {
    console.error("Error broadcasting price updates:", broadcastError);
  }

  return {
    updated: successfulUpdates.length,
    history_stored: historyError ? 0 : successfulUpdates.length,
    broadcasted: broadcastCount,
  };
}

/**
 * Process price updates for a single user
 */
async function processUserPriceUpdates(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  apiKeys: {
    massive: string;
    alphaVantage: string;
    coingecko?: string;
    metalsApi: string;
  }
) {
  // Fetch all listed assets for this user
  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, user_id, asset_type, symbol, name, current_price, last_price_update, portfolio_id")
    .eq("user_id", userId)
    .not("symbol", "is", null);

  if (error) {
    console.error(`Error fetching assets for user ${userId}:`, error);
    return { user_id: userId, success: false, error: error.message };
  }

  if (!assets || assets.length === 0) {
    return { user_id: userId, success: true, assets_updated: 0, message: "No listed assets" };
  }

  // Group assets by type
  const stockAssets = assets.filter((a: Asset) => a.asset_type === "stock");
  const cryptoAssets = assets.filter((a: Asset) => a.asset_type === "crypto");
  const commodityAssets = assets.filter((a: Asset) => a.asset_type === "commodity");

  // Fetch prices for each asset type
  const allResults: PriceUpdateResult[] = [];

  if (stockAssets.length > 0) {
    const stockResults = await updateStockPrices(
      stockAssets,
      apiKeys.massive,
      apiKeys.alphaVantage
    );
    allResults.push(...stockResults);
  }

  if (cryptoAssets.length > 0) {
    const cryptoResults = await updateCryptoPrices(cryptoAssets, apiKeys.coingecko);
    allResults.push(...cryptoResults);
  }

  if (commodityAssets.length > 0) {
    const commodityResults = await updateCommodityPrices(commodityAssets, apiKeys.metalsApi);
    allResults.push(...commodityResults);
  }

  // Save updates to database
  const saveResult = await savePriceUpdates(supabase, allResults, userId);

  const successCount = allResults.filter((r) => r.success).length;
  const failureCount = allResults.filter((r) => !r.success).length;

  return {
    user_id: userId,
    success: true,
    total_assets: assets.length,
    assets_updated: successCount,
    assets_failed: failureCount,
    ...saveResult,
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
    // Get API keys from environment
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const massiveApiKey = Deno.env.get("MASSIVE_API_KEY");
    const alphaVantageApiKey = Deno.env.get("ALPHA_VANTAGE_API_KEY");
    const coingeckoApiKey = Deno.env.get("COINGECKO_API_KEY");
    const metalsApiKey = Deno.env.get("METALS_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Supabase configuration missing" }, 500);
    }

    if (!massiveApiKey || !alphaVantageApiKey || !metalsApiKey) {
      return jsonResponse({ error: "API keys not configured" }, 500);
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const startTime = Date.now();

    // Get users who need price updates
    const usersNeedingUpdate = await getUsersNeedingUpdates(supabase);

    console.log(`Processing price updates for ${usersNeedingUpdate.length} users`);

    // Process updates for each user
    const results = [];
    for (const userId of usersNeedingUpdate) {
      const result = await processUserPriceUpdates(supabase, userId, {
        massive: massiveApiKey,
        alphaVantage: alphaVantageApiKey,
        coingecko: coingeckoApiKey,
        metalsApi: metalsApiKey,
      });
      results.push(result);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    const totalUpdated = results.reduce((sum, r) => sum + (r.assets_updated || 0), 0);
    const totalFailed = results.reduce((sum, r) => sum + (r.assets_failed || 0), 0);

    return jsonResponse({
      success: true,
      users_processed: usersNeedingUpdate.length,
      total_assets_updated: totalUpdated,
      total_assets_failed: totalFailed,
      duration_ms: duration,
      results,
    });
  } catch (error) {
    console.error("Price update job error:", error);
    return jsonResponse(
      {
        error: "Price update job failed",
        message: (error as Error).message,
      },
      500
    );
  }
});
