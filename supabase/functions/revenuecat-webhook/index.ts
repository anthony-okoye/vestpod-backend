// =====================================================
// Vestpod - RevenueCat Webhook Handler Edge Function
// =====================================================
// Handles RevenueCat webhook events for subscription management:
// - INITIAL_PURCHASE: New subscription purchase
// - RENEWAL: Subscription renewal
// - CANCELLATION: User cancels subscription
// - EXPIRATION: Subscription expires
// - BILLING_ISSUE: Payment failed
// Requirements: 10

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-revenuecat-signature",
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// RevenueCat webhook secret for signature verification
const REVENUECAT_WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");

// =====================================================
// Types
// =====================================================

interface RevenueCatWebhookEvent {
  api_version: string;
  event: {
    type: string;
    app_user_id: string;
    original_app_user_id: string;
    aliases: string[];
    product_id: string;
    entitlement_ids: string[];
    period_type: string;
    purchased_at_ms: number;
    expiration_at_ms: number | null;
    store: string;
    environment: string;
    is_trial_conversion: boolean;
    takehome_percentage: number;
    price: number;
    price_in_purchased_currency: number;
    currency: string;
    subscriber_attributes: Record<string, unknown>;
    transaction_id: string;
    original_transaction_id: string;
  };
}

// =====================================================
// Helper Functions
// =====================================================

/**
 * Verify webhook signature from RevenueCat
 */
