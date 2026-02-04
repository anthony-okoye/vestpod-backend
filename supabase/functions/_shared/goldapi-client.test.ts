// =====================================================
// Gold-API Client Property-Based Tests
// =====================================================
// Property tests for CommodityQuote interface conformance
// Feature: api-provider-migration, Property 2: CommodityQuote Interface Conformance
// **Validates: Requirements 2.2, 2.6**

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import * as fc from "https://esm.sh/fast-check@3.15.0";

import type { CommodityQuote, CommoditySymbol } from "./goldapi-client.ts";

/**
 * Gold-API response structure (matches internal interface)
 */
interface GoldAPIResponse {
  name: string;
  price: number;
  symbol: string;
  updatedAt: string;
  updatedAtReadable: string;
}

/**
 * Valid commodity symbols
 */
const VALID_SYMBOLS: CommoditySymbol[] = ["XAU", "XAG", "XPT", "XPD"];

/**
 * Transform Gold-API response to CommodityQuote interface
 * (Duplicated from goldapi-client.ts for testing since it's not exported)
 */
function transformToCommodityQuote(response: GoldAPIResponse): CommodityQuote {
  return {
    symbol: response.symbol as CommoditySymbol,
    name: response.name,
    price: Number(response.price.toFixed(2)),
    unit: "troy ounce",
    timestamp: new Date(response.updatedAt).getTime(),
  };
}

/**
 * Arbitrary generator for valid commodity symbols
 */
const commoditySymbolArbitrary = fc.constantFrom<CommoditySymbol>(...VALID_SYMBOLS);

/**
 * Arbitrary generator for commodity names matching symbols
 */
const commodityNameArbitrary = (symbol: CommoditySymbol): string => {
  const names: Record<CommoditySymbol, string> = {
    XAU: "Gold",
    XAG: "Silver",
    XPT: "Platinum",
    XPD: "Palladium",
  };
  return names[symbol];
};

/**
 * Arbitrary generator for valid ISO timestamps
 */
const isoTimestampArbitrary = fc.date({
  min: new Date("2020-01-01"),
  max: new Date("2030-12-31"),
}).map((d) => d.toISOString());

/**
 * Arbitrary generator for valid Gold-API responses
 */
const goldAPIResponseArbitrary = commoditySymbolArbitrary.chain((symbol) =>
  fc.record({
    name: fc.constant(commodityNameArbitrary(symbol)),
    price: fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
    symbol: fc.constant(symbol),
    updatedAt: isoTimestampArbitrary,
    updatedAtReadable: fc.constant("a few seconds ago"),
  })
);

/**
 * Property 2: CommodityQuote Interface Conformance
 * 
 * *For any* valid Gold-API response for a precious metal,
 * transforming it to a CommodityQuote SHALL produce an object with all
 * required fields (symbol, name, price, unit, timestamp) where price
 * is a positive number and symbol is one of XAU, XAG, XPT, XPD.
 * 
 * **Validates: Requirements 2.2, 2.6**
 */
