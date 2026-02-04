// =====================================================
// CoinCap Cryptocurrency Price API Client
// =====================================================
// Provides crypto price fetching with symbol-to-ID mapping,
// batch operations, error handling, and retry logic
// Replaces CoinGecko client with identical interface
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 5.1, 5.2, 5.3, 5.4

const COINCAP_BASE_URL = "https://api.coincap.io/v2";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const REQUEST_TIMEOUT = 10000; // 10 seconds

/**
 * Cryptocurrency quote response
 */
export interface CryptoQuote {
  symbol: string;
  id: string;
  price: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

/**
 * Historical data point for crypto
 */
export interface CryptoHistoricalDataPoint {
  timestamp: number;
  price: number;
  marketCap: number;
  volume: number;
}

/**
 * Historical data response
 */
export interface CryptoHistoricalData {
  symbol: string;
  id: string;
  data: CryptoHistoricalDataPoint[];
}

/**
 * Symbol to CoinCap ID mapping entry
 */
export interface CoinMapping {
  id: string;
  symbol: string;
  name: string;
}

/**
 * API Error with retry information
 * Matches CoinGeckoAPIError structure for backward compatibility
 */
export class CoinCapAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "CoinCapAPIError";
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
 * Make HTTP request with retry logic and timeout
 * Implements exponential backoff (max 3 retries)
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
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
        throw new CoinCapAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Rate limit or server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `CoinCap attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new CoinCapAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable CoinCapAPIError
      if (error instanceof CoinCapAPIError && !error.retryable) {
        throw error;
      }

      // Timeout or network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `CoinCap attempt ${attempt + 1} failed with error: ${(error as Error).message}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new CoinCapAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}


/**
 * In-memory cache for symbol-to-ID mappings
 * CoinCap uses IDs (e.g., "bitcoin") not symbols (e.g., "BTC")
 */
let coinListCache: CoinMapping[] | null = null;
let coinListCacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * CoinCap asset response structure
 */
interface CoinCapAsset {
  id: string;
  rank: string;
  symbol: string;
  name: string;
  supply: string;
  maxSupply: string | null;
  marketCapUsd: string;
  volumeUsd24Hr: string;
  priceUsd: string;
  changePercent24Hr: string;
  vwap24Hr: string | null;
}

/**
 * Fetch complete list of coins from CoinCap
 * Cached for 24 hours to minimize API calls
 * 
 * @param _apiKey - Unused, kept for interface compatibility
 * @returns Array of coin mappings
 */