function verifyWebhookSignature(
  signature: string | null,
  body: string
): boolean {
  if (!REVENUECAT_WEBHOOK_SECRET) {
    console.warn("REVENUECAT_WEBHOOK_SECRET not configured, skipping signature verification");
    return true; // Allow in development
  }

  if (!signature) {
    console.error("No signature provided in webhook request");
    return false;
  }

  try {
    const hmac = createHmac("sha256", REVENUECAT_WEBHOOK_SECRET);
    hmac.update(body);
    const expectedSignature = hmac.digest("hex");

    return signature === expectedSignature;
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
}

/**
 * Send JSON response
 */
function jsonResponse(data: Record<string, unknown>, status = 200) {
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
 * Get user ID from RevenueCat app_user_id
 */
function getUserId(appUserId: string): string {
  // RevenueCat app_user_id should match our Supabase user ID
  return appUserId;
}

/**
 * Determine subscription tier from product ID
 */
function getSubscriptionTier(productId: string): string | null {
  if (productId.includes("monthly")) {
    return "monthly";
  } else if (productId.includes("annual")) {
    return "annual";
  }
  return null;
}

/**
 * Check if subscription is in trial period
 */
function isTrialPeriod(periodType: string): boolean {
  return periodType === "trial";
}

// =====================================================
// Event Handlers
// =====================================================

/**
 * Handle INITIAL_PURCHASE event
 * User makes their first subscription purchase
 */
async function handleInitialPurchase(event: RevenueCatWebhookEvent["event"]) {
  console.log("Handling INITIAL_PURCHASE event:", event.app_user_id);

  const userId = getUserId(event.app_user_id);
  const tier = getSubscriptionTier(event.product_id);
  const isTrial = isTrialPeriod(event.period_type);
  const subscriptionStatus = isTrial ? "trial" : "active";

  const subscriptionData: Record<string, unknown> = {
    user_id: userId,
    revenuecat_customer_id: event.app_user_id,
    subscription_status: subscriptionStatus,
    subscription_tier: tier,
    subscription_start_date: new Date(event.purchased_at_ms).toISOString(),
    subscription_end_date: event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null,
    next_billing_date: event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null,
    is_premium: true,
    max_alerts: 999999, // Unlimited for premium
    price_update_frequency_minutes: 5, // 5 minutes for premium
  };

  if (isTrial) {
    subscriptionData.trial_start_date = new Date(event.purchased_at_ms).toISOString();
    subscriptionData.trial_end_date = event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null;
  }

  const { error } = await supabase
    .from("subscriptions")
    .upsert(subscriptionData, { onConflict: "user_id" });

  if (error) {
    console.error("Error updating subscription:", error);
    throw error;
  }

  console.log(`Subscription activated for user ${userId} (${tier}, trial: ${isTrial})`);
}

/**
 * Handle RENEWAL event
 * Subscription renews successfully
 */
async function handleRenewal(event: RevenueCatWebhookEvent["event"]) {
  console.log("Handling RENEWAL event:", event.app_user_id);

  const userId = getUserId(event.app_user_id);
  const tier = getSubscriptionTier(event.product_id);

  const { error } = await supabase
    .from("subscriptions")
    .update({
      subscription_status: "active",
      subscription_tier: tier,
      subscription_end_date: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      next_billing_date: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      is_premium: true,
      trial_start_date: null, // Clear trial dates on renewal
      trial_end_date: null,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating subscription:", error);
    throw error;
  }

  console.log(`Subscription renewed for user ${userId}`);
}

/**
 * Handle CANCELLATION event
 * User cancels subscription (but remains active until expiration)
 */
async function handleCancellation(event: RevenueCatWebhookEvent["event"]) {
  console.log("Handling CANCELLATION event:", event.app_user_id);

  const userId = getUserId(event.app_user_id);

  // Keep premium active until expiration date
  const { error } = await supabase
    .from("subscriptions")
    .update({
      subscription_status: "cancelled",
      // Keep is_premium true until expiration
      // next_billing_date will be null (no future billing)
      next_billing_date: null,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating subscription:", error);
    throw error;
  }

  console.log(`Subscription cancelled for user ${userId} (active until expiration)`);
}

/**
 * Handle EXPIRATION event
 * Subscription expires (after cancellation or failed payment)
 */
async function handleExpiration(event: RevenueCatWebhookEvent["event"]) {
  console.log("Handling EXPIRATION event:", event.app_user_id);

  const userId = getUserId(event.app_user_id);

  // Downgrade to free tier
  const { error } = await supabase
    .from("subscriptions")
    .update({
      subscription_status: "expired",
      subscription_tier: null,
      is_premium: false,
      max_alerts: 3, // Free tier limit
      price_update_frequency_minutes: 15, // Free tier frequency
      trial_start_date: null,
      trial_end_date: null,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating subscription:", error);
    throw error;
  }

  console.log(`Subscription expired for user ${userId}, downgraded to free tier`);
}

/**
 * Handle BILLING_ISSUE event
 * Payment failed, subscription at risk
 */
async function handleBillingIssue(event: RevenueCatWebhookEvent["event"]) {
  console.log("Handling BILLING_ISSUE event:", event.app_user_id);

  const userId = getUserId(event.app_user_id);

  // Keep subscription active but log the billing issue
  // RevenueCat will retry payment and send EXPIRATION if it fails
  const { error } = await supabase
    .from("subscriptions")
    .update({
      // Keep current status, just update the timestamp
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating subscription:", error);
    throw error;
  }

  console.log(`Billing issue detected for user ${userId}`);
  
  // TODO: Send notification to user about billing issue
  // This could be implemented in a future task
}

/**
 * Handle UNCANCELLATION event
 * User reactivates a cancelled subscription
 */
async function handleUncancellation(event: RevenueCatWebhookEvent["event"]) {
  console.log("Handling UNCANCELLATION event:", event.app_user_id);

  const userId = getUserId(event.app_user_id);
  const tier = getSubscriptionTier(event.product_id);

  const { error } = await supabase
    .from("subscriptions")
    .update({
      subscription_status: "active",
      subscription_tier: tier,
      subscription_end_date: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      next_billing_date: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      is_premium: true,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating subscription:", error);
    throw error;
  }

  console.log(`Subscription reactivated for user ${userId}`);
}

// =====================================================
// Main Request Handler
// =====================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Get request body as text for signature verification
    const bodyText = await req.text();
    
    // Verify webhook signature
    const signature = req.headers.get("X-RevenueCat-Signature");
    if (!verifyWebhookSignature(signature, bodyText)) {
      console.error("Invalid webhook signature");
      return errorResponse("Invalid signature", 401);
    }

    // Parse webhook event
    const webhookEvent: RevenueCatWebhookEvent = JSON.parse(bodyText);
    const { event } = webhookEvent;

    console.log(`Received webhook event: ${event.type} for user ${event.app_user_id}`);

    // Route to appropriate handler based on event type
    switch (event.type) {
      case "INITIAL_PURCHASE":
        await handleInitialPurchase(event);
        break;

      case "RENEWAL":
        await handleRenewal(event);
        break;

      case "CANCELLATION":
        await handleCancellation(event);
        break;

      case "EXPIRATION":
        await handleExpiration(event);
        break;

      case "BILLING_ISSUE":
        await handleBillingIssue(event);
        break;

      case "UNCANCELLATION":
        await handleUncancellation(event);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
        // Return 200 to acknowledge receipt even for unhandled events
        return jsonResponse({ message: "Event received but not handled" });
    }

    return jsonResponse({ 
      success: true, 
      message: `Event ${event.type} processed successfully` 
    });

  } catch (error) {
    console.error("Webhook handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
