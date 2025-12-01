/**
 * Cost estimation for OpenAI Vision API usage
 * Updated for gpt-4o model pricing:
 * - Input tokens: $2.50 per million
 * - Output tokens: $10.00 per million
 * - Image pricing: Same as gpt-4-vision-preview
 * Based on: https://platform.openai.com/pricing
 */

export interface CostEstimate {
  estimatedPages: number;
  estimatedScreenshots: number;
  estimatedActions: number;
  imageCost: number;
  textInputCost: number;
  textOutputCost: number;
  totalCost: number;
  breakdown: string[];
}

export class CostEstimator {
  // OpenAI pricing for gpt-4o (as of 2024/2025)
  // Input: $2.50 per million tokens
  // Output: $10.00 per million tokens
  // Image pricing: Same as gpt-4-vision-preview
  private readonly INPUT_TOKEN_COST_PER_MILLION = 2.5;  // Updated for gpt-4o
  private readonly OUTPUT_TOKEN_COST_PER_MILLION = 10.0; // Updated for gpt-4o
  
  // Image token costs (same for gpt-4o as gpt-4-vision-preview)
  // High detail: 512x512 = ~0.00255, scales with resolution
  // Low detail: 512x512 = ~0.00085
  // We use high detail for screenshots (better analysis)
  private readonly HIGH_DETAIL_512x512_COST = 0.00255;
  private readonly LOW_DETAIL_512x512_COST = 0.00085;
  
  // Average screenshot dimensions (1920x1080 viewport, but full page can be larger)
  // Full page screenshots are typically 1920x3000-5000 pixels
  private readonly AVG_SCREENSHOT_WIDTH = 1920;
  private readonly AVG_SCREENSHOT_HEIGHT = 3500; // Average full page height
  
  // Average tokens per request
  private readonly AVG_PROMPT_TOKENS = 500; // Prompt text tokens
  private readonly AVG_RESPONSE_TOKENS = 1500; // AI response tokens
  private readonly AVG_REPORT_TOKENS = 2000; // Final report generation tokens

  /**
   * Calculate image token cost based on resolution
   * OpenAI charges based on image resolution, not just count
   */
  private calculateImageCost(width: number, height: number, highDetail: boolean = true): number {
    // Base cost for 512x512
    const base512Cost = highDetail ? this.HIGH_DETAIL_512x512_COST : this.LOW_DETAIL_512x512_COST;
    
    // Calculate how many 512x512 tiles fit in the image
    // Images are processed in 512x512 tiles, with a minimum of 1 tile
    const tilesX = Math.ceil(width / 512);
    const tilesY = Math.ceil(height / 512);
    const totalTiles = tilesX * tilesY;
    
    // Cost scales with number of tiles
    return base512Cost * totalTiles;
  }

  /**
   * Estimate cost for a single page analysis
   */
  private estimatePageAnalysisCost(): {
    imageCost: number;
    inputTokens: number;
    outputTokens: number;
  } {
    const imageCost = this.calculateImageCost(
      this.AVG_SCREENSHOT_WIDTH,
      this.AVG_SCREENSHOT_HEIGHT,
      true // High detail for better analysis
    );
    
    return {
      imageCost,
      inputTokens: this.AVG_PROMPT_TOKENS,
      outputTokens: this.AVG_RESPONSE_TOKENS,
    };
  }

  /**
   * Estimate total cost for a website exploration
   */
  estimateCost(maxPages: number, maxActions: number): CostEstimate {
    // Each page gets analyzed (screenshot + AI analysis)
    const pagesToAnalyze = maxPages;
    
    // Each page analysis includes:
    // - 1 screenshot (full page)
    // - 1 AI vision call
    const pageAnalysis = this.estimatePageAnalysisCost();
    
    // Calculate per-page costs
    const imageCostPerPage = pageAnalysis.imageCost;
    const inputTokensPerPage = pageAnalysis.inputTokens;
    const outputTokensPerPage = pageAnalysis.outputTokens;
    
    // Total image costs
    const totalImageCost = imageCostPerPage * pagesToAnalyze;
    
    // Total text input tokens (prompts)
    const totalInputTokens = inputTokensPerPage * pagesToAnalyze;
    const totalInputCost = (totalInputTokens / 1_000_000) * this.INPUT_TOKEN_COST_PER_MILLION;
    
    // Total text output tokens (responses)
    const totalOutputTokens = outputTokensPerPage * pagesToAnalyze;
    const totalOutputCost = (totalOutputTokens / 1_000_000) * this.OUTPUT_TOKEN_COST_PER_MILLION;
    
    // Final report generation (one additional call)
    const reportInputTokens = this.AVG_PROMPT_TOKENS;
    const reportOutputTokens = this.AVG_REPORT_TOKENS;
    const reportInputCost = (reportInputTokens / 1_000_000) * this.INPUT_TOKEN_COST_PER_MILLION;
    const reportOutputCost = (reportOutputTokens / 1_000_000) * this.OUTPUT_TOKEN_COST_PER_MILLION;
    
    const totalTextInputCost = totalInputCost + reportInputCost;
    const totalTextOutputCost = totalOutputCost + reportOutputCost;
    
    const totalCost = totalImageCost + totalTextInputCost + totalTextOutputCost;
    
    // Create breakdown
    const breakdown: string[] = [
      `📸 Screenshot Analysis (${pagesToAnalyze} pages): $${totalImageCost.toFixed(4)}`,
      `  - Per page: $${imageCostPerPage.toFixed(4)} (${this.AVG_SCREENSHOT_WIDTH}x${this.AVG_SCREENSHOT_HEIGHT} high detail)`,
      `📝 Text Input Tokens (${totalInputTokens + reportInputTokens} tokens): $${totalTextInputCost.toFixed(4)}`,
      `📤 Text Output Tokens (${totalOutputTokens + reportOutputTokens} tokens): $${totalTextOutputCost.toFixed(4)}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💰 Estimated Total: $${totalCost.toFixed(4)}`,
    ];
    
    return {
      estimatedPages: pagesToAnalyze,
      estimatedScreenshots: pagesToAnalyze,
      estimatedActions: maxActions,
      imageCost: totalImageCost,
      textInputCost: totalTextInputCost,
      textOutputCost: totalTextOutputCost,
      totalCost,
      breakdown,
    };
  }

  /**
   * Format cost estimate for display
   */
  formatEstimate(estimate: CostEstimate): string {
    return [
      `\n💵 Cost Estimate for Website Analysis`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Pages to analyze: ${estimate.estimatedPages}`,
      `Screenshots: ${estimate.estimatedScreenshots}`,
      `Max actions: ${estimate.estimatedActions}`,
      ``,
      ...estimate.breakdown,
      ``,
      `Note: Actual costs may vary based on:`,
      `  - Actual screenshot dimensions`,
      `  - Response length from AI`,
      `  - Number of pages actually visited`,
      `  - Current OpenAI pricing`,
      ``,
    ].join('\n');
  }

  /**
   * Quick cost estimate for common scenarios
   */
  getQuickEstimates(): Array<{ pages: number; actions: number; cost: number }> {
    return [
      { pages: 1, actions: 5, cost: this.estimateCost(1, 5).totalCost },
      { pages: 5, actions: 20, cost: this.estimateCost(5, 20).totalCost },
      { pages: 10, actions: 50, cost: this.estimateCost(10, 50).totalCost },
      { pages: 20, actions: 100, cost: this.estimateCost(20, 100).totalCost },
    ];
  }
}

