// =====================================================
// CoinGecko Cryptocurrency Price API Client
// =====================================================
// Provides crypto price fetching with symbol-to-ID mapping,
// batch operations, error handling, and retry logic
// Requirements: 3, 5

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

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
 * Symbol to CoinGecko ID mapping entry
 */
export interface CoinMapping {
  id: string;
  symbol: string;
  name: string;
}

/**
 * API Error with retry information
 */
export class CoinGeckoAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "CoinGeckoAPIError";
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
        throw new CoinGeckoAPIError(
          `API request failed: ${response.statusText}`,
          response.status,
          false
        );
      }

      // Rate limit or server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `CoinGecko attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      throw new CoinGeckoAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable error
      if (error instanceof CoinGeckoAPIError && !error.retryable) {
        throw error;
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `CoinGecko attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new CoinGeckoAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}

/**
 * In-memory cache for symbol-to-ID mappings
 * CoinGecko uses IDs (e.g., "bitcoin") not symbols (e.g., "BTC")
 */
let coinListCache: CoinMapping[] | null = null;
let coinListCacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch complete list of coins from CoinGecko
 * Cached for 24 hours to minimize API calls
 * 
 * @param apiKey - CoinGecko API key (optional for free tier)
 * @returns Array of coin mappings
 */
export async function fetchCoinList(apiKey?: string): Promise<CoinMapping[]> {
  // Return cached data if still valid
  const now = Date.now();
  if (coinListCache && now - coinListCacheTime < CACHE_TTL) {
    return coinListCache;
  }

  const url = apiKey
    ? `${COINGECKO_BASE_URL}/coins/list?x_cg_demo_api_key=${apiKey}`
    : `${COINGECKO_BASE_URL}/coins/list`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new CoinGeckoAPIError(
        "Invalid coin list response structure",
        undefined,
        false
      );
    }

    coinListCache = data.map((coin: { id: string; symbol: string; name: string }) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
    }));
    coinListCacheTime = now;

    return coinListCache;
  } catch (error) {
    if (error instanceof CoinGeckoAPIError) {
      throw error;
    }
    throw new CoinGeckoAPIError(
      `Failed to fetch coin list: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Map cryptocurrency symbol to CoinGecko ID
 * Example: "BTC" -> "bitcoin", "ETH" -> "ethereum"
 * 
 * @param symbol - Crypto symbol (e.g., "BTC", "ETH")
 * @param apiKey - CoinGecko API key (optional)
 * @returns CoinGecko ID or null if not found
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
 * @param apiKey - CoinGecko API key (optional)
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
 * Fetch current cryptocurrency price
 * Uses CoinGecko simple/price endpoint
 * 
 * @param id - CoinGecko coin ID (e.g., "bitcoin")
 * @param apiKey - CoinGecko API key (optional)
 * @returns Crypto quote data
 */
export async function fetchCryptoQuote(
  id: string,
  apiKey?: string
): Promise<CryptoQuote> {
  const params = new URLSearchParams({
    ids: id,
    vs_currencies: "usd",
    include_market_cap: "true",
    include_24hr_vol: "true",
    include_24hr_change: "true",
    include_last_updated_at: "true",
  });

  if (apiKey) {
    params.append("x_cg_demo_api_key", apiKey);
  }

  const url = `${COINGECKO_BASE_URL}/simple/price?${params.toString()}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Validate response structure
    if (!data[id]) {
      throw new CoinGeckoAPIError(
        `No data found for coin ID: ${id}`,
        404,
        false
      );
    }

    const coinData = data[id];

    // Fetch additional data for high/low
    const detailUrl = apiKey
      ? `${COINGECKO_BASE_URL}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&x_cg_demo_api_key=${apiKey}`
      : `${COINGECKO_BASE_URL}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`;

    const detailResponse = await fetchWithRetry(detailUrl);
    const detailData = await detailResponse.json();

    const price = coinData.usd || 0;
    const marketCap = coinData.usd_market_cap || 0;
    const volume24h = coinData.usd_24h_vol || 0;
    const changePercent24h = coinData.usd_24h_change || 0;
    const change24h = (price * changePercent24h) / 100;
    const high24h = detailData.market_data?.high_24h?.usd || price;
    const low24h = detailData.market_data?.low_24h?.usd || price;
    const timestamp = (coinData.last_updated_at || Date.now() / 1000) * 1000;

    return {
      symbol: detailData.symbol?.toUpperCase() || "",
      id,
      price: Number(price.toFixed(8)),
      marketCap: Number(marketCap.toFixed(2)),
      volume24h: Number(volume24h.toFixed(2)),
      change24h: Number(change24h.toFixed(8)),
      changePercent24h: Number(changePercent24h.toFixed(2)),
      high24h: Number(high24h.toFixed(8)),
      low24h: Number(low24h.toFixed(8)),
      timestamp,
    };
  } catch (error) {
    if (error instanceof CoinGeckoAPIError) {
      throw error;
    }
    throw new CoinGeckoAPIError(
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
 * @param apiKey - CoinGecko API key (optional)
 * @returns Crypto quote data
 */
export async function fetchCryptoQuoteBySymbol(
  symbol: string,
  apiKey?: string
): Promise<CryptoQuote> {
  const id = await symbolToId(symbol, apiKey);

  if (!id) {
    throw new CoinGeckoAPIError(
      `Unknown cryptocurrency symbol: ${symbol}`,
      404,
      false
    );
  }

  return fetchCryptoQuote(id, apiKey);
}

/**
 * Fetch historical cryptocurrency data
 * Uses CoinGecko market_chart endpoint
 * 
 * @param id - CoinGecko coin ID (e.g., "bitcoin")
 * @param days - Number of days of data (1, 7, 14, 30, 90, 180, 365, max)
 * @param apiKey - CoinGecko API key (optional)
 * @returns Historical data points
 */
export async function fetchHistoricalData(
  id: string,
  days: number | "max" = 30,
  apiKey?: string
): Promise<CryptoHistoricalData> {
  const params = new URLSearchParams({
    vs_currency: "usd",
    days: days.toString(),
  });

  if (apiKey) {
    params.append("x_cg_demo_api_key", apiKey);
  }

  const url = `${COINGECKO_BASE_URL}/coins/${id}/market_chart?${params.toString()}`;

  try {
    const response = await fetchWithRetry(url);
    const data = await response.json();

    // Validate response structure
    if (!data.prices || !Array.isArray(data.prices)) {
      throw new CoinGeckoAPIError(
        `No historical data available for ${id}`,
        undefined,
        false
      );
    }

    // Get symbol from coin details
    const detailUrl = apiKey
      ? `${COINGECKO_BASE_URL}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&x_cg_demo_api_key=${apiKey}`
      : `${COINGECKO_BASE_URL}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`;

    const detailResponse = await fetchWithRetry(detailUrl);
    const detailData = await detailResponse.json();
    const symbol = detailData.symbol?.toUpperCase() || "";

    // Transform results
    const dataPoints: CryptoHistoricalDataPoint[] = data.prices.map(
      (item: number[], index: number) => ({
        timestamp: item[0],
        price: item[1],
        marketCap: data.market_caps?.[index]?.[1] || 0,
        volume: data.total_volumes?.[index]?.[1] || 0,
      })
    );

    return {
      symbol,
      id,
      data: dataPoints,
    };
  } catch (error) {
    if (error instanceof CoinGeckoAPIError) {
      throw error;
    }
    throw new CoinGeckoAPIError(
      `Failed to fetch historical data for ${id}: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Fetch quotes for multiple cryptocurrencies in batch
 * Uses CoinGecko's batch endpoint for efficiency
 * 
 * @param ids - Array of CoinGecko coin IDs
 * @param apiKey - CoinGecko API key (optional)
 * @returns Map of ID to quote (or error)
 */
export async function fetchBatchQuotes(
  ids: string[],
  apiKey?: string
): Promise<Map<string, CryptoQuote | Error>> {
  const results = new Map<string, CryptoQuote | Error>();

  // CoinGecko allows up to 250 IDs per request
  const BATCH_SIZE = 250;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams({
      ids: batch.join(","),
      vs_currencies: "usd",
      include_market_cap: "true",
      include_24hr_vol: "true",
      include_24hr_change: "true",
      include_last_updated_at: "true",
    });

    if (apiKey) {
      params.append("x_cg_demo_api_key", apiKey);
    }

    const url = `${COINGECKO_BASE_URL}/simple/price?${params.toString()}`;

    try {
      const response = await fetchWithRetry(url);
      const data = await response.json();

      // Process each coin in the batch
      for (const id of batch) {
        try {
          if (!data[id]) {
            results.set(
              id,
              new CoinGeckoAPIError(`No data found for coin ID: ${id}`, 404, false)
            );
            continue;
          }

          const coinData = data[id];

          // Fetch symbol from coin list cache
          const coinList = await fetchCoinList(apiKey);
          const coin = coinList.find((c) => c.id === id);
          const symbol = coin?.symbol || "";

          const price = coinData.usd || 0;
          const marketCap = coinData.usd_market_cap || 0;
          const volume24h = coinData.usd_24h_vol || 0;
          const changePercent24h = coinData.usd_24h_change || 0;
          const change24h = (price * changePercent24h) / 100;
          const timestamp = (coinData.last_updated_at || Date.now() / 1000) * 1000;

          results.set(id, {
            symbol,
            id,
            price: Number(price.toFixed(8)),
            marketCap: Number(marketCap.toFixed(2)),
            volume24h: Number(volume24h.toFixed(2)),
            change24h: Number(change24h.toFixed(8)),
            changePercent24h: Number(changePercent24h.toFixed(2)),
            high24h: price, // Batch endpoint doesn't include high/low
            low24h: price,
            timestamp,
          });
        } catch (error) {
          results.set(id, error as Error);
        }
      }
    } catch (error) {
      // If batch request fails, mark all IDs in batch as errors
      for (const id of batch) {
        results.set(id, error as Error);
      }
    }
  }

  return results;
}

/**
 * Fetch quotes for multiple cryptocurrencies by symbols
 * Convenience method that handles symbol-to-ID mapping
 * 
 * @param symbols - Array of crypto symbols
 * @param apiKey - CoinGecko API key (optional)
 * @returns Map of symbol to quote (or error)
 */
export async function fetchBatchQuotesBySymbols(
  symbols: string[],
  apiKey?: string
): Promise<Map<string, CryptoQuote | Error>> {
  const results = new Map<string, CryptoQuote | Error>();

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
        new CoinGeckoAPIError(`Unknown cryptocurrency symbol: ${symbol}`, 404, false)
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
