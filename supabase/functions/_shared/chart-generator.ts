// =====================================================
// Chart Generator Component
// =====================================================
// Generates portfolio visualization charts as PNG images
// Uses QuickChart API for Deno-compatible chart generation
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5

const QUICKCHART_BASE_URL = "https://quickchart.io/chart";
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY = 1000;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_BACKGROUND_COLOR = "#ffffff";

/**
 * Chart generator configuration
 */
export interface ChartGeneratorConfig {
  width?: number;
  height?: number;
  backgroundColor?: string;
}

/**
 * Performance chart data (30-day trend)
 */
export interface PerformanceChartData {
  dates: string[];
  values: number[];
  currency: string;
}

/**
 * Allocation chart data (pie chart)
 */
export interface AllocationChartData {
  labels: string[];
  values: number[];
  colors?: string[];
}

/**
 * Correlation heatmap data
 */
export interface CorrelationChartData {
  assets: string[];
  correlationMatrix: number[][]; // NxN matrix
}

/**
 * Chart generation error
 */
export class ChartGenerationError extends Error {
  constructor(
    message: string,
    public chartType: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "ChartGenerationError";
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chart Generator class
 * Generates portfolio visualization charts using QuickChart API
 */
export class ChartGenerator {
  private config: Required<ChartGeneratorConfig>;

  constructor(config: ChartGeneratorConfig = {}) {
    this.config = {
      width: config.width || DEFAULT_WIDTH,
      height: config.height || DEFAULT_HEIGHT,
      backgroundColor: config.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    };
  }

  /**
   * Generate performance line chart
   * Shows 30-day portfolio value trend
   * 
   * @param data - Performance chart data
   * @returns Base64-encoded PNG image
   */
  async generatePerformanceChart(
    data: PerformanceChartData
  ): Promise<string | null> {
    try {
      const chartConfig = {
        type: "line",
        data: {
          labels: data.dates,
          datasets: [
            {
              label: `Portfolio Value (${data.currency})`,
              data: data.values,
              borderColor: "#10b981",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              borderWidth: 2,
              fill: true,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: "30-Day Performance Trend",
              font: { size: 16, weight: "bold" },
            },
            legend: {
              display: true,
              position: "bottom",
            },
          },
          scales: {
            y: {
              beginAtZero: false,
              ticks: {
                callback: `function(value) { return '${data.currency} ' + value.toLocaleString(); }`,
              },
            },
          },
        },
      };

      return await this.generateChart(chartConfig, "performance");
    } catch (error) {
      console.error("Performance chart generation failed:", error);
      return null; // Graceful degradation
    }
  }

  /**
   * Generate allocation pie chart
   * Shows sector or geographic distribution
   * 
   * @param data - Allocation chart data
   * @returns Base64-encoded PNG image
   */
  async generateAllocationChart(
    data: AllocationChartData
  ): Promise<string | null> {
    try {
      const defaultColors = [
        "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
        "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
      ];

      const chartConfig = {
        type: "pie",
        data: {
          labels: data.labels,
          datasets: [
            {
              data: data.values,
              backgroundColor: data.colors || defaultColors.slice(0, data.labels.length),
              borderWidth: 2,
              borderColor: "#ffffff",
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: "Portfolio Allocation",
              font: { size: 16, weight: "bold" },
            },
            legend: {
              display: true,
              position: "right",
            },
            tooltip: {
              callbacks: {
                label: `function(context) { 
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  return label + ': ' + value.toFixed(1) + '%';
                }`,
              },
            },
          },
        },
      };

      return await this.generateChart(chartConfig, "allocation");
    } catch (error) {
      console.error("Allocation chart generation failed:", error);
      return null; // Graceful degradation
    }
  }

  /**
   * Generate correlation heatmap
   * Shows how assets move together
   * 
   * @param data - Correlation chart data
   * @returns Base64-encoded PNG image
   */
  async generateCorrelationHeatmap(
    data: CorrelationChartData
  ): Promise<string | null> {
    try {
      // Transform correlation matrix into heatmap format
      const heatmapData = [];
      for (let i = 0; i < data.assets.length; i++) {
        for (let j = 0; j < data.assets.length; j++) {
          heatmapData.push({
            x: data.assets[j],
            y: data.assets[i],
            v: data.correlationMatrix[i][j],
          });
        }
      }

      const chartConfig = {
        type: "matrix",
        data: {
          datasets: [
            {
              label: "Correlation",
              data: heatmapData,
              backgroundColor: `function(context) {
                const value = context.dataset.data[context.dataIndex].v;
                const alpha = Math.abs(value);
                return value >= 0 
                  ? 'rgba(16, 185, 129, ' + alpha + ')' 
                  : 'rgba(239, 68, 68, ' + alpha + ')';
              }`,
              borderWidth: 1,
              borderColor: "#ffffff",
              width: `function(context) {
                const a = context.chart.chartArea;
                return (a.right - a.left) / ${data.assets.length} - 1;
              }`,
              height: `function(context) {
                const a = context.chart.chartArea;
                return (a.bottom - a.top) / ${data.assets.length} - 1;
              }`,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: "Asset Correlation Matrix",
              font: { size: 16, weight: "bold" },
            },
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                title: `function() { return ''; }`,
                label: `function(context) {
                  const v = context.dataset.data[context.dataIndex];
                  return v.y + ' vs ' + v.x + ': ' + v.v.toFixed(2);
                }`,
              },
            },
          },
          scales: {
            x: {
              type: "category",
              labels: data.assets,
              ticks: {
                display: true,
              },
              grid: {
                display: false,
              },
            },
            y: {
              type: "category",
              labels: data.assets,
              offset: true,
              ticks: {
                display: true,
              },
              grid: {
                display: false,
              },
            },
          },
        },
      };

      return await this.generateChart(chartConfig, "correlation");
    } catch (error) {
      console.error("Correlation heatmap generation failed:", error);
      return null; // Graceful degradation
    }
  }

