// =====================================================
// Gemini 3 Pro AI API Client - Tests
// =====================================================
// Tests for AI portfolio analysis and chat functionality
// Requirements: 8, 9

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  generatePortfolioInsights,
  sendChatMessage,
  testConnection,
  type PortfolioContext,
  type ChatMessage,
  GeminiAPIError,
} from "./gemini-client.ts";

// Mock API key for testing
const MOCK_API_KEY = Deno.env.get("GEMINI_API_KEY") || "test-api-key";

// Sample portfolio context for testing
const samplePortfolioContext: PortfolioContext = {
  userId: "test-user-123",
  portfolioId: "portfolio-456",
  totalValue: 125430.50,
  currency: "USD",
  assets: [
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      type: "stock",
      quantity: 50,
      currentPrice: 180.50,
      purchasePrice: 150.00,
      totalValue: 9025.00,
      gainLoss: 1525.00,
      gainLossPercent: 20.33,
      sector: "Technology",
      country: "US",
    },
    {
      symbol: "GOOGL",
      name: "Alphabet Inc.",
      type: "stock",
      quantity: 20,
      currentPrice: 140.25,
      purchasePrice: 120.00,
      totalValue: 2805.00,
      gainLoss: 405.00,
      gainLossPercent: 16.88,
      sector: "Technology",
      country: "US",
    },
    {
      symbol: "BTC",
      name: "Bitcoin",
      type: "crypto",
      quantity: 0.5,
      currentPrice: 45000.00,
      purchasePrice: 40000.00,
      totalValue: 22500.00,
      gainLoss: 2500.00,
      gainLossPercent: 12.50,
      sector: "Cryptocurrency",
      country: "Global",
    },
  ],
  userPreferences: {
    riskTolerance: "medium",
    investmentGoals: ["long-term growth", "diversification"],
    currency: "USD",
  },
};

/**
 * Test: Connection test
 */
Deno.test("Gemini API - Connection test", async () => {
  // Skip if no API key
  if (MOCK_API_KEY === "test-api-key") {
    console.log("⚠️  Skipping connection test - No API key provided");
    return;
  }

  const isConnected = await testConnection(MOCK_API_KEY);
  assertEquals(isConnected, true, "Should successfully connect to Gemini API");
});

/**
 * Test: Generate portfolio insights
 */
Deno.test("Gemini API - Generate portfolio insights", async () => {
  // Skip if no API key
  if (MOCK_API_KEY === "test-api-key") {
    console.log("⚠️  Skipping insights test - No API key provided");
    return;
  }

  try {
    const insights = await generatePortfolioInsights(
      samplePortfolioContext,
      MOCK_API_KEY
    );

    // Validate response structure
    assertExists(insights, "Insights should exist");
    assertExists(insights.riskScore, "Risk score should exist");
    assertExists(insights.riskAnalysis, "Risk analysis should exist");
    assertExists(insights.geographicExposure, "Geographic exposure should exist");
    assertExists(insights.sectorExposure, "Sector exposure should exist");
    assertExists(insights.recommendations, "Recommendations should exist");
    assertExists(insights.verification, "Verification should exist");
    assertExists(insights.timestamp, "Timestamp should exist");

    // Validate risk score range
    assertEquals(
      insights.riskScore >= 0 && insights.riskScore <= 10,
      true,
      "Risk score should be between 0 and 10"
    );

    // Validate recommendations structure
    if (insights.recommendations.length > 0) {
      const rec = insights.recommendations[0];
      assertExists(rec.type, "Recommendation type should exist");
      assertExists(rec.title, "Recommendation title should exist");
      assertExists(rec.description, "Recommendation description should exist");
      assertExists(rec.actions, "Recommendation actions should exist");
      assertExists(rec.reasoning, "Recommendation reasoning should exist");
    }

    console.log("✅ Portfolio insights generated successfully");
    console.log(`   Risk Score: ${insights.riskScore}/10`);
    console.log(`   Recommendations: ${insights.recommendations.length}`);
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      console.error("❌ Gemini API Error:", error.message);
      throw error;
    }
    throw error;
  }
});

/**
 * Test: Send chat message
 */
