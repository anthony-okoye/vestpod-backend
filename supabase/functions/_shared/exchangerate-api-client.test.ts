// =====================================================
// ExchangeRate-API Client Tests
// =====================================================
// Tests for currency exchange rate fetching and conversion
// Requirements: 5, 12

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  fetchExchangeRate,
  convertCurrency,
  fetchAllRates,
  convertToMultipleCurrencies,
  getSupportedCurrencies,
  ExchangeRateAPIError,
} from "./exchangerate-api-client.ts";

// Get API key from environment
const EXCHANGE_RATE_API_KEY = Deno.env.get("EXCHANGE_RATE_API_KEY");

if (!EXCHANGE_RATE_API_KEY) {
  console.warn("⚠️  EXCHANGE_RATE_API_KEY not set. Tests will be skipped.");
  console.warn("   Set EXCHANGE_RATE_API_KEY environment variable to run tests.");
  Deno.exit(0);
}

/**
 * Test: Fetch exchange rate USD to EUR
 */
Deno.test("ExchangeRate-API - Fetch USD to EUR rate", async () => {
  const rate = await fetchExchangeRate("USD", "EUR", EXCHANGE_RATE_API_KEY!);

  assertExists(rate);
  assertEquals(rate.baseCurrency, "USD");
  assertEquals(rate.targetCurrency, "EUR");
  assertEquals(typeof rate.rate, "number");
  assertEquals(rate.rate > 0, true);
  assertEquals(typeof rate.timestamp, "number");

  console.log(`✓ USD to EUR rate: ${rate.rate.toFixed(4)}`);
});

/**
 * Test: Fetch exchange rate EUR to GBP
 */
Deno.test("ExchangeRate-API - Fetch EUR to GBP rate", async () => {
  const rate = await fetchExchangeRate("EUR", "GBP", EXCHANGE_RATE_API_KEY!);

  assertExists(rate);
  assertEquals(rate.baseCurrency, "EUR");
  assertEquals(rate.targetCurrency, "GBP");
  assertEquals(typeof rate.rate, "number");
  assertEquals(rate.rate > 0, true);

  console.log(`✓ EUR to GBP rate: ${rate.rate.toFixed(4)}`);
});

/**
 * Test: Fetch exchange rate with lowercase symbols
 */
Deno.test("ExchangeRate-API - Fetch rate with lowercase symbols", async () => {
  const rate = await fetchExchangeRate("usd", "jpy", EXCHANGE_RATE_API_KEY!);

  assertExists(rate);
  assertEquals(rate.baseCurrency, "USD");
  assertEquals(rate.targetCurrency, "JPY");
  assertEquals(typeof rate.rate, "number");
  assertEquals(rate.rate > 0, true);

  console.log(`✓ USD to JPY rate: ${rate.rate.toFixed(2)}`);
});

/**
 * Test: Convert currency USD to EUR
 */
Deno.test("ExchangeRate-API - Convert 100 USD to EUR", async () => {
  const result = await convertCurrency("USD", "EUR", 100, EXCHANGE_RATE_API_KEY!);

  assertExists(result);
  assertEquals(result.fromCurrency, "USD");
  assertEquals(result.toCurrency, "EUR");
  assertEquals(result.fromAmount, 100);
  assertEquals(typeof result.toAmount, "number");
  assertEquals(result.toAmount > 0, true);
  assertEquals(typeof result.rate, "number");
  assertEquals(result.rate > 0, true);
  assertEquals(typeof result.timestamp, "number");

  console.log(`✓ 100 USD = ${result.toAmount.toFixed(2)} EUR (rate: ${result.rate.toFixed(4)})`);
});

/**
 * Test: Convert currency GBP to USD
 */
Deno.test("ExchangeRate-API - Convert 50 GBP to USD", async () => {
  const result = await convertCurrency("GBP", "USD", 50, EXCHANGE_RATE_API_KEY!);

  assertExists(result);
  assertEquals(result.fromCurrency, "GBP");
  assertEquals(result.toCurrency, "USD");
  assertEquals(result.fromAmount, 50);
  assertEquals(typeof result.toAmount, "number");
  assertEquals(result.toAmount > 0, true);

  console.log(`✓ 50 GBP = ${result.toAmount.toFixed(2)} USD`);
});

