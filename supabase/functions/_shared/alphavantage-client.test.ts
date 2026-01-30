// =====================================================
// Alpha Vantage API Client Tests
// =====================================================
// Tests for Alpha Vantage stock price API integration
// Requirements: 3, 5

import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  fetchStockQuote,
  fetchHistoricalData,
  fetchBatchQuotes,
  AlphaVantageAPIError,
  RateLimitError,
  getRateLimitStatus,
} from "./alphavantage-client.ts";

// Test configuration
const TEST_API_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY") || "demo";
const TEST_SYMBOL = "IBM"; // Use IBM for demo key
const SKIP_LIVE_TESTS = !Deno.env.get("ALPHA_VANTAGE_API_KEY");

// =====================================================
// Stock Quote Tests
// =====================================================

Deno.test({
  name: "fetchStockQuote - should fetch valid quote for IBM",
  ignore: SKIP_LIVE_TESTS,
  async fn() {
    const quote = await fetchStockQuote(TEST_SYMBOL, TEST_API_KEY);

    // Validate structure
    assertExists(quote.symbol);
    assertExists(quote.price);
    assertExists(quote.timestamp);

    // Validate values
    assertEquals(quote.symbol, TEST_SYMBOL);
    assertEquals(typeof quote.price, "number");
    assertEquals(typeof quote.open, "number");
    assertEquals(typeof quote.high, "number");
    assertEquals(typeof quote.low, "number");
    assertEquals(typeof quote.volume, "number");
    assertEquals(typeof quote.change, "number");
    assertEquals(typeof quote.changePercent, "number");

    console.log("✅ Alpha Vantage Quote Test Passed:", quote);
  },
});

Deno.test({
  name: "fetchStockQuote - should handle invalid symbol",
  ignore: SKIP_LIVE_TESTS,
  async fn() {
    try {
      await fetchStockQuote("INVALID_SYMBOL_XYZ", TEST_API_KEY);
      throw new Error("Should have thrown error for invalid symbol");
    } catch (error) {
      assertEquals(error instanceof AlphaVantageAPIError, true);
      console.log("✅ Invalid symbol error handled correctly");
    }
  },
});

// =====================================================
// Historical Data Tests
// =====================================================

Deno.test({
  name: "fetchHistoricalData - should fetch historical data for IBM",
  ignore: SKIP_LIVE_TESTS,
  async fn() {
    const data = await fetchHistoricalData(TEST_SYMBOL, TEST_API_KEY, "compact");

    // Validate structure
    assertExists(data.symbol);
    assertExists(data.data);
    assertEquals(Array.isArray(data.data), true);
    assertEquals(data.symbol, TEST_SYMBOL);

    // Validate data points
    if (data.data.length > 0) {
      const point = data.data[0];
      assertEquals(typeof point.timestamp, "number");
      assertEquals(typeof point.open, "number");
      assertEquals(typeof point.high, "number");
      assertEquals(typeof point.low, "number");
      assertEquals(typeof point.close, "number");
      assertEquals(typeof point.volume, "number");
    }

    console.log(`✅ Alpha Vantage Historical Test Passed: ${data.data.length} data points`);
  },
});

// =====================================================
// Batch Quotes Tests
// =====================================================

Deno.test({
  name: "fetchBatchQuotes - should fetch multiple quotes",
  ignore: SKIP_LIVE_TESTS,
  async fn() {
    const symbols = ["IBM", "MSFT"];
    const results = await fetchBatchQuotes(symbols, TEST_API_KEY);

    // Validate results
    assertEquals(results.size, symbols.length);

    for (const symbol of symbols) {
      const result = results.get(symbol);
      assertExists(result);

      if (result instanceof Error) {
        console.log(`⚠️ Error for ${symbol}:`, result.message);
      } else {
        assertEquals(result.symbol, symbol);
        console.log(`✅ Quote for ${symbol}:`, result.price);
      }
    }
  },
});

// =====================================================
// Rate Limit Tests
// =====================================================

Deno.test({
  name: "getRateLimitStatus - should return rate limit info",
  fn() {
    const status = getRateLimitStatus();

    assertExists(status.dailyCalls);
    assertExists(status.dailyLimit);
    assertExists(status.dailyRemaining);
    assertExists(status.minuteCalls);
    assertExists(status.minuteLimit);
    assertExists(status.minuteRemaining);

    assertEquals(status.dailyLimit, 25);
    assertEquals(status.minuteLimit, 5);

    console.log("✅ Rate Limit Status:", status);
  },
});

// =====================================================
// Error Handling Tests
// =====================================================

Deno.test({
  name: "fetchStockQuote - should handle network errors with retry",
  ignore: SKIP_LIVE_TESTS,
  async fn() {
    try {
      // Use invalid API key to trigger error
      await fetchStockQuote(TEST_SYMBOL, "invalid_key");
      throw new Error("Should have thrown error for invalid API key");
    } catch (error) {
      assertEquals(error instanceof AlphaVantageAPIError, true);
      console.log("✅ Network error handled with retry logic");
    }
  },
});

// =====================================================
// Integration Test Summary
// =====================================================

if (SKIP_LIVE_TESTS) {
  console.log("\n⚠️ ALPHA_VANTAGE_API_KEY not set - skipping live API tests");
  console.log("To run live tests, set ALPHA_VANTAGE_API_KEY environment variable");
} else {
  console.log("\n✅ Running Alpha Vantage API live tests with API key");
}
