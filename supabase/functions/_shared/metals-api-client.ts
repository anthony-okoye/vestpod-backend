// =====================================================
// Metals-API Commodity Price API Client
// =====================================================
// Provides commodity price fetching for precious metals
// with rate limit management (50 calls/month)
// Requirements: 3, 5

const METALS_API_BASE_URL = "https://metals-api.com/api";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Rate limit tracking (50 calls per month)
const MONTHLY_LIMIT = 50;
const rateLimitState = {
  monthlyCalls: 0,
  monthlyResetTime: getNextMonthTimestamp(),
};

/**
 * Supported commodity symbols
 */
export type CommoditySymbol = "XAU" | "XAG" | "XPT" | "XPD";

/**
 * Commodity quote response
 */
export interface CommodityQuote {
  symbol: CommoditySymbol;
  name: string;
  price: number; // Price per troy ounce in USD
  unit: string;
  timestamp: number;
}

/**
 * Historical data point for commodities
 */
export interface CommodityHistoricalDataPoint {
  timestamp: number;
  price: number;
}

/**
 * Historical data response
 */
export interface CommodityHistoricalData {
  symbol: CommoditySymbol;
  name: string;
  data: CommodityHistoricalDataPoint[];
}

/**
 * API Error with retry information
 */
export class MetalsAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "MetalsAPIError";
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends MetalsAPIError {
  constructor(message: string) {
    super(message, 429, false);
    this.name = "RateLimitError";
  }
}

/**
 * Get timestamp for next month
 */
