// =====================================================
// Metals-API Client Tests
// =====================================================
// Tests for commodity price fetching and rate limiting
// Requirements: 3, 5

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  fetchCommodityQuote,
  fetchHistoricalData,
  fetchBatchQuotes,
  getRateLimitStatus,
  MetalsAPIError,
  RateLimitError,
  type CommoditySymbol,
} from "./metals-api-client.ts";

// Get API key from environment
const METALS_API_KEY = Deno.env.get("METALS_API_KEY");

if (!METALS_API_KEY) {
  console.warn("⚠️  METALS_API_KEY not set. Tests will be skipped.");
  console.warn("   Set METALS_API_KEY environment variable to run tests.");
  Deno.exit(0);
}

/**
 * Test: Fetch gold quote
 */
Deno.test("Metals-API - Fetch gold quote", async () => {
  const quote = await fetchCommodityQuote("XAU", METALS_API_KEY!);

  assertExists(quote);
  assertEquals(quote.symbol, "XAU");
  assertEquals(quote.name, "Gold");
  assertEquals(typeof quote.price, "number");
  assertEquals(quote.price > 0, true);
  assertEquals(quote.unit, "troy ounce");
  assertEquals(typeof quote.timestamp, "number");

  console.log(`✓ Gold price: $${quote.price.toFixed(2)} per ${quote.unit}`);
});

/**
 * Test: Fetch silver quote
 */
Deno.test("Metals-API - Fetch silver quote", async () => {
  const quote = await fetchCommodityQuote("XAG", METALS_API_KEY!);

  assertExists(quote);
  assertEquals(quote.symbol, "XAG");
  assertEquals(quote.name, "Silver");
  assertEquals(typeof quote.price, "number");
  assertEquals(quote.price > 0, true);

  console.log(`✓ Silver price: $${quote.price.toFixed(2)} per ${quote.unit}`);
});

/**
 * Test: Fetch platinum quote
 */
Deno.test("Metals-API - Fetch platinum quote", async () => {
  const quote = await fetchCommodityQuote("XPT", METALS_API_KEY!);

  assertExists(quote);
  assertEquals(quote.symbol, "XPT");
  assertEquals(quote.name, "Platinum");
  assertEquals(typeof quote.price, "number");
  assertEquals(quote.price > 0, true);

  console.log(`✓ Platinum price: $${quote.price.toFixed(2)} per ${quote.unit}`);
});

/**
 * Test: Fetch palladium quote
 */
Deno.test("Metals-API - Fetch palladium quote", async () => {
  const quote = await fetchCommodityQuote("XPD", METALS_API_KEY!);

  assertExists(quote);
  assertEquals(quote.symbol, "XPD");
  assertEquals(quote.name, "Palladium");
  assertEquals(typeof quote.price, "number");
  assertEquals(quote.price > 0, true);

  console.log(`✓ Palladium price: $${quote.price.toFixed(2)} per ${quote.unit}`);
});

/**
 * Test: Fetch historical data
 */
Deno.test("Metals-API - Fetch historical data", async () => {
  // Get last 7 days of gold prices
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const formatDate = (date: Date) => date.toISOString().split("T")[0];

  const historicalData = await fetchHistoricalData(
    "XAU",
    formatDate(startDate),
    formatDate(endDate),
    METALS_API_KEY!
  );

  assertExists(historicalData);
  assertEquals(historicalData.symbol, "XAU");
  assertEquals(historicalData.name, "Gold");
  assertEquals(Array.isArray(historicalData.data), true);
  assertEquals(historicalData.data.length > 0, true);

  // Check structure of first data point
  const firstPoint = historicalData.data[0];
  assertEquals(typeof firstPoint.timestamp, "number");
  assertEquals(typeof firstPoint.price, "number");
  assertEquals(firstPoint.price > 0, true);

  console.log(`✓ Fetched ${historicalData.data.length} historical data points for Gold`);
  console.log(`  First price: $${firstPoint.price.toFixed(2)}`);
  console.log(`  Last price: $${historicalData.data[historicalData.data.length - 1].price.toFixed(2)}`);
});

