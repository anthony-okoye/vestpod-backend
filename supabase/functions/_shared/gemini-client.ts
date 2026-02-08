// =====================================================
// Gemini 3 Pro AI API Client
// =====================================================
// Provides AI-powered portfolio analysis, conversational
// assistance, and multi-step reasoning capabilities
// Requirements: 8, 9

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * AI Insight response structure
 */
export interface AIInsight {
  riskScore: number; // 0-10
  riskAnalysis: {
    volatilityScore: number;
    concentrationScore: number;
    reasoning: string;
  };
  geographicExposure: Record<string, number> & {
    warnings: string[];
  };
  sectorExposure: Record<string, number> & {
    warnings: string[];
  };
  recommendations: AIRecommendation[];
  verification: {
    selfCheckPassed: boolean;
    correctionsMade: string[];
  };
  timestamp: number;
}

/**
 * AI Recommendation structure
 */
export interface AIRecommendation {
  type: "warning" | "suggestion" | "positive";
  title: string;
  description: string;
  actions: string[];
  reasoning: string;
}

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: "user" | "model";
  content: string;
  timestamp: number;
}

/**
 * Chat response structure
 */
export interface ChatResponse {
  message: string;
  actions?: ChatAction[];
  timestamp: number;
}

/**
 * Chat action (e.g., show chart, view asset)
 */
export interface ChatAction {
  type: "show_chart" | "view_asset" | "rebalance" | "export";
  data: Record<string, unknown>;
}

/**
 * Portfolio context for AI analysis
 */
export interface PortfolioContext {
  userId: string;
  portfolioId: string;
  totalValue: number;
  currency: string;
  assets: AssetContext[];
  priceHistory?: PriceHistoryContext[];
  userPreferences?: UserPreferences;
}

/**
 * Asset context for AI
 */
export interface AssetContext {
  symbol: string;
  name: string;
  type: string;
  quantity: number;
  currentPrice: number;
  purchasePrice: number;
  totalValue: number;
  gainLoss: number;
  gainLossPercent: number;
  sector?: string;
  country?: string;
}

/**
 * Price history context
 */
export interface PriceHistoryContext {
  symbol: string;
  timestamp: number;
  price: number;
}

/**
 * User preferences
 */
export interface UserPreferences {
  riskTolerance?: "low" | "medium" | "high";
  investmentGoals?: string[];
  currency: string;
}

/**
 * API Error with retry information
 */
