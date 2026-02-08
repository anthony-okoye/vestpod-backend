// =====================================================
// Market Data Aggregator Component
// =====================================================
// Fetches and consolidates external market intelligence
// Requirements: 4.1, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 9.1

import {
  fetchStockQuote,
  fetchHistoricalData,
  AlphaVantageQuote,
  AlphaVantageHistoricalData,
} from "./alphavantage-client.ts";

const CACHE_TTL_BENCHMARK = 15 * 60 * 1000; // 15 minutes
const CACHE_TTL_MACRO = 60 * 60 * 1000; // 1 hour
const CACHE_TTL_HISTORICAL = 24 * 60 * 60 * 1000; // 1 day

/**
 * Benchmark data (S&P 500)
 */
export interface BenchmarkData {
  symbol: string;
  currentPrice: number;
  changePercent: number;
  period: string;
  timestamp: number;
}

/**
 * Macro-economic indicators
 */
export interface MacroIndicators {
  fedFundsRate: number;
  vixIndex: number;
  cpiInflation: number;
  lastUpdated: number;
}

/**
 * Historical data point
 */
export interface HistoricalDataPoint {
  date: string;
  price: number;
}

/**
 * Historical data response
 */
export interface HistoricalData {
  symbol: string;
  period: "30D" | "12W" | "12M";
  dataPoints: HistoricalDataPoint[];
}

/**
 * Market data aggregation error
 */