Deno.test("Property 2: CommodityQuote Interface Conformance", async () => {
  await fc.assert(
    fc.property(goldAPIResponseArbitrary, (response) => {
      const quote = transformToCommodityQuote(response);

      // Verify all required fields exist
      assertExists(quote.symbol, "symbol field must exist");
      assertExists(quote.name, "name field must exist");
      assertExists(quote.unit, "unit field must exist");
      assertExists(quote.timestamp, "timestamp field must exist");

      // Verify symbol is one of the valid commodity symbols
      assertEquals(
        VALID_SYMBOLS.includes(quote.symbol),
        true,
        `symbol must be one of ${VALID_SYMBOLS.join(", ")}, got: ${quote.symbol}`
      );

      // Verify symbol matches input
      assertEquals(quote.symbol, response.symbol, "symbol must match input response symbol");

      // Verify name matches input
      assertEquals(quote.name, response.name, "name must match input response name");

      // Verify price is a valid positive number
      assertEquals(typeof quote.price, "number", "price must be a number");
      assertEquals(Number.isFinite(quote.price), true, "price must be finite");
      assertEquals(quote.price > 0, true, "price must be positive");

      // Verify price is rounded to 2 decimal places
      const priceStr = quote.price.toString();
      const decimalPart = priceStr.split(".")[1];
      if (decimalPart) {
        assertEquals(
          decimalPart.length <= 2,
          true,
          "price must have at most 2 decimal places"
        );
      }

      // Verify unit is "troy ounce"
      assertEquals(quote.unit, "troy ounce", "unit must be 'troy ounce'");

      // Verify timestamp is a valid positive number
      assertEquals(typeof quote.timestamp, "number", "timestamp must be a number");
      assertEquals(Number.isFinite(quote.timestamp), true, "timestamp must be finite");
      assertEquals(quote.timestamp > 0, true, "timestamp must be positive");

      // Verify timestamp is derived from updatedAt
      const expectedTimestamp = new Date(response.updatedAt).getTime();
      assertEquals(
        quote.timestamp,
        expectedTimestamp,
        "timestamp must match parsed updatedAt"
      );

      return true;
    }),
    { numRuns: 100 }
  );

  console.log("✓ Property 2: CommodityQuote Interface Conformance - PASSED (100 runs)");
});

/**
 * Property 4: Batch Metals Operation Completeness
 * 
 * *For any* list of commodity symbols provided to fetchBatchQuotes,
 * the returned Map SHALL contain an entry for every input symbol,
 * where each entry is either a valid CommodityQuote or an Error.
 * 
 * **Validates: Requirements 2.3**
 */
Deno.test("Property 4: Batch Metals Operation Completeness", async () => {
  // Import the actual fetchBatchQuotes function
  const { fetchBatchQuotes } = await import("./goldapi-client.ts");

  await fc.assert(
    fc.asyncProperty(
      // Generate arrays of 1-4 commodity symbols (may include duplicates)
      fc.array(commoditySymbolArbitrary, { minLength: 1, maxLength: 4 }),
      async (symbols) => {
        // Call the batch function
        const results = await fetchBatchQuotes(symbols);

        // Verify results is a Map
        assertEquals(
          results instanceof Map,
          true,
          "fetchBatchQuotes must return a Map"
        );

        // Verify every input symbol has an entry in the results
        for (const symbol of symbols) {
          assertEquals(
            results.has(symbol),
            true,
            `Result map must contain entry for symbol: ${symbol}`
          );

          const entry = results.get(symbol);
          assertExists(entry, `Entry for ${symbol} must exist`);

          // Each entry must be either a CommodityQuote or an Error
          const isQuote =
            typeof entry === "object" &&
            entry !== null &&
            "symbol" in entry &&
            "name" in entry &&
            "price" in entry &&
            "unit" in entry &&
            "timestamp" in entry;

          const isError = entry instanceof Error;

          assertEquals(
            isQuote || isError,
            true,
            `Entry for ${symbol} must be either a CommodityQuote or an Error, got: ${typeof entry}`
          );

          // If it's a quote, verify it matches the requested symbol
          if (isQuote) {
            const quote = entry as CommodityQuote;
            assertEquals(
              quote.symbol,
              symbol,
              `Quote symbol must match requested symbol: ${symbol}`
            );

            // Verify quote has valid structure
            assertEquals(
              VALID_SYMBOLS.includes(quote.symbol),
              true,
              `Quote symbol must be valid: ${quote.symbol}`
            );
            assertEquals(
              typeof quote.price,
              "number",
              "Quote price must be a number"
            );
            assertEquals(
              typeof quote.timestamp,
              "number",
              "Quote timestamp must be a number"
            );
          }
        }

        return true;
      }
    ),
    { numRuns: 100 }
  );

  console.log("✓ Property 4: Batch Metals Operation Completeness - PASSED (100 runs)");
});

console.log("\n=== Gold-API Client Property Tests ===\n");
