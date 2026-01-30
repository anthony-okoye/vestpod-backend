// =====================================================
// Vestpod - Alert Handler Edge Function
// =====================================================
// Handles alert CRUD operations:
// - Create alert (price target, percentage change, maturity reminder)
// - Read alerts (list and single)
// - Update alert
// - Delete alert
// - Enforce free user alert limit (3 alerts)
// Requirements: 7

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

// Valid alert types
const ALERT_TYPES = ["price_target", "percentage_change", "maturity_reminder"] as const;
type AlertType = typeof ALERT_TYPES[number];

// Valid condition operators
const CONDITION_OPERATORS = ["above", "below", "change_up", "change_down"] as const;
type ConditionOperator = typeof CONDITION_OPERATORS[number];

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
 * Validate alert type
 */
function isValidAlertType(type: string): type is AlertType {
  return ALERT_TYPES.includes(type as AlertType);
}

/**
 * Validate condition operator
 */
function isValidConditionOperator(operator: string): operator is ConditionOperator {
  return CONDITION_OPERATORS.includes(operator as ConditionOperator);
}

// Import centralized subscription helper
import { getSubscriptionLimits, checkPremiumStatus } from "../_shared/subscription-helper.ts";

/**
 * Get user's subscription status
 * Requirement 7.6, 7.7: Check alert limits based on subscription
 */
async function getUserSubscription(userId: string) {
  const limits = await getSubscriptionLimits(userId);
  const isPremium = await checkPremiumStatus(userId);
  
  return { 
    is_premium: isPremium, 
    max_alerts: limits.maxAlerts 
  };
}

/**
 * Count active alerts for user
 */
async function countActiveAlerts(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("Error counting alerts:", error);
    return 0;
  }

  return count || 0;
}

/**
 * Validate alert creation input
 * Requirement 7.1: Require asset, alert type, and condition parameters
 */
function validateAlertInput(data: Record<string, unknown>, isUpdate = false): { valid: boolean; error?: string } {
  // Asset ID validation
  if (!isUpdate && (!data.asset_id || typeof data.asset_id !== "string")) {
    return {
      valid: false,
      error: "Asset ID is required",
    };
  }

  // Alert type validation
  if (!isUpdate && (!data.alert_type || !isValidAlertType(data.alert_type as string))) {
    return {
      valid: false,
      error: `Invalid alert type. Must be one of: ${ALERT_TYPES.join(", ")}`,
    };
  }

  const alertType = data.alert_type as AlertType;

  // Price target validation
  if (!isUpdate && alertType === "price_target") {
    if (data.condition_value === undefined || data.condition_value === null) {
      return {
        valid: false,
        error: "Condition value (target price) is required for price target alerts",
      };
    }

    if (isNaN(Number(data.condition_value)) || Number(data.condition_value) <= 0) {
      return {
        valid: false,
        error: "Condition value must be a positive number",
      };
    }

    if (!data.condition_operator || !isValidConditionOperator(data.condition_operator as string)) {
      return {
        valid: false,
        error: "Condition operator must be 'above' or 'below' for price target alerts",
      };
    }

    if (!["above", "below"].includes(data.condition_operator as string)) {
      return {
        valid: false,
        error: "Condition operator must be 'above' or 'below' for price target alerts",
      };
    }
  }

  // Percentage change validation
  if (!isUpdate && alertType === "percentage_change") {
    if (data.condition_value === undefined || data.condition_value === null) {
      return {
        valid: false,
        error: "Condition value (percentage) is required for percentage change alerts",
      };
    }

    if (isNaN(Number(data.condition_value)) || Number(data.condition_value) <= 0) {
      return {
        valid: false,
        error: "Condition value must be a positive number",
      };
    }

    if (!data.condition_operator || !isValidConditionOperator(data.condition_operator as string)) {
      return {
        valid: false,
        error: "Condition operator must be 'change_up' or 'change_down' for percentage change alerts",
      };
    }

    if (!["change_up", "change_down"].includes(data.condition_operator as string)) {
      return {
        valid: false,
        error: "Condition operator must be 'change_up' or 'change_down' for percentage change alerts",
      };
    }
  }

  // Maturity reminder validation
  if (!isUpdate && alertType === "maturity_reminder") {
    if (data.reminder_days_before === undefined || data.reminder_days_before === null) {
      return {
        valid: false,
        error: "Reminder days before is required for maturity reminder alerts",
      };
    }

    if (isNaN(Number(data.reminder_days_before)) || Number(data.reminder_days_before) < 0) {
      return {
        valid: false,
        error: "Reminder days before must be a non-negative number",
      };
    }
  }

  return { valid: true };
}