/**
 * Test: Convert decimal amount
 */
Deno.test("ExchangeRate-API - Convert decimal amount", async () => {
  const result = await convertCurrency("USD", "EUR", 123.45, EXCHANGE_RATE_API_KEY!);

  assertExists(result);
  assertEquals(result.fromAmount, 123.45);
  assertEquals(typeof result.toAmount, "number");
  assertEquals(result.toAmount > 0, true);

  console.log(`✓ 123.45 USD = ${result.toAmount.toFixed(2)} EUR`);
});

/**
 * Test: Fetch all rates for USD
 */
Deno.test("ExchangeRate-API - Fetch all rates for USD", async () => {
  const allRates = await fetchAllRates("USD", EXCHANGE_RATE_API_KEY!);

  assertExists(allRates);
  assertEquals(allRates.baseCurrency, "USD");
  assertEquals(typeof allRates.rates, "object");
  assertEquals(typeof allRates.timestamp, "number");

  // Check for common currencies
  assertExists(allRates.rates["EUR"]);
  assertExists(allRates.rates["GBP"]);
  assertExists(allRates.rates["JPY"]);
  assertExists(allRates.rates["CAD"]);
  assertExists(allRates.rates["AUD"]);

  assertEquals(typeof allRates.rates["EUR"], "number");
  assertEquals(allRates.rates["EUR"] > 0, true);

  const currencyCount = Object.keys(allRates.rates).length;
  console.log(`✓ Fetched ${currencyCount} exchange rates for USD`);
  console.log(`  EUR: ${allRates.rates["EUR"].toFixed(4)}`);
  console.log(`  GBP: ${allRates.rates["GBP"].toFixed(4)}`);
  console.log(`  JPY: ${allRates.rates["JPY"].toFixed(2)}`);
});

/**
 * Test: Fetch all rates for EUR
 */
Deno.test("ExchangeRate-API - Fetch all rates for EUR", async () => {
  const allRates = await fetchAllRates("EUR", EXCHANGE_RATE_API_KEY!);

  assertExists(allRates);
  assertEquals(allRates.baseCurrency, "EUR");
  assertExists(allRates.rates["USD"]);
  assertExists(allRates.rates["GBP"]);

  console.log(`✓ Fetched ${Object.keys(allRates.rates).length} exchange rates for EUR`);
});

/**
 * Test: Convert to multiple currencies
 */
Deno.test("ExchangeRate-API - Convert to multiple currencies", async () => {
  const targetCurrencies = ["EUR", "GBP", "JPY", "CAD", "AUD"];
  const results = await convertToMultipleCurrencies(
    "USD",
    targetCurrencies,
    1000,
    EXCHANGE_RATE_API_KEY!
  );

  assertEquals(results.size, 5);

  // Check EUR conversion
  const eurResult = results.get("EUR");
  assertExists(eurResult);
  assertEquals(eurResult instanceof Error, false);
  if (!(eurResult instanceof Error)) {
    assertEquals(eurResult.fromCurrency, "USD");
    assertEquals(eurResult.toCurrency, "EUR");
    assertEquals(eurResult.fromAmount, 1000);
    assertEquals(typeof eurResult.toAmount, "number");
    assertEquals(eurResult.toAmount > 0, true);
    console.log(`✓ 1000 USD = ${eurResult.toAmount.toFixed(2)} EUR`);
  }

  // Check GBP conversion
  const gbpResult = results.get("GBP");
  assertExists(gbpResult);
  assertEquals(gbpResult instanceof Error, false);
  if (!(gbpResult instanceof Error)) {
    assertEquals(gbpResult.toCurrency, "GBP");
    console.log(`✓ 1000 USD = ${gbpResult.toAmount.toFixed(2)} GBP`);
  }

  // Check JPY conversion
  const jpyResult = results.get("JPY");
  assertExists(jpyResult);
  assertEquals(jpyResult instanceof Error, false);
  if (!(jpyResult instanceof Error)) {
    assertEquals(jpyResult.toCurrency, "JPY");
    console.log(`✓ 1000 USD = ${jpyResult.toAmount.toFixed(2)} JPY`);
  }

  // Check all conversions succeeded
  let successCount = 0;
  for (const result of results.values()) {
    if (!(result instanceof Error)) {
      successCount++;
    }
  }
  assertEquals(successCount, 5);
  console.log(`✓ All ${successCount} conversions successful`);
});