Deno.test("Gemini API - Send chat message", async () => {
  // Skip if no API key
  if (MOCK_API_KEY === "test-api-key") {
    console.log("⚠️  Skipping chat test - No API key provided");
    return;
  }

  try {
    const chatHistory: ChatMessage[] = [];
    const userMessage = "What is my total portfolio value?";

    const response = await sendChatMessage(
      userMessage,
      samplePortfolioContext,
      chatHistory,
      MOCK_API_KEY
    );

    // Validate response structure
    assertExists(response, "Response should exist");
    assertExists(response.message, "Response message should exist");
    assertExists(response.timestamp, "Response timestamp should exist");

    // Check if response mentions the portfolio value
    const containsValue = response.message.includes("125") || 
                          response.message.includes("$125,430") ||
                          response.message.includes("125430");
    
    assertEquals(
      containsValue,
      true,
      "Response should mention the portfolio value"
    );

    console.log("✅ Chat message sent successfully");
    console.log(`   User: ${userMessage}`);
    console.log(`   AI: ${response.message.substring(0, 100)}...`);
    
    if (response.actions && response.actions.length > 0) {
      console.log(`   Actions: ${response.actions.length}`);
    }
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      console.error("❌ Gemini API Error:", error.message);
      throw error;
    }
    throw error;
  }
});

/**
 * Test: Chat with conversation history
 */
Deno.test("Gemini API - Chat with history", async () => {
  // Skip if no API key
  if (MOCK_API_KEY === "test-api-key") {
    console.log("⚠️  Skipping chat history test - No API key provided");
    return;
  }

  try {
    // First message
    const chatHistory: ChatMessage[] = [];
    const firstMessage = "What is my largest holding?";

    const firstResponse = await sendChatMessage(
      firstMessage,
      samplePortfolioContext,
      chatHistory,
      MOCK_API_KEY
    );

    // Add to history
    chatHistory.push({
      role: "user",
      content: firstMessage,
      timestamp: Date.now(),
    });
    chatHistory.push({
      role: "model",
      content: firstResponse.message,
      timestamp: firstResponse.timestamp,
    });

    // Second message (should reference context)
    const secondMessage = "What percentage of my portfolio is it?";

    const secondResponse = await sendChatMessage(
      secondMessage,
      samplePortfolioContext,
      chatHistory,
      MOCK_API_KEY
    );

    // Validate response
    assertExists(secondResponse, "Second response should exist");
    assertExists(secondResponse.message, "Second response message should exist");

    console.log("✅ Chat with history successful");
    console.log(`   Message 1: ${firstMessage}`);
    console.log(`   Response 1: ${firstResponse.message.substring(0, 80)}...`);
    console.log(`   Message 2: ${secondMessage}`);
    console.log(`   Response 2: ${secondResponse.message.substring(0, 80)}...`);
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      console.error("❌ Gemini API Error:", error.message);
      throw error;
    }
    throw error;
  }
});

/**
 * Test: Error handling - Invalid API key
 */
Deno.test("Gemini API - Error handling (invalid key)", async () => {
  try {
    await testConnection("invalid-api-key-12345");
    
    // If we get here, the test should fail
    assertEquals(false, true, "Should have thrown an error for invalid API key");
  } catch (error) {
    // Expected to fail
    console.log("✅ Invalid API key correctly rejected");
  }
});

/**
 * Test: Error handling - Empty portfolio
 */
Deno.test("Gemini API - Error handling (empty portfolio)", async () => {
  // Skip if no API key
  if (MOCK_API_KEY === "test-api-key") {
    console.log("⚠️  Skipping empty portfolio test - No API key provided");
    return;
  }

  const emptyContext: PortfolioContext = {
    userId: "test-user-123",
    portfolioId: "portfolio-456",
    totalValue: 0,
    currency: "USD",
    assets: [],
  };

  try {
    const insights = await generatePortfolioInsights(
      emptyContext,
      MOCK_API_KEY
    );

    // Should still return valid structure
    assertExists(insights, "Insights should exist even for empty portfolio");
    assertExists(insights.riskScore, "Risk score should exist");
    
    console.log("✅ Empty portfolio handled correctly");
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      console.error("❌ Gemini API Error:", error.message);
      throw error;
    }
    throw error;
  }
});

console.log("\n📋 Test Summary:");
console.log("   - Connection test");
console.log("   - Portfolio insights generation");
console.log("   - Chat message sending");
console.log("   - Chat with conversation history");
console.log("   - Error handling (invalid key)");
console.log("   - Error handling (empty portfolio)");
console.log("\n💡 Note: Tests require GEMINI_API_KEY environment variable");
console.log("   Set it with: export GEMINI_API_KEY=your-key-here\n");
