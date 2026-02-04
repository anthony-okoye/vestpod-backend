// =====================================================
// Vestpod - Asset Handler Edge Function
// =====================================================
// Handles asset CRUD operations for both listed and non-listed assets:
// - Create asset (listed: stocks, crypto, commodities)
// - Create asset (non-listed: real estate, fixed income, other)
// - Read assets (list and single)
// - Update asset
// - Delete asset
// Requirements: 3, 4

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/auth.ts";
import { fetchStockQuote, MassiveAPIError } from "../_shared/massive-client.ts";
import { fetchCryptoQuoteBySymbol, CoinCapAPIError } from "../_shared/coincap-client.ts";
import { fetchCommodityQuote, GoldAPIError, CommoditySymbol } from "../_shared/goldapi-client.ts";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with service role for database operations
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// API keys for price fetching (only Massive API requires a key)
const massiveApiKey = Deno.env.get("MASSIVE_API_KEY") || "";

// Valid asset types
const ASSET_TYPES = ["stock", "crypto", "commodity", "real_estate", "fixed_income", "other"] as const;
type AssetType = typeof ASSET_TYPES[number];

// Listed asset types (have ticker symbols and public prices)
const LISTED_ASSET_TYPES: AssetType[] = ["stock", "crypto", "commodity"];

// =====================================================
// Helper Functions
// =====================================================

/**
 * Send JSON response
 */
