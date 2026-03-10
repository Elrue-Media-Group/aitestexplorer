/**
 * MCP Explorer Test Script
 *
 * Tests the MCP exploration workflow end-to-end.
 *
 * Usage: npx tsx src/mcp-explore-test.ts [url]
 * Example: npx tsx src/mcp-explore-test.ts http://localhost:4002/
 */

import { MCPExplorer } from './mcp-explorer.js';
import { loadConfig } from './config.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { ContextFileConfig } from './types.js';

const DEFAULT_URL = 'http://localhost:4002/';

async function loadContextFile(url: string): Promise<ContextFileConfig | null> {
  try {
    const urlObj = new URL(url);
    let domain = urlObj.hostname.replace('www.', '');
    const port = urlObj.port;

    // Try port-specific context first
    let contextPath = port
      ? join(process.cwd(), 'context', `${domain}-${port}.json`)
      : join(process.cwd(), 'context', `${domain}.json`);

    if (port && !existsSync(contextPath)) {
      contextPath = join(process.cwd(), 'context', `${domain}.json`);
    }

    if (!existsSync(contextPath)) {
      console.log(`ℹ️ No context file found at ${contextPath}`);
      return null;
    }

    const content = await readFile(contextPath, 'utf-8');
    const contextFile: ContextFileConfig = JSON.parse(content);
    console.log(`✅ Loaded context file: ${contextPath}`);
    return contextFile;
  } catch (error) {
    console.warn('⚠️ Could not load context file:', error);
    return null;
  }
}

async function main() {
  const url = process.argv[2] || DEFAULT_URL;

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              MCP Explorer Test                             ║
╠════════════════════════════════════════════════════════════╣
║  AI Vision + MCP for deterministic exploration             ║
╚════════════════════════════════════════════════════════════╝

Target URL: ${url}
`);

  // Load config
  const config = loadConfig();

  // Load context file if available
  const contextFile = await loadContextFile(url);

  // Create output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(process.cwd(), 'output', `mcp-test-${timestamp}`);

  // Create explorer
  const explorer = new MCPExplorer(config, {
    maxPages: 3,
    maxActions: 10,
    headless: false,
    screenshotDir: join(outputDir, 'screenshots'),
    contextFile: contextFile || undefined,
  });

  try {
    // Run exploration
    const pages = await explorer.explore(url);

    // Output summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 EXPLORATION RESULTS');
    console.log('='.repeat(60));

    for (const page of pages) {
      console.log(`\n📄 Page: ${page.url}`);
      console.log(`   Title: ${page.title}`);
      console.log(`   Screenshot: ${page.screenshot}`);
      console.log(`   Actions taken: ${page.actions.length}`);

      if (page.discoveredElements) {
        console.log(`   Links: ${page.discoveredElements.links.length}`);
        console.log(`   Buttons: ${page.discoveredElements.buttons.length}`);
        console.log(`   Headings: ${page.discoveredElements.headings.length}`);
      }

      if (page.visionAnalysis) {
        console.log(`   Page Type: ${page.visionAnalysis.pageType}`);
        console.log(`   Description: ${page.visionAnalysis.description.substring(0, 100)}...`);
      }

      // Show elements with refs
      if (page.discoveredElements?.links.length) {
        console.log(`\n   Links with MCP refs:`);
        for (const link of page.discoveredElements.links.slice(0, 5)) {
          console.log(`     - [${link.mcpRef}] "${link.text}" → ${link.href}`);
        }
      }

      if (page.discoveredElements?.buttons.length) {
        console.log(`\n   Buttons with MCP refs:`);
        for (const btn of page.discoveredElements.buttons.slice(0, 5)) {
          console.log(`     - [${btn.mcpRef}] "${btn.text}"`);
        }
      }
    }

    console.log(`\n✅ Output saved to: ${outputDir}`);

  } catch (error) {
    console.error('❌ Exploration failed:', error);
    process.exit(1);
  }
}

main();
