// =====================================================
// Vestpod - Data Export Edge Function
// =====================================================
// Generates portfolio data exports in CSV, JSON, and PDF formats
// Requirements: 11

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/auth.ts";
import { checkPremiumStatus } from "../_shared/subscription-helper.ts";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// Types
// =====================================================

interface ExportAsset {
  symbol: string;
  name: string;
  type: string;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  currentPrice: number;
  currentValue: number;
  totalCost: number;
  gainLoss: number;
  gainLossPercent: number;
  sector?: string;
  country?: string;
}

interface ExportData {
  user: {
    email: string;
    name: string;
    currency: string;
  };
  portfolios: {
    name: string;
    totalValue: number;
    totalCost: number;
    totalGainLoss: number;
    totalGainLossPercent: number;
    assets: ExportAsset[];
  }[];
  insights?: {
    healthScore: number;
    riskScore: number;
    geographicExposure: Record<string, number>;
    sectorExposure: Record<string, number>;
    recommendations: unknown[];
    generatedAt: string;
  };
  exportedAt: string;
}

// =====================================================
// Helper Functions
// =====================================================

function jsonResponse(
  data: Record<string, unknown> | { error: string },
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

/**
 * Fetch complete portfolio data for export
 */
async function fetchExportData(userId: string): Promise<ExportData | null> {
  try {
    // Get user profile
    const { data: userProfile } = await supabase
      .from("user_profiles")
      .select("email, full_name, currency_preference")
      .eq("id", userId)
      .single();

    if (!userProfile) {
      return null;
    }

    // Get all portfolios
    const { data: portfolios } = await supabase
      .from("portfolios")
      .select("id, name")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!portfolios || portfolios.length === 0) {
      return null;
    }

    // Build portfolio data
    const portfolioData = [];
    for (const portfolio of portfolios) {
      // Get all assets in portfolio
      const { data: assets } = await supabase
        .from("assets")
        .select("*")
        .eq("portfolio_id", portfolio.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (!assets || assets.length === 0) {
        continue;
      }

      // Build asset data
      const exportAssets: ExportAsset[] = assets.map((asset) => {
        const quantity = Number(asset.quantity);
        const purchasePrice = Number(asset.purchase_price);
        const currentPrice = asset.current_price
          ? Number(asset.current_price)
          : purchasePrice;

        const currentValue = quantity * currentPrice;
        const totalCost = quantity * purchasePrice;
        const gainLoss = currentValue - totalCost;
        const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;

        return {
          symbol: asset.symbol || "",
          name: asset.name,
          type: asset.asset_type,
          quantity,
          purchasePrice: Number(purchasePrice.toFixed(2)),
          purchaseDate: asset.purchase_date,
          currentPrice: Number(currentPrice.toFixed(2)),
          currentValue: Number(currentValue.toFixed(2)),
          totalCost: Number(totalCost.toFixed(2)),
          gainLoss: Number(gainLoss.toFixed(2)),
          gainLossPercent: Number(gainLossPercent.toFixed(2)),
          sector: asset.metadata?.sector as string | undefined,
          country: asset.metadata?.country as string | undefined,
        };
      });

      // Calculate portfolio totals
      const totalValue = exportAssets.reduce((sum, a) => sum + a.currentValue, 0);
      const totalCost = exportAssets.reduce((sum, a) => sum + a.totalCost, 0);
      const totalGainLoss = totalValue - totalCost;
      const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

      portfolioData.push({
        name: portfolio.name,
        totalValue: Number(totalValue.toFixed(2)),
        totalCost: Number(totalCost.toFixed(2)),
        totalGainLoss: Number(totalGainLoss.toFixed(2)),
        totalGainLossPercent: Number(totalGainLossPercent.toFixed(2)),
        assets: exportAssets,
      });
    }

    // Get latest AI insights (optional)
    const { data: latestInsight } = await supabase
      .from("ai_insights")
      .select("*")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    let insights;
    if (latestInsight) {
      insights = {
        healthScore: latestInsight.health_score,
        riskScore: latestInsight.risk_score,
        geographicExposure: latestInsight.geographic_exposure,
        sectorExposure: latestInsight.sector_exposure,
        recommendations: latestInsight.recommendations,
        generatedAt: latestInsight.generated_at,
      };
    }

    return {
      user: {
        email: userProfile.email,
        name: userProfile.full_name || "User",
        currency: userProfile.currency_preference || "USD",
      },
      portfolios: portfolioData,
      insights,
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching export data:", error);
    return null;
  }
}

/**
 * Generate CSV export
 * Requirement 11.2: Generate spreadsheet-compatible file
 */
function generateCSV(data: ExportData): string {
  const lines: string[] = [];

  // Header
  lines.push("# Vestpod Portfolio Export");
  lines.push(`# Exported: ${new Date(data.exportedAt).toLocaleString()}`);
  lines.push(`# User: ${data.user.name} (${data.user.email})`);
  lines.push(`# Currency: ${data.user.currency}`);
  lines.push("");

  // For each portfolio
  for (const portfolio of data.portfolios) {
    lines.push(`# Portfolio: ${portfolio.name}`);
    lines.push(`# Total Value: ${portfolio.totalValue} ${data.user.currency}`);
    lines.push(`# Total Gain/Loss: ${portfolio.totalGainLoss} ${data.user.currency} (${portfolio.totalGainLossPercent}%)`);
    lines.push("");

    // Asset headers
    lines.push(
      "Symbol,Name,Type,Quantity,Purchase Price,Purchase Date,Current Price,Current Value,Total Cost,Gain/Loss,Gain/Loss %,Sector,Country"
    );

    // Asset rows
    for (const asset of portfolio.assets) {
      const row = [
        asset.symbol || "",
        `"${asset.name}"`,
        asset.type,
        asset.quantity,
        asset.purchasePrice,
        asset.purchaseDate,
        asset.currentPrice,
        asset.currentValue,
        asset.totalCost,
        asset.gainLoss,
        asset.gainLossPercent,
        asset.sector || "",
        asset.country || "",
      ];
      lines.push(row.join(","));
    }

    lines.push("");
  }

  // AI Insights section
  if (data.insights) {
    lines.push("# AI Insights");
    lines.push(`# Health Score: ${data.insights.healthScore}/10`);
    lines.push(`# Risk Score: ${data.insights.riskScore}/10`);
    lines.push(`# Generated: ${new Date(data.insights.generatedAt).toLocaleString()}`);
    lines.push("");

    // Geographic exposure
    lines.push("# Geographic Exposure");
    lines.push("Country,Percentage");
    for (const [country, percentage] of Object.entries(data.insights.geographicExposure)) {
      lines.push(`${country},${percentage}`);
    }
    lines.push("");

    // Sector exposure
    lines.push("# Sector Exposure");
    lines.push("Sector,Percentage");
    for (const [sector, percentage] of Object.entries(data.insights.sectorExposure)) {
      lines.push(`${sector},${percentage}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate JSON export
 * Requirement 11.3: Generate structured data file
 */
function generateJSON(data: ExportData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Generate PDF export
 * Requirement 11.4: Generate printable portfolio report
 */
function generatePDF(data: ExportData): string {
  // For PDF generation, we'll create an HTML document that can be converted to PDF
  // In a production environment, you would use a library like puppeteer or jsPDF
  // For now, we'll generate a well-formatted HTML that can be printed as PDF

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Vestpod Portfolio Export</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
      color: #333;
    }
    h1 {
      color: #2563eb;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 10px;
    }
    h2 {
      color: #1e40af;
      margin-top: 30px;
    }
    .header {
      margin-bottom: 30px;
    }
    .info {
      margin: 5px 0;
      color: #666;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th {
      background-color: #2563eb;
      color: white;
      padding: 10px;
      text-align: left;
    }
    td {
      padding: 8px;
      border-bottom: 1px solid #ddd;
    }
    tr:hover {
      background-color: #f5f5f5;
    }
    .positive {
      color: #16a34a;
    }
    .negative {
      color: #dc2626;
    }
    .summary {
      background-color: #f0f9ff;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .insights {
      background-color: #fef3c7;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .metric {
      display: inline-block;
      margin-right: 30px;
    }
    @media print {
      body {
        margin: 20px;
      }
      .page-break {
        page-break-before: always;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Vestpod Portfolio Export</h1>
    <div class="info">Exported: ${new Date(data.exportedAt).toLocaleString()}</div>
    <div class="info">User: ${data.user.name} (${data.user.email})</div>
    <div class="info">Currency: ${data.user.currency}</div>
  </div>

  ${data.portfolios.map((portfolio, index) => `
    ${index > 0 ? '<div class="page-break"></div>' : ''}
    <h2>Portfolio: ${portfolio.name}</h2>
    <div class="summary">
      <div class="metric"><strong>Total Value:</strong> ${portfolio.totalValue} ${data.user.currency}</div>
      <div class="metric"><strong>Total Cost:</strong> ${portfolio.totalCost} ${data.user.currency}</div>
      <div class="metric">
        <strong>Gain/Loss:</strong> 
        <span class="${portfolio.totalGainLoss >= 0 ? 'positive' : 'negative'}">
          ${portfolio.totalGainLoss} ${data.user.currency} (${portfolio.totalGainLossPercent}%)
        </span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Name</th>
          <th>Type</th>
          <th>Quantity</th>
          <th>Purchase Price</th>
          <th>Current Price</th>
          <th>Current Value</th>
          <th>Gain/Loss</th>
        </tr>
      </thead>
      <tbody>
        ${portfolio.assets.map(asset => `
          <tr>
            <td>${asset.symbol || '-'}</td>
            <td>${asset.name}</td>
            <td>${asset.type}</td>
            <td>${asset.quantity}</td>
            <td>${asset.purchasePrice}</td>
            <td>${asset.currentPrice}</td>
            <td>${asset.currentValue}</td>
            <td class="${asset.gainLoss >= 0 ? 'positive' : 'negative'}">
              ${asset.gainLoss} (${asset.gainLossPercent}%)
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `).join('')}

  ${data.insights ? `
    <div class="page-break"></div>
    <h2>AI Insights</h2>
    <div class="insights">
      <div class="metric"><strong>Health Score:</strong> ${data.insights.healthScore}/10</div>
      <div class="metric"><strong>Risk Score:</strong> ${data.insights.riskScore}/10</div>
      <div class="info">Generated: ${new Date(data.insights.generatedAt).toLocaleString()}</div>
    </div>

    <h3>Geographic Exposure</h3>
    <table>
      <thead>
        <tr>
          <th>Country</th>
          <th>Percentage</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(data.insights.geographicExposure).map(([country, percentage]) => `
          <tr>
            <td>${country}</td>
            <td>${percentage}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h3>Sector Exposure</h3>
    <table>
      <thead>
        <tr>
          <th>Sector</th>
          <th>Percentage</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(data.insights.sectorExposure).map(([sector, percentage]) => `
          <tr>
            <td>${sector}</td>
            <td>${percentage}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h3>Recommendations</h3>
    <ul>
      ${(data.insights.recommendations as Array<{ recommendation: string }>).map(rec => `
        <li>${rec.recommendation}</li>
      `).join('')}
    </ul>
  ` : ''}

  <div style="margin-top: 50px; text-align: center; color: #999; font-size: 12px;">
    Generated by Vestpod - Investment Portfolio Tracker
  </div>
</body>
</html>
  `.trim();

  return html;
}

/**
 * Upload export file to Supabase Storage
 * Requirement 11: Store exports in Supabase Storage
 */
async function uploadExportFile(
  userId: string,
  filename: string,
  content: string,
  contentType: string
): Promise<string | null> {
  try {
    const bucket = "exports";
    const path = `${userId}/${filename}`;

    // Upload file
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, content, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Error uploading file:", uploadError);
      return null;
    }

    // Get public URL
    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return data.publicUrl;
  } catch (error) {
    console.error("Error uploading export file:", error);
    return null;
  }
}

// =====================================================
// Route Handlers
// =====================================================

/**
 * POST /data-export
 * Generate and export portfolio data
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */
async function handleExportData(req: Request, userId: string) {
  try {
    // Check premium status
    // Requirement 11.8: Only premium users can export
    const isPremium = await checkPremiumStatus(userId);
    if (!isPremium) {
      return errorResponse(
        "Premium subscription required to export portfolio data",
        403
      );
    }

    // Get format from request
    const body = await req.json().catch(() => ({}));
    const format = (body.format || "json").toLowerCase();

    if (!["csv", "json", "pdf"].includes(format)) {
      return errorResponse(
        "Invalid format. Supported formats: csv, json, pdf",
        400
      );
    }

    // Fetch export data
    // Requirement 11.5: Include all assets, current values, purchase prices, and performance metrics
    const exportData = await fetchExportData(userId);
    if (!exportData) {
      return errorResponse(
        "No portfolio data found. Please add assets to your portfolio first.",
        404
      );
    }

    // Generate export based on format
    let content: string;
    let contentType: string;
    let fileExtension: string;

    if (format === "csv") {
      content = generateCSV(exportData);
      contentType = "text/csv";
      fileExtension = "csv";
    } else if (format === "json") {
      content = generateJSON(exportData);
      contentType = "application/json";
      fileExtension = "json";
    } else {
      content = generatePDF(exportData);
      contentType = "text/html";
      fileExtension = "html";
    }

    // Generate filename
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `vestpod-export-${timestamp}.${fileExtension}`;

    // Upload to storage
    const downloadUrl = await uploadExportFile(
      userId,
      filename,
      content,
      contentType
    );

    if (!downloadUrl) {
      return errorResponse("Failed to generate export file", 500);
    }

    // Return success with download URL
    return jsonResponse({
      success: true,
      export: {
        format,
        filename,
        downloadUrl,
        generatedAt: exportData.exportedAt,
        portfolioCount: exportData.portfolios.length,
        totalAssets: exportData.portfolios.reduce(
          (sum, p) => sum + p.assets.length,
          0
        ),
      },
    });
  } catch (error) {
    console.error("Export data handler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// =====================================================
// Main Request Handler
// =====================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate request
    let user;
    try {
      user = await authenticateRequest(req);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Authentication failed";
      return errorResponse(errorMessage, 401);
    }

    // Route requests
    if (req.method === "POST") {
      return await handleExportData(req, user.id);
    }

    // Method not allowed
    return errorResponse("Method not allowed", 405);
  } catch (error) {
    console.error("Request handler error:", error);
    return errorResponse("Internal server error", 500);
  }
});
