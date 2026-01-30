// =====================================================
// Vestpod - AI Chat Handler Edge Function
// =====================================================
// Handles conversational AI chat messages with portfolio context
// Requirements: 9

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/auth.ts";
import {
  sendChatMessage,
  PortfolioContext,
  AssetContext,
  ChatMessage,
  GeminiAPIError,
} from "../_shared/gemini-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_HISTORY_MESSAGES = 20;

function jsonResponse(
  data: Record<string, unknown> | { error: string } | { success: boolean; [key: string]: unknown },
  status = 200
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// Import centralized subscription helper
import { checkPremiumStatus } from "../_shared/subscription-helper.ts";

async function fetchPortfolioContext(
  userId: string,
  portfolioId?: string
): Promise<PortfolioContext | null> {
  try {
    const { data: userProfile } = await supabase
      .from("user_profiles")
      .select("currency_preference")
      .eq("id", userId)
      .single();

    const currency = userProfile?.currency_preference || "USD";

    let targetPortfolioId = portfolioId;
    if (!targetPortfolioId) {
      const { data: defaultPortfolio } = await supabase
        .from("portfolios")
        .select("id")
        .eq("user_id", userId)
        .eq("is_default", true)
        .single();

      if (!defaultPortfolio) {
        const { data: firstPortfolio } = await supabase
          .from("portfolios")
          .select("id")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .single();

        if (!firstPortfolio) {
          return null;
        }
        targetPortfolioId = firstPortfolio.id;
      } else {
        targetPortfolioId = defaultPortfolio.id;
      }
    }

    const { data: portfolio, error: portfolioError } = await supabase
      .from("portfolios")
      .select("id, name")
      .eq("id", targetPortfolioId)
      .eq("user_id", userId)
      .single();

    if (portfolioError || !portfolio) {
      return null;
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("*")
      .eq("portfolio_id", targetPortfolioId)
      .eq("user_id", userId);

    if (assetsError || !assets || assets.length === 0) {
      return null;
    }

    const assetContexts: AssetContext[] = assets.map((asset) => {
      const quantity = Number(asset.quantity);
      const purchasePrice = Number(asset.purchase_price);
      const currentPrice = asset.current_price
        ? Number(asset.current_price)
        : purchasePrice;

      const totalValue = quantity * currentPrice;
      const totalCost = quantity * purchasePrice;
      const gainLoss = totalValue - totalCost;
      const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;

      return {
        symbol: asset.symbol || asset.name,
        name: asset.name,
        type: asset.asset_type,
        quantity,
        currentPrice,
        purchasePrice,
        totalValue: Number(totalValue.toFixed(2)),
        gainLoss: Number(gainLoss.toFixed(2)),
        gainLossPercent: Number(gainLossPercent.toFixed(2)),
        sector: asset.metadata?.sector as string | undefined,
        country: asset.metadata?.country as string | undefined,
      };
    });

    const totalValue = assetContexts.reduce(
      (sum, asset) => sum + asset.totalValue,
      0
    );

    return {
      userId,
      portfolioId: targetPortfolioId!,
      totalValue: Number(totalValue.toFixed(2)),
      currency,
      assets: assetContexts,
    };
  } catch (error) {
    console.error("Error fetching portfolio context:", error);
    return null;
  }
}

async function fetchChatHistory(
  userId: string,
  limit: number = MAX_HISTORY_MESSAGES
): Promise<ChatMessage[]> {
  try {
    const { data: messages, error } = await supabase
      .from("ai_chat_history")
      .select("role, message, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !messages) {
      return [];
    }

    return messages
      .reverse()
      .map((msg) => ({
        role: msg.role as "user" | "model",
        content: msg.message,
        timestamp: new Date(msg.created_at).getTime(),
      }));
  } catch (error) {
    console.error("Error fetching chat history:", error);
    return [];
  }
}

async function storeChatMessage(
  userId: string,
  role: "user" | "assistant",
  message: string,
  portfolioContext?: PortfolioContext
): Promise<void> {
  try {
    await supabase.from("ai_chat_history").insert({
      user_id: userId,
      role,
      message,
      portfolio_context: portfolioContext || null,
    });
  } catch (error) {
    console.error("Error storing chat message:", error);
  }
}

async function handleSendMessage(req: Request, userId: string) {
  try {
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to access AI chat assistant",
        403
      );
    }

    if (!geminiApiKey) {
      return errorResponse(
        "AI chat service is not configured. Please contact support.",
        503
      );
    }

    const body = await req.json();
    const { message, portfolio_id } = body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return errorResponse("Message is required", 400);
    }

    if (message.length > 2000) {
      return errorResponse("Message is too long (max 2000 characters)", 400);
    }

    const portfolioContext = await fetchPortfolioContext(userId, portfolio_id);
    if (!portfolioContext) {
      return errorResponse(
        "No portfolio data found. Please add assets to your portfolio first.",
        404
      );
    }

    const chatHistory = await fetchChatHistory(userId);

    await storeChatMessage(userId, "user", message, portfolioContext);

    let chatResponse;
    try {
      chatResponse = await sendChatMessage(
        message,
        portfolioContext,
        chatHistory,
        geminiApiKey
      );
    } catch (error) {
      if (error instanceof GeminiAPIError) {
        console.error("Gemini API error:", error.message);
        return errorResponse(
          `AI chat failed: ${error.message}`,
          error.statusCode || 500
        );
      }
      throw error;
    }

    await storeChatMessage(userId, "assistant", chatResponse.message);

    return jsonResponse({
      success: true,
      response: {
        message: chatResponse.message,
        actions: chatResponse.actions || [],
        timestamp: chatResponse.timestamp,
      },
    });
  } catch (error) {
    console.error("Send message handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

async function handleGetHistory(req: Request, userId: string) {
  try {
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to access AI chat assistant",
        403
      );
    }

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");

    const messages = await fetchChatHistory(userId, Math.min(limit, 100));

    return jsonResponse({
      success: true,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      })),
    });
  } catch (error) {
    console.error("Get history handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

async function handleClearHistory(userId: string) {
  try {
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to access AI chat assistant",
        403
      );
    }

    const { error } = await supabase
      .from("ai_chat_history")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Error clearing chat history:", error);
      return errorResponse("Failed to clear chat history", 500);
    }

    return jsonResponse({
      success: true,
      message: "Chat history cleared successfully",
    });
  } catch (error) {
    console.error("Clear history handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let user;
    try {
      user = await authenticateRequest(req);
    } catch (error) {
      return errorResponse(error.message, 401);
    }

    const url = new URL(req.url);
    const path = url.pathname;

    if (path.endsWith("/send") && req.method === "POST") {
      return await handleSendMessage(req, user.id);
    }

    if (path.endsWith("/history") && req.method === "GET") {
      return await handleGetHistory(req, user.id);
    }

    if (path.endsWith("/clear") && req.method === "DELETE") {
      return await handleClearHistory(user.id);
    }

    return errorResponse("Route not found", 404);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
