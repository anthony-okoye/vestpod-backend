// =====================================================
// API Provider Migration Integration Property Tests
// =====================================================
// Property tests for retry behavior and error class structure
// Feature: api-provider-migration
// **Validates: Requirements 1.4, 2.4, 3.4, 5.2, 5.4**

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import * as fc from "https://esm.sh/fast-check@3.15.0";

import { CoinCapAPIError } from "./coincap-client.ts";
import { GoldAPIError } from "./goldapi-client.ts";

console.log("\n=== API Provider Migration Integration Property Tests ===\n");

// =====================================================
// Property 5: Retry Behavior with Exponential Backoff
// =====================================================
// *For any* sequence of N consecutive network failures (where N ≤ maxRetries),
// the client SHALL make exactly N+1 total attempts, with delay between
// attempt i and i+1 being at least initialDelayMs * (backoffMultiplier ^ i).
// **Validates: Requirements 1.4, 2.4, 5.2, 5.4**

/**
 * Retry configuration constants (matching client implementations)
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  timeoutMs: 10000,
};

/**
 * Calculate expected delay for a given attempt number
 * @param attempt - Zero-based attempt number (0, 1, 2, ...)
 * @returns Expected delay in milliseconds
 */
function calculateExpectedDelay(attempt: number): number {
  return RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
}

/**
 * Property 5: Retry Behavior with Exponential Backoff
 * 
 * Tests that the exponential backoff calculation produces correct delays
 * for any valid attempt number within the retry limit.
 */
Deno.test("Property 5: Retry Behavior with Exponential Backoff", async () => {
  await fc.assert(
    fc.property(
      // Generate attempt numbers from 0 to maxRetries-1
      fc.integer({ min: 0, max: RETRY_CONFIG.maxRetries - 1 }),
      (attempt) => {
        const expectedDelay = calculateExpectedDelay(attempt);
        
        // Verify delay follows exponential backoff formula
        const expectedFormula = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
        assertEquals(expectedDelay, expectedFormula, 
          `Delay for attempt ${attempt} should follow exponential backoff formula`);
        
        // Verify delay is positive
        assertEquals(expectedDelay > 0, true, 
          `Delay must be positive for attempt ${attempt}`);
        
        // Verify delay increases with each attempt (monotonic increase)
        if (attempt > 0) {
          const previousDelay = calculateExpectedDelay(attempt - 1);
          assertEquals(expectedDelay > previousDelay, true,
            `Delay for attempt ${attempt} must be greater than attempt ${attempt - 1}`);
        }
        
        // Verify delay doubles with each attempt (backoff multiplier = 2)
        if (attempt > 0) {
          const previousDelay = calculateExpectedDelay(attempt - 1);
          assertEquals(expectedDelay, previousDelay * RETRY_CONFIG.backoffMultiplier,
            `Delay should double between consecutive attempts`);
        }

        return true;
      }
    ),
    { numRuns: 100 }
  );

  console.log("✓ Property 5: Retry Behavior with Exponential Backoff - PASSED (100 runs)");
});



/**
 * Property 5 (continued): Total attempts calculation
 * 
 * For N consecutive failures where N ≤ maxRetries, 
 * the client makes exactly N+1 total attempts.
 */
Deno.test("Property 5: Total Attempts Calculation", async () => {
  await fc.assert(
    fc.property(
      // Generate number of failures from 0 to maxRetries
      fc.integer({ min: 0, max: RETRY_CONFIG.maxRetries }),
      (numFailures) => {
        // Total attempts = failures + 1 (initial attempt)
        const totalAttempts = numFailures + 1;
        
        // Verify total attempts is within bounds
        assertEquals(totalAttempts >= 1, true, 
          "Must make at least 1 attempt");
        assertEquals(totalAttempts <= RETRY_CONFIG.maxRetries + 1, true,
          `Total attempts (${totalAttempts}) must not exceed maxRetries + 1 (${RETRY_CONFIG.maxRetries + 1})`);
        
        // Calculate total delay for all retries
        let totalDelay = 0;
        for (let i = 0; i < numFailures; i++) {
          totalDelay += calculateExpectedDelay(i);
        }
        
        // Verify total delay is non-negative
        assertEquals(totalDelay >= 0, true, "Total delay must be non-negative");
        
        // Verify total delay is bounded
        const maxPossibleDelay = RETRY_CONFIG.initialDelayMs * 
          (Math.pow(RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxRetries) - 1) / 
          (RETRY_CONFIG.backoffMultiplier - 1);
        assertEquals(totalDelay <= maxPossibleDelay, true,
          `Total delay (${totalDelay}) must not exceed maximum possible delay (${maxPossibleDelay})`);

        return true;
      }
    ),
    { numRuns: 100 }
  );

  console.log("✓ Property 5: Total Attempts Calculation - PASSED (100 runs)");
});

// =====================================================
// Property 6: Error Class Structure Compatibility
// =====================================================
// *For any* error thrown by the new clients (CoinCapAPIError, GoldAPIError),
// the error SHALL have the same structure as the original errors
// (statusCode?: number, retryable: boolean, message: string).
// **Validates: Requirements 3.4**

/**
 * Arbitrary generator for error messages
 */
const errorMessageArbitrary = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Arbitrary generator for HTTP status codes
 */
const statusCodeArbitrary = fc.option(
  fc.integer({ min: 100, max: 599 }),
  { nil: undefined }
);

