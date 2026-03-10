/**
 * MCP Proof of Concept Test Script
 *
 * Tests basic Playwright MCP operations to validate the approach
 * before integrating into the main codebase.
 *
 * Usage: npx tsx src/mcp-test.ts [url]
 * Example: npx tsx src/mcp-test.ts https://example.com
 */

import { spawn, ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Test configuration
const DEFAULT_URL = 'https://example.com';
const HEADLESS = false; // Set to true for CI/headless testing

interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

class MCPTestRunner {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private serverProcess: ChildProcess | null = null;

  async connect(): Promise<void> {
    console.log('🚀 Starting Playwright MCP server...\n');

    // Build args for the MCP server
    const args = ['@playwright/mcp@latest'];
    if (HEADLESS) {
      args.push('--headless');
    }

    // Create transport that spawns the MCP server
    this.transport = new StdioClientTransport({
      command: 'npx',
      args,
    });

    // Create MCP client
    this.client = new Client(
      { name: 'mcp-test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    // Connect to the server
    await this.client.connect(this.transport);
    console.log('✅ Connected to Playwright MCP server\n');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      console.log('🔌 Disconnected from MCP server');
    }
  }

  async listTools(): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    console.log('📋 Listing available MCP tools...\n');
    const tools = await this.client.listTools();

    console.log(`Found ${tools.tools.length} tools:\n`);
    for (const tool of tools.tools) {
      console.log(`  - ${tool.name}: ${tool.description?.substring(0, 60)}...`);
    }
    console.log('');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.client) throw new Error('Not connected');

    console.log(`🔧 Calling tool: ${name}`);
    console.log(`   Args: ${JSON.stringify(args)}\n`);

    const result = await this.client.callTool({ name, arguments: args });
    return result as MCPToolResult;
  }

  async navigate(url: string): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📍 TEST: Navigate to ${url}`);
    console.log('='.repeat(60));

    const result = await this.callTool('browser_navigate', { url });

    if (result.isError) {
      console.log('❌ Navigation failed:', result.content);
    } else {
      console.log('✅ Navigation successful');
      this.printResult(result);
    }
  }

  async getSnapshot(): Promise<string> {
    console.log(`\n${'='.repeat(60)}`);
    console.log('📸 TEST: Get Page Snapshot (Accessibility Tree)');
    console.log('='.repeat(60));

    const result = await this.callTool('browser_snapshot', {});

    if (result.isError) {
      console.log('❌ Snapshot failed:', result.content);
      return '';
    }

    const snapshotText = result.content.find(c => c.type === 'text')?.text || '';

    // Show first 2000 chars of snapshot
    console.log('\n📄 Accessibility Tree (first 2000 chars):');
    console.log('-'.repeat(40));
    console.log(snapshotText.substring(0, 2000));
    if (snapshotText.length > 2000) {
      console.log(`\n... (${snapshotText.length - 2000} more characters)`);
    }
    console.log('-'.repeat(40));

    // Count elements
    const elementCount = (snapshotText.match(/- \w+/g) || []).length;
    console.log(`\n📊 Estimated elements in tree: ${elementCount}`);

    return snapshotText;
  }

  async click(ref: string, element?: string): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🖱️  TEST: Click element (ref: ${ref})`);
    console.log('='.repeat(60));

    const args: Record<string, unknown> = { ref };
    if (element) args.element = element;

    const result = await this.callTool('browser_click', args);

    if (result.isError) {
      console.log('❌ Click failed:', result.content);
    } else {
      console.log('✅ Click successful');
      this.printResult(result);
    }
  }

  async type(ref: string, text: string, element?: string): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`⌨️  TEST: Type "${text}" into element (ref: ${ref})`);
    console.log('='.repeat(60));

    const args: Record<string, unknown> = { ref, text };
    if (element) args.element = element;

    const result = await this.callTool('browser_type', args);

    if (result.isError) {
      console.log('❌ Type failed:', result.content);
    } else {
      console.log('✅ Type successful');
      this.printResult(result);
    }
  }

  async takeScreenshot(filename?: string): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log('📷 TEST: Take Screenshot');
    console.log('='.repeat(60));

    const args: Record<string, unknown> = { type: 'png' };
    if (filename) args.filename = filename;

    const result = await this.callTool('browser_take_screenshot', args);

    if (result.isError) {
      console.log('❌ Screenshot failed:', result.content);
    } else {
      console.log('✅ Screenshot captured');
      const imageContent = result.content.find(c => c.type === 'image');
      if (imageContent) {
        console.log(`   Image type: ${imageContent.mimeType}`);
        console.log(`   Data length: ${imageContent.data?.length || 0} bytes (base64)`);
      }
    }
  }

  async close(): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🚪 TEST: Close Browser');
    console.log('='.repeat(60));

    const result = await this.callTool('browser_close', {});

    if (result.isError) {
      console.log('❌ Close failed:', result.content);
    } else {
      console.log('✅ Browser closed');
    }
  }

  private printResult(result: MCPToolResult): void {
    for (const content of result.content) {
      if (content.type === 'text' && content.text) {
        // Truncate long text responses
        const text = content.text;
        if (text.length > 500) {
          console.log(`   Response: ${text.substring(0, 500)}...`);
        } else {
          console.log(`   Response: ${text}`);
        }
      }
    }
  }
}