/**
 * Format alert for response
 */
function formatAlert(alert: Record<string, unknown>) {
  return {
    id: alert.id,
    userId: alert.user_id,
    assetId: alert.asset_id,
    alertType: alert.alert_type,
    conditionValue: alert.condition_value,
    conditionOperator: alert.condition_operator,
    isActive: alert.is_active,
    triggeredAt: alert.triggered_at,
    lastCheckedAt: alert.last_checked_at,
    reminderDaysBefore: alert.reminder_days_before,
    createdAt: alert.created_at,
    updatedAt: alert.updated_at,
  };
}

// =====================================================
// Route Handlers
// =====================================================

/**
 * POST /alert-handler/create
 * Create a new alert
 * Requirements: 7.1, 7.6, 7.7
 */
async function handleCreateAlert(req: Request, userId: string) {
  try {
    const body = await req.json();

    // Validate input
    const validation = validateAlertInput(body);
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    const {
      asset_id,
      alert_type,
      condition_value,
      condition_operator,
      reminder_days_before,
    } = body;

    // Verify asset belongs to user
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id, name, asset_type, metadata")
      .eq("id", asset_id)
      .eq("user_id", userId)
      .single();

    if (assetError || !asset) {
      return errorResponse("Asset not found", 404);
    }

    // Check alert limit for free users
    const subscription = await getUserSubscription(userId);
    const activeAlertCount = await countActiveAlerts(userId);

    if (!subscription.is_premium && activeAlertCount >= subscription.max_alerts) {
      return errorResponse(
        `Free users are limited to ${subscription.max_alerts} active alerts. Upgrade to premium for unlimited alerts.`,
        403
      );
    }

    // For maturity reminders, verify asset is fixed income with maturity date
    if (alert_type === "maturity_reminder") {
      if (asset.asset_type !== "fixed_income") {
        return errorResponse("Maturity reminders can only be set for fixed income assets");
      }

      if (!asset.metadata || !asset.metadata.maturity_date) {
        return errorResponse("This fixed income asset does not have a maturity date set");
      }
    }

    // Create alert
    const { data: alert, error: createError } = await supabase
      .from("alerts")
      .insert({
        user_id: userId,
        asset_id,
        alert_type,
        condition_value: condition_value !== undefined ? Number(condition_value) : null,
        condition_operator: condition_operator || null,
        reminder_days_before: reminder_days_before !== undefined ? Number(reminder_days_before) : null,
        is_active: true,
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating alert:", createError);
      return errorResponse("Failed to create alert", 500);
    }

    return jsonResponse({
      success: true,
      message: "Alert created successfully",
      alert: formatAlert(alert),
    }, 201);
  } catch (error) {
    console.error("Create alert handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /alert-handler/list
 * Get all alerts for user
 * Requirement 7.8: Display all active alerts
 */
async function handleListAlerts(req: Request, userId: string) {
  try {
    const url = new URL(req.url);
    const assetId = url.searchParams.get("asset_id");
    const activeOnly = url.searchParams.get("active_only") === "true";

    let query = supabase
      .from("alerts")
      .select(`
        *,
        assets (
          id,
          name,
          symbol,
          asset_type,
          current_price
        )
      `)
      .eq("user_id", userId);

    if (assetId) {
      query = query.eq("asset_id", assetId);
    }

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    query = query.order("created_at", { ascending: false });

    const { data: alerts, error: alertsError } = await query;

    if (alertsError) {
      console.error("Error fetching alerts:", alertsError);
      return errorResponse("Failed to fetch alerts", 500);
    }

    const formattedAlerts = alerts.map((alert) => ({
      ...formatAlert(alert),
      asset: alert.assets ? {
        id: alert.assets.id,
        name: alert.assets.name,
        symbol: alert.assets.symbol,
        assetType: alert.assets.asset_type,
        currentPrice: alert.assets.current_price,
      } : null,
    }));

    return jsonResponse({
      success: true,
      alerts: formattedAlerts,
    });
  } catch (error) {
    console.error("List alerts handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * GET /alert-handler/:id
 * Get a single alert by ID
 */
async function handleGetAlert(alertId: string, userId: string) {
  try {
    const { data: alert, error: alertError } = await supabase
      .from("alerts")
      .select(`
        *,
        assets (
          id,
          name,
          symbol,
          asset_type,
          current_price
        )
      `)
      .eq("id", alertId)
      .eq("user_id", userId)
      .single();

    if (alertError || !alert) {
      return errorResponse("Alert not found", 404);
    }

    return jsonResponse({
      success: true,
      alert: {
        ...formatAlert(alert),
        asset: alert.assets ? {
          id: alert.assets.id,
          name: alert.assets.name,
          symbol: alert.assets.symbol,
          assetType: alert.assets.asset_type,
          currentPrice: alert.assets.current_price,
        } : null,
      },
    });
  } catch (error) {
    console.error("Get alert handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * PUT /alert-handler/:id
 * Update alert
 */
async function handleUpdateAlert(req: Request, alertId: string, userId: string) {
  try {
    const body = await req.json();

    // Validate input
    const validation = validateAlertInput(body, true);
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    // Check if alert exists and belongs to user
    const { data: existingAlert, error: fetchError } = await supabase
      .from("alerts")
      .select("*")
      .eq("id", alertId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !existingAlert) {
      return errorResponse("Alert not found", 404);
    }

    // Build update object
    const updateData: Record<string, unknown> = {};

    if (body.condition_value !== undefined) {
      updateData.condition_value = Number(body.condition_value);
    }

    if (body.condition_operator !== undefined) {
      updateData.condition_operator = body.condition_operator;
    }

    if (body.reminder_days_before !== undefined) {
      updateData.reminder_days_before = Number(body.reminder_days_before);
    }

    if (body.is_active !== undefined) {
      updateData.is_active = Boolean(body.is_active);
    }

    // Update alert
    const { data: alert, error: updateError } = await supabase
      .from("alerts")
      .update(updateData)
      .eq("id", alertId)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating alert:", updateError);
      return errorResponse("Failed to update alert", 500);
    }

    return jsonResponse({
      success: true,
      message: "Alert updated successfully",
      alert: formatAlert(alert),
    });
  } catch (error) {
    console.error("Update alert handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * DELETE /alert-handler/:id
 * Delete an alert
 */
async function handleDeleteAlert(alertId: string, userId: string) {
  try {
    // Check if alert exists and belongs to user
    const { data: alert, error: fetchError } = await supabase
      .from("alerts")
      .select("id")
      .eq("id", alertId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !alert) {
      return errorResponse("Alert not found", 404);
    }

    // Delete alert
    const { error: deleteError } = await supabase
      .from("alerts")
      .delete()
      .eq("id", alertId)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting alert:", deleteError);
      return errorResponse("Failed to delete alert", 500);
    }

    return jsonResponse({
      success: true,
      message: "Alert deleted successfully",
    });
  } catch (error) {
    console.error("Delete alert handler error:", error);
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
      return await handleCreateAlert(req, user.id);
    }

    if (path.endsWith("/list") && req.method === "GET") {
      return await handleListAlerts(req, user.id);
    }

    // Handle /:id routes
    if (pathParts.length >= 2) {
      const alertId = pathParts[pathParts.length - 1];

      if (req.method === "GET") {
        return await handleGetAlert(alertId, user.id);
      }

      if (req.method === "PUT") {
        return await handleUpdateAlert(req, alertId, user.id);
      }

      if (req.method === "DELETE") {
        return await handleDeleteAlert(alertId, user.id);
      }
    }

    // Route not found
    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