function getNextMonthTimestamp(): number {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.getTime();
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check and update rate limits
 * Returns true if call is allowed, false if rate limit exceeded
 */
function checkRateLimit(): boolean {
  const now = Date.now();

  // Reset monthly counter if new month started
  if (now >= rateLimitState.monthlyResetTime) {
    rateLimitState.monthlyCalls = 0;
    rateLimitState.monthlyResetTime = getNextMonthTimestamp();
  }

  // Check limit
  if (rateLimitState.monthlyCalls >= MONTHLY_LIMIT) {
    return false;
  }

  // Increment counter
  rateLimitState.monthlyCalls++;

  return true;
}

/**
 * Get rate limit status
 */
export function getRateLimitStatus() {
  return {
    monthlyCalls: rateLimitState.monthlyCalls,
    monthlyLimit: MONTHLY_LIMIT,
    monthlyRemaining: MONTHLY_LIMIT - rateLimitState.monthlyCalls,
    monthlyResetTime: rateLimitState.monthlyResetTime,
  };
}

/**
 * Get commodity name from symbol
 */
function getCommodityName(symbol: CommoditySymbol): string {
  const names: Record<CommoditySymbol, string> = {
    XAU: "Gold",
    XAG: "Silver",
    XPT: "Platinum",
    XPD: "Palladium",
  };
  return names[symbol];
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
        throw new MetalsAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Metals-API attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new MetalsAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable error
      if (error instanceof MetalsAPIError && !error.retryable) {
        throw error;
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Metals-API attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new MetalsAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}

/**
 * Fetch current commodity price
 * Uses Metals-API latest endpoint
 * 
 * @param symbol - Commodity symbol (XAU, XAG, XPT, XPD)
 * @param apiKey - Metals-API key
 * @returns Commodity quote data
 */
export async function fetchCommodityQuote(
  symbol: CommoditySymbol,
  apiKey: string
): Promise<CommodityQuote> {
  // Check rate limit
  if (!checkRateLimit()) {
    const status = getRateLimitStatus();
    throw new RateLimitError(
      `Metals-API rate limit exceeded. Monthly: ${status.monthlyCalls}/${status.monthlyLimit}`
    );
  }

  const url = `${METALS_API_BASE_URL}/latest?access_key=${apiKey}&base=USD&symbols=${symbol}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (!data.success) {
      const errorMessage = data.error?.info || "Unknown API error";
      throw new MetalsAPIError(errorMessage, data.error?.code || 400, false);
    }

    // Validate response structure
    if (!data.rates || !data.rates[symbol]) {
      throw new MetalsAPIError(
        `No price data available for ${symbol}`,
        404,
        false
      );
    }

    // Metals-API returns rates as USD per unit
    // For precious metals, the unit is troy ounce
    // The rate is inverted (e.g., 0.0005 means 1/0.0005 = $2000 per oz)
    const rate = data.rates[symbol];
    const price = 1 / rate;

    return {
      symbol,
      name: getCommodityName(symbol),
      price: Number(price.toFixed(2)),
      unit: "troy ounce",
      timestamp: data.timestamp * 1000, // Convert to milliseconds
    };
  } catch (error) {
    if (error instanceof MetalsAPIError) {
      throw error;
    }
    throw new MetalsAPIError(
      `Failed to fetch quote for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch historical commodity data
 * Uses Metals-API timeseries endpoint
 * 
 * @param symbol - Commodity symbol (XAU, XAG, XPT, XPD)
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param apiKey - Metals-API key
 * @returns Historical data points
 */
export async function fetchHistoricalData(
  symbol: CommoditySymbol,
  startDate: string,
  endDate: string,
  apiKey: string
): Promise<CommodityHistoricalData> {
  // Check rate limit
  if (!checkRateLimit()) {
    const status = getRateLimitStatus();
    throw new RateLimitError(
      `Metals-API rate limit exceeded. Monthly: ${status.monthlyCalls}/${status.monthlyLimit}`
    );
  }

  const url = `${METALS_API_BASE_URL}/timeseries?access_key=${apiKey}&start_date=${startDate}&end_date=${endDate}&base=USD&symbols=${symbol}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (!data.success) {
      const errorMessage = data.error?.info || "Unknown API error";
      throw new MetalsAPIError(errorMessage, data.error?.code || 400, false);
    }

    // Validate response structure
    if (!data.rates) {
      throw new MetalsAPIError(
        `No historical data available for ${symbol}`,
        404,
        false
      );
    }

    // Transform results
    const dataPoints: CommodityHistoricalDataPoint[] = [];
    for (const [date, rates] of Object.entries(data.rates)) {
      const rate = (rates as Record<string, number>)[symbol];
      if (rate) {
        const price = 1 / rate;
        dataPoints.push({
          timestamp: new Date(date).getTime(),
          price: Number(price.toFixed(2)),
        });
      }
    }

    // Sort by timestamp ascending
    dataPoints.sort((a, b) => a.timestamp - b.timestamp);

    return {
      symbol,
      name: getCommodityName(symbol),
      data: dataPoints,
    };
  } catch (error) {
    if (error instanceof MetalsAPIError) {
      throw error;
    }
    throw new MetalsAPIError(
      `Failed to fetch historical data for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch quotes for multiple commodities in batch
 * Makes a single API call for efficiency
 * 
 * @param symbols - Array of commodity symbols
 * @param apiKey - Metals-API key
 * @returns Map of symbol to quote (or error)
 */
export async function fetchBatchQuotes(
  symbols: CommoditySymbol[],
  apiKey: string
): Promise<Map<CommoditySymbol, CommodityQuote | Error>> {
  const results = new Map<CommoditySymbol, CommodityQuote | Error>();

  // Check rate limit
  if (!checkRateLimit()) {
    const status = getRateLimitStatus();
    const error = new RateLimitError(
      `Metals-API rate limit exceeded. Monthly: ${status.monthlyCalls}/${status.monthlyLimit}`
    );
    // Return error for all symbols
    for (const symbol of symbols) {
      results.set(symbol, error);
    }
    return results;
  }

  const symbolsParam = symbols.join(",");
  const url = `${METALS_API_BASE_URL}/latest?access_key=${apiKey}&base=USD&symbols=${symbolsParam}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API errors
    if (!data.success) {
      const errorMessage = data.error?.info || "Unknown API error";
      const error = new MetalsAPIError(errorMessage, data.error?.code || 400, false);
      // Return error for all symbols
      for (const symbol of symbols) {
        results.set(symbol, error);
      }
      return results;
    }

    // Process each symbol
    for (const symbol of symbols) {
      try {
        if (!data.rates || !data.rates[symbol]) {
          results.set(
            symbol,
            new MetalsAPIError(`No price data available for ${symbol}`, 404, false)
          );
          continue;
        }

        const rate = data.rates[symbol];
        const price = 1 / rate;

        results.set(symbol, {
          symbol,
          name: getCommodityName(symbol),
          price: Number(price.toFixed(2)),
          unit: "troy ounce",
          timestamp: data.timestamp * 1000,
        });
      } catch (error) {
        results.set(symbol, error as Error);
      }
    }
  } catch (error) {
    // If batch request fails, mark all symbols as errors
    for (const symbol of symbols) {
      results.set(symbol, error as Error);
    }
  }

  return results;
}
