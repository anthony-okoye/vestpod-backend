// =====================================================
// Vestpod - Alert Checker Job Edge Function
// =====================================================
// Scheduled job that checks alert conditions and sends notifications
// - Evaluates price target alerts (above/below)
// - Evaluates percentage change alerts (change_up/change_down)
// - Evaluates maturity reminder alerts
// - Sends push notifications when conditions are met
// - Runs every 5 minutes via cron trigger
// Requirements: 7

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Alert from database
 */
interface Alert {
  id: string;
  user_id: string;
  asset_id: string;
  alert_type: "price_target" | "percentage_change" | "maturity_reminder";
  condition_value: number | null;
  condition_operator: "above" | "below" | "change_up" | "change_down" | null;
  is_active: boolean;
  triggered_at: string | null;
  last_checked_at: string | null;
  reminder_days_before: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Asset with price information
 */
interface Asset {
  id: string;
  name: string;
  symbol: string | null;
  asset_type: string;
  current_price: number | null;
  purchase_price: number;
  metadata: {
    maturity_date?: string;
    [key: string]: unknown;
  };
}

/**
 * Alert check result
 */
interface AlertCheckResult {
  alert_id: string;
  user_id: string;
  triggered: boolean;
  reason?: string;
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
 * Check if price target alert condition is met
 * Requirement 7.2: Trigger when asset price reaches target
 */
function checkPriceTargetAlert(
  alert: Alert,
  asset: Asset
): { triggered: boolean; reason?: string } {
  if (!asset.current_price || !alert.condition_value) {
    return { triggered: false };
  }

  const currentPrice = asset.current_price;
  const targetPrice = alert.condition_value;
  const operator = alert.condition_operator;

  if (operator === "above" && currentPrice >= targetPrice) {
    return {
      triggered: true,
      reason: `${asset.name} (${asset.symbol || "N/A"}) reached $${currentPrice.toFixed(2)}, above target of $${targetPrice.toFixed(2)}`,
    };
  }

  if (operator === "below" && currentPrice <= targetPrice) {
    return {
      triggered: true,
      reason: `${asset.name} (${asset.symbol || "N/A"}) dropped to $${currentPrice.toFixed(2)}, below target of $${targetPrice.toFixed(2)}`,
    };
  }

  return { triggered: false };
}

/**
 * Check if percentage change alert condition is met
 * Requirement 7.3: Trigger when price changes by specified percentage
 */
function checkPercentageChangeAlert(
  alert: Alert,
  asset: Asset
): { triggered: boolean; reason?: string } {
  if (!asset.current_price || !alert.condition_value) {
    return { triggered: false };
  }

  const currentPrice = asset.current_price;
  const purchasePrice = asset.purchase_price;
  const targetPercentage = alert.condition_value;
  const operator = alert.condition_operator;

  // Calculate percentage change from purchase price
  const percentageChange = ((currentPrice - purchasePrice) / purchasePrice) * 100;

  if (operator === "change_up" && percentageChange >= targetPercentage) {
    return {
      triggered: true,
      reason: `${asset.name} (${asset.symbol || "N/A"}) increased by ${percentageChange.toFixed(2)}%, exceeding target of ${targetPercentage.toFixed(2)}%`,
    };
  }

  if (operator === "change_down" && percentageChange <= -targetPercentage) {
    return {
      triggered: true,
      reason: `${asset.name} (${asset.symbol || "N/A"}) decreased by ${Math.abs(percentageChange).toFixed(2)}%, exceeding target of ${targetPercentage.toFixed(2)}%`,
    };
  }

  return { triggered: false };
}

/**
 * Check if maturity reminder alert condition is met
 * Requirement 7.4: Trigger N days before maturity date
 */
function checkMaturityReminderAlert(
  alert: Alert,
  asset: Asset
): { triggered: boolean; reason?: string } {
  if (!asset.metadata?.maturity_date || alert.reminder_days_before === null) {
    return { triggered: false };
  }

  const maturityDate = new Date(asset.metadata.maturity_date);
  const today = new Date();
  const reminderDate = new Date(maturityDate);
  reminderDate.setDate(reminderDate.getDate() - alert.reminder_days_before);

  // Check if today is the reminder date or later (but before maturity)
  if (today >= reminderDate && today < maturityDate) {
    const daysUntilMaturity = Math.ceil(
      (maturityDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      triggered: true,
      reason: `${asset.name} will mature in ${daysUntilMaturity} day${daysUntilMaturity !== 1 ? "s" : ""} on ${maturityDate.toLocaleDateString()}`,
    };
  }

  return { triggered: false };
}

/**
 * Send push notification to user
 * Requirement 7.5: Send push notification when alert triggers
 */
async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  alertId: string
): Promise<boolean> {
  try {
    // In a production environment, this would integrate with:
    // - Firebase Cloud Messaging (FCM) for Android
    // - Apple Push Notification Service (APNs) for iOS
    // - Or a service like OneSignal, Pusher, etc.
    
    // For now, we'll log the notification
    console.log(`[PUSH NOTIFICATION] User: ${userId}`);
    console.log(`  Title: ${title}`);
    console.log(`  Body: ${body}`);
    console.log(`  Alert ID: ${alertId}`);

    // TODO: Implement actual push notification service integration
    // Example with FCM:
    // const fcmToken = await getUserFCMToken(userId);
    // await sendFCMNotification(fcmToken, { title, body, data: { alert_id: alertId } });

    return true;
  } catch (error) {
    console.error("Error sending push notification:", error);
    return false;
  }
}

/**
 * Check a single alert and trigger notification if needed
 */
async function checkAlert(
  supabase: ReturnType<typeof createClient>,
  alert: Alert,
  asset: Asset
): Promise<AlertCheckResult> {
  const now = new Date().toISOString();

  // Update last_checked_at timestamp
  await supabase
    .from("alerts")
    .update({ last_checked_at: now })
    .eq("id", alert.id);

  let checkResult: { triggered: boolean; reason?: string } = { triggered: false };

  // Check alert condition based on type
  switch (alert.alert_type) {
    case "price_target":
      checkResult = checkPriceTargetAlert(alert, asset);
      break;
    case "percentage_change":
      checkResult = checkPercentageChangeAlert(alert, asset);
      break;
    case "maturity_reminder":
      checkResult = checkMaturityReminderAlert(alert, asset);
      break;
    default:
      return {
        alert_id: alert.id,
        user_id: alert.user_id,
        triggered: false,
        error: `Unknown alert type: ${alert.alert_type}`,
      };
  }

  if (!checkResult.triggered) {
    return {
      alert_id: alert.id,
      user_id: alert.user_id,
      triggered: false,
    };
  }

  // Alert condition is met - send notification and mark as triggered
  const notificationTitle = "Price Alert Triggered";
  const notificationBody = checkResult.reason || "Your alert condition has been met";

  const notificationSent = await sendPushNotification(
    alert.user_id,
    notificationTitle,
    notificationBody,
    alert.id
  );

  // Mark alert as triggered and deactivate it
  await supabase
    .from("alerts")
    .update({
      triggered_at: now,
      is_active: false,
    })
    .eq("id", alert.id);

  return {
    alert_id: alert.id,
    user_id: alert.user_id,
    triggered: true,
    reason: checkResult.reason,
    notification_sent: notificationSent,
  };
}

/**
 * Process all active alerts
 */
async function processAlerts(supabase: ReturnType<typeof createClient>) {
  // Fetch all active alerts with their associated assets
  const { data: alerts, error: alertsError } = await supabase
    .from("alerts")
    .select(`
      *,
      assets (
        id,
        name,
        symbol,
        asset_type,
        current_price,
        purchase_price,
        metadata
      )
    `)
    .eq("is_active", true);

  if (alertsError) {
    console.error("Error fetching alerts:", alertsError);
    throw new Error(`Failed to fetch alerts: ${alertsError.message}`);
  }

  if (!alerts || alerts.length === 0) {
    return {
      total_alerts: 0,
      alerts_triggered: 0,
      notifications_sent: 0,
      results: [],
    };
  }

  console.log(`Checking ${alerts.length} active alerts`);

  // Check each alert
  const results: AlertCheckResult[] = [];
  for (const alert of alerts) {
    if (!alert.assets) {
      console.error(`Alert ${alert.id} has no associated asset`);
      results.push({
        alert_id: alert.id,
        user_id: alert.user_id,
        triggered: false,
        error: "Asset not found",
      });
      continue;
    }

    const result = await checkAlert(
      supabase,
      alert as Alert,
      alert.assets as unknown as Asset
    );
    results.push(result);
  }

  const triggeredCount = results.filter((r) => r.triggered).length;
  const notificationsSent = results.filter((r) => r.notification_sent).length;

  return {
    total_alerts: alerts.length,
    alerts_triggered: triggeredCount,
    notifications_sent: notificationsSent,
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

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Supabase configuration missing" }, 500);
    }

    // Create Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const startTime = Date.now();

    // Process all active alerts
    const result = await processAlerts(supabase);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`Alert checker completed in ${duration}ms`);
    console.log(`  Total alerts checked: ${result.total_alerts}`);
    console.log(`  Alerts triggered: ${result.alerts_triggered}`);
    console.log(`  Notifications sent: ${result.notifications_sent}`);

    return jsonResponse({
      success: true,
      ...result,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Alert checker job error:", error);
    return jsonResponse(
      {
        error: "Alert checker job failed",
        message: (error as Error).message,
      },
      500
    );
  }
});