export class MarketDataError extends Error {
  constructor(
    message: string,
    public source: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

/**
 * Cache entry
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * In-memory cache
 */
class DataCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Market Data Aggregator class
 * Fetches and caches external market data
 */
export class MarketDataAggregator {
  private cache = new DataCache();
  private alphaVantageApiKey: string;

  constructor(alphaVantageApiKey: string) {
    this.alphaVantageApiKey = alphaVantageApiKey;
  }

  /**
   * Fetch S&P 500 benchmark data
   * Uses Alpha Vantage API
   * 
   * @param period - Time period (30D, 12W, 12M)
   * @returns Benchmark data
   */
  async fetchBenchmarkData(period: string): Promise<BenchmarkData | null> {
    const cacheKey = `benchmark:${period}`;

    // Check cache
    const cached = this.cache.get<BenchmarkData>(cacheKey);
    if (cached) {
      console.log(`Benchmark data cache hit for ${period}`);
      return cached;
    }

    try {
      // Fetch S&P 500 quote (symbol: ^GSPC)
      const quote = await fetchStockQuote("SPY", this.alphaVantageApiKey);

      const benchmarkData: BenchmarkData = {
        symbol: "^GSPC",
        currentPrice: quote.price,
        changePercent: quote.changePercent,
        period,
        timestamp: Date.now(),
      };

      // Cache result
      this.cache.set(cacheKey, benchmarkData, CACHE_TTL_BENCHMARK);

      console.log(`Benchmark data fetched for ${period}: ${quote.changePercent.toFixed(2)}%`);

      return benchmarkData;
    } catch (error) {
      console.error("Failed to fetch benchmark data:", error);
      
      // Try to return stale cache if available
      const staleCache = this.cache.get<BenchmarkData>(cacheKey);
      if (staleCache) {
        console.log("Returning stale benchmark data from cache");
        return staleCache;
      }

      return null; // Graceful degradation
    }
  }

  /**
   * Fetch macro-economic indicators
   * Uses Alpha Vantage for VIX, hardcoded estimates for Fed rate and CPI
   * (In production, use FRED API for Fed rate and CPI)
   * 
   * @returns Macro indicators
   */
  async fetchMacroIndicators(): Promise<MacroIndicators | null> {
    const cacheKey = "macro:indicators";

    // Check cache
    const cached = this.cache.get<MacroIndicators>(cacheKey);
    if (cached) {
      console.log("Macro indicators cache hit");
      return cached;
    }

    try {
      // Fetch VIX from Alpha Vantage
      let vixIndex = 20.0; // Default fallback
      try {
        const vixQuote = await fetchStockQuote("VIX", this.alphaVantageApiKey);
        vixIndex = vixQuote.price;
      } catch (error) {
        console.warn("Failed to fetch VIX, using default:", error);
      }

      // TODO: In production, fetch from FRED API
      // For now, use reasonable estimates
      const macroIndicators: MacroIndicators = {
        fedFundsRate: 5.33, // Current Fed funds rate (as of Feb 2026)
        vixIndex,
        cpiInflation: 3.1, // Year-over-year CPI
        lastUpdated: Date.now(),
      };

      // Cache result
      this.cache.set(cacheKey, macroIndicators, CACHE_TTL_MACRO);

      console.log(
        `Macro indicators fetched: Fed=${macroIndicators.fedFundsRate}%, VIX=${macroIndicators.vixIndex.toFixed(1)}, CPI=${macroIndicators.cpiInflation}%`
      );

      return macroIndicators;
    } catch (error) {
      console.error("Failed to fetch macro indicators:", error);
      
      // Try to return stale cache if available
      const staleCache = this.cache.get<MacroIndicators>(cacheKey);
      if (staleCache) {
        console.log("Returning stale macro indicators from cache");
        return staleCache;
      }

      return null; // Graceful degradation
    }
  }

  /**
   * Fetch historical price data for asset
   * Uses Alpha Vantage API
   * 
   * @param symbol - Asset symbol
   * @param period - Time period (30D, 12W, 12M)
   * @returns Historical data
   */
  async fetchHistoricalData(
    symbol: string,
    period: "30D" | "12W" | "12M"
  ): Promise<HistoricalData | null> {
    const cacheKey = `historical:${symbol}:${period}`;

    // Check cache
    const cached = this.cache.get<HistoricalData>(cacheKey);
    if (cached) {
      console.log(`Historical data cache hit for ${symbol} (${period})`);
      return cached;
    }

    try {
      // Fetch historical data from Alpha Vantage
      const historicalResponse = await fetchHistoricalData(
        symbol,
        this.alphaVantageApiKey,
        "compact" // 100 data points
      );

      // Filter data based on period
      const now = Date.now();
      let cutoffTime: number;

      switch (period) {
        case "30D":
          cutoffTime = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case "12W":
          cutoffTime = now - 12 * 7 * 24 * 60 * 60 * 1000;
          break;
        case "12M":
          cutoffTime = now - 12 * 30 * 24 * 60 * 60 * 1000;
          break;
      }

      const filteredData = historicalResponse.data
        .filter((point) => point.timestamp >= cutoffTime)
        .map((point) => ({
          date: new Date(point.timestamp).toISOString().split("T")[0],
          price: point.close,
        }));

      const historicalData: HistoricalData = {
        symbol,
        period,
        dataPoints: filteredData,
      };

      // Cache result
      this.cache.set(cacheKey, historicalData, CACHE_TTL_HISTORICAL);

      console.log(
        `Historical data fetched for ${symbol} (${period}): ${filteredData.length} points`
      );

      return historicalData;
    } catch (error) {
      console.error(`Failed to fetch historical data for ${symbol}:`, error);
      
      // Try to return stale cache if available
      const staleCache = this.cache.get<HistoricalData>(cacheKey);
      if (staleCache) {
        console.log(`Returning stale historical data for ${symbol} from cache`);
        return staleCache;
      }

      return null; // Graceful degradation
    }
  }

  /**
   * Calculate Pearson correlation matrix for assets
   * Uses historical price data
   * 
   * @param symbols - Array of asset symbols
   * @returns NxN correlation matrix
   */
  async calculateCorrelationMatrix(
    symbols: string[]
  ): Promise<number[][] | null> {
    try {
      // Fetch historical data for all assets
      const historicalDataPromises = symbols.map((symbol) =>
        this.fetchHistoricalData(symbol, "30D")
      );

      const historicalDataResults = await Promise.all(historicalDataPromises);

      // Filter out null results
      const validData = historicalDataResults.filter(
        (data): data is HistoricalData => data !== null
      );

      if (validData.length < 2) {
        console.warn("Not enough historical data to calculate correlation matrix");
        return null;
      }

      // Build price arrays aligned by date
      const priceArrays: number[][] = [];
      const commonDates = this.findCommonDates(validData);

      for (const data of validData) {
        const prices: number[] = [];
        for (const date of commonDates) {
          const point = data.dataPoints.find((p) => p.date === date);
          if (point) {
            prices.push(point.price);
          }
        }
        priceArrays.push(prices);
      }

      // Calculate correlation matrix
      const n = priceArrays.length;
      const correlationMatrix: number[][] = [];

      for (let i = 0; i < n; i++) {
        const row: number[] = [];
        for (let j = 0; j < n; j++) {
          if (i === j) {
            row.push(1.0); // Perfect correlation with self
          } else {
            const correlation = this.calculatePearsonCorrelation(
              priceArrays[i],
              priceArrays[j]
            );
            row.push(correlation);
          }
        }
        correlationMatrix.push(row);
      }

      console.log(`Correlation matrix calculated for ${n} assets`);

      return correlationMatrix;
    } catch (error) {
      console.error("Failed to calculate correlation matrix:", error);
      return null; // Graceful degradation
    }
  }

  /**
   * Find common dates across all historical data
   */
  private findCommonDates(historicalData: HistoricalData[]): string[] {
    if (historicalData.length === 0) return [];

    // Start with dates from first asset
    let commonDates = new Set(historicalData[0].dataPoints.map((p) => p.date));

    // Intersect with dates from other assets
    for (let i = 1; i < historicalData.length; i++) {
      const dates = new Set(historicalData[i].dataPoints.map((p) => p.date));
      commonDates = new Set([...commonDates].filter((date) => dates.has(date)));
    }

    return Array.from(commonDates).sort();
  }

  /**
   * Calculate Pearson correlation coefficient
   * 
   * @param x - First price array
   * @param y - Second price array
   * @returns Correlation coefficient (-1 to 1)
   */
  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) {
      return 0;
    }

    const n = x.length;

    // Calculate means
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    // Calculate covariance and standard deviations
    let covariance = 0;
    let stdX = 0;
    let stdY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      covariance += dx * dy;
      stdX += dx * dx;
      stdY += dy * dy;
    }

    stdX = Math.sqrt(stdX);
    stdY = Math.sqrt(stdY);

    // Avoid division by zero
    if (stdX === 0 || stdY === 0) {
      return 0;
    }

    return covariance / (stdX * stdY);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    console.log("Market data cache cleared");
  }
}
