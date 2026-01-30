// =====================================================
// Massive.com API Client - Manual Test Script
// =====================================================
// Run with: deno run --allow-net --allow-env massive-client.test.ts
// Set MASSIVE_API_KEY environment variable before running

import {
  fetchStockQuote,
  fetchHistoricalData,
  fetchBatchQuotes,
  MassiveAPIError,
} from "./massive-client.ts";

// Test configuration
const TEST_SYMBOLS = ["AAPL", "MSFT", "GOOGL"];
const INVALID_SYMBOL = "INVALID_TICKER_XYZ";

/**
 * Test: Fetch single stock quote
 */
async function testFetchStockQuote(apiKey: string) {
  console.log("\n=== Test: Fetch Stock Quote ===");
  
  try {
    const quote = await fetchStockQuote("AAPL", apiKey);
    console.log("✓ Successfully fetched quote for AAPL");
    console.log(`  Price: $${quote.price}`);
    console.log(`  Change: ${quote.change} (${quote.changePercent}%)`);
    console.log(`  Volume: ${quote.volume.toLocaleString()}`);
    console.log(`  Open: $${quote.open}, High: $${quote.high}, Low: $${quote.low}`);
    return true;
  } catch (error) {
    console.error("✗ Failed to fetch quote:", error);
    return false;
  }
}

/**
 * Test: Fetch historical data
 */
async function testFetchHistoricalData(apiKey: string) {
  console.log("\n=== Test: Fetch Historical Data ===");
  
  // Get last 7 days
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  
  const toStr = to.toISOString().split("T")[0];
  const fromStr = from.toISOString().split("T")[0];
  
  try {
    const data = await fetchHistoricalData("AAPL", fromStr, toStr, "day", 1, apiKey);
    console.log(`✓ Successfully fetched historical data for AAPL`);
    console.log(`  Symbol: ${data.symbol}`);
    console.log(`  Data points: ${data.data.length}`);
    
    if (data.data.length > 0) {
      const latest = data.data[data.data.length - 1];
      const date = new Date(latest.timestamp);
      console.log(`  Latest: ${date.toISOString().split("T")[0]}`);
      console.log(`    Open: $${latest.open}, Close: $${latest.close}`);
      console.log(`    High: $${latest.high}, Low: $${latest.low}`);
      console.log(`    Volume: ${latest.volume.toLocaleString()}`);
    }
    return true;
  } catch (error) {
    console.error("✗ Failed to fetch historical data:", error);
    return false;
  }
}

/**
 * Test: Batch quote fetching
 */
async function testBatchQuotes(apiKey: string) {
  console.log("\n=== Test: Batch Quote Fetching ===");
  
  try {
    const results = await fetchBatchQuotes(TEST_SYMBOLS, apiKey);
    console.log(`✓ Fetched quotes for ${results.size} symbols`);
    
    for (const [symbol, result] of results.entries()) {
      if (result instanceof Error) {
        console.log(`  ${symbol}: ERROR - ${result.message}`);
      } else {
        console.log(`  ${symbol}: $${result.price} (${result.changePercent > 0 ? "+" : ""}${result.changePercent}%)`);
      }
    }
    return true;
  } catch (error) {
    console.error("✗ Failed batch fetch:", error);
    return false;
  }
}

/**
 * Test: Error handling for invalid symbol
 */
async function testInvalidSymbol(apiKey: string) {
  console.log("\n=== Test: Invalid Symbol Error Handling ===");
  
  try {
    await fetchStockQuote(INVALID_SYMBOL, apiKey);
    console.error("✗ Should have thrown error for invalid symbol");
    return false;
  } catch (error) {
    if (error instanceof MassiveAPIError) {
      console.log("✓ Correctly handled invalid symbol");
      console.log(`  Error: ${error.message}`);
      return true;
    } else {
      console.error("✗ Wrong error type:", error);
      return false;
    }
  }
}

/**
 * Test: Retry logic (simulated by using invalid API key)
 */
async function testRetryLogic() {
  console.log("\n=== Test: Retry Logic ===");
  console.log("Testing with invalid API key to trigger retries...");
  
  const startTime = Date.now();
  try {
    await fetchStockQuote("AAPL", "invalid_key_for_testing");
    console.error("✗ Should have failed with invalid API key");
    return false;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`✓ Retry logic executed (took ${duration}ms)`);
    console.log(`  Expected ~7000ms for 3 retries (1s + 2s + 4s)`);
    
    if (error instanceof MassiveAPIError) {
      console.log(`  Error: ${error.message}`);
      return duration >= 6000; // Should take at least 6 seconds with retries
    }
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log("=".repeat(50));
  console.log("Massive.com API Client Test Suite");
  console.log("=".repeat(50));
  
  // Get API key from environment
  const apiKey = Deno.env.get("MASSIVE_API_KEY");
  
  if (!apiKey) {
    console.error("\n❌ ERROR: MASSIVE_API_KEY environment variable not set");
    console.error("Set it with: export MASSIVE_API_KEY=your_api_key");
    Deno.exit(1);
  }
  
  console.log(`\nUsing API key: ${apiKey.substring(0, 10)}...`);
  
  const results = {
    passed: 0,
    failed: 0,
  };
  
  // Run tests
  const tests = [
    { name: "Fetch Stock Quote", fn: () => testFetchStockQuote(apiKey) },
    { name: "Fetch Historical Data", fn: () => testFetchHistoricalData(apiKey) },
    { name: "Batch Quotes", fn: () => testBatchQuotes(apiKey) },
    { name: "Invalid Symbol", fn: () => testInvalidSymbol(apiKey) },
    { name: "Retry Logic", fn: testRetryLogic },
  ];
  
  for (const test of tests) {
    try {
      const passed = await test.fn();
      if (passed) {
        results.passed++;
      } else {
        results.failed++;
      }
    } catch (error) {
      console.error(`\n✗ Test "${test.name}" threw unexpected error:`, error);
      results.failed++;
    }
  }
  
  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Test Summary");
  console.log("=".repeat(50));
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total: ${results.passed + results.failed}`);
  
  if (results.failed === 0) {
    console.log("\n✓ All tests passed!");
    Deno.exit(0);
  } else {
    console.log(`\n✗ ${results.failed} test(s) failed`);
    Deno.exit(1);
  }
}

// Run tests if this is the main module
if (import.meta.main) {
  runTests();
}
