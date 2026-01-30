#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Real-time Price Broadcasting Test Script
 * 
 * This script tests the real-time broadcasting functionality by:
 * 1. Subscribing to a user's price update channel
 * 2. Triggering the price update job
 * 3. Verifying that broadcasts are received
 * 
 * Usage:
 *   deno run --allow-net --allow-env test-realtime-broadcast.ts <user_id>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Get configuration from environment or command line
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const userId = Deno.args[0];

if (!userId) {
  console.error("❌ Error: User ID is required");
  console.log("Usage: deno run --allow-net --allow-env test-realtime-broadcast.ts <user_id>");
  Deno.exit(1);
}

if (!supabaseAnonKey) {
  console.error("❌ Error: SUPABASE_ANON_KEY environment variable is required");
  Deno.exit(1);
}

console.log("🚀 Real-time Price Broadcasting Test");
console.log("=====================================");
console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`User ID: ${userId}`);
console.log("");

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Track received broadcasts
let broadcastsReceived = 0;
const receivedUpdates: any[] = [];

// Subscribe to price updates channel
console.log(`📡 Subscribing to channel: price-updates:${userId}`);

const channel = supabase.channel(`price-updates:${userId}`);

channel
  .on("broadcast", { event: "price-update" }, (payload) => {
    broadcastsReceived++;
    
    console.log("\n✅ Broadcast received!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Timestamp: ${payload.payload.timestamp}`);
    console.log(`User ID: ${payload.payload.user_id}`);
    console.log(`Number of updates: ${payload.payload.updates.length}`);
    console.log("");
    
    payload.payload.updates.forEach((update: any, index: number) => {
      console.log(`Update ${index + 1}:`);
      console.log(`  Symbol: ${update.symbol}`);
      console.log(`  Asset ID: ${update.asset_id}`);
      console.log(`  Old Price: $${update.old_price?.toFixed(2) || "N/A"}`);
      console.log(`  New Price: $${update.new_price.toFixed(2)}`);
      console.log(`  Change: ${update.price_change >= 0 ? "+" : ""}${update.price_change.toFixed(2)}%`);
      console.log(`  Source: ${update.source}`);
      console.log(`  Portfolio ID: ${update.portfolio_id}`);
      console.log("");
      
      receivedUpdates.push(update);
    });
    
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  })
  .subscribe((status) => {
    if (status === "SUBSCRIBED") {
      console.log("✅ Successfully subscribed to channel");
      console.log("");
      console.log("💡 Now trigger the price update job:");
      console.log(`   curl -X POST ${supabaseUrl}/functions/v1/price-update-job \\`);
      console.log(`     -H "Authorization: Bearer ${supabaseAnonKey}"`);
      console.log("");
      console.log("⏳ Waiting for broadcasts... (Press Ctrl+C to exit)");
    } else if (status === "CHANNEL_ERROR") {
      console.error("❌ Error subscribing to channel");
      Deno.exit(1);
    } else if (status === "TIMED_OUT") {
      console.error("❌ Subscription timed out");
      Deno.exit(1);
    } else {
      console.log(`📊 Subscription status: ${status}`);
    }
  });

// Handle graceful shutdown
const handleShutdown = () => {
  console.log("\n\n📊 Test Summary");
  console.log("=====================================");
  console.log(`Broadcasts received: ${broadcastsReceived}`);
  console.log(`Total updates: ${receivedUpdates.length}`);
  
  if (receivedUpdates.length > 0) {
    console.log("\n📈 Price Changes:");
    receivedUpdates.forEach((update) => {
      const changeSymbol = update.price_change >= 0 ? "📈" : "📉";
      console.log(`  ${changeSymbol} ${update.symbol}: ${update.price_change >= 0 ? "+" : ""}${update.price_change.toFixed(2)}%`);
    });
  }
  
  console.log("\n👋 Unsubscribing and exiting...");
  channel.unsubscribe();
  Deno.exit(0);
};

// Listen for Ctrl+C
Deno.addSignalListener("SIGINT", handleShutdown);

// Optional: Auto-trigger price update job after 3 seconds
setTimeout(async () => {
  console.log("\n🔄 Auto-triggering price update job...");
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/price-update-job`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log("✅ Price update job triggered successfully");
      console.log(`   Users processed: ${result.users_processed}`);
      console.log(`   Assets updated: ${result.total_assets_updated}`);
      console.log(`   Assets failed: ${result.total_assets_failed}`);
      
      if (result.results && result.results.length > 0) {
        const userResult = result.results.find((r: any) => r.user_id === userId);
        if (userResult) {
          console.log(`\n📊 Results for user ${userId}:`);
          console.log(`   Total assets: ${userResult.total_assets}`);
          console.log(`   Updated: ${userResult.assets_updated}`);
          console.log(`   Failed: ${userResult.assets_failed}`);
          console.log(`   Broadcasted: ${userResult.broadcasted}`);
        }
      }
    } else {
      console.error("❌ Error triggering price update job:", result);
    }
  } catch (error) {
    console.error("❌ Error triggering price update job:", error);
  }
}, 3000);

// Keep the script running
await new Promise(() => {});
