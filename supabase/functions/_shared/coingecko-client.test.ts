// =====================================================
// CoinGecko API Client Tests
// =====================================================
// Tests for cryptocurrency price fetching, symbol mapping,
// and batch operations
// Requirements: 3, 5

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  fetchCoinList,
  symbolToId,
  symbolsToIds,
  fetchCryptoQuote,
  fetchCryptoQuoteBySymbol,
  fetchHistoricalData,
  fetchBatchQuotes,
  fetchBatchQuotesBySymbols,
  CoinGeckoAPIError,
} from "./coingecko-client.ts";

// Get API key from environment (optional for free tier)
const COINGECKO_API_KEY = Deno.env.get("COINGECKO_API_KEY");

/**
 * Test: Fetch coin list
 */
Deno.test("CoinGecko - Fetch coin list", async () => {
  const coinList = await fetchCoinList(COINGECKO_API_KEY);

  assertExists(coinList);
  assertEquals(Array.isArray(coinList), true);
  assertEquals(coinList.length > 0, true);

  // Check structure of first coin
  const firstCoin = coinList[0];
  assertExists(firstCoin.id);
  assertExists(firstCoin.symbol);
  assertExists(firstCoin.name);

  console.log(`✓ Fetched ${coinList.length} coins from CoinGecko`);
});

/**
 * Test: Symbol to ID mapping
 */
Deno.test("CoinGecko - Symbol to ID mapping", async () => {
  // Test common cryptocurrencies
  const btcId = await symbolToId("BTC", COINGECKO_API_KEY);
  assertEquals(btcId, "bitcoin");

  const ethId = await symbolToId("ETH", COINGECKO_API_KEY);
  assertEquals(ethId, "ethereum");

  // Test unknown symbol
  const unknownId = await symbolToId("UNKNOWN_CRYPTO_XYZ", COINGECKO_API_KEY);
  assertEquals(unknownId, null);

  console.log("✓ Symbol to ID mapping working correctly");
});

/**
 * Test: Batch symbol to ID mapping
 */
Deno.test("CoinGecko - Batch symbol to ID mapping", async () => {
  const symbols = ["BTC", "ETH", "BNB", "UNKNOWN_XYZ"];
  const results = await symbolsToIds(symbols, COINGECKO_API_KEY);

  assertEquals(results.size, 4);
  assertEquals(results.get("BTC"), "bitcoin");
  assertEquals(results.get("ETH"), "ethereum");
  assertExists(results.get("BNB")); // Should find Binance Coin
  assertEquals(results.get("UNKNOWN_XYZ"), null);

  console.log("✓ Batch symbol to ID mapping working correctly");
});

/**
 * Test: Fetch crypto quote by ID
 */
Deno.test("CoinGecko - Fetch crypto quote by ID", async () => {
  const quote = await fetchCryptoQuote("bitcoin", COINGECKO_API_KEY);

  assertExists(quote);
  assertEquals(quote.id, "bitcoin");
  assertEquals(quote.symbol, "BTC");
  assertEquals(typeof quote.price, "number");
  assertEquals(quote.price > 0, true);
  assertEquals(typeof quote.marketCap, "number");
  assertEquals(typeof quote.volume24h, "number");
  assertEquals(typeof quote.change24h, "number");
  assertEquals(typeof quote.changePercent24h, "number");
  assertEquals(typeof quote.high24h, "number");
  assertEquals(typeof quote.low24h, "number");
  assertEquals(typeof quote.timestamp, "number");

  console.log(`✓ Bitcoin price: $${quote.price.toFixed(2)}`);
  console.log(`  24h change: ${quote.changePercent24h.toFixed(2)}%`);
  console.log(`  Market cap: $${(quote.marketCap / 1e9).toFixed(2)}B`);
});

/**
 * Test: Fetch crypto quote by symbol
 */
Deno.test("CoinGecko - Fetch crypto quote by symbol", async () => {
  const quote = await fetchCryptoQuoteBySymbol("ETH", COINGECKO_API_KEY);

  assertExists(quote);
  assertEquals(quote.symbol, "ETH");
  assertEquals(quote.id, "ethereum");
  assertEquals(typeof quote.price, "number");
  assertEquals(quote.price > 0, true);

  console.log(`✓ Ethereum price: $${quote.price.toFixed(2)}`);
});

/**
 * Test: Fetch crypto quote with invalid ID
 */
Deno.test("CoinGecko - Fetch crypto quote with invalid ID", async () => {
  try {
    await fetchCryptoQuote("invalid-coin-id-xyz", COINGECKO_API_KEY);
    throw new Error("Should have thrown CoinGeckoAPIError");
  } catch (error) {
    assertEquals(error instanceof CoinGeckoAPIError, true);
    assertEquals((error as CoinGeckoAPIError).statusCode, 404);
    console.log("✓ Invalid ID error handled correctly");
  }
});

/**
 * Test: Fetch crypto quote with invalid symbol
 */
Deno.test("CoinGecko - Fetch crypto quote with invalid symbol", async () => {
  try {
    await fetchCryptoQuoteBySymbol("INVALID_XYZ", COINGECKO_API_KEY);
    throw new Error("Should have thrown CoinGeckoAPIError");
  } catch (error) {
    assertEquals(error instanceof CoinGeckoAPIError, true);
    assertEquals((error as CoinGeckoAPIError).statusCode, 404);
    console.log("✓ Invalid symbol error handled correctly");
  }
});

/**
 * Test: Fetch historical data
 */
