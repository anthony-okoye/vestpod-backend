// =====================================================
// Vestpod - Portfolio Handler Edge Function
// =====================================================
// Handles portfolio CRUD operations:
// - Create portfolio
// - Read portfolios (list and single)
// - Update portfolio
// - Delete portfolio
// Requirements: 2

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/auth.ts";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client with service role for database operations
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// Helper Functions
// =====================================================

/**
 * Send JSON response
 */
function jsonResponse(data: any, status = 200) {
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
 * Calculate portfolio total value and performance
 */
async function calculatePortfolioMetrics(portfolioId: string) {
  // Get all assets in portfolio
  const { data: assets, error } = await supabase
    .from("assets")
    .select("quantity, purchase_price, current_price")
    .eq("portfolio_id", portfolioId);

  if (error) {
    console.error("Error fetching assets for metrics:", error);
    return { totalValue: 0, totalCost: 0, performance: 0 };
  }

  if (!assets || assets.length === 0) {
    return { totalValue: 0, totalCost: 0, performance: 0 };
  }

  let totalValue = 0;
  let totalCost = 0;

  for (const asset of assets) {
    const currentPrice = asset.current_price || asset.purchase_price;
    totalValue += Number(asset.quantity) * Number(currentPrice);
    totalCost += Number(asset.quantity) * Number(asset.purchase_price);
  }

  const performance = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

  return {
    totalValue: Number(totalValue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    performance: Number(performance.toFixed(2)),
  };
}

// =====================================================
// Route Handlers
// =====================================================

/**
 * POST /portfolio-handler/create
 * Create a new portfolio
 * Requirement 2.2: Unique portfolio name validation
 */
async function handleCreatePortfolio(req: Request, userId: string) {
  try {
    const { name, description } = await req.json();

    // Validate input
    if (!name || name.trim().length === 0) {
      return errorResponse("Portfolio name is required");
    }

    const trimmedName = name.trim();

    // Check if portfolio name already exists for this user
    const { data: existingPortfolio } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", userId)
      .eq("name", trimmedName)
      .single();

    if (existingPortfolio) {
      return errorResponse("Portfolio name already exists. Please choose a different name.", 409);
    }

    // Create portfolio
    const { data: portfolio, error } = await supabase
      .from("portfolios")
      .insert({
        user_id: userId,
        name: trimmedName,
        description: description || null,
        is_default: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating portfolio:", error);
      return errorResponse("Failed to create portfolio", 500);
    }

    return jsonResponse({
      success: true,
      message: "Portfolio created successfully",
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        description: portfolio.description,
        isDefault: portfolio.is_default,
        createdAt: portfolio.created_at,
        totalValue: 0,
        performance: 0,
      },
    }, 201);
  } catch (error) {
    console.error("Create portfolio handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /portfolio-handler/list
 * Get all portfolios for the authenticated user
 * Requirement 2.3: Display all portfolios with total value and performance
 */
async function handleListPortfolios(userId: string) {
  try {
    // Get all portfolios for user
    const { data: portfolios, error } = await supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching portfolios:", error);
      return errorResponse("Failed to fetch portfolios", 500);
    }

    // Calculate metrics for each portfolio
    const portfoliosWithMetrics = await Promise.all(
      portfolios.map(async (portfolio) => {
        const metrics = await calculatePortfolioMetrics(portfolio.id);
        return {
          id: portfolio.id,
          name: portfolio.name,
          description: portfolio.description,
          isDefault: portfolio.is_default,
          createdAt: portfolio.created_at,
          totalValue: metrics.totalValue,
          totalCost: metrics.totalCost,
          performance: metrics.performance,
        };
      })
    );

    return jsonResponse({
      success: true,
      portfolios: portfoliosWithMetrics,
    });
  } catch (error) {
    console.error("List portfolios handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /portfolio-handler/:id
 * Get a single portfolio by ID
 * Requirement 2.4: Display portfolio with assets
 */
async function handleGetPortfolio(portfolioId: string, userId: string) {
  try {
    // Get portfolio
    const { data: portfolio, error: portfolioError } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolioId)
      .eq("user_id", userId)
      .single();

    if (portfolioError || !portfolio) {
      return errorResponse("Portfolio not found", 404);
    }

    // Calculate metrics
    const metrics = await calculatePortfolioMetrics(portfolio.id);

    // Get asset count
    const { count: assetCount } = await supabase
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("portfolio_id", portfolioId);

    return jsonResponse({
      success: true,
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        description: portfolio.description,
        isDefault: portfolio.is_default,
        createdAt: portfolio.created_at,
        totalValue: metrics.totalValue,
        totalCost: metrics.totalCost,
        performance: metrics.performance,
        assetCount: assetCount || 0,
      },
    });
  } catch (error) {
    console.error("Get portfolio handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * PUT /portfolio-handler/:id
 * Update portfolio name or description
 * Requirement 2.5: Update portfolio name
 */
async function handleUpdatePortfolio(req: Request, portfolioId: string, userId: string) {
  try {
    const { name, description } = await req.json();

    // Validate input
    if (!name || name.trim().length === 0) {
      return errorResponse("Portfolio name is required");
    }

    const trimmedName = name.trim();

    // Check if portfolio exists and belongs to user
    const { data: existingPortfolio, error: fetchError } = await supabase
      .from("portfolios")
      .select("id, name")
      .eq("id", portfolioId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !existingPortfolio) {
      return errorResponse("Portfolio not found", 404);
    }

    // Check if new name conflicts with another portfolio
    if (trimmedName !== existingPortfolio.name) {
      const { data: conflictingPortfolio } = await supabase
        .from("portfolios")
        .select("id")
        .eq("user_id", userId)
        .eq("name", trimmedName)
        .neq("id", portfolioId)
        .single();

      if (conflictingPortfolio) {
        return errorResponse("Portfolio name already exists. Please choose a different name.", 409);
      }
    }

    // Update portfolio
    const { data: portfolio, error: updateError } = await supabase
      .from("portfolios")
      .update({
        name: trimmedName,
        description: description || null,
      })
      .eq("id", portfolioId)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating portfolio:", error);
      return errorResponse("Failed to update portfolio", 500);
    }

    // Calculate metrics
    const metrics = await calculatePortfolioMetrics(portfolio.id);

    return jsonResponse({
      success: true,
      message: "Portfolio updated successfully",
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        description: portfolio.description,
        isDefault: portfolio.is_default,
        updatedAt: portfolio.updated_at,
        totalValue: metrics.totalValue,
        performance: metrics.performance,
      },
    });
  } catch (error) {
    console.error("Update portfolio handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * DELETE /portfolio-handler/:id
 * Delete a portfolio
 * Requirement 2.6: Delete portfolio and all associated assets
 * Requirement 2.7: Prevent deletion of only portfolio
 */
async function handleDeletePortfolio(portfolioId: string, userId: string) {
  try {
    // Check if portfolio exists and belongs to user
    const { data: portfolio, error: fetchError } = await supabase
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !portfolio) {
      return errorResponse("Portfolio not found", 404);
    }

    // Count total portfolios for user
    const { count: portfolioCount } = await supabase
      .from("portfolios")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    // Prevent deletion if this is the only portfolio
    if (portfolioCount === 1) {
      return errorResponse("Cannot delete your only portfolio. Create another portfolio first.", 400);
    }

    // Delete portfolio (cascade will delete associated assets)
    const { error: deleteError } = await supabase
      .from("portfolios")
      .delete()
      .eq("id", portfolioId)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting portfolio:", deleteError);
      return errorResponse("Failed to delete portfolio", 500);
    }

    return jsonResponse({
      success: true,
      message: "Portfolio deleted successfully",
    });
  } catch (error) {
    console.error("Delete portfolio handler error:", error);
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
      return await handleCreatePortfolio(req, user.id);
    }

    if (path.endsWith("/list") && req.method === "GET") {
      return await handleListPortfolios(user.id);
    }

    // Handle /:id routes
    if (pathParts.length >= 2) {
      const portfolioId = pathParts[pathParts.length - 1];

      if (req.method === "GET") {
        return await handleGetPortfolio(portfolioId, user.id);
      }

      if (req.method === "PUT") {
        return await handleUpdatePortfolio(req, portfolioId, user.id);
      }

      if (req.method === "DELETE") {
        return await handleDeletePortfolio(portfolioId, user.id);
      }
    }

    // Route not found
    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
