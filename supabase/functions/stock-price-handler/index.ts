// =====================================================
// Vestpod - Stock Price Handler Edge Function
// =====================================================
// Handles stock price queries using Massive.com API
// - Get current quote for a symbol
// - Get historical data for a symbol
// - Get batch quotes for multiple symbols
// Requirements: 3, 5

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  fetchStockQuote as fetchMassiveQuote,
  fetchHistoricalData as fetchMassiveHistorical,
  fetchBatchQuotes as fetchMassiveBatch,
  MassiveAPIError,
} from "../_shared/massive-client.ts";
import {
  fetchStockQuote as fetchAlphaVantageQuote,
  fetchHistoricalData as fetchAlphaVantageHistorical,
  fetchBatchQuotes as fetchAlphaVantageBatch,
  AlphaVantageAPIError,
  RateLimitError,
  getRateLimitStatus,
} from "../_shared/alphavantage-client.ts";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
 * Send error response
 */
function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

/**
 * GET /stock-price-handler/quote/:symbol
 * Get current stock quote with fallback logic
 * Tries Massive.com first, falls back to Alpha Vantage on failure
 */
async function handleGetQuote(symbol: string, massiveApiKey: string, alphaVantageApiKey: string) {
  let primaryError: Error | null = null;

  // Try Massive.com first
  try {
    const quote = await fetchMassiveQuote(symbol, massiveApiKey);
    return jsonResponse({
      success: true,
      quote,
      source: "massive",
    });
  } catch (error) {
    primaryError = error as Error;
    console.log(`Massive.com failed for ${symbol}, attempting Alpha Vantage fallback:`, error);
  }

  // Fallback to Alpha Vantage
  try {
    const quote = await fetchAlphaVantageQuote(symbol, alphaVantageApiKey);
    return jsonResponse({
      success: true,
      quote,
      source: "alphavantage",
      warning: "Primary API unavailable, using backup",
    });
  } catch (fallbackError) {
    console.error(`Both APIs failed for ${symbol}:`, { primaryError, fallbackError });

    // Return appropriate error
    if (fallbackError instanceof RateLimitError) {
      return errorResponse(
        `All APIs unavailable: ${primaryError?.message}. Backup API rate limit exceeded.`,
        503
      );
    }

    if (fallbackError instanceof AlphaVantageAPIError) {
      return errorResponse(
        `Failed to fetch quote: ${primaryError?.message}`,
        fallbackError.statusCode || 500
      );
    }

    return errorResponse("Failed to fetch stock quote from all sources", 500);
  }
}

/**
 * GET /stock-price-handler/historical/:symbol
 * Get historical stock data with fallback logic
 * Query params: from, to, timespan (optional), multiplier (optional)
 */
async function handleGetHistorical(
  symbol: string,
  searchParams: URLSearchParams,
  massiveApiKey: string,
  alphaVantageApiKey: string
) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const timespan = (searchParams.get("timespan") || "day") as
    | "minute"
    | "hour"
    | "day"
    | "week"
    | "month"
    | "quarter"
    | "year";
  const multiplier = parseInt(searchParams.get("multiplier") || "1", 10);

  // Validate required params
  if (!from || !to) {
    return errorResponse("Missing required parameters: from, to");
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(from) || !dateRegex.test(to)) {
    return errorResponse("Invalid date format. Use YYYY-MM-DD");
  }

  let primaryError: Error | null = null;

  // Try Massive.com first
  try {
    const data = await fetchMassiveHistorical(symbol, from, to, timespan, multiplier, massiveApiKey);
    return jsonResponse({
      success: true,
      historical: data,
      source: "massive",
    });
  } catch (error) {
    primaryError = error as Error;
    console.log(`Massive.com historical failed for ${symbol}, attempting Alpha Vantage fallback:`, error);
  }

  // Fallback to Alpha Vantage (only supports daily data)
  try {
    const data = await fetchAlphaVantageHistorical(symbol, alphaVantageApiKey, "full");
    
    // Filter data by date range
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();
    const filteredData = data.data.filter(
      (point) => point.timestamp >= fromTime && point.timestamp <= toTime
    );

    return jsonResponse({
      success: true,
      historical: {
        symbol: data.symbol,
        data: filteredData,
      },
      source: "alphavantage",
      warning: "Primary API unavailable, using backup (daily data only)",
    });
  } catch (fallbackError) {
    console.error(`Both APIs failed for historical ${symbol}:`, { primaryError, fallbackError });

    if (fallbackError instanceof RateLimitError) {
      return errorResponse(
        `All APIs unavailable: ${primaryError?.message}. Backup API rate limit exceeded.`,
        503
      );
    }

    if (fallbackError instanceof AlphaVantageAPIError) {
      return errorResponse(
        `Failed to fetch historical data: ${primaryError?.message}`,
        fallbackError.statusCode || 500
      );
    }

    return errorResponse("Failed to fetch historical data from all sources", 500);
  }
}

