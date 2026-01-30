// =====================================================
// ExchangeRate-API Forex Currency Rate API Client
// =====================================================
// Provides currency exchange rate fetching and conversion
// with error handling and retry logic
// Requirements: 5, 12

const EXCHANGERATE_API_BASE_URL = "https://v6.exchangerate-api.com/v6";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Supported currency codes (ISO 4217)
 */
export type CurrencyCode = string; // e.g., "USD", "EUR", "GBP", "JPY", etc.

/**
 * Currency exchange rate response
 */
export interface ExchangeRate {
  baseCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
  rate: number;
  timestamp: number;
}

/**
 * Currency conversion result
 */
export interface ConversionResult {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  fromAmount: number;
  toAmount: number;
  rate: number;
  timestamp: number;
}

/**
 * All exchange rates for a base currency
 */
export interface AllExchangeRates {
  baseCurrency: CurrencyCode;
  rates: Record<CurrencyCode, number>;
  timestamp: number;
}

/**
 * API Error with retry information
 */
export class ExchangeRateAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "ExchangeRateAPIError";
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if error is retryable
 */
function isRetryableError(statusCode?: number): boolean {
  if (!statusCode) return true; // Network errors are retryable
  return statusCode >= 500;
}

/**
 * Make HTTP request with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Success - return response
      if (response.ok) {
        return response;
      }

      // Check if error is retryable
      if (!isRetryableError(response.status)) {
        throw new ExchangeRateAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `ExchangeRate-API attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new ExchangeRateAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable error
      if (error instanceof ExchangeRateAPIError && !error.retryable) {
        throw error;
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `ExchangeRate-API attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new ExchangeRateAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}

/**
 * Fetch exchange rate between two currencies
 * Uses ExchangeRate-API pair endpoint
 * 
 * @param baseCurrency - Base currency code (e.g., "USD")
 * @param targetCurrency - Target currency code (e.g., "EUR")
 * @param apiKey - ExchangeRate-API key
 * @returns Exchange rate data
 */