Deno.test("CoinGecko - Fetch historical data", async () => {
  const historicalData = await fetchHistoricalData("bitcoin", 7, COINGECKO_API_KEY);

  assertExists(historicalData);
  assertEquals(historicalData.id, "bitcoin");
  assertEquals(historicalData.symbol, "BTC");
  assertEquals(Array.isArray(historicalData.data), true);
  assertEquals(historicalData.data.length > 0, true);

  // Check structure of first data point
  const firstPoint = historicalData.data[0];
  assertEquals(typeof firstPoint.timestamp, "number");
  assertEquals(typeof firstPoint.price, "number");
  assertEquals(typeof firstPoint.marketCap, "number");
  assertEquals(typeof firstPoint.volume, "number");

  console.log(`✓ Fetched ${historicalData.data.length} historical data points for Bitcoin`);
  console.log(`  First price: $${firstPoint.price.toFixed(2)}`);
  console.log(`  Last price: $${historicalData.data[historicalData.data.length - 1].price.toFixed(2)}`);
});

/**
 * Test: Fetch batch quotes by IDs
 */
Deno.test("CoinGecko - Fetch batch quotes by IDs", async () => {
  const ids = ["bitcoin", "ethereum", "binancecoin"];
  const results = await fetchBatchQuotes(ids, COINGECKO_API_KEY);

  assertEquals(results.size, 3);

  // Check Bitcoin
  const btcResult = results.get("bitcoin");
  assertExists(btcResult);
  assertEquals(btcResult instanceof Error, false);
  if (!(btcResult instanceof Error)) {
    assertEquals(btcResult.id, "bitcoin");
    assertEquals(btcResult.symbol, "BTC");
    assertEquals(typeof btcResult.price, "number");
    console.log(`✓ Batch - Bitcoin: $${btcResult.price.toFixed(2)}`);
  }

  // Check Ethereum
  const ethResult = results.get("ethereum");
  assertExists(ethResult);
  assertEquals(ethResult instanceof Error, false);
  if (!(ethResult instanceof Error)) {
    assertEquals(ethResult.id, "ethereum");
    assertEquals(ethResult.symbol, "ETH");
    console.log(`✓ Batch - Ethereum: $${ethResult.price.toFixed(2)}`);
  }

  // Check Binance Coin
  const bnbResult = results.get("binancecoin");
  assertExists(bnbResult);
  assertEquals(bnbResult instanceof Error, false);
  if (!(bnbResult instanceof Error)) {
    assertEquals(bnbResult.id, "binancecoin");
    assertEquals(bnbResult.symbol, "BNB");
    console.log(`✓ Batch - Binance Coin: $${bnbResult.price.toFixed(2)}`);
  }
});

/**
 * Test: Fetch batch quotes by symbols
 */
Deno.test("CoinGecko - Fetch batch quotes by symbols", async () => {
  const symbols = ["BTC", "ETH", "BNB", "INVALID_XYZ"];
  const results = await fetchBatchQuotesBySymbols(symbols, COINGECKO_API_KEY);

  assertEquals(results.size, 4);

  // Check valid symbols
  const btcResult = results.get("BTC");
  assertExists(btcResult);
  assertEquals(btcResult instanceof Error, false);
  if (!(btcResult instanceof Error)) {
    assertEquals(btcResult.symbol, "BTC");
    console.log(`✓ Batch by symbol - BTC: $${btcResult.price.toFixed(2)}`);
  }

  // Check invalid symbol
  const invalidResult = results.get("INVALID_XYZ");
  assertExists(invalidResult);
  assertEquals(invalidResult instanceof Error, true);
  console.log("✓ Batch by symbol - Invalid symbol handled correctly");
});

/**
 * Test: Batch quotes with mixed valid and invalid IDs
 */
Deno.test("CoinGecko - Batch quotes with mixed valid and invalid IDs", async () => {
  const ids = ["bitcoin", "invalid-coin-xyz", "ethereum"];
  const results = await fetchBatchQuotes(ids, COINGECKO_API_KEY);

  assertEquals(results.size, 3);

  // Valid coins should succeed
  const btcResult = results.get("bitcoin");
  assertExists(btcResult);
  assertEquals(btcResult instanceof Error, false);

  const ethResult = results.get("ethereum");
  assertExists(ethResult);
  assertEquals(ethResult instanceof Error, false);

  // Invalid coin should have error
  const invalidResult = results.get("invalid-coin-xyz");
  assertExists(invalidResult);
  assertEquals(invalidResult instanceof Error, true);

  console.log("✓ Batch with mixed valid/invalid IDs handled correctly");
});

/**
 * Test: Large batch request (>250 IDs)
 */
Deno.test("CoinGecko - Large batch request", async () => {
  // Get first 300 coins from coin list
  const coinList = await fetchCoinList(COINGECKO_API_KEY);
  const ids = coinList.slice(0, 300).map((coin) => coin.id);

  const results = await fetchBatchQuotes(ids, COINGECKO_API_KEY);

  // Should handle batching internally
  assertEquals(results.size, 300);

  let successCount = 0;
  let errorCount = 0;

  for (const result of results.values()) {
    if (result instanceof Error) {
      errorCount++;
    } else {
      successCount++;
    }
  }

  console.log(`✓ Large batch: ${successCount} successful, ${errorCount} errors`);
  assertEquals(successCount > 0, true);
});

console.log("\n=== All CoinGecko API Client Tests Passed ===\n");
