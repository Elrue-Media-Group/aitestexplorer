/**
 * Configuration Management
 * 
 * Loads configuration from environment variables with sensible defaults.
 * Required: OPENAI_API_KEY
 * Optional: Model selection, limits, directories, headless mode
 */

import dotenv from 'dotenv';
import { Config } from './types.js';

dotenv.config();

/**
 * Load and validate configuration from environment variables
 * @returns Config object with all settings
 * @throws Error if OPENAI_API_KEY is not set
 */
export function loadConfig(): Config {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  return {
    maxPages: parseInt(process.env.MAX_PAGES || '10', 10),
    maxActions: parseInt(process.env.MAX_ACTIONS || '50', 10),
    openaiApiKey: apiKey,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    screenshotDir: process.env.SCREENSHOT_DIR || './screenshots',
    outputDir: process.env.OUTPUT_DIR || './output',
    headless: process.env.HEADLESS === 'true',
  };
}

