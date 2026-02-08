// =====================================================
// News Aggregator Component
// =====================================================
// Fetches financial news and calculates sentiment scores
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2

const NEWSAPI_BASE_URL = "https://newsapi.org/v2";
const CACHE_TTL_NEWS = 60 * 60 * 1000; // 1 hour
const MAX_ARTICLES_PER_ASSET = 5;

/**
 * News article structure
 */
export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: string;
}

/**
 * Sentiment analysis result
 */
export interface SentimentAnalysis {
  symbol: string;
  score: number; // -1.0 to +1.0
  magnitude: number; // 0.0 to 1.0 (confidence)
  articles: NewsArticle[];
  lastUpdated: number;
}

/**
 * News aggregation error
 */
export class NewsAggregationError extends Error {
  constructor(
    message: string,
    public symbol: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "NewsAggregationError";
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
class NewsCache {
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
 * News Aggregator class
 * Fetches news and analyzes sentiment
 */
export class NewsAggregator {
  private cache = new NewsCache();
  private newsApiKey: string;
  private geminiApiKey: string;

  constructor(newsApiKey: string, geminiApiKey: string) {
    this.newsApiKey = newsApiKey;
    this.geminiApiKey = geminiApiKey;
  }

  /**
   * Fetch recent news for asset
   * Uses NewsAPI
   * 
   * @param symbol - Asset symbol
   * @param limit - Maximum number of articles
   * @returns Array of news articles
   */
  async fetchNews(
    symbol: string,
    limit: number = MAX_ARTICLES_PER_ASSET
  ): Promise<NewsArticle[]> {
    const cacheKey = `news:${symbol}`;

    // Check cache
    const cached = this.cache.get<NewsArticle[]>(cacheKey);
    if (cached) {
      console.log(`News cache hit for ${symbol}`);
      return cached;
    }

    try {
      // Build search query
      const query = `${symbol} stock OR ${symbol} shares`;
      const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const params = new URLSearchParams({
        q: query,
        from: fromDate,
        sortBy: "relevancy",
        language: "en",
        pageSize: limit.toString(),
        apiKey: this.newsApiKey,
      });

      const url = `${NEWSAPI_BASE_URL}/everything?${params.toString()}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new NewsAggregationError(
          `NewsAPI returned ${response.status}: ${response.statusText}`,
          symbol,
          response.status >= 500
        );
      }

      const data = await response.json();

      if (data.status !== "ok") {
        throw new NewsAggregationError(
          `NewsAPI error: ${data.message || "Unknown error"}`,
          symbol,
          false
        );
      }

      // Transform articles
      const articles: NewsArticle[] = (data.articles || []).map(
        (article: {
          title: string;
          description: string;
          url: string;
          publishedAt: string;
          source: { name: string };
        }) => ({
          title: article.title,
          description: article.description || "",
          url: article.url,
          publishedAt: article.publishedAt,
          source: article.source.name,
        })
      );

      // Cache result
      this.cache.set(cacheKey, articles, CACHE_TTL_NEWS);

      console.log(`Fetched ${articles.length} news articles for ${symbol}`);

      return articles;
    } catch (error) {
      console.error(`Failed to fetch news for ${symbol}:`, error);
      
      // Try to return stale cache if available
      const staleCache = this.cache.get<NewsArticle[]>(cacheKey);
      if (staleCache) {
        console.log(`Returning stale news for ${symbol} from cache`);
        return staleCache;
      }

      return []; // Graceful degradation
    }
  }

  /**
   * Calculate sentiment score for asset
   * Uses Gemini API for NLP sentiment analysis
   * 
   * @param symbol - Asset symbol
   * @param articles - News articles
   * @returns Sentiment analysis
   */
  async analyzeSentiment(
    symbol: string,
    articles: NewsArticle[]
  ): Promise<SentimentAnalysis> {
    const cacheKey = `sentiment:${symbol}`;

    // Check cache
    const cached = this.cache.get<SentimentAnalysis>(cacheKey);
    if (cached) {
      console.log(`Sentiment cache hit for ${symbol}`);
      return cached;
    }

    try {
      if (articles.length === 0) {
        // No articles - return neutral sentiment
        return {
          symbol,
          score: 0.0,
          magnitude: 0.0,
          articles: [],
          lastUpdated: Date.now(),
        };
      }

      // Build sentiment analysis prompt
      const articlesText = articles
        .map(
          (article, index) =>
            `Article ${index + 1}:\nTitle: ${article.title}\nDescription: ${article.description}`
        )
        .join("\n\n");

      const prompt = `Analyze the sentiment of these news articles about ${symbol}:

${articlesText}

Provide a sentiment analysis with:
1. Overall sentiment score from -1.0 (very negative) to +1.0 (very positive)
2. Magnitude from 0.0 to 1.0 indicating confidence in the sentiment

Output Format (JSON only):
{
  "score": <number -1.0 to 1.0>,
  "magnitude": <number 0.0 to 1.0>,
  "reasoning": "<brief explanation>"
}`;

      // Call Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${this.geminiApiKey}`;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
          },
        }),
      });