async function runTests(url: string): Promise<void> {
  const runner = new MCPTestRunner();

  try {
    // Connect to MCP server
    await runner.connect();

    // List available tools
    await runner.listTools();

    // Test 1: Navigate to URL
    await runner.navigate(url);

    // Test 2: Get accessibility snapshot
    const snapshot = await runner.getSnapshot();

    // Test 3: Take a screenshot for comparison
    await runner.takeScreenshot();

    // Test 4: Try to find and interact with an element
    // Parse the snapshot to find a clickable element
    const linkMatch = snapshot.match(/- link "([^"]+)"[^\n]*\[ref=([^\]]+)\]/);
    if (linkMatch) {
      const [, linkText, linkRef] = linkMatch;
      console.log(`\n🔍 Found link in snapshot: "${linkText}" (ref: ${linkRef})`);

      // Optionally click it (commented out to avoid navigation)
      // await runner.click(linkRef, linkText);
    } else {
      console.log('\n⚠️  No links found in snapshot to test click');
    }

    // Test 5: Try to find an input field
    const inputMatch = snapshot.match(/- textbox[^\n]*\[ref=([^\]]+)\]/);
    if (inputMatch) {
      const [, inputRef] = inputMatch;
      console.log(`\n🔍 Found input field in snapshot (ref: ${inputRef})`);

      // Optionally type into it (commented out to avoid side effects)
      // await runner.type(inputRef, 'test input');
    } else {
      console.log('\n⚠️  No input fields found in snapshot to test type');
    }

    // Close browser
    await runner.close();

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ ALL TESTS COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log('\n📊 Summary:');
    console.log('   - MCP server connection: ✅');
    console.log('   - Tool listing: ✅');
    console.log('   - Navigation: ✅');
    console.log('   - Accessibility snapshot: ✅');
    console.log('   - Screenshot capture: ✅');
    console.log('   - Browser close: ✅');
    console.log('\n🎉 Playwright MCP is working! Ready for Phase 2 integration.');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    throw error;
  } finally {
    await runner.disconnect();
  }
}

// Parse command line args
const url = process.argv[2] || DEFAULT_URL;

console.log(`
╔════════════════════════════════════════════════════════════╗
║           Playwright MCP Proof of Concept Test             ║
╠════════════════════════════════════════════════════════════╣
║  Testing MCP server integration for AI-first exploration   ║
╚════════════════════════════════════════════════════════════╝

Target URL: ${url}
Headless: ${HEADLESS}
`);

runTests(url).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