export async function fetchExchangeRate(
  baseCurrency: CurrencyCode,
  targetCurrency: CurrencyCode,
  apiKey: string
): Promise<ExchangeRate> {
  const baseUpper = baseCurrency.toUpperCase();
  const targetUpper = targetCurrency.toUpperCase();
  const url = `${EXCHANGERATE_API_BASE_URL}/${apiKey}/pair/${baseUpper}/${targetUpper}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (data.result !== "success") {
      const errorType = data["error-type"] || "unknown";
      throw new ExchangeRateAPIError(
        `API error: ${errorType}`,
        400,
        false
      );
    }

    // Validate response structure
    if (!data.conversion_rate) {
      throw new ExchangeRateAPIError(
        `No exchange rate available for ${baseUpper}/${targetUpper}`,
        404,
        false
      );
    }

    return {
      baseCurrency: baseUpper,
      targetCurrency: targetUpper,
      rate: data.conversion_rate,
      timestamp: data.time_last_update_unix * 1000, // Convert to milliseconds
    };
  } catch (error) {
    if (error instanceof ExchangeRateAPIError) {
      throw error;
    }
    throw new ExchangeRateAPIError(
      `Failed to fetch exchange rate for ${baseUpper}/${targetUpper}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Convert amount from one currency to another
 * Uses ExchangeRate-API pair conversion endpoint
 * 
 * @param fromCurrency - Source currency code
 * @param toCurrency - Target currency code
 * @param amount - Amount to convert
 * @param apiKey - ExchangeRate-API key
 * @returns Conversion result
 */
export async function convertCurrency(
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  amount: number,
  apiKey: string
): Promise<ConversionResult> {
  const fromUpper = fromCurrency.toUpperCase();
  const toUpper = toCurrency.toUpperCase();
  const url = `${EXCHANGERATE_API_BASE_URL}/${apiKey}/pair/${fromUpper}/${toUpper}/${amount}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (data.result !== "success") {
      const errorType = data["error-type"] || "unknown";
      throw new ExchangeRateAPIError(
        `API error: ${errorType}`,
        400,
        false
      );
    }

    // Validate response structure
    if (!data.conversion_result || !data.conversion_rate) {
      throw new ExchangeRateAPIError(
        `No conversion result available for ${fromUpper}/${toUpper}`,
        404,
        false
      );
    }

    return {
      fromCurrency: fromUpper,
      toCurrency: toUpper,
      fromAmount: amount,
      toAmount: data.conversion_result,
      rate: data.conversion_rate,
      timestamp: data.time_last_update_unix * 1000,
    };
  } catch (error) {
    if (error instanceof ExchangeRateAPIError) {
      throw error;
    }
    throw new ExchangeRateAPIError(
      `Failed to convert ${amount} ${fromUpper} to ${toUpper}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch all exchange rates for a base currency
 * Uses ExchangeRate-API latest endpoint
 * 
 * @param baseCurrency - Base currency code (e.g., "USD")
 * @param apiKey - ExchangeRate-API key
 * @returns All exchange rates for the base currency
 */
export async function fetchAllRates(
  baseCurrency: CurrencyCode,
  apiKey: string
): Promise<AllExchangeRates> {
  const baseUpper = baseCurrency.toUpperCase();
  const url = `${EXCHANGERATE_API_BASE_URL}/${apiKey}/latest/${baseUpper}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (data.result !== "success") {
      const errorType = data["error-type"] || "unknown";
      throw new ExchangeRateAPIError(
        `API error: ${errorType}`,
        400,
        false
      );
    }

    // Validate response structure
    if (!data.conversion_rates) {
      throw new ExchangeRateAPIError(
        `No exchange rates available for ${baseUpper}`,
        404,
        false
      );
    }

    return {
      baseCurrency: baseUpper,
      rates: data.conversion_rates,
      timestamp: data.time_last_update_unix * 1000,
    };
  } catch (error) {
    if (error instanceof ExchangeRateAPIError) {
      throw error;
    }
    throw new ExchangeRateAPIError(
      `Failed to fetch all rates for ${baseUpper}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Convert multiple amounts from one currency to multiple target currencies
 * Makes a single API call for efficiency
 * 
 * @param baseCurrency - Source currency code
 * @param targetCurrencies - Array of target currency codes
 * @param amount - Amount to convert
 * @param apiKey - ExchangeRate-API key
 * @returns Map of target currency to conversion result (or error)
 */
export async function convertToMultipleCurrencies(
  baseCurrency: CurrencyCode,
  targetCurrencies: CurrencyCode[],
  amount: number,
  apiKey: string
): Promise<Map<CurrencyCode, ConversionResult | Error>> {
  const results = new Map<CurrencyCode, ConversionResult | Error>();

  try {
    // Fetch all rates for base currency
    const allRates = await fetchAllRates(baseCurrency, apiKey);

    // Convert to each target currency
    for (const targetCurrency of targetCurrencies) {
      const targetUpper = targetCurrency.toUpperCase();
      const rate = allRates.rates[targetUpper];

      if (!rate) {
        results.set(
          targetCurrency,
          new ExchangeRateAPIError(
            `No exchange rate available for ${allRates.baseCurrency}/${targetUpper}`,
            404,
            false
          )
        );
        continue;
      }

      results.set(targetCurrency, {
        fromCurrency: allRates.baseCurrency,
        toCurrency: targetUpper,
        fromAmount: amount,
        toAmount: Number((amount * rate).toFixed(2)),
        rate,
        timestamp: allRates.timestamp,
      });
    }
  } catch (error) {
    // If batch request fails, mark all currencies as errors
    for (const targetCurrency of targetCurrencies) {
      results.set(targetCurrency, error as Error);
    }
  }

  return results;
}

/**
 * Get list of supported currency codes
 * Uses ExchangeRate-API codes endpoint
 * 
 * @param apiKey - ExchangeRate-API key
 * @returns Array of supported currency codes
 */
export async function getSupportedCurrencies(
  apiKey: string
): Promise<CurrencyCode[]> {
  const url = `${EXCHANGERATE_API_BASE_URL}/${apiKey}/codes`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (data.result !== "success") {
      const errorType = data["error-type"] || "unknown";
      throw new ExchangeRateAPIError(
        `API error: ${errorType}`,
        400,
        false
      );
    }

    // Validate response structure
    if (!data.supported_codes || !Array.isArray(data.supported_codes)) {
      throw new ExchangeRateAPIError(
        "Invalid supported codes response structure",
        undefined,
        false
      );
    }

    // Extract currency codes from [code, name] pairs
    return data.supported_codes.map((pair: [string, string]) => pair[0]);
  } catch (error) {
    if (error instanceof ExchangeRateAPIError) {
      throw error;
    }
    throw new ExchangeRateAPIError(
      `Failed to fetch supported currencies: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}
