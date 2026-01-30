// =====================================================
// Vestpod - Subscription Helper Module
// =====================================================
// Centralized subscription status checking and feature access control
// Requirements: 10

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// Types
// =====================================================

export interface SubscriptionStatus {
  isPremium: boolean;
  status: "free" | "trial" | "active" | "expired" | "cancelled";
  tier: "monthly" | "annual" | null;
  maxAlerts: number;
  priceUpdateFrequency: number;
  subscriptionEndDate: string | null;
  isExpired: boolean;
}

export interface FeatureAccess {
  canAccessAIInsights: boolean;
  canAccessAIChat: boolean;
  canExportData: boolean;
  maxAlerts: number;
  priceUpdateFrequency: number;
}

// =====================================================
// Core Functions
// =====================================================

/**
 * Check if a user has premium access
 * Handles subscription expiration automatically
 * 
 * @param userId - The user's UUID
 * @returns Promise<boolean> - True if user has active premium subscription
 */
export async function checkPremiumStatus(userId: string): Promise<boolean> {
  const status = await getSubscriptionStatus(userId);
  return status.isPremium && !status.isExpired;
}

/**
 * Get detailed subscription status for a user
 * Automatically handles expired subscriptions
 * 
 * @param userId - The user's UUID
 * @returns Promise<SubscriptionStatus> - Detailed subscription information
 */
export async function getSubscriptionStatus(
  userId: string
): Promise<SubscriptionStatus> {
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select(
      "subscription_status, subscription_tier, is_premium, max_alerts, price_update_frequency_minutes, subscription_end_date"
    )
    .eq("user_id", userId)
    .single();

  if (error || !subscription) {
    // Return default free tier if subscription not found
    return {
      isPremium: false,
      status: "free",
      tier: null,
      maxAlerts: 3,
      priceUpdateFrequency: 15,
      subscriptionEndDate: null,
      isExpired: false,
    };
  }

  // Check if subscription has expired
  const isExpired = checkSubscriptionExpiration(
    subscription.subscription_end_date,
    subscription.subscription_status
  );

  // If expired and still marked as premium, downgrade automatically
  if (isExpired && subscription.is_premium) {
    await downgradeExpiredSubscription(userId);
    return {
      isPremium: false,
      status: "expired",
      tier: null,
      maxAlerts: 3,
      priceUpdateFrequency: 15,
      subscriptionEndDate: subscription.subscription_end_date,
      isExpired: true,
    };
  }

  return {
    isPremium: subscription.is_premium,
    status: subscription.subscription_status,
    tier: subscription.subscription_tier,
    maxAlerts: subscription.max_alerts,
    priceUpdateFrequency: subscription.price_update_frequency_minutes,
    subscriptionEndDate: subscription.subscription_end_date,
    isExpired,
  };
}

/**
 * Get feature access permissions for a user
 * 
 * @param userId - The user's UUID
 * @returns Promise<FeatureAccess> - Feature access permissions
 */
export async function getFeatureAccess(userId: string): Promise<FeatureAccess> {
  const status = await getSubscriptionStatus(userId);
  const isPremiumActive = status.isPremium && !status.isExpired;

  return {
    canAccessAIInsights: isPremiumActive,
    canAccessAIChat: isPremiumActive,
    canExportData: isPremiumActive,
    maxAlerts: status.maxAlerts,
    priceUpdateFrequency: status.priceUpdateFrequency,
  };
}

/**
 * Check if a specific feature is accessible for a user
 * 
 * @param userId - The user's UUID
 * @param feature - The feature to check
 * @returns Promise<boolean> - True if user can access the feature
 */
export async function canAccessFeature(
  userId: string,
  feature: "ai_insights" | "ai_chat" | "data_export" | "unlimited_alerts"
): Promise<boolean> {
  const access = await getFeatureAccess(userId);

  switch (feature) {
    case "ai_insights":
      return access.canAccessAIInsights;
    case "ai_chat":
      return access.canAccessAIChat;
    case "data_export":
      return access.canExportData;
    case "unlimited_alerts":
      return access.maxAlerts > 3; // Premium users have unlimited (999999)
    default:
      return false;
  }
}

// =====================================================
// Helper Functions
// =====================================================

/**
 * Check if a subscription has expired based on end date
 * 
 * @param endDate - Subscription end date (ISO string)
 * @param status - Current subscription status
 * @returns boolean - True if subscription has expired
 */
function checkSubscriptionExpiration(
  endDate: string | null,
  status: string
): boolean {
  // If no end date, subscription is not expired
  if (!endDate) {
    return false;
  }

  // If already marked as expired, return true
  if (status === "expired") {
    return true;
  }

  // Check if end date has passed
  const now = new Date();
  const expirationDate = new Date(endDate);

  return now > expirationDate;
}

/**
 * Downgrade an expired subscription to free tier
 * 
 * @param userId - The user's UUID
 */
async function downgradeExpiredSubscription(userId: string): Promise<void> {
  console.log(`Downgrading expired subscription for user ${userId}`);

  const { error } = await supabase
    .from("subscriptions")
    .update({
      subscription_status: "expired",
      subscription_tier: null,
      is_premium: false,
      max_alerts: 3,
      price_update_frequency_minutes: 15,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error downgrading expired subscription:", error);
    throw error;
  }

  console.log(`Successfully downgraded user ${userId} to free tier`);
}

/**
 * Validate that a user has premium access, throw error if not
 * Useful for premium-only endpoints
 * 
 * @param userId - The user's UUID
 * @throws Error if user does not have premium access
 */
export async function requirePremiumAccess(userId: string): Promise<void> {
  const isPremium = await checkPremiumStatus(userId);

  if (!isPremium) {
    throw new Error(
      "Premium subscription required. Please upgrade to access this feature."
    );
  }
}

/**
 * Get subscription limits for a user
 * 
 * @param userId - The user's UUID
 * @returns Promise<{maxAlerts: number, priceUpdateFrequency: number}>
 */
export async function getSubscriptionLimits(
  userId: string
): Promise<{ maxAlerts: number; priceUpdateFrequency: number }> {
  const status = await getSubscriptionStatus(userId);

  return {
    maxAlerts: status.maxAlerts,
    priceUpdateFrequency: status.priceUpdateFrequency,
  };
}