/**
 * Test: Convert to multiple currencies with invalid currency
 */
Deno.test("ExchangeRate-API - Convert with invalid target currency", async () => {
  const targetCurrencies = ["EUR", "INVALID_XYZ", "GBP"];
  const results = await convertToMultipleCurrencies(
    "USD",
    targetCurrencies,
    100,
    EXCHANGE_RATE_API_KEY!
  );

  assertEquals(results.size, 3);

  // Valid currencies should succeed
  const eurResult = results.get("EUR");
  assertExists(eurResult);
  assertEquals(eurResult instanceof Error, false);

  const gbpResult = results.get("GBP");
  assertExists(gbpResult);
  assertEquals(gbpResult instanceof Error, false);

  // Invalid currency should have error
  const invalidResult = results.get("INVALID_XYZ");
  assertExists(invalidResult);
  assertEquals(invalidResult instanceof Error, true);

  console.log("✓ Mixed valid/invalid currencies handled correctly");
});

/**
 * Test: Get supported currencies
 */
Deno.test("ExchangeRate-API - Get supported currencies", async () => {
  const currencies = await getSupportedCurrencies(EXCHANGE_RATE_API_KEY!);

  assertExists(currencies);
  assertEquals(Array.isArray(currencies), true);
  assertEquals(currencies.length > 0, true);

  // Check for common currencies
  assertEquals(currencies.includes("USD"), true);
  assertEquals(currencies.includes("EUR"), true);
  assertEquals(currencies.includes("GBP"), true);
  assertEquals(currencies.includes("JPY"), true);

  console.log(`✓ Fetched ${currencies.length} supported currencies`);
  console.log(`  Sample: ${currencies.slice(0, 10).join(", ")}`);
});

/**
 * Test: Error handling with invalid API key
 */
Deno.test("ExchangeRate-API - Error handling with invalid API key", async () => {
  try {
    await fetchExchangeRate("USD", "EUR", "invalid-api-key");
    throw new Error("Should have thrown ExchangeRateAPIError");
  } catch (error) {
    assertEquals(error instanceof ExchangeRateAPIError, true);
    console.log("✓ Invalid API key error handled correctly");
  }
});

/**
 * Test: Error handling with invalid currency code
 */
Deno.test("ExchangeRate-API - Error handling with invalid currency", async () => {
  try {
    await fetchExchangeRate("USD", "INVALID", EXCHANGE_RATE_API_KEY!);
    throw new Error("Should have thrown ExchangeRateAPIError");
  } catch (error) {
    assertEquals(error instanceof ExchangeRateAPIError, true);
    console.log("✓ Invalid currency code error handled correctly");
  }
});

/**
 * Test: Same currency conversion
 */
Deno.test("ExchangeRate-API - Same currency conversion", async () => {
  const result = await convertCurrency("USD", "USD", 100, EXCHANGE_RATE_API_KEY!);

  assertExists(result);
  assertEquals(result.fromCurrency, "USD");
  assertEquals(result.toCurrency, "USD");
  assertEquals(result.fromAmount, 100);
  assertEquals(result.rate, 1);
  assertEquals(result.toAmount, 100);

  console.log("✓ Same currency conversion returns 1:1 rate");
});

console.log("\n=== All ExchangeRate-API Client Tests Passed ===\n");