export class GeminiAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "GeminiAPIError";
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
  return statusCode === 429 || statusCode === 503 || statusCode >= 500;
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
        const errorBody = await response.text();
        throw new GeminiAPIError(
          `API request failed: ${response.statusText} - ${errorBody}`,
          response.status,
          false
        );
      }

      // Rate limit or server error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Gemini attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Max retries reached
      const errorBody = await response.text();
      throw new GeminiAPIError(
        `API request failed after ${retries + 1} attempts: ${response.statusText} - ${errorBody}`,
        response.status,
        true
      );
    } catch (error) {
      lastError = error as Error;

      // Non-retryable error
      if (error instanceof GeminiAPIError && !error.retryable) {
        throw error;
      }

      // Network error - retry
      if (attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(
          `Gemini attempt ${attempt + 1} failed with network error. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // Max retries reached
  throw new GeminiAPIError(
    `API request failed after ${retries + 1} attempts: ${lastError?.message || "Unknown error"}`,
    undefined,
    true
  );
}

/**
 * Generate AI portfolio insights using Gemini 3 Pro
 * Uses multi-step reasoning and self-verification
 * 
 * @param context - Portfolio context for analysis
 * @param apiKey - Gemini API key
 * @returns AI-generated insights
 */
export async function generatePortfolioInsights(
  context: PortfolioContext,
  apiKey: string
): Promise<AIInsight> {
  const model = "gemini-3-flash-preview";
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;

  // Build system prompt
  const systemPrompt = buildPortfolioAnalysisPrompt(context);

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: systemPrompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Lower temperature for factual analysis
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    // Validate response structure
    if (!data.candidates || data.candidates.length === 0) {
      throw new GeminiAPIError(
        "No response candidates from Gemini API",
        undefined,
        false
      );
    }

    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new GeminiAPIError(
        "Invalid response structure from Gemini API",
        undefined,
        false
      );
    }

    const responseText = candidate.content.parts[0].text;

    // Parse JSON response
    const insight = parseInsightResponse(responseText);

    return {
      ...insight,
      timestamp: Date.now(),
    };
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      throw error;
    }
    throw new GeminiAPIError(
      `Failed to generate portfolio insights: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Build portfolio analysis prompt
 */
function buildPortfolioAnalysisPrompt(context: PortfolioContext): string {
  const assetsDescription = context.assets
    .map(
      (asset) =>
        `- ${asset.symbol} (${asset.name}): ${asset.quantity} shares @ $${asset.currentPrice.toFixed(2)} = $${asset.totalValue.toFixed(2)} (${asset.gainLossPercent >= 0 ? "+" : ""}${asset.gainLossPercent.toFixed(2)}%)`
    )
    .join("\n");

  return `You are an autonomous portfolio analysis agent. Your task is to:

1. ANALYZE the user's portfolio for risks and opportunities
2. VERIFY your analysis using multi-step reasoning
3. GENERATE actionable recommendations
4. SELF-CORRECT any errors in your analysis

Portfolio Context:
- Total Value: $${context.totalValue.toFixed(2)} ${context.currency}
- Number of Assets: ${context.assets.length}
- Assets:
${assetsDescription}

${context.userPreferences ? `User Preferences:
- Risk Tolerance: ${context.userPreferences.riskTolerance || "Not specified"}
- Investment Goals: ${context.userPreferences.investmentGoals?.join(", ") || "Not specified"}
` : ""}

Use multi-step reasoning to analyze:
1. Calculate risk score (0-10) based on volatility and concentration
2. Analyze geographic exposure by country
3. Analyze sector exposure by industry
4. Generate warnings if concentration exceeds thresholds (60% country, 40% sector)
5. Provide actionable recommendations
6. Self-verify your calculations

Output Format (JSON only, no additional text):
{
  "risk_score": <number 0-10>,
  "risk_analysis": {
    "volatility_score": <number 0-10>,
    "concentration_score": <number 0-10>,
    "reasoning": "<step-by-step explanation>"
  },
  "geographic_exposure": {
    "<country>": <percentage>,
    "warnings": ["<warning if any>"]
  },
  "sector_exposure": {
    "<sector>": <percentage>,
    "warnings": ["<warning if any>"]
  },
  "recommendations": [
    {
      "type": "warning|suggestion|positive",
      "title": "<short title>",
      "description": "<detailed description>",
      "actions": ["<action 1>", "<action 2>"],
      "reasoning": "<why this recommendation>"
    }
  ],
  "verification": {
    "self_check_passed": true|false,
    "corrections_made": ["<correction if any>"]
  }
}`;
}

/**
 * Multi-modal context for enhanced AI analysis
 */
export interface MultiModalContext extends PortfolioContext {
  charts: {
    performance: string; // base64 PNG
    allocation: string; // base64 PNG
    correlation: string; // base64 PNG
  };
  sentiment?: Map<string, {
    score: number;
    magnitude: number;
    articles_count: number;
  }>;
  benchmark?: {
    symbol: string;
    currentPrice: number;
    changePercent: number;
    period: string;
  };
  macroIndicators?: {
    fedFundsRate: number;
    vixIndex: number;
    cpiInflation: number;
  };
}

/**
 * Enhanced AI Insight with multi-modal analysis
 */
export interface EnhancedAIInsight extends AIInsight {
  visualPatterns?: {
    trendAnalysis: string;
    allocationInsights: string;
    correlationInsights: string;
  };
  sentimentSummary?: {
    overallSentiment: number;
    negativeAssets: string[];
    positiveAssets: string[];
  };
  benchmarkComparison?: {
    relativePerformance: number;
    outperforming: boolean;
    reasoning: string;
  };
  macroContext?: {
    marketCondition: "bullish" | "bearish" | "neutral";
    volatilityLevel: "low" | "medium" | "high";
    recommendations: string[];
  };
}

/**
 * Generate multi-modal portfolio insights using Gemini 3 Pro
 * Analyzes both text data and chart images for comprehensive insights
 * 
 * @param context - Multi-modal portfolio context with chart images
 * @param apiKey - Gemini API key
 * @returns AI-generated insights with visual pattern analysis
 */
export async function generateMultiModalInsights(
  context: MultiModalContext,
  apiKey: string
): Promise<EnhancedAIInsight> {
  const model = "gemini-3-flash-preview";
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;

  // Build system prompt with visual analysis instructions
  const systemPrompt = buildMultiModalAnalysisPrompt(context);

  // Build multi-modal request with inline image data
  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: systemPrompt,
          },
          // Add performance chart as inline data
          {
            inlineData: {
              mimeType: "image/png",
              data: context.charts.performance,
            },
          },
          // Add allocation chart as inline data
          {
            inlineData: {
              mimeType: "image/png",
              data: context.charts.allocation,
            },
          },
          // Add correlation heatmap as inline data
          {
            inlineData: {
              mimeType: "image/png",
              data: context.charts.correlation,
            },
          },
          {
            text: "Analyze the visual patterns in these three charts (performance trend, allocation distribution, and correlation heatmap) along with the portfolio data provided above.",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Lower temperature for factual analysis
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    // Validate response structure
    if (!data.candidates || data.candidates.length === 0) {
      throw new GeminiAPIError(
        "No response candidates from Gemini API",
        undefined,
        false
      );
    }

    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new GeminiAPIError(
        "Invalid response structure from Gemini API",
        undefined,
        false
      );
    }

    const responseText = candidate.content.parts[0].text;

    // Parse JSON response with enhanced fields
    const insight = parseEnhancedInsightResponse(responseText);

    return {
      ...insight,
      timestamp: Date.now(),
    };
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      throw error;
    }
    throw new GeminiAPIError(
      `Failed to generate multi-modal insights: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Build multi-modal analysis prompt with visual analysis instructions
 */
function buildMultiModalAnalysisPrompt(context: MultiModalContext): string {
  const assetsDescription = context.assets
    .map(
      (asset) =>
        `- ${asset.symbol} (${asset.name}): ${asset.quantity} shares @ ${asset.currentPrice.toFixed(2)} = ${asset.totalValue.toFixed(2)} (${asset.gainLossPercent >= 0 ? "+" : ""}${asset.gainLossPercent.toFixed(2)}%)`
    )
    .join("\n");

  // Build sentiment context if available
  let sentimentContext = "";
  if (context.sentiment && context.sentiment.size > 0) {
    const sentimentLines: string[] = [];
    context.sentiment.forEach((sentiment, symbol) => {
      sentimentLines.push(
        `  ${symbol}: score=${sentiment.score.toFixed(2)}, confidence=${sentiment.magnitude.toFixed(2)}, articles=${sentiment.articles_count}`
      );
    });
    sentimentContext = `\nMarket Sentiment Data:\n${sentimentLines.join("\n")}`;
  }

  // Build benchmark context if available
  let benchmarkContext = "";
  if (context.benchmark) {
    benchmarkContext = `\nBenchmark Comparison (${context.benchmark.symbol}):\n- Current Price: ${context.benchmark.currentPrice.toFixed(2)}\n- Change: ${context.benchmark.changePercent >= 0 ? "+" : ""}${context.benchmark.changePercent.toFixed(2)}%\n- Period: ${context.benchmark.period}`;
  }

  // Build macro context if available
  let macroContext = "";
  if (context.macroIndicators) {
    macroContext = `\nMacro-Economic Indicators:\n- Fed Funds Rate: ${context.macroIndicators.fedFundsRate.toFixed(2)}%\n- VIX (Volatility): ${context.macroIndicators.vixIndex.toFixed(1)}\n- CPI Inflation: ${context.macroIndicators.cpiInflation.toFixed(1)}%`;
  }

  return `You are an autonomous portfolio analysis agent with visual analysis capabilities. Your task is to:

1. ANALYZE the user's portfolio for risks and opportunities
2. ANALYZE the visual patterns in the provided charts
3. INCORPORATE market sentiment, benchmark comparison, and macro-economic context
4. VERIFY your analysis using multi-step reasoning
5. GENERATE actionable recommendations
6. SELF-CORRECT any errors in your analysis

Portfolio Context:
- Total Value: ${context.totalValue.toFixed(2)} ${context.currency}
- Number of Assets: ${context.assets.length}
- Assets:
${assetsDescription}

${context.userPreferences ? `User Preferences:
- Risk Tolerance: ${context.userPreferences.riskTolerance || "Not specified"}
- Investment Goals: ${context.userPreferences.investmentGoals?.join(", ") || "Not specified"}
` : ""}${sentimentContext}${benchmarkContext}${macroContext}

Visual Analysis Instructions:
You will receive 3 chart images:
1. Performance Chart: 30-day portfolio value trend
2. Allocation Chart: Sector/geographic distribution
3. Correlation Heatmap: Asset relationship matrix

Analyze these charts for:
- Trend patterns (upward, downward, volatile)
- Concentration risks (over-allocation to sectors/regions)
- Correlation patterns (diversification effectiveness)
- Visual anomalies or concerning patterns

Use multi-step reasoning to analyze:
1. Calculate risk score (0-10) based on volatility and concentration
2. Analyze geographic exposure by country
3. Analyze sector exposure by industry
4. Analyze visual patterns from charts
5. Incorporate sentiment data (flag assets with score < -0.3 as negative)
6. Compare against benchmark performance
7. Consider macro-economic context (flag VIX > 30 as high volatility)
8. Generate warnings if concentration exceeds thresholds (60% country, 40% sector)
9. Provide actionable recommendations based on all data sources
10. Self-verify your calculations

Output Format (JSON only, no additional text):
{
  "risk_score": <number 0-10>,
  "risk_analysis": {
    "volatility_score": <number 0-10>,
    "concentration_score": <number 0-10>,
    "reasoning": "<step-by-step explanation including visual pattern observations>"
  },
  "geographic_exposure": {
    "<country>": <percentage>,
    "warnings": ["<warning if any>"]
  },
  "sector_exposure": {
    "<sector>": <percentage>,
    "warnings": ["<warning if any>"]
  },
  "recommendations": [
    {
      "type": "warning|suggestion|positive",
      "title": "<short title>",
      "description": "<detailed description including visual insights>",
      "actions": ["<action 1>", "<action 2>"],
      "reasoning": "<why this recommendation, referencing visual patterns>"
    }
  ],
  "verification": {
    "self_check_passed": true|false,
    "corrections_made": ["<correction if any>"]
  },
  "visual_patterns": {
    "trend_analysis": "<analysis of performance chart trends>",
    "allocation_insights": "<insights from allocation chart>",
    "correlation_insights": "<insights from correlation heatmap>"
  },
  "sentiment_summary": {
    "overall_sentiment": <average sentiment score>,
    "negative_assets": ["<assets with score < -0.3>"],
    "positive_assets": ["<assets with score > 0.3>"]
  },
  "benchmark_comparison": {
    "relative_performance": <portfolio change % - benchmark change %>,
    "outperforming": <true if portfolio > benchmark>,
    "reasoning": "<explanation of relative performance>"
  },
  "macro_context": {
    "market_condition": "bullish|bearish|neutral",
    "volatility_level": "low|medium|high",
    "recommendations": ["<macro-aware recommendations>"]
  }
}`;
}

/**
 * Parse insight response from Gemini
 */
function parseInsightResponse(responseText: string): Omit<AIInsight, "timestamp"> {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```\n?/g, "");
    }

    const parsed = JSON.parse(jsonText);

    return {
      riskScore: parsed.risk_score || 0,
      riskAnalysis: {
        volatilityScore: parsed.risk_analysis?.volatility_score || 0,
        concentrationScore: parsed.risk_analysis?.concentration_score || 0,
        reasoning: parsed.risk_analysis?.reasoning || "",
      },
      geographicExposure: {
        ...parsed.geographic_exposure,
        warnings: parsed.geographic_exposure?.warnings || [],
      },
      sectorExposure: {
        ...parsed.sector_exposure,
        warnings: parsed.sector_exposure?.warnings || [],
      },
      recommendations: (parsed.recommendations || []).map((rec: {
        type: string;
        title: string;
        description: string;
        actions: string[];
        reasoning: string;
      }) => ({
        type: rec.type as "warning" | "suggestion" | "positive",
        title: rec.title,
        description: rec.description,
        actions: rec.actions || [],
        reasoning: rec.reasoning || "",
      })),
      verification: {
        selfCheckPassed: parsed.verification?.self_check_passed || false,
        correctionsMade: parsed.verification?.corrections_made || [],
      },
    };
  } catch (error) {
    throw new GeminiAPIError(
      `Failed to parse insight response: ${(error as Error).message}`,
      undefined,
      false
    );
  }
}