  /**
   * Generate chart using QuickChart API
   * 
   * @param chartConfig - Chart.js configuration
   * @param chartType - Chart type for error logging
   * @returns Base64-encoded PNG image
   */
  private async generateChart(
    chartConfig: Record<string, unknown>,
    chartType: string
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const params = new URLSearchParams({
          chart: JSON.stringify(chartConfig),
          width: this.config.width.toString(),
          height: this.config.height.toString(),
          backgroundColor: this.config.backgroundColor,
          format: "png",
        });

        const url = `${QUICKCHART_BASE_URL}?${params.toString()}`;

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": "Vestpod-Portfolio-Tracker/1.0",
          },
        });

        if (!response.ok) {
          throw new ChartGenerationError(
            `QuickChart API returned ${response.status}: ${response.statusText}`,
            chartType,
            response.status >= 500
          );
        }

        // Get image as array buffer
        const imageBuffer = await response.arrayBuffer();

        // Convert to base64
        const base64 = btoa(
          new Uint8Array(imageBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ""
          )
        );

        console.log(
          `${chartType} chart generated successfully (${(imageBuffer.byteLength / 1024).toFixed(1)}KB)`
        );

        return base64;
      } catch (error) {
        lastError = error as Error;

        // Check if retryable
        const isRetryable =
          error instanceof ChartGenerationError && error.retryable;

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
          console.log(
            `${chartType} chart generation attempt ${attempt + 1} failed. Retrying in ${delay}ms...`
          );
          await sleep(delay);
          continue;
        }

        // Max retries reached or non-retryable error
        throw new ChartGenerationError(
          `Failed to generate ${chartType} chart: ${lastError?.message}`,
          chartType,
          false
        );
      }
    }

    throw new ChartGenerationError(
      `Failed to generate ${chartType} chart after ${MAX_RETRIES + 1} attempts`,
      chartType,
      false
    );
  }
}
