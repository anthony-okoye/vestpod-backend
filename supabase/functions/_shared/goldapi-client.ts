// =====================================================
// Gold-API Commodity Price API Client
// =====================================================
// Provides commodity price fetching for precious metals
// from Gold-API.com (free, no API key required)
// Requirements: 2.1, 2.4, 5.2, 5.4

const GOLDAPI_BASE_URL = "https://api.gold-api.com/price";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const REQUEST_TIMEOUT = 10000; // 10 seconds

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
 * Rate limit status (Gold-API has no rate limiting)
 */
export interface RateLimitStatus {
  monthlyCalls: number;
  monthlyLimit: number;
  monthlyRemaining: number;
  monthlyResetTime: number;
}

/**
 * API Error with retry information
 */
export class GoldAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "GoldAPIError";
  }
}


/**
 * Valid commodity symbols set for validation
 */
const VALID_SYMBOLS = new Set<CommoditySymbol>(["XAU", "XAG", "XPT", "XPD"]);

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if error is retryable based on HTTP status
 */
function isRetryableError(statusCode?: number): boolean {
  if (!statusCode) return true; // Network errors are retryable
  if (statusCode === 429) return true; // Rate limit - retry with backoff
  return statusCode >= 500; // Server errors are retryable
}

/**
 * Make HTTP request with retry logic and exponential backoff
 * Requirements: 2.4, 5.2, 5.4
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success - return response
      if (response.ok) {
        return response;
      }

      // Check if error is retryable
      if (!isRetryableError(response.status)) {
        throw new GoldAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Retryable error - retry with backoff
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Gold-API attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new GoldAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable GoldAPIError
      if (error instanceof GoldAPIError && !error.retryable) {
        throw error;
      }

      // Abort error (timeout)
      if ((error as Error).name === "AbortError") {
        if (attempt < retries) {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
          console.log(
            `Gold-API attempt ${attempt + 1} timed out. Retrying in ${delay}ms...`
          );
          await sleep(delay);
          continue;
        }
        throw new GoldAPIError(
          `API request timed out after ${retries + 1} attempts`,
          undefined,
          true
        );
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Gold-API attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new GoldAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}


/**
 * Validate commodity symbol
 */
function isValidSymbol(symbol: string): symbol is CommoditySymbol {
  return VALID_SYMBOLS.has(symbol as CommoditySymbol);
}

/**
 * Get rate limit status
 * Gold-API has no rate limiting for real-time prices
 * Returns unlimited status for compatibility
 * Requirements: 4.2
 */
export function getRateLimitStatus(): RateLimitStatus {
  return {
    monthlyCalls: 0,
    monthlyLimit: Infinity,
    monthlyRemaining: Infinity,
    monthlyResetTime: 0,
  };
}

/**
 * Gold-API response structure
 */
interface GoldAPIResponse {
  name: string;
  price: number;
  symbol: string;
  updatedAt: string;
  updatedAtReadable: string;
}

/**
 * Transform Gold-API response to CommodityQuote
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
 * Fetch current commodity price
 * Uses Gold-API price endpoint
 * Requirements: 2.2, 2.5, 2.6
 * 
 * @param symbol - Commodity symbol (XAU, XAG, XPT, XPD)
 * @returns Commodity quote data
 */
export async function fetchCommodityQuote(
  symbol: CommoditySymbol
): Promise<CommodityQuote> {
  // Validate symbol
  if (!isValidSymbol(symbol)) {
    throw new GoldAPIError(
      `Unsupported commodity symbol: ${symbol}. Supported symbols: XAU, XAG, XPT, XPD`,
      400,
      false
    );
  }

  const url = `${GOLDAPI_BASE_URL}/${symbol}`;

  try {
    const response = await fetchWithRetry(url);
    const data: GoldAPIResponse = await response.json();

    // Validate response structure
    if (!data.price || !data.symbol) {
      throw new GoldAPIError(
        `Invalid response structure for ${symbol}`,
        500,
        true
      );
    }

    return transformToCommodityQuote(data);
  } catch (error) {
    if (error instanceof GoldAPIError) {
      throw error;
    }
    throw new GoldAPIError(
      `Failed to fetch quote for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}


/**
 * Fetch historical commodity data
 * Note: Gold-API free tier may not support historical data
 * Returns empty data array for compatibility
 * Requirements: 2.2
 * 
 * @param symbol - Commodity symbol (XAU, XAG, XPT, XPD)
 * @param startDate - Start date (YYYY-MM-DD) - not used
 * @param endDate - End date (YYYY-MM-DD) - not used
 * @returns Historical data (empty for free tier)
 */
export async function fetchHistoricalData(
  symbol: CommoditySymbol,
  _startDate: string,
  _endDate: string
): Promise<CommodityHistoricalData> {
  // Validate symbol
  if (!isValidSymbol(symbol)) {
    throw new GoldAPIError(
      `Unsupported commodity symbol: ${symbol}. Supported symbols: XAU, XAG, XPT, XPD`,
      400,
      false
    );
  }

  // Gold-API free tier does not support historical data
  // Return empty data array for compatibility
  const commodityNames: Record<CommoditySymbol, string> = {
    XAU: "Gold",
    XAG: "Silver",
    XPT: "Platinum",
    XPD: "Palladium",
  };

  return {
    symbol,
    name: commodityNames[symbol],
    data: [],
  };
}

/**
 * Fetch quotes for multiple commodities in batch
 * Makes parallel API calls for each symbol
 * Requirements: 2.3
 * 
 * @param symbols - Array of commodity symbols
 * @returns Map of symbol to quote (or error)
 */
export async function fetchBatchQuotes(
  symbols: CommoditySymbol[]
): Promise<Map<CommoditySymbol, CommodityQuote | Error>> {
  const results = new Map<CommoditySymbol, CommodityQuote | Error>();

  // Make parallel requests for all symbols
  const promises = symbols.map(async (symbol) => {
    try {
      const quote = await fetchCommodityQuote(symbol);
      return { symbol, result: quote };
    } catch (error) {
      return { symbol, result: error as Error };
    }
  });

  const responses = await Promise.all(promises);

  // Populate results map
  for (const { symbol, result } of responses) {
    results.set(symbol, result);
  }

  return results;
}
