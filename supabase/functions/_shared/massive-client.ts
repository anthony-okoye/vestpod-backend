// =====================================================
// Massive.com (Polygon.io) Stock Price API Client
// =====================================================
// Provides stock quote and historical data fetching
// with error handling and retry logic
// Requirements: 3, 5

const POLYGON_BASE_URL = "https://api.polygon.io";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Stock quote response from Polygon.io snapshot API
 */
export interface StockQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  previousClose: number;
  change: number;
  changePercent: number;
}

/**
 * Historical data point (OHLC)
 */
export interface HistoricalDataPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Historical data response
 */
export interface HistoricalData {
  symbol: string;
  data: HistoricalDataPoint[];
}

/**
 * API Error with retry information
 */
export class MassiveAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "MassiveAPIError";
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
  return statusCode === 429 || statusCode >= 500;
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
        throw new MassiveAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Rate limit or server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new MassiveAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable error
      if (error instanceof MassiveAPIError && !error.retryable) {
        throw error;
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new MassiveAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}

/**
 * Fetch current stock quote
 * Uses Polygon.io snapshot API: /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}
 * 
 * @param symbol - Stock ticker symbol (e.g., "AAPL")
 * @param apiKey - Polygon.io API key
 * @returns Stock quote data
 */
export async function fetchStockQuote(
  symbol: string,
  apiKey: string
): Promise<StockQuote> {
  const url = `${POLYGON_BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/${symbol.toUpperCase()}?apiKey=${apiKey}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Validate response structure
    if (!data.ticker) {
      throw new MassiveAPIError(
        `Invalid response structure for symbol ${symbol}`,
        undefined,
        false
      );
    }

    const ticker = data.ticker;
    const day = ticker.day || {};
    const prevDay = ticker.prevDay || {};
    const lastTrade = ticker.lastTrade || {};

    // Calculate change
    const currentPrice = lastTrade.p || day.c || 0;
    const previousClose = prevDay.c || 0;
    const change = currentPrice - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    return {
      symbol: ticker.ticker,
      price: currentPrice,
      open: day.o || 0,
      high: day.h || 0,
      low: day.l || 0,
      close: day.c || currentPrice,
      volume: day.v || 0,
      timestamp: lastTrade.t || Date.now(),
      previousClose,
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
    };
  } catch (error) {
    if (error instanceof MassiveAPIError) {
      throw error;
    }
    throw new MassiveAPIError(
      `Failed to fetch quote for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch historical stock data
 * Uses Polygon.io aggregates API: /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
 * 
 * @param symbol - Stock ticker symbol (e.g., "AAPL")
 * @param from - Start date (YYYY-MM-DD)
 * @param to - End date (YYYY-MM-DD)
 * @param timespan - Time interval: "minute", "hour", "day", "week", "month", "quarter", "year"
 * @param multiplier - Size of timespan multiplier (e.g., 1 for 1 day, 5 for 5 minutes)
 * @param apiKey - Polygon.io API key
 * @returns Historical data points
 */
export async function fetchHistoricalData(
  symbol: string,
  from: string,
  to: string,
  timespan: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year" = "day",
  multiplier = 1,
  apiKey: string
): Promise<HistoricalData> {
  const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol.toUpperCase()}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&apiKey=${apiKey}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Validate response
    if (!data.results || !Array.isArray(data.results)) {
      throw new MassiveAPIError(
        `No historical data available for ${symbol} from ${from} to ${to}`,
        undefined,
        false
      );
    }

    // Transform results
    const dataPoints: HistoricalDataPoint[] = data.results.map((bar: {
      t: number;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }) => ({
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));

    return {
      symbol: symbol.toUpperCase(),
      data: dataPoints,
    };
  } catch (error) {
    if (error instanceof MassiveAPIError) {
      throw error;
    }
    throw new MassiveAPIError(
      `Failed to fetch historical data for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch quotes for multiple symbols in batch
 * Makes parallel requests with error handling per symbol
 * 
 * @param symbols - Array of stock ticker symbols
 * @param apiKey - Polygon.io API key
 * @returns Map of symbol to quote (or error)
 */
export async function fetchBatchQuotes(
  symbols: string[],
  apiKey: string
): Promise<Map<string, StockQuote | Error>> {
  const results = new Map<string, StockQuote | Error>();

  // Fetch all quotes in parallel
  const promises = symbols.map(async (symbol) => {
    try {
      const quote = await fetchStockQuote(symbol, apiKey);
      results.set(symbol, quote);
    } catch (error) {
      results.set(symbol, error as Error);
    }
  });

  await Promise.all(promises);
  return results;
}