      if (!response.ok) {
        throw new NewsAggregationError(
          `Gemini API returned ${response.status}`,
          symbol,
          response.status >= 500
        );
      }

      const data = await response.json();

      // Parse response
      const responseText =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      
      let jsonText = responseText.trim();
      if (jsonText.startsWith("```json")) {
        jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
      } else if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/```\n?/g, "");
      }

      const parsed = JSON.parse(jsonText);

      const sentimentAnalysis: SentimentAnalysis = {
        symbol,
        score: Math.max(-1.0, Math.min(1.0, parsed.score || 0.0)),
        magnitude: Math.max(0.0, Math.min(1.0, parsed.magnitude || 0.0)),
        articles,
        lastUpdated: Date.now(),
      };

      // Cache result
      this.cache.set(cacheKey, sentimentAnalysis, CACHE_TTL_NEWS);

      console.log(
        `Sentiment analyzed for ${symbol}: score=${sentimentAnalysis.score.toFixed(2)}, magnitude=${sentimentAnalysis.magnitude.toFixed(2)}`
      );

      return sentimentAnalysis;
    } catch (error) {
      console.error(`Failed to analyze sentiment for ${symbol}:`, error);
      
      // Try to return stale cache if available
      const staleCache = this.cache.get<SentimentAnalysis>(cacheKey);
      if (staleCache) {
        console.log(`Returning stale sentiment for ${symbol} from cache`);
        return staleCache;
      }

      // Return neutral sentiment on failure
      return {
        symbol,
        score: 0.0,
        magnitude: 0.0,
        articles: [],
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Batch analyze sentiment for multiple assets
   * Processes in parallel with individual error handling
   * 
   * @param symbols - Array of asset symbols
   * @returns Map of symbol to sentiment analysis
   */
  async batchAnalyzeSentiment(
    symbols: string[]
  ): Promise<Map<string, SentimentAnalysis>> {
    const results = new Map<string, SentimentAnalysis>();

    // Process all symbols in parallel
    const promises = symbols.map(async (symbol) => {
      try {
        // Fetch news
        const articles = await this.fetchNews(symbol);

        // Analyze sentiment
        const sentiment = await this.analyzeSentiment(symbol, articles);

        return { symbol, sentiment };
      } catch (error) {
        console.error(`Batch sentiment analysis failed for ${symbol}:`, error);
        
        // Return neutral sentiment on failure
        return {
          symbol,
          sentiment: {
            symbol,
            score: 0.0,
            magnitude: 0.0,
            articles: [],
            lastUpdated: Date.now(),
          },
        };
      }
    });

    const settledResults = await Promise.all(promises);

    // Build results map
    for (const result of settledResults) {
      results.set(result.symbol, result.sentiment);
    }

    console.log(`Batch sentiment analysis complete for ${symbols.length} assets`);

    return results;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    console.log("News cache cleared");
  }
}