export async function fetchCoinList(_apiKey?: string): Promise<CoinMapping[]> {
  // Return cached data if still valid
  const now = Date.now();
  if (coinListCache && now - coinListCacheTime < CACHE_TTL) {
    return coinListCache;
  }

  const url = `${COINCAP_BASE_URL}/assets?limit=2000`;

  try {
    const response = await fetchWithRetry(url);
    const json = await response.json();

    if (!json.data || !Array.isArray(json.data)) {
      throw new CoinCapAPIError(
        "Invalid coin list response structure",
        undefined,
        false
      );
    }

    const mappedCoins: CoinMapping[] = json.data.map((coin: CoinCapAsset) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
    }));
    coinListCache = mappedCoins;
    coinListCacheTime = now;

    return mappedCoins;
  } catch (error) {
    if (error instanceof CoinCapAPIError) {
      throw error;
    }
    throw new CoinCapAPIError(
      `Failed to fetch coin list: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Map cryptocurrency symbol to CoinCap ID
 * Example: "BTC" -> "bitcoin", "ETH" -> "ethereum"
 * 
 * @param symbol - Crypto symbol (e.g., "BTC", "ETH")
 * @param apiKey - Unused, kept for interface compatibility
 * @returns CoinCap ID or null if not found
 */
export async function symbolToId(
  symbol: string,
  apiKey?: string
): Promise<string | null> {
  const coinList = await fetchCoinList(apiKey);
  const normalizedSymbol = symbol.toUpperCase();

  // Find exact match
  const coin = coinList.find((c) => c.symbol === normalizedSymbol);
  return coin ? coin.id : null;
}

/**
 * Map multiple symbols to IDs in batch
 * 
 * @param symbols - Array of crypto symbols
 * @param apiKey - Unused, kept for interface compatibility
 * @returns Map of symbol to ID (or null if not found)
 */
export async function symbolsToIds(
  symbols: string[],
  apiKey?: string
): Promise<Map<string, string | null>> {
  const coinList = await fetchCoinList(apiKey);
  const results = new Map<string, string | null>();

  for (const symbol of symbols) {
    const normalizedSymbol = symbol.toUpperCase();
    const coin = coinList.find((c) => c.symbol === normalizedSymbol);
    results.set(symbol, coin ? coin.id : null);
  }

  return results;
}


/**
 * Transform CoinCap asset response to CryptoQuote interface
 */
function transformToCryptoQuote(asset: CoinCapAsset): CryptoQuote {
  const price = parseFloat(asset.priceUsd) || 0;
  const changePercent = parseFloat(asset.changePercent24Hr) || 0;
  const marketCap = parseFloat(asset.marketCapUsd) || 0;
  const volume24h = parseFloat(asset.volumeUsd24Hr) || 0;
  const change24h = (price * changePercent) / 100;

  return {
    symbol: asset.symbol.toUpperCase(),
    id: asset.id,
    price: Number(price.toFixed(8)),
    marketCap: Number(marketCap.toFixed(2)),
    volume24h: Number(volume24h.toFixed(2)),
    change24h: Number(change24h.toFixed(8)),
    changePercent24h: Number(changePercent.toFixed(2)),
    high24h: price, // CoinCap doesn't provide 24h high/low
    low24h: price,
    timestamp: Date.now(),
  };
}

/**
 * Fetch current cryptocurrency price by ID
 * Uses CoinCap /v2/assets/{id} endpoint
 * 
 * @param id - CoinCap coin ID (e.g., "bitcoin")
 * @param _apiKey - Unused, kept for interface compatibility
 * @returns Crypto quote data
 */
export async function fetchCryptoQuote(
  id: string,
  _apiKey?: string
): Promise<CryptoQuote> {
  const url = `${COINCAP_BASE_URL}/assets/${id}`;

  try {
    const response = await fetchWithRetry(url);
    const json = await response.json();

    if (!json.data) {
      throw new CoinCapAPIError(
        `No data found for coin ID: ${id}`,
        404,
        false
      );
    }

    return transformToCryptoQuote(json.data);
  } catch (error) {
    if (error instanceof CoinCapAPIError) {
      throw error;
    }
    throw new CoinCapAPIError(
      `Failed to fetch quote for ${id}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch cryptocurrency quote by symbol
 * Convenience method that handles symbol-to-ID mapping
 * 
 * @param symbol - Crypto symbol (e.g., "BTC")
 * @param apiKey - Unused, kept for interface compatibility
 * @returns Crypto quote data
 */
export async function fetchCryptoQuoteBySymbol(
  symbol: string,
  apiKey?: string
): Promise<CryptoQuote> {
  const id = await symbolToId(symbol, apiKey);

  if (!id) {
    throw new CoinCapAPIError(
      `Unknown cryptocurrency symbol: ${symbol}`,
      404,
      false
    );
  }

  return fetchCryptoQuote(id, apiKey);
}


/**
 * Fetch quotes for multiple cryptocurrencies in batch
 * Uses CoinCap's batch endpoint for efficiency
 * 
 * @param ids - Array of CoinCap coin IDs
 * @param _apiKey - Unused, kept for interface compatibility
 * @returns Map of ID to quote (or error)
 */
export async function fetchBatchQuotes(
  ids: string[],
  _apiKey?: string
): Promise<Map<string, CryptoQuote | Error>> {
  const results = new Map<string, CryptoQuote | Error>();

  if (ids.length === 0) {
    return results;
  }

  // CoinCap allows batch fetching via ids parameter
  const url = `${COINCAP_BASE_URL}/assets?ids=${ids.join(",")}`;

  try {
    const response = await fetchWithRetry(url);
    const json = await response.json();

    if (!json.data || !Array.isArray(json.data)) {
      // Mark all IDs as errors
      for (const id of ids) {
        results.set(
          id,
          new CoinCapAPIError("Invalid batch response structure", undefined, false)
        );
      }
      return results;
    }

    // Create a map of returned assets by ID
    const assetMap = new Map<string, CoinCapAsset>();
    for (const asset of json.data) {
      assetMap.set(asset.id, asset);
    }

    // Process each requested ID
    for (const id of ids) {
      const asset = assetMap.get(id);
      if (asset) {
        results.set(id, transformToCryptoQuote(asset));
      } else {
        results.set(
          id,
          new CoinCapAPIError(`No data found for coin ID: ${id}`, 404, false)
        );
      }
    }
  } catch (error) {
    // If batch request fails, mark all IDs as errors
    for (const id of ids) {
      results.set(id, error as Error);
    }
  }

  return results;
}

/**
 * Fetch quotes for multiple cryptocurrencies by symbols
 * Convenience method that handles symbol-to-ID mapping
 * 
 * @param symbols - Array of crypto symbols
 * @param apiKey - Unused, kept for interface compatibility
 * @returns Map of symbol to quote (or error)
 */
export async function fetchBatchQuotesBySymbols(
  symbols: string[],
  apiKey?: string
): Promise<Map<string, CryptoQuote | Error>> {
  const results = new Map<string, CryptoQuote | Error>();

  if (symbols.length === 0) {
    return results;
  }

  // Map symbols to IDs
  const symbolToIdMap = await symbolsToIds(symbols, apiKey);

  // Collect valid IDs
  const validIds: string[] = [];
  const idToSymbolMap = new Map<string, string>();

  for (const [symbol, id] of symbolToIdMap.entries()) {
    if (id) {
      validIds.push(id);
      idToSymbolMap.set(id, symbol);
    } else {
      results.set(
        symbol,
        new CoinCapAPIError(`Unknown cryptocurrency symbol: ${symbol}`, 404, false)
      );
    }
  }

  // Fetch quotes for valid IDs
  if (validIds.length > 0) {
    const idResults = await fetchBatchQuotes(validIds, apiKey);

    // Map results back to symbols
    for (const [id, result] of idResults.entries()) {
      const symbol = idToSymbolMap.get(id);
      if (symbol) {
        results.set(symbol, result);
      }
    }
  }

  return results;
}


/**
 * Fetch historical cryptocurrency data
 * Uses CoinCap /v2/assets/{id}/history endpoint
 * 
 * @param id - CoinCap coin ID (e.g., "bitcoin")
 * @param days - Number of days of data (1, 7, 14, 30, 90, 180, 365, max)
 * @param _apiKey - Unused, kept for interface compatibility
 * @returns Historical data points
 */
export async function fetchHistoricalData(
  id: string,
  days: number | "max" = 30,
  _apiKey?: string
): Promise<CryptoHistoricalData> {
  // Calculate time range
  const now = Date.now();
  let start: number;
  let interval: string;

  if (days === "max") {
    // Get data from 2010 (Bitcoin genesis)
    start = new Date("2010-01-01").getTime();
    interval = "d1"; // Daily for max range
  } else {
    start = now - days * 24 * 60 * 60 * 1000;
    // Choose interval based on days
    if (days <= 1) {
      interval = "m5"; // 5 minutes for 1 day
    } else if (days <= 7) {
      interval = "h1"; // 1 hour for up to 7 days
    } else if (days <= 30) {
      interval = "h2"; // 2 hours for up to 30 days
    } else {
      interval = "d1"; // Daily for longer periods
    }
  }

  const url = `${COINCAP_BASE_URL}/assets/${id}/history?interval=${interval}&start=${start}&end=${now}`;

  try {
    const response = await fetchWithRetry(url);
    const json = await response.json();

    if (!json.data || !Array.isArray(json.data)) {
      throw new CoinCapAPIError(
        `No historical data available for ${id}`,
        undefined,
        false
      );
    }

    // Get symbol from coin list cache
    const coinList = await fetchCoinList();
    const coin = coinList.find((c) => c.id === id);
    const symbol = coin?.symbol || "";

    // Transform results
    const dataPoints: CryptoHistoricalDataPoint[] = json.data.map(
      (item: { priceUsd: string; time: number }) => ({
        timestamp: item.time,
        price: parseFloat(item.priceUsd) || 0,
        marketCap: 0, // CoinCap history doesn't include market cap
        volume: 0, // CoinCap history doesn't include volume
      })
    );

    return {
      symbol,
      id,
      data: dataPoints,
    };
  } catch (error) {
    if (error instanceof CoinCapAPIError) {
      throw error;
    }
    throw new CoinCapAPIError(
      `Failed to fetch historical data for ${id}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}