function jsonResponse(data: Record<string, unknown> | { error: string } | { success: boolean; [key: string]: unknown }, status = 200) {
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
 * Validate asset type
 */
function isValidAssetType(type: string): type is AssetType {
  return ASSET_TYPES.includes(type as AssetType);
}

/**
 * Check if asset type is listed (has public market price)
 */
function isListedAssetType(type: AssetType): boolean {
  return LISTED_ASSET_TYPES.includes(type);
}

/**
 * Fetch current price for listed asset
 * Requirement 3.1: Fetch current price from financial APIs
 */
async function fetchAssetPrice(assetType: AssetType, symbol: string): Promise<number | null> {
  try {
    if (assetType === "stock") {
      const quote = await fetchStockQuote(symbol, massiveApiKey);
      return quote.price;
    } else if (assetType === "crypto") {
      const quote = await fetchCryptoQuoteBySymbol(symbol);
      return quote.price;
    } else if (assetType === "commodity") {
      const commoditySymbol = symbol.toUpperCase() as CommoditySymbol;
      if (!["XAU", "XAG", "XPT", "XPD"].includes(commoditySymbol)) {
        return null;
      }
      const quote = await fetchCommodityQuote(commoditySymbol);
      return quote.price;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Validate listed asset symbol
 * Requirement 3.2: Validate ticker symbol
 */
async function validateListedAsset(assetType: AssetType, symbol: string): Promise<{ valid: boolean; price?: number; error?: string }> {
  try {
    const price = await fetchAssetPrice(assetType, symbol);
    
    if (price === null) {
      return {
        valid: false,
        error: `Invalid ${assetType} symbol: ${symbol}. Please check the symbol and try again.`,
      };
    }

    return { valid: true, price };
  } catch (error) {
    if (error instanceof MassiveAPIError || error instanceof CoinCapAPIError || error instanceof GoldAPIError) {
      return {
        valid: false,
        error: `Unable to validate ${assetType} symbol: ${symbol}. ${error.message}`,
      };
    }
    return {
      valid: false,
      error: `Failed to validate ${assetType} symbol: ${symbol}`,
    };
  }
}

/**
 * Validate asset creation input
 * Requirements: 3.3, 4.1
 */
function validateAssetInput(data: Record<string, unknown>, isUpdate = false): { valid: boolean; error?: string } {
  // Asset type validation
  if (!isUpdate && (!data.asset_type || !isValidAssetType(data.asset_type as string))) {
    return {
      valid: false,
      error: `Invalid asset type. Must be one of: ${ASSET_TYPES.join(", ")}`,
    };
  }

  const assetType = data.asset_type as AssetType;
  const isListed = isListedAssetType(assetType);

  // Listed assets require symbol
  if (!isUpdate && isListed && (!data.symbol || typeof data.symbol !== "string" || data.symbol.trim().length === 0)) {
    return {
      valid: false,
      error: "Symbol is required for listed assets (stocks, crypto, commodities)",
    };
  }

  // All assets require name
  if (!isUpdate && (!data.name || typeof data.name !== "string" || data.name.trim().length === 0)) {
    return {
      valid: false,
      error: "Asset name is required",
    };
  }

  // Quantity validation
  if (!isUpdate && (data.quantity === undefined || data.quantity === null)) {
    return {
      valid: false,
      error: "Quantity is required",
    };
  }

  if (data.quantity !== undefined && (isNaN(Number(data.quantity)) || Number(data.quantity) <= 0)) {
    return {
      valid: false,
      error: "Quantity must be a positive number",
    };
  }

  // Purchase price validation
  if (!isUpdate && (data.purchase_price === undefined || data.purchase_price === null)) {
    return {
      valid: false,
      error: "Purchase price is required",
    };
  }

  if (data.purchase_price !== undefined && (isNaN(Number(data.purchase_price)) || Number(data.purchase_price) < 0)) {
    return {
      valid: false,
      error: "Purchase price must be a non-negative number",
    };
  }

  // Purchase date validation
  if (!isUpdate && (!data.purchase_date || typeof data.purchase_date !== "string")) {
    return {
      valid: false,
      error: "Purchase date is required (YYYY-MM-DD format)",
    };
  }

  if (data.purchase_date && !isValidDate(data.purchase_date as string)) {
    return {
      valid: false,
      error: "Invalid purchase date format. Use YYYY-MM-DD",
    };
  }

  // Portfolio ID validation
  if (!isUpdate && (!data.portfolio_id || typeof data.portfolio_id !== "string")) {
    return {
      valid: false,
      error: "Portfolio ID is required",
    };
  }

  return { valid: true };
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Calculate asset metrics
 */
function calculateAssetMetrics(asset: {
  quantity: number;
  purchase_price: number;
  current_price: number | null;
}) {
  const quantity = Number(asset.quantity);
  const purchasePrice = Number(asset.purchase_price);
  const currentPrice = asset.current_price ? Number(asset.current_price) : purchasePrice;

  const totalValue = quantity * currentPrice;
  const totalCost = quantity * purchasePrice;
  const gainLoss = totalValue - totalCost;
  const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;

  return {
    totalValue: Number(totalValue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    gainLoss: Number(gainLoss.toFixed(2)),
    gainLossPercent: Number(gainLossPercent.toFixed(2)),
  };
}

// =====================================================
// Route Handlers
// =====================================================

/**
 * POST /asset-handler/create
 * Create a new asset (listed or non-listed)
 * Requirements: 3.3, 3.4, 4.1, 4.4
 */
async function handleCreateAsset(req: Request, userId: string) {
  try {
    const body = await req.json();

    // Validate input
    const validation = validateAssetInput(body);
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    const {
      portfolio_id,
      asset_type,
      symbol,
      name,
      quantity,
      purchase_price,
      purchase_date,
      metadata = {},
    } = body;

    // Verify portfolio belongs to user
    const { data: portfolio, error: portfolioError } = await supabase
      .from("portfolios")
      .select("id")
      .eq("id", portfolio_id)
      .eq("user_id", userId)
      .single();

    if (portfolioError || !portfolio) {
      return errorResponse("Portfolio not found", 404);
    }

    const isListed = isListedAssetType(asset_type);
    let currentPrice: number | null = null;

    // For listed assets, validate symbol and fetch current price
    if (isListed && symbol) {
      const symbolValidation = await validateListedAsset(asset_type, symbol);
      
      if (!symbolValidation.valid) {
        return errorResponse(symbolValidation.error!);
      }

      currentPrice = symbolValidation.price || null;
    }

    // For non-listed assets, current price equals purchase price initially
    if (!isListed) {
      currentPrice = purchase_price;
    }

    // Create asset
    const { data: asset, error: createError } = await supabase
      .from("assets")
      .insert({
        portfolio_id,
        user_id: userId,
        asset_type,
        symbol: isListed ? symbol?.toUpperCase() : null,
        name: name.trim(),
        quantity: Number(quantity),
        purchase_price: Number(purchase_price),
        purchase_date,
        current_price: currentPrice,
        last_price_update: isListed && currentPrice ? new Date().toISOString() : null,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating asset:", createError);
      return errorResponse("Failed to create asset", 500);
    }

    // Calculate metrics
    const metrics = calculateAssetMetrics(asset);

    // Requirement 4.7: Create automatic maturity reminder for fixed income
    if (asset_type === "fixed_income" && metadata.maturity_date) {
      try {
        await supabase.from("alerts").insert({
          user_id: userId,
          asset_id: asset.id,
          alert_type: "maturity_reminder",
          reminder_days_before: 30,
          is_active: true,
        });
      } catch (error) {
        console.error("Error creating maturity reminder:", error);
      }
    }

    return jsonResponse({
      success: true,
      message: "Asset created successfully",
      asset: {
        id: asset.id,
        portfolioId: asset.portfolio_id,
        assetType: asset.asset_type,
        symbol: asset.symbol,
        name: asset.name,
        quantity: asset.quantity,
        purchasePrice: asset.purchase_price,
        purchaseDate: asset.purchase_date,
        currentPrice: asset.current_price,
        lastPriceUpdate: asset.last_price_update,
        metadata: asset.metadata,
        createdAt: asset.created_at,
        ...metrics,
      },
    }, 201);
  } catch (error) {
    console.error("Create asset handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /asset-handler/list
 * Get all assets for a portfolio
 * Requirement 2.4: Display all assets within portfolio
 */
async function handleListAssets(req: Request, userId: string) {
  try {
    const url = new URL(req.url);
    const portfolioId = url.searchParams.get("portfolio_id");

    if (!portfolioId) {
      return errorResponse("Portfolio ID is required");
    }

    // Verify portfolio belongs to user
    const { data: portfolio, error: portfolioError } = await supabase
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId)
      .eq("user_id", userId)
      .single();

    if (portfolioError || !portfolio) {
      return errorResponse("Portfolio not found", 404);
    }

    // Get all assets in portfolio
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (assetsError) {
      console.error("Error fetching assets:", assetsError);
      return errorResponse("Failed to fetch assets", 500);
    }

    // Calculate metrics for each asset
    const assetsWithMetrics = assets.map((asset) => {
      const metrics = calculateAssetMetrics(asset);
      return {
        id: asset.id,
        portfolioId: asset.portfolio_id,
        assetType: asset.asset_type,
        symbol: asset.symbol,
        name: asset.name,
        quantity: asset.quantity,
        purchasePrice: asset.purchase_price,
        purchaseDate: asset.purchase_date,
        currentPrice: asset.current_price,
        lastPriceUpdate: asset.last_price_update,
        metadata: asset.metadata,
        createdAt: asset.created_at,
        ...metrics,
      };
    });

    return jsonResponse({
      success: true,
      assets: assetsWithMetrics,
    });
  } catch (error) {
    console.error("List assets handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /asset-handler/:id
 * Get a single asset by ID
 * Requirement 3.5: Display asset details
 */
async function handleGetAsset(assetId: string, userId: string) {
  try {
    // Get asset
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("user_id", userId)
      .single();

    if (assetError || !asset) {
      return errorResponse("Asset not found", 404);
    }

    // Calculate metrics
    const metrics = calculateAssetMetrics(asset);

    return jsonResponse({
      success: true,
      asset: {
        id: asset.id,
        portfolioId: asset.portfolio_id,
        assetType: asset.asset_type,
        symbol: asset.symbol,
        name: asset.name,
        quantity: asset.quantity,
        purchasePrice: asset.purchase_price,
        purchaseDate: asset.purchase_date,
        currentPrice: asset.current_price,
        lastPriceUpdate: asset.last_price_update,
        metadata: asset.metadata,
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
        ...metrics,
      },
    });
  } catch (error) {
    console.error("Get asset handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * PUT /asset-handler/:id
 * Update asset
 * Requirements: 3.6, 4.5
 */
async function handleUpdateAsset(req: Request, assetId: string, userId: string) {
  try {
    const body = await req.json();

    // Validate input
    const validation = validateAssetInput(body, true);
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    // Check if asset exists and belongs to user
    const { data: existingAsset, error: fetchError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !existingAsset) {
      return errorResponse("Asset not found", 404);
    }

    // Build update object
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      updateData.name = body.name.trim();
    }

    if (body.quantity !== undefined) {
      updateData.quantity = Number(body.quantity);
    }

    if (body.purchase_price !== undefined) {
      updateData.purchase_price = Number(body.purchase_price);
    }

    if (body.purchase_date !== undefined) {
      updateData.purchase_date = body.purchase_date;
    }

    if (body.metadata !== undefined) {
      updateData.metadata = body.metadata;
    }

    // For non-listed assets, allow manual price updates
    if (!isListedAssetType(existingAsset.asset_type) && body.current_price !== undefined) {
      updateData.current_price = Number(body.current_price);
      updateData.last_price_update = new Date().toISOString();
    }

    // Update asset
    const { data: asset, error: updateError } = await supabase
      .from("assets")
      .update(updateData)
      .eq("id", assetId)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating asset:", updateError);
      return errorResponse("Failed to update asset", 500);
    }

    // Calculate metrics
    const metrics = calculateAssetMetrics(asset);

    return jsonResponse({
      success: true,
      message: "Asset updated successfully",
      asset: {
        id: asset.id,
        portfolioId: asset.portfolio_id,
        assetType: asset.asset_type,
        symbol: asset.symbol,
        name: asset.name,
        quantity: asset.quantity,
        purchasePrice: asset.purchase_price,
        purchaseDate: asset.purchase_date,
        currentPrice: asset.current_price,
        lastPriceUpdate: asset.last_price_update,
        metadata: asset.metadata,
        updatedAt: asset.updated_at,
        ...metrics,
      },
    });
  } catch (error) {
    console.error("Update asset handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * DELETE /asset-handler/:id
 * Delete an asset
 * Requirement 3.7: Remove asset from portfolio
 */
async function handleDeleteAsset(assetId: string, userId: string) {
  try {
    // Check if asset exists and belongs to user
    const { data: asset, error: fetchError } = await supabase
      .from("assets")
      .select("id")
      .eq("id", assetId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !asset) {
      return errorResponse("Asset not found", 404);
    }

    // Delete asset (cascade will delete price history and alerts)
    const { error: deleteError } = await supabase
      .from("assets")
      .delete()
      .eq("id", assetId)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting asset:", deleteError);
      return errorResponse("Failed to delete asset", 500);
    }

    return jsonResponse({
      success: true,
      message: "Asset deleted successfully",
    });
  } catch (error) {
    console.error("Delete asset handler error:", error);
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
    const pathParts = path.split("/").filter(Boolean);

    // Route requests
    if (path.endsWith("/create") && req.method === "POST") {
      return await handleCreateAsset(req, user.id);
    }

    if (path.endsWith("/list") && req.method === "GET") {
      return await handleListAssets(req, user.id);
    }

    // Handle /:id routes
    if (pathParts.length >= 2) {
      const assetId = pathParts[pathParts.length - 1];

      if (req.method === "GET") {
        return await handleGetAsset(assetId, user.id);
      }

      if (req.method === "PUT") {
        return await handleUpdateAsset(req, assetId, user.id);
      }

      if (req.method === "DELETE") {
        return await handleDeleteAsset(assetId, user.id);
      }
    }

    // Route not found
    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