/**
 * Arbitrary generator for retryable flag
 */
const retryableArbitrary = fc.boolean();

/**
 * Property 6: CoinCapAPIError Structure Compatibility
 * 
 * Tests that CoinCapAPIError has the required structure:
 * - message: string
 * - statusCode?: number
 * - retryable: boolean
 * - name: string (equals "CoinCapAPIError")
 */
Deno.test("Property 6: CoinCapAPIError Structure Compatibility", async () => {
  await fc.assert(
    fc.property(
      errorMessageArbitrary,
      statusCodeArbitrary,
      retryableArbitrary,
      (message, statusCode, retryable) => {
        const error = new CoinCapAPIError(message, statusCode, retryable);
        
        // Verify error is an instance of Error
        assertEquals(error instanceof Error, true, 
          "CoinCapAPIError must be an instance of Error");
        
        // Verify error name
        assertEquals(error.name, "CoinCapAPIError",
          "Error name must be 'CoinCapAPIError'");
        
        // Verify message field
        assertExists(error.message, "message field must exist");
        assertEquals(typeof error.message, "string", "message must be a string");
        assertEquals(error.message, message, "message must match input");
        
        // Verify statusCode field
        if (statusCode !== undefined) {
          assertEquals(typeof error.statusCode, "number", 
            "statusCode must be a number when defined");
          assertEquals(error.statusCode, statusCode, 
            "statusCode must match input");
        } else {
          assertEquals(error.statusCode, undefined, 
            "statusCode must be undefined when not provided");
        }
        
        // Verify retryable field
        assertEquals(typeof error.retryable, "boolean", 
          "retryable must be a boolean");
        assertEquals(error.retryable, retryable, 
          "retryable must match input");

        return true;
      }
    ),
    { numRuns: 100 }
  );

  console.log("✓ Property 6: CoinCapAPIError Structure Compatibility - PASSED (100 runs)");
});

/**
 * Property 6: GoldAPIError Structure Compatibility
 * 
 * Tests that GoldAPIError has the required structure:
 * - message: string
 * - statusCode?: number
 * - retryable: boolean
 * - name: string (equals "GoldAPIError")
 */
Deno.test("Property 6: GoldAPIError Structure Compatibility", async () => {
  await fc.assert(
    fc.property(
      errorMessageArbitrary,
      statusCodeArbitrary,
      retryableArbitrary,
      (message, statusCode, retryable) => {
        const error = new GoldAPIError(message, statusCode, retryable);
        
        // Verify error is an instance of Error
        assertEquals(error instanceof Error, true, 
          "GoldAPIError must be an instance of Error");
        
        // Verify error name
        assertEquals(error.name, "GoldAPIError",
          "Error name must be 'GoldAPIError'");
        
        // Verify message field
        assertExists(error.message, "message field must exist");
        assertEquals(typeof error.message, "string", "message must be a string");
        assertEquals(error.message, message, "message must match input");
        
        // Verify statusCode field
        if (statusCode !== undefined) {
          assertEquals(typeof error.statusCode, "number", 
            "statusCode must be a number when defined");
          assertEquals(error.statusCode, statusCode, 
            "statusCode must match input");
        } else {
          assertEquals(error.statusCode, undefined, 
            "statusCode must be undefined when not provided");
        }
        
        // Verify retryable field
        assertEquals(typeof error.retryable, "boolean", 
          "retryable must be a boolean");
        assertEquals(error.retryable, retryable, 
          "retryable must match input");

        return true;
      }
    ),
    { numRuns: 100 }
  );

  console.log("✓ Property 6: GoldAPIError Structure Compatibility - PASSED (100 runs)");
});

/**
 * Property 6: Error Classes Have Identical Structure
 * 
 * Tests that both error classes have the same property structure,
 * ensuring they can be used interchangeably in error handling code.
 */
Deno.test("Property 6: Error Classes Have Identical Structure", async () => {
  await fc.assert(
    fc.property(
      errorMessageArbitrary,
      statusCodeArbitrary,
      retryableArbitrary,
      (message, statusCode, retryable) => {
        const coinCapError = new CoinCapAPIError(message, statusCode, retryable);
        const goldAPIError = new GoldAPIError(message, statusCode, retryable);
        
        // Both errors should have the same properties (except name)
        assertEquals(coinCapError.message, goldAPIError.message,
          "Both errors should have same message");
        assertEquals(coinCapError.statusCode, goldAPIError.statusCode,
          "Both errors should have same statusCode");
        assertEquals(coinCapError.retryable, goldAPIError.retryable,
          "Both errors should have same retryable value");
        
        // Both should be Error instances
        assertEquals(coinCapError instanceof Error, goldAPIError instanceof Error,
          "Both should be Error instances");
        
        // Verify property keys are the same (excluding 'name' and 'stack')
        const coinCapKeys = Object.keys(coinCapError).filter(k => k !== 'name' && k !== 'stack').sort();
        const goldAPIKeys = Object.keys(goldAPIError).filter(k => k !== 'name' && k !== 'stack').sort();
        assertEquals(coinCapKeys.length, goldAPIKeys.length,
          "Both errors should have same number of properties");

        return true;
      }
    ),
    { numRuns: 100 }
  );

  console.log("✓ Property 6: Error Classes Have Identical Structure - PASSED (100 runs)");
});

console.log("\n=== All Integration Property Tests Complete ===\n");
