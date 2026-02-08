// =====================================================
// Vestpod - Cost Monitoring Helper
// =====================================================
// Tracks and monitors API costs for multi-modal insights
// Requirements: 10.1, 10.2, 10.3, 10.5
// Task 8: Cost Monitoring and Optimization

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Cost thresholds
const MONTHLY_COST_THRESHOLD_CENTS = 50000; // $500
const ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL") || "admin@vestpod.com";

// Gemini API pricing (approximate)
// gemini-3-pro-preview: $0.00025 per 1K input tokens, $0.001 per 1K output tokens
const GEMINI_INPUT_COST_PER_1K_TOKENS = 0.025; // cents
const GEMINI_OUTPUT_COST_PER_1K_TOKENS = 0.1; // cents

// Estimated token usage for multi-modal vs text-only
const MULTIMODAL_ESTIMATED_INPUT_TOKENS = 15000; // ~15K tokens (text + 3 images)
const MULTIMODAL_ESTIMATED_OUTPUT_TOKENS = 2000; // ~2K tokens output
const TEXT_ONLY_ESTIMATED_INPUT_TOKENS = 3000; // ~3K tokens (text only)
const TEXT_ONLY_ESTIMATED_OUTPUT_TOKENS = 1500; // ~1.5K tokens output

/**
 * Calculate estimated cost for Gemini API call
 * Task 8.1: Calculate cost per request
 */
export function calculateGeminiCost(
  inputTokens: number,
  outputTokens: number
): number {
  const inputCost = (inputTokens / 1000) * GEMINI_INPUT_COST_PER_1K_TOKENS;
  const outputCost = (outputTokens / 1000) * GEMINI_OUTPUT_COST_PER_1K_TOKENS;
  return Math.ceil(inputCost + outputCost); // Round up to nearest cent
}

/**
 * Estimate cost for multi-modal analysis
 */
export function estimateMultiModalCost(): number {
  return calculateGeminiCost(
    MULTIMODAL_ESTIMATED_INPUT_TOKENS,
    MULTIMODAL_ESTIMATED_OUTPUT_TOKENS
  );
}

/**
 * Estimate cost for text-only analysis
 */
export function estimateTextOnlyCost(): number {
  return calculateGeminiCost(
    TEXT_ONLY_ESTIMATED_INPUT_TOKENS,
    TEXT_ONLY_ESTIMATED_OUTPUT_TOKENS
  );
}

/**
 * Log API cost to database
 * Task 8.1: Store in api_cost_tracking table
 */
export async function logApiCost(
  userId: string | null,
  serviceName: "gemini" | "newsapi" | "alphavantage" | "fred",
  endpoint: string,
  costCents: number,
  tokensUsed?: number
): Promise<void> {
  try {
    const { error } = await supabase
      .from("api_cost_tracking")
      .insert({
        user_id: userId,
        service_name: serviceName,
        endpoint: endpoint,
        tokens_used: tokensUsed || null,
        cost_cents: costCents,
        timestamp: new Date().toISOString(),
      });

    if (error) {
      console.error("Error logging API cost:", error);
    } else {
      console.log(
        `Logged ${serviceName} API cost: ${costCents} cents (${tokensUsed || "N/A"} tokens)`
      );
    }
  } catch (error) {
    console.error("Error logging API cost:", error);
  }
}

/**
 * Get monthly API costs
 * Task 8.2: Calculate total cost for period
 */
export async function getMonthlyApiCosts(): Promise<{
  totalCents: number;
  byService: Record<string, number>;
  byUser: Record<string, number>;
}> {
  try {
    // Get start of current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Query costs for current month
    const { data, error } = await supabase
      .from("api_cost_tracking")
      .select("user_id, service_name, cost_cents")
      .gte("timestamp", monthStart.toISOString());

    if (error) {
      console.error("Error fetching monthly costs:", error);
      return { totalCents: 0, byService: {}, byUser: {} };
    }

    // Aggregate costs
    let totalCents = 0;
    const byService: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    for (const record of data || []) {
      totalCents += record.cost_cents;

      // By service
      if (!byService[record.service_name]) {
        byService[record.service_name] = 0;
      }
      byService[record.service_name] += record.cost_cents;

      // By user
      if (record.user_id) {
        if (!byUser[record.user_id]) {
          byUser[record.user_id] = 0;
        }
        byUser[record.user_id] += record.cost_cents;
      }
    }

    return { totalCents, byService, byUser };
  } catch (error) {
    console.error("Error calculating monthly costs:", error);
    return { totalCents: 0, byService: {}, byUser: {} };
  }
}

/**
 * Check if monthly cost threshold is exceeded
 * Task 8.3: Cost threshold monitoring
 */
export async function checkCostThreshold(): Promise<{
  exceeded: boolean;
  currentCents: number;
  thresholdCents: number;
  percentUsed: number;
}> {
  const { totalCents } = await getMonthlyApiCosts();
  const exceeded = totalCents >= MONTHLY_COST_THRESHOLD_CENTS;
  const percentUsed = (totalCents / MONTHLY_COST_THRESHOLD_CENTS) * 100;

  return {
    exceeded,
    currentCents: totalCents,
    thresholdCents: MONTHLY_COST_THRESHOLD_CENTS,
    percentUsed: Math.round(percentUsed * 10) / 10,
  };
}