/**
 * Parse enhanced insight response from Gemini (multi-modal)
 */
function parseEnhancedInsightResponse(responseText: string): Omit<EnhancedAIInsight, "timestamp"> {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```\n?/g, "");
    }

    const parsed = JSON.parse(jsonText);

    const baseInsight = {
      riskScore: parsed.risk_score || 0,
      riskAnalysis: {
        volatilityScore: parsed.risk_analysis?.volatility_score || 0,
        concentrationScore: parsed.risk_analysis?.concentration_score || 0,
        reasoning: parsed.risk_analysis?.reasoning || "",
      },
      geographicExposure: {
        ...parsed.geographic_exposure,
        warnings: parsed.geographic_exposure?.warnings || [],
      },
      sectorExposure: {
        ...parsed.sector_exposure,
        warnings: parsed.sector_exposure?.warnings || [],
      },
      recommendations: (parsed.recommendations || []).map((rec: {
        type: string;
        title: string;
        description: string;
        actions: string[];
        reasoning: string;
      }) => ({
        type: rec.type as "warning" | "suggestion" | "positive",
        title: rec.title,
        description: rec.description,
        actions: rec.actions || [],
        reasoning: rec.reasoning || "",
      })),
      verification: {
        selfCheckPassed: parsed.verification?.self_check_passed || false,
        correctionsMade: parsed.verification?.corrections_made || [],
      },
    };

    // Add enhanced fields
    const enhancedInsight: Omit<EnhancedAIInsight, "timestamp"> = {
      ...baseInsight,
      visualPatterns: parsed.visual_patterns ? {
        trendAnalysis: parsed.visual_patterns.trend_analysis || "",
        allocationInsights: parsed.visual_patterns.allocation_insights || "",
        correlationInsights: parsed.visual_patterns.correlation_insights || "",
      } : undefined,
      sentimentSummary: parsed.sentiment_summary ? {
        overallSentiment: parsed.sentiment_summary.overall_sentiment || 0,
        negativeAssets: parsed.sentiment_summary.negative_assets || [],
        positiveAssets: parsed.sentiment_summary.positive_assets || [],
      } : undefined,
      benchmarkComparison: parsed.benchmark_comparison ? {
        relativePerformance: parsed.benchmark_comparison.relative_performance || 0,
        outperforming: parsed.benchmark_comparison.outperforming || false,
        reasoning: parsed.benchmark_comparison.reasoning || "",
      } : undefined,
      macroContext: parsed.macro_context ? {
        marketCondition: parsed.macro_context.market_condition || "neutral",
        volatilityLevel: parsed.macro_context.volatility_level || "medium",
        recommendations: parsed.macro_context.recommendations || [],
      } : undefined,
    };

    return enhancedInsight;
  } catch (error) {
    throw new GeminiAPIError(
      `Failed to parse enhanced insight response: ${(error as Error).message}`,
      undefined,
      false
    );
  }
}

/**
 * Send chat message to Gemini AI assistant
 * Maintains conversation context
 * 
 * @param message - User message
 * @param context - Portfolio context
 * @param history - Previous chat messages
 * @param apiKey - Gemini API key
 * @returns AI response
 */
export async function sendChatMessage(
  message: string,
  context: PortfolioContext,
  history: ChatMessage[],
  apiKey: string
): Promise<ChatResponse> {
  const model = "gemini-3-flash-preview";
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;

  // Build system instruction
  const systemInstruction = buildChatSystemInstruction(context);

  // Build conversation history
  const contents = [
    {
      role: "user",
      parts: [{ text: systemInstruction }],
    },
    ...history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    })),
    {
      role: "user",
      parts: [{ text: message }],
    },
  ];

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0.7, // Higher temperature for conversational responses
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    // Validate response structure
    if (!data.candidates || data.candidates.length === 0) {
      throw new GeminiAPIError(
        "No response candidates from Gemini API",
        undefined,
        false
      );
    }

    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new GeminiAPIError(
        "Invalid response structure from Gemini API",
        undefined,
        false
      );
    }

    const responseText = candidate.content.parts[0].text;

    // Parse actions from response
    const actions = parseActionsFromResponse(responseText);

    return {
      message: responseText,
      actions,
      timestamp: Date.now(),
    };
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      throw error;
    }
    throw new GeminiAPIError(
      `Failed to send chat message: ${(error as Error).message}`,
      undefined,
      true
    );
  }
}

/**
 * Build chat system instruction
 */
function buildChatSystemInstruction(context: PortfolioContext): string {
  const assetsDescription = context.assets
    .map(
      (asset) =>
        `- ${asset.symbol}: $${asset.totalValue.toFixed(2)} (${asset.gainLossPercent >= 0 ? "+" : ""}${asset.gainLossPercent.toFixed(2)}%)`
    )
    .join("\n");

  return `You are a portfolio assistant for an investment tracking app.

User's Portfolio Context:
- Total Value: $${context.totalValue.toFixed(2)} ${context.currency}
- Number of Assets: ${context.assets.length}
- Assets:
${assetsDescription}

Capabilities:
- Answer questions about the user's portfolio
- Explain financial concepts
- Provide investment insights
- Suggest actions (use [Action: <action_type>] format)

Rules:
- Always cite data sources when making claims
- Provide disclaimers for investment advice
- Be concise but thorough
- Use ${context.currency} for all monetary values
- If suggesting an action, use format: [Action: show_chart|view_asset|rebalance|export]

Example:
User: "How exposed am I to tech stocks?"
Assistant: "Based on your portfolio, you have 45% exposure to technology sector. This is above the recommended 35% for diversification. [Action: show_chart type=sector_exposure]"`;
}

/**
 * Parse actions from chat response
 */
function parseActionsFromResponse(responseText: string): ChatAction[] {
  const actions: ChatAction[] = [];
  const actionRegex = /\[Action:\s*(\w+)(?:\s+(.+?))?\]/g;

  let match;
  while ((match = actionRegex.exec(responseText)) !== null) {
    const actionType = match[1];
    const actionData = match[2] || "";

    // Parse action data (simple key=value format)
    const data: Record<string, unknown> = {};
    if (actionData) {
      const pairs = actionData.split(/\s+/);
      for (const pair of pairs) {
        const [key, value] = pair.split("=");
        if (key && value) {
          data[key] = value;
        }
      }
    }

    actions.push({
      type: actionType as ChatAction["type"],
      data,
    });
  }

  return actions;
}

/**
 * Test basic API connectivity
 * Simple health check to verify API key and endpoint
 * 
 * @param apiKey - Gemini API key
 * @returns True if connection successful
 */
export async function testConnection(apiKey: string): Promise<boolean> {
  const model = "gemini-3-flash-preview";
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Hello, this is a connection test. Please respond with 'OK'.",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 10,
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    // Check if we got a valid response
    if (data.candidates && data.candidates.length > 0) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Gemini connection test failed:", error);
    return false;
  }
}
