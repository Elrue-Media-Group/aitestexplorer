/**
 * MCP Client Wrapper
 *
 * Provides a clean interface for interacting with the Playwright MCP server.
 * Handles connection lifecycle, tool calls, and response parsing.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export interface MCPSnapshot {
  url: string;
  title: string;
  accessibilityTree: string;
  rawYaml: string;
}

export interface MCPScreenshot {
  data: string;  // base64
  mimeType: string;
}

export interface MCPClickResult {
  success: boolean;
  error?: string;
}

export interface MCPTypeResult {
  success: boolean;
  error?: string;
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  private headless: boolean;
  private isolated: boolean;

  constructor(options: { headless?: boolean; isolated?: boolean } = {}) {
    this.headless = options.headless ?? false;
    // Default to isolated mode - fresh browser context with no persisted cookies/sessions
    // This ensures exploration starts clean and must go through login flow
    this.isolated = options.isolated ?? true;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    console.log('🚀 Starting Playwright MCP server...');

    const args = ['@playwright/mcp@latest'];
    if (this.headless) {
      args.push('--headless');
    }
    if (this.isolated) {
      args.push('--isolated');
      console.log('🔒 Using isolated browser context (no session persistence)');
    }

    this.transport = new StdioClientTransport({
      command: 'npx',
      args,
    });

    this.client = new Client(
      { name: 'qatool-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.connected = true;
    console.log('✅ Connected to Playwright MCP server');
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.close();
      this.connected = false;
      console.log('🔌 Disconnected from MCP server');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolResult> {
    if (!this.client || !this.connected) {
      throw new Error('MCP client not connected');
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result as MCPToolResult;
  }

  private getTextContent(result: MCPToolResult): string {
    return result.content.find(c => c.type === 'text')?.text || '';
  }

  private getImageContent(result: MCPToolResult): { data: string; mimeType: string } | null {
    const imageContent = result.content.find(c => c.type === 'image');
    if (imageContent && imageContent.data) {
      return {
        data: imageContent.data,
        mimeType: imageContent.mimeType || 'image/png',
      };
    }
    return null;
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('browser_navigate', { url });
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get page accessibility snapshot
   */
  async getSnapshot(): Promise<MCPSnapshot | null> {
    try {
      const result = await this.callTool('browser_snapshot', {});
      if (result.isError) {
        console.error('❌ Snapshot failed:', this.getTextContent(result));
        return null;
      }

      const text = this.getTextContent(result);

      // Parse URL and title from the response
      const urlMatch = text.match(/Page URL:\s*(.+)/);
      const titleMatch = text.match(/Page Title:\s*(.+)/);

      // Extract just the YAML snapshot portion
      const yamlMatch = text.match(/```yaml\n([\s\S]*?)(?:```|$)/);
      const rawYaml = yamlMatch ? yamlMatch[1].trim() : text;

      return {
        url: urlMatch ? urlMatch[1].trim() : '',
        title: titleMatch ? titleMatch[1].trim() : '',
        accessibilityTree: text,
        rawYaml,
      };
    } catch (error) {
      console.error('❌ Snapshot error:', error);
      return null;
    }
  }

  /**
   * Take a screenshot
   */
  async takeScreenshot(): Promise<MCPScreenshot | null> {
    try {
      const result = await this.callTool('browser_take_screenshot', { type: 'png' });
      if (result.isError) {
        console.error('❌ Screenshot failed:', this.getTextContent(result));
        return null;
      }

      const imageContent = this.getImageContent(result);
      if (!imageContent) {
        console.error('❌ No image data in screenshot response');
        return null;
      }

      return imageContent;
    } catch (error) {
      console.error('❌ Screenshot error:', error);
      return null;
    }
  }

  /**
   * Click an element by ref
   */
  async click(ref: string, elementDescription?: string): Promise<MCPClickResult> {
    try {
      const args: Record<string, unknown> = { ref };
      if (elementDescription) {
        args.element = elementDescription;
      }

      const result = await this.callTool('browser_click', args);
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Type text into an element by ref
   */
  async type(ref: string, text: string, options?: { submit?: boolean; elementDescription?: string }): Promise<MCPTypeResult> {
    try {
      const args: Record<string, unknown> = { ref, text };
      if (options?.submit) {
        args.submit = true;
      }
      if (options?.elementDescription) {
        args.element = options.elementDescription;
      }

      const result = await this.callTool('browser_type', args);
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Fill multiple form fields at once
   */
  async fillForm(fields: Array<{ ref: string; value: string }>): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('browser_fill_form', { fields });
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Hover over an element
   */
  async hover(ref: string, elementDescription?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const args: Record<string, unknown> = { ref };
      if (elementDescription) {
        args.element = elementDescription;
      }

      const result = await this.callTool('browser_hover', args);
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Select an option from a dropdown
   */
  async selectOption(ref: string, values: string[], elementDescription?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const args: Record<string, unknown> = { ref, values };
      if (elementDescription) {
        args.element = elementDescription;
      }

      const result = await this.callTool('browser_select_option', args);
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Press a key
   */
  async pressKey(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('browser_press_key', { key });
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Wait for text to appear or time to pass
   */
  async waitFor(options: { text?: string; textGone?: string; time?: number }): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('browser_wait_for', options);
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Navigate back
   */
  async goBack(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('browser_navigate_back', {});
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    try {
      await this.callTool('browser_close', {});
    } catch (error) {
      console.warn('⚠️ Error closing browser:', error);
    }
  }

  /**
   * Evaluate JavaScript in the browser
   */
  async evaluate(script: string): Promise<{ success: boolean; result?: string; error?: string }> {
    try {
      // Playwright MCP browser_evaluate expects a callable function string.
      // Wrap the script so any expression or IIFE is returned from an arrow function.
      const wrappedScript = `() => { return ${script.trim()} }`;
      const result = await this.callTool('browser_evaluate', { function: wrappedScript });
      if (result.isError) {
        return { success: false, error: this.getTextContent(result) };
      }
      return { success: true, result: this.getTextContent(result) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get value of an input field by ref
   */
  async getInputValue(ref: string): Promise<string | null> {
    try {
      // Use browser_evaluate to get the value of the element
      // The ref format is like "e42", we need to find the element and get its value
      const script = `
        (() => {
          // Find all input, textarea, and contenteditable elements
          const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
          for (const input of inputs) {
            // Check if this element's value contains what we're looking for
            const value = input.value || input.textContent || '';
            if (value) return value;
          }
          return '';
        })()
      `;
      const result = await this.evaluate(script);
      return result.success ? result.result || null : null;
    } catch {
      return null;
    }
  }

  /**
   * Search for text in all input field values on the page
   */
  async findTextInInputs(searchText: string): Promise<{ found: boolean; value?: string; fieldType?: string }> {
    try {
      const script = `
        (() => {
          const searchLower = ${JSON.stringify(searchText.toLowerCase())};
          const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
          for (const input of inputs) {
            const value = input.value || input.textContent || '';
            if (value.toLowerCase().includes(searchLower)) {
              return JSON.stringify({
                found: true,
                value: value,
                fieldType: input.tagName.toLowerCase() + (input.type ? '[' + input.type + ']' : '')
              });
            }
          }
          return JSON.stringify({ found: false });
        })()
      `;
      const result = await this.evaluate(script);
      if (result.success && result.result) {
        try {
          return JSON.parse(result.result);
        } catch {
          return { found: false };
        }
      }
      return { found: false };
    } catch {
      return { found: false };
    }
  }

  /**
   * Parse accessibility tree to extract interactive elements
   */
  parseElements(yaml: string): Array<{
    type: string;
    ref: string;
    text: string;
    url?: string;
    level?: number;
  }> {
    const elements: Array<{
      type: string;
      ref: string;
      text: string;
      url?: string;
      level?: number;
    }> = [];

    // Match patterns like: - link "Text" [ref=e19]
    // or: - button "Text" [ref=e20]
    // or: - textbox "Label" [ref=e15]
    const elementPattern = /- (link|button|textbox|checkbox|radio|combobox|searchbox|heading|img)\s*"([^"]*)"[^\[]*\[ref=([^\]]+)\]/g;

    let match;
    while ((match = elementPattern.exec(yaml)) !== null) {
      const [, type, text, ref] = match;

      const element: {
        type: string;
        ref: string;
        text: string;
        url?: string;
        level?: number;
      } = { type, ref, text };

      // Look for URL on the next line for links
      if (type === 'link') {
        const urlMatch = yaml.slice(match.index).match(/\/url:\s*([^\n]+)/);
        if (urlMatch) {
          element.url = urlMatch[1].trim();
        }
      }

      // Look for heading level
      if (type === 'heading') {
        const levelMatch = yaml.slice(match.index).match(/\[level=(\d+)\]/);
        if (levelMatch) {
          element.level = parseInt(levelMatch[1], 10);
        }
      }

      elements.push(element);
    }

    return elements;
  }
}