/**
 * Send cost threshold alert
 * Task 8.3: Send alert when exceeding threshold
 */
export async function sendCostAlert(
  currentCents: number,
  thresholdCents: number,
  percentUsed: number
): Promise<void> {
  try {
    console.warn(
      `⚠️ COST ALERT: Monthly API costs have reached ${percentUsed}% of threshold`
    );
    console.warn(
      `Current: $${(currentCents / 100).toFixed(2)} / Threshold: $${(thresholdCents / 100).toFixed(2)}`
    );

    // Get cost breakdown
    const { byService } = await getMonthlyApiCosts();
    console.warn("Cost breakdown by service:");
    for (const [service, cost] of Object.entries(byService)) {
      console.warn(`  ${service}: $${(cost / 100).toFixed(2)}`);
    }

    // In production, send email alert via Supabase Edge Function or external service
    // For now, log to console
    console.warn(`Alert should be sent to: ${ALERT_EMAIL}`);

    // Store alert in database for tracking
    await supabase.from("system_alerts").insert({
      alert_type: "cost_threshold",
      severity: percentUsed >= 100 ? "critical" : "warning",
      message: `Monthly API costs at ${percentUsed}%: $${(currentCents / 100).toFixed(2)} / $${(thresholdCents / 100).toFixed(2)}`,
      metadata: { currentCents, thresholdCents, percentUsed, byService },
      created_at: new Date().toISOString(),
    }).catch(err => {
      // Table might not exist yet, just log
      console.error("Could not store alert in database:", err);
    });
  } catch (error) {
    console.error("Error sending cost alert:", error);
  }
}

/**
 * Determine if multi-modal analysis should be used based on cost threshold
 * Task 8.4: Cost-based fallback
 */
export async function shouldUseMultiModal(): Promise<{
  allowed: boolean;
  reason?: string;
  currentCents: number;
  percentUsed: number;
}> {
  const threshold = await checkCostThreshold();

  // If threshold exceeded, fallback to text-only
  if (threshold.exceeded) {
    const reason = `Monthly cost threshold exceeded: ${threshold.percentUsed}% used ($${(threshold.currentCents / 100).toFixed(2)} / $${(threshold.thresholdCents / 100).toFixed(2)})`;
    console.warn(`⚠️ ${reason} - Falling back to text-only analysis`);

    return {
      allowed: false,
      reason,
      currentCents: threshold.currentCents,
      percentUsed: threshold.percentUsed,
    };
  }

  // If approaching threshold (>90%), warn but allow
  if (threshold.percentUsed > 90) {
    console.warn(
      `⚠️ Approaching cost threshold: ${threshold.percentUsed}% used`
    );
  }

  return {
    allowed: true,
    currentCents: threshold.currentCents,
    percentUsed: threshold.percentUsed,
  };
}

/**
 * Calculate batch cost summary for daily job
 * Task 8.2: Batch cost calculation
 */
export async function calculateBatchCost(
  userCount: number,
  multiModalCount: number,
  textOnlyCount: number
): Promise<{
  totalCents: number;
  multiModalCents: number;
  textOnlyCents: number;
  averageCentsPerUser: number;
}> {
  const multiModalCents = multiModalCount * estimateMultiModalCost();
  const textOnlyCents = textOnlyCount * estimateTextOnlyCost();
  const totalCents = multiModalCents + textOnlyCents;
  const averageCentsPerUser = userCount > 0 ? Math.round(totalCents / userCount) : 0;

  return {
    totalCents,
    multiModalCents,
    textOnlyCents,
    averageCentsPerUser,
  };
}

/**
 * Log batch cost summary
 * Task 8.2: Log batch cost summary
 */
export async function logBatchCostSummary(
  jobName: string,
  userCount: number,
  multiModalCount: number,
  textOnlyCount: number,
  actualCostCents?: number
): Promise<void> {
  const estimated = await calculateBatchCost(
    userCount,
    multiModalCount,
    textOnlyCount
  );

  console.log(`\n📊 Batch Cost Summary - ${jobName}`);
  console.log(`Total users processed: ${userCount}`);
  console.log(`Multi-modal analyses: ${multiModalCount}`);
  console.log(`Text-only analyses: ${textOnlyCount}`);
  console.log(`Estimated cost: $${(estimated.totalCents / 100).toFixed(2)}`);
  if (actualCostCents !== undefined) {
    console.log(`Actual cost: $${(actualCostCents / 100).toFixed(2)}`);
  }
  console.log(`Average per user: $${(estimated.averageCentsPerUser / 100).toFixed(2)}`);

  // Check if this batch pushed us over threshold
  const threshold = await checkCostThreshold();
  console.log(
    `Monthly total: $${(threshold.currentCents / 100).toFixed(2)} / $${(threshold.thresholdCents / 100).toFixed(2)} (${threshold.percentUsed}%)`
  );

  // Send alert if threshold exceeded
  if (threshold.exceeded && threshold.percentUsed >= 100) {
    await sendCostAlert(
      threshold.currentCents,
      threshold.thresholdCents,
      threshold.percentUsed
    );
  }
}