/**
 * POST /stock-price-handler/batch
 * Get quotes for multiple symbols with fallback logic
 * Body: { symbols: string[] }
 */
async function handleBatchQuotes(req: Request, massiveApiKey: string, alphaVantageApiKey: string) {
  try {
    const body = await req.json();
    const symbols = body.symbols;

    // Validate input
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return errorResponse("Invalid request: symbols array required");
    }

    if (symbols.length > 50) {
      return errorResponse("Maximum 50 symbols per batch request");
    }

    let primaryError: Error | null = null;

    // Try Massive.com first
    try {
      const results = await fetchMassiveBatch(symbols, massiveApiKey);

      // Transform results to JSON-serializable format
      const quotes: Record<string, unknown> = {};
      const errors: Record<string, string> = {};

      for (const [symbol, result] of results.entries()) {
        if (result instanceof Error) {
          errors[symbol] = result.message;
        } else {
          quotes[symbol] = result;
        }
      }

      return jsonResponse({
        success: true,
        quotes,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        source: "massive",
      });
    } catch (error) {
      primaryError = error as Error;
      console.log("Massive.com batch failed, attempting Alpha Vantage fallback:", error);
    }

    // Fallback to Alpha Vantage
    try {
      const results = await fetchAlphaVantageBatch(symbols, alphaVantageApiKey);

      // Transform results to JSON-serializable format
      const quotes: Record<string, unknown> = {};
      const errors: Record<string, string> = {};

      for (const [symbol, result] of results.entries()) {
        if (result instanceof Error) {
          errors[symbol] = result.message;
        } else {
          quotes[symbol] = result;
        }
      }

      return jsonResponse({
        success: true,
        quotes,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        source: "alphavantage",
        warning: "Primary API unavailable, using backup (rate limited)",
      });
    } catch (fallbackError) {
      console.error("Both APIs failed for batch quotes:", { primaryError, fallbackError });
      return errorResponse("Failed to fetch batch quotes from all sources", 500);
    }
  } catch (error) {
    console.error("Batch quotes error:", error);
    return errorResponse("Failed to fetch batch quotes", 500);
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
    // Get API keys from environment
    const massiveApiKey = Deno.env.get("MASSIVE_API_KEY");
    const alphaVantageApiKey = Deno.env.get("ALPHA_VANTAGE_API_KEY");

    if (!massiveApiKey) {
      return errorResponse("MASSIVE_API_KEY not configured", 500);
    }

    if (!alphaVantageApiKey) {
      console.warn("ALPHA_VANTAGE_API_KEY not configured - fallback unavailable");
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const pathParts = path.split("/").filter(Boolean);

    // Route: GET /quote/:symbol
    if (pathParts.length >= 2 && pathParts[pathParts.length - 2] === "quote" && req.method === "GET") {
      const symbol = pathParts[pathParts.length - 1];
      return await handleGetQuote(symbol, massiveApiKey, alphaVantageApiKey || "");
    }

    // Route: GET /historical/:symbol
    if (pathParts.length >= 2 && pathParts[pathParts.length - 2] === "historical" && req.method === "GET") {
      const symbol = pathParts[pathParts.length - 1];
      return await handleGetHistorical(symbol, url.searchParams, massiveApiKey, alphaVantageApiKey || "");
    }

    // Route: POST /batch
    if (path.endsWith("/batch") && req.method === "POST") {
      return await handleBatchQuotes(req, massiveApiKey, alphaVantageApiKey || "");
    }

    // Route: GET /rate-limit-status
    if (path.endsWith("/rate-limit-status") && req.method === "GET") {
      const status = getRateLimitStatus();
      return jsonResponse({
        success: true,
        rateLimit: status,
      });
    }

    // Route not found
    return errorResponse(
      "Route not found. Available routes: GET /quote/:symbol, GET /historical/:symbol, POST /batch, GET /rate-limit-status",
      404
    );
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
