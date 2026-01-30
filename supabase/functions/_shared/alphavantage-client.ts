// =====================================================
// Alpha Vantage Stock Price API Client (Backup)
// =====================================================
// Provides stock quote and historical data fetching
// with error handling, retry logic, and rate limiting
// Requirements: 3, 5

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Rate limit tracking
const DAILY_LIMIT = 25;
const MINUTE_LIMIT = 5;
const rateLimitState = {
  dailyCalls: 0,
  dailyResetTime: Date.now() + 24 * 60 * 60 * 1000,
  minuteCalls: 0,
  minuteResetTime: Date.now() + 60 * 1000,
};

/**
 * Stock quote response from Alpha Vantage
 */
export interface AlphaVantageQuote {
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
export interface AlphaVantageHistoricalDataPoint {
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
export interface AlphaVantageHistoricalData {
  symbol: string;
  data: AlphaVantageHistoricalDataPoint[];
}

/**
 * API Error with retry information
 */
export class AlphaVantageAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "AlphaVantageAPIError";
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AlphaVantageAPIError {
  constructor(message: string) {
    super(message, 429, false);
    this.name = "RateLimitError";
  }
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

  // Reset daily counter if 24 hours passed
  if (now >= rateLimitState.dailyResetTime) {
    rateLimitState.dailyCalls = 0;
    rateLimitState.dailyResetTime = now + 24 * 60 * 60 * 1000;
  }

  // Reset minute counter if 1 minute passed
  if (now >= rateLimitState.minuteResetTime) {
    rateLimitState.minuteCalls = 0;
    rateLimitState.minuteResetTime = now + 60 * 1000;
  }

  // Check limits
  if (rateLimitState.dailyCalls >= DAILY_LIMIT) {
    return false;
  }

  if (rateLimitState.minuteCalls >= MINUTE_LIMIT) {
    return false;
  }

  // Increment counters
  rateLimitState.dailyCalls++;
  rateLimitState.minuteCalls++;

  return true;
}

/**
 * Get rate limit status
 */
export function getRateLimitStatus() {
  return {
    dailyCalls: rateLimitState.dailyCalls,
    dailyLimit: DAILY_LIMIT,
    dailyRemaining: DAILY_LIMIT - rateLimitState.dailyCalls,
    minuteCalls: rateLimitState.minuteCalls,
    minuteLimit: MINUTE_LIMIT,
    minuteRemaining: MINUTE_LIMIT - rateLimitState.minuteCalls,
    dailyResetTime: rateLimitState.dailyResetTime,
    minuteResetTime: rateLimitState.minuteResetTime,
  };
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
        throw new AlphaVantageAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Alpha Vantage attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new AlphaVantageAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable error
      if (error instanceof AlphaVantageAPIError && !error.retryable) {
        throw error;
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Alpha Vantage attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new AlphaVantageAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}

/**
 * Fetch current stock quote from Alpha Vantage
 * Uses GLOBAL_QUOTE function
 * 
 * @param symbol - Stock ticker symbol (e.g., "AAPL")
 * @param apiKey - Alpha Vantage API key
 * @returns Stock quote data
 */
export async function fetchStockQuote(
  symbol: string,
  apiKey: string
): Promise<AlphaVantageQuote> {
  // Check rate limit
  if (!checkRateLimit()) {
    const status = getRateLimitStatus();
    throw new RateLimitError(
      `Alpha Vantage rate limit exceeded. Daily: ${status.dailyCalls}/${status.dailyLimit}, Minute: ${status.minuteCalls}/${status.minuteLimit}`
    );
  }

  const url = `${ALPHA_VANTAGE_BASE_URL}?function=GLOBAL_QUOTE&symbol=${symbol.toUpperCase()}&apikey=${apiKey}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API error messages
    if (data["Error Message"]) {
      throw new AlphaVantageAPIError(
        `Invalid symbol: ${symbol}`,
        400,
        false
      );
    }

    if (data["Note"]) {
      throw new RateLimitError(
        "Alpha Vantage API rate limit exceeded (API response)"
      );
    }

    // Validate response structure
    const quote = data["Global Quote"];
    if (!quote || !quote["01. symbol"]) {
      throw new AlphaVantageAPIError(
        `Invalid response structure for symbol ${symbol}`,
        undefined,
        false
      );
    }

    // Parse values
    const price = parseFloat(quote["05. price"] || "0");
    const open = parseFloat(quote["02. open"] || "0");
    const high = parseFloat(quote["03. high"] || "0");
    const low = parseFloat(quote["04. low"] || "0");
    const volume = parseInt(quote["06. volume"] || "0", 10);
    const previousClose = parseFloat(quote["08. previous close"] || "0");
    const change = parseFloat(quote["09. change"] || "0");
    const changePercentStr = quote["10. change percent"] || "0%";
    const changePercent = parseFloat(changePercentStr.replace("%", ""));

    // Parse timestamp from latest trading day
    const latestTradingDay = quote["07. latest trading day"];
    const timestamp = latestTradingDay
      ? new Date(latestTradingDay).getTime()
      : Date.now();

    return {
      symbol: quote["01. symbol"],
      price,
      open,
      high,
      low,
      close: price,
      volume,
      timestamp,
      previousClose,
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
    };
  } catch (error) {
    if (error instanceof AlphaVantageAPIError) {
      throw error;
    }
    throw new AlphaVantageAPIError(
      `Failed to fetch quote for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch historical stock data from Alpha Vantage
 * Uses TIME_SERIES_DAILY function
 * 
 * @param symbol - Stock ticker symbol (e.g., "AAPL")
 * @param apiKey - Alpha Vantage API key
 * @param outputSize - "compact" (100 data points) or "full" (20+ years)
 * @returns Historical data points
 */
export async function fetchHistoricalData(
  symbol: string,
  apiKey: string,
  outputSize: "compact" | "full" = "compact"
): Promise<AlphaVantageHistoricalData> {
  // Check rate limit
  if (!checkRateLimit()) {
    const status = getRateLimitStatus();
    throw new RateLimitError(
      `Alpha Vantage rate limit exceeded. Daily: ${status.dailyCalls}/${status.dailyLimit}, Minute: ${status.minuteCalls}/${status.minuteLimit}`
    );
  }

  const url = `${ALPHA_VANTAGE_BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol.toUpperCase()}&outputsize=${outputSize}&apikey=${apiKey}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Check for API error messages
    if (data["Error Message"]) {
      throw new AlphaVantageAPIError(
        `Invalid symbol: ${symbol}`,
        400,
        false
      );
    }

    if (data["Note"]) {
      throw new RateLimitError(
        "Alpha Vantage API rate limit exceeded (API response)"
      );
    }

    // Validate response structure
    const timeSeries = data["Time Series (Daily)"];
    if (!timeSeries) {
      throw new AlphaVantageAPIError(
        `No historical data available for ${symbol}`,
        undefined,
        false
      );
    }

    // Transform results
    const dataPoints: AlphaVantageHistoricalDataPoint[] = [];
    for (const [date, values] of Object.entries(timeSeries)) {
      const timestamp = new Date(date).getTime();
      const open = parseFloat((values as Record<string, string>)["1. open"] || "0");
      const high = parseFloat((values as Record<string, string>)["2. high"] || "0");
      const low = parseFloat((values as Record<string, string>)["3. low"] || "0");
      const close = parseFloat((values as Record<string, string>)["4. close"] || "0");
      const volume = parseInt((values as Record<string, string>)["5. volume"] || "0", 10);

      dataPoints.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    // Sort by timestamp ascending
    dataPoints.sort((a, b) => a.timestamp - b.timestamp);

    return {
      symbol: symbol.toUpperCase(),
      data: dataPoints,
    };
  } catch (error) {
    if (error instanceof AlphaVantageAPIError) {
      throw error;
    }
    throw new AlphaVantageAPIError(
      `Failed to fetch historical data for ${symbol}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch quotes for multiple symbols in batch
 * Makes sequential requests with rate limiting
 * 
 * @param symbols - Array of stock ticker symbols
 * @param apiKey - Alpha Vantage API key
 * @returns Map of symbol to quote (or error)
 */
export async function fetchBatchQuotes(
  symbols: string[],
  apiKey: string
): Promise<Map<string, AlphaVantageQuote | Error>> {
  const results = new Map<string, AlphaVantageQuote | Error>();

  // Alpha Vantage has strict rate limits (5 per minute)
  // Process sequentially with delays
  for (const symbol of symbols) {
    try {
      const quote = await fetchStockQuote(symbol, apiKey);
      results.set(symbol, quote);

      // Add delay between requests to respect rate limit (12 seconds = 5 per minute)
      if (symbols.indexOf(symbol) < symbols.length - 1) {
        await sleep(12000);
      }
    } catch (error) {
      results.set(symbol, error as Error);

      // If rate limit error, stop processing
      if (error instanceof RateLimitError) {
        console.log("Rate limit reached, stopping batch processing");
        break;
      }
    }
  }

  return results;
}