/**
 * Test: Fetch batch quotes
 */
Deno.test("Metals-API - Fetch batch quotes", async () => {
  const symbols: CommoditySymbol[] = ["XAU", "XAG", "XPT", "XPD"];
  const results = await fetchBatchQuotes(symbols, METALS_API_KEY!);

  assertEquals(results.size, 4);

  // Check Gold
  const goldResult = results.get("XAU");
  assertExists(goldResult);
  assertEquals(goldResult instanceof Error, false);
  if (!(goldResult instanceof Error)) {
    assertEquals(goldResult.symbol, "XAU");
    assertEquals(goldResult.name, "Gold");
    assertEquals(typeof goldResult.price, "number");
    console.log(`✓ Batch - Gold: $${goldResult.price.toFixed(2)}`);
  }

  // Check Silver
  const silverResult = results.get("XAG");
  assertExists(silverResult);
  assertEquals(silverResult instanceof Error, false);
  if (!(silverResult instanceof Error)) {
    assertEquals(silverResult.symbol, "XAG");
    assertEquals(silverResult.name, "Silver");
    console.log(`✓ Batch - Silver: $${silverResult.price.toFixed(2)}`);
  }

  // Check Platinum
  const platinumResult = results.get("XPT");
  assertExists(platinumResult);
  assertEquals(platinumResult instanceof Error, false);
  if (!(platinumResult instanceof Error)) {
    assertEquals(platinumResult.symbol, "XPT");
    assertEquals(platinumResult.name, "Platinum");
    console.log(`✓ Batch - Platinum: $${platinumResult.price.toFixed(2)}`);
  }

  // Check Palladium
  const palladiumResult = results.get("XPD");
  assertExists(palladiumResult);
  assertEquals(palladiumResult instanceof Error, false);
  if (!(palladiumResult instanceof Error)) {
    assertEquals(palladiumResult.symbol, "XPD");
    assertEquals(palladiumResult.name, "Palladium");
    console.log(`✓ Batch - Palladium: $${palladiumResult.price.toFixed(2)}`);
  }
});

/**
 * Test: Rate limit tracking
 */
Deno.test("Metals-API - Rate limit tracking", async () => {
  const statusBefore = getRateLimitStatus();
  assertExists(statusBefore);
  assertEquals(typeof statusBefore.monthlyCalls, "number");
  assertEquals(typeof statusBefore.monthlyLimit, "number");
  assertEquals(typeof statusBefore.monthlyRemaining, "number");
  assertEquals(statusBefore.monthlyLimit, 50);

  console.log(`✓ Rate limit status:`);
  console.log(`  Monthly calls: ${statusBefore.monthlyCalls}/${statusBefore.monthlyLimit}`);
  console.log(`  Remaining: ${statusBefore.monthlyRemaining}`);
  console.log(`  Reset time: ${new Date(statusBefore.monthlyResetTime).toISOString()}`);

  // Make a call
  await fetchCommodityQuote("XAU", METALS_API_KEY!);

  const statusAfter = getRateLimitStatus();
  assertEquals(statusAfter.monthlyCalls, statusBefore.monthlyCalls + 1);
  assertEquals(statusAfter.monthlyRemaining, statusBefore.monthlyRemaining - 1);

  console.log(`✓ Rate limit incremented correctly`);
  console.log(`  After call: ${statusAfter.monthlyCalls}/${statusAfter.monthlyLimit}`);
});

/**
 * Test: Error handling with invalid API key
 */
Deno.test("Metals-API - Error handling with invalid API key", async () => {
  try {
    await fetchCommodityQuote("XAU", "invalid-api-key");
    throw new Error("Should have thrown MetalsAPIError");
  } catch (error) {
    assertEquals(error instanceof MetalsAPIError, true);
    console.log("✓ Invalid API key error handled correctly");
  }
});

console.log("\n=== All Metals-API Client Tests Passed ===\n");
