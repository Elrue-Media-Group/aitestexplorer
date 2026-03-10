/**
 * MCP Explorer
 *
 * AI-first exploration using MCP for browser interaction.
 * Combines Vision API understanding with MCP's deterministic element targeting.
 *
 * Architecture:
 * 1. Navigate via MCP
 * 2. Get screenshot + accessibility tree
 * 3. Send BOTH to AI Vision for understanding
 * 4. AI returns structured actions with MCP refs
 * 5. Execute actions via MCP
 * 6. Output PageState[] compatible with existing pipeline
 */

import { MCPClient, MCPSnapshot, MCPScreenshot } from './mcp-client.js';
import { AIVisionService } from './ai-vision.js';
import {
  PageState,
  Action,
  ActionOutcome,
  DiscoveredElements,
  DiscoveredLink,
  DiscoveredButton,
  DiscoveredHeading,
  VisionAnalysis,
  Config,
  ContextFileConfig,
} from './types.js';
import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface MCPExplorerOptions {
  maxPages: number;
  maxActions: number;
  headless: boolean;
  screenshotDir: string;
  contextFile?: ContextFileConfig;
  keepBrowserAlive?: boolean; // Keep browser open for test execution
}

export interface ExplorationResult {
  pages: PageState[];
  mcpClient: MCPClient | null; // Client for continued use (if keepBrowserAlive)
}

export interface MCPAction {
  tool: 'browser_click' | 'browser_type' | 'browser_navigate' | 'browser_select_option' | 'browser_hover';
  ref?: string;
  url?: string;
  text?: string;
  value?: string;
  element?: string;
  reason: string;
}

export interface MCPAnalysisResponse {
  pageClassification: {
    type: 'auth_gate' | 'public_marketing' | 'app_core' | 'settings' | 'error' | 'unknown';
    purpose: string;
  };
  pageDescription: string;
  suggestedActions: MCPAction[];
  loginInfo?: {
    isLoginPage: boolean;
    hasCredentialFields: boolean;
  };
}

interface ExecuteActionsResult {
  navigationOccurred: boolean;
  inlineChangesDetected: boolean;
  actionsExecuted: number;
}

export class MCPExplorer {
  private mcpClient: MCPClient;
  private visionService: AIVisionService;
  private openai: OpenAI;
  private model: string;
  private options: MCPExplorerOptions;
  private visitedUrls: Set<string> = new Set();
  private pages: PageState[] = [];
  private actionCount = 0;
  private startOrigin = ''; // Same-origin guard: only explore pages on this domain

  /**
   * External protocols that should not be clicked (would open external apps)
   */
  private static readonly BLOCKED_PROTOCOLS = ['mailto:', 'tel:', 'javascript:', 'data:', 'blob:', 'file:'];

  constructor(config: Config, options: MCPExplorerOptions) {
    this.mcpClient = new MCPClient({ headless: options.headless });
    this.visionService = new AIVisionService(config);
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiModel;
    this.options = options;
  }

  /**
   * Main exploration entry point
   */
  async explore(startUrl: string): Promise<PageState[]> {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🔍 MCP Explorer - AI-First Exploration');
    console.log('='.repeat(60));
    console.log(`Start URL: ${startUrl}`);
    console.log(`Max Pages: ${this.options.maxPages}`);
    console.log(`Max Actions: ${this.options.maxActions}`);
    console.log('');

    try {
      // Record start origin for same-origin guard
      try { this.startOrigin = new URL(startUrl).origin; } catch { this.startOrigin = ''; }

      // Connect to MCP server
      await this.mcpClient.connect();

      // Ensure screenshot directory exists
      if (!existsSync(this.options.screenshotDir)) {
        await mkdir(this.options.screenshotDir, { recursive: true });
      }

      // Start exploration
      await this.explorePage(startUrl);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ Exploration complete: ${this.pages.length} pages, ${this.actionCount} actions`);
      console.log('='.repeat(60));

      // If keepBrowserAlive, return client for test execution
      if (this.options.keepBrowserAlive) {
        console.log('🔗 Keeping browser alive for test execution');
        return this.pages;
      }

      // Otherwise close browser
      await this.mcpClient.close();
      return this.pages;
    } finally {
      // Only disconnect if not keeping alive
      if (!this.options.keepBrowserAlive) {
        await this.mcpClient.disconnect();
      }
    }
  }

  /**
   * Explore a single page with single-pass flow.
   *
   * Navigate → capture state → AI analysis (ONE call) → execute within-page actions →
   * refresh refs → execute navigation actions → recursively explore new pages.
   *
   * Refs from the initial snapshot stay valid because click() no longer auto-snapshots.
   * Failed refs (from DOM mutations) just get skipped gracefully.
   */
  private async explorePage(url: string): Promise<void> {
    // Check limits
    if (this.pages.length >= this.options.maxPages) {
      console.log(`⚠️ Max pages (${this.options.maxPages}) reached, stopping exploration`);
      return;
    }

    if (this.actionCount >= this.options.maxActions) {
      console.log(`⚠️ Max actions (${this.options.maxActions}) reached, stopping exploration`);
      return;
    }

    // Same-origin guard: never explore external domains
    try {
      const urlOrigin = new URL(url).origin;
      if (this.startOrigin && urlOrigin !== this.startOrigin) {
        console.log(`⏭️ Skipping off-site URL: ${url} (origin ${urlOrigin} != ${this.startOrigin})`);
        return;
      }
    } catch { /* malformed URL, let it fail at navigation */ }

    // Normalize URL and check if visited
    const normalizedUrl = this.normalizeUrl(url);
    if (this.visitedUrls.has(normalizedUrl)) {
      console.log(`⏭️ Already visited: ${normalizedUrl}`);
      return;
    }
    this.visitedUrls.add(normalizedUrl);

    console.log(`\n📄 Exploring page ${this.pages.length + 1}: ${url}`);

    // Navigate to page
    const navResult = await this.mcpClient.navigate(url);
    if (!navResult.success) {
      console.error(`❌ Navigation failed: ${navResult.error}`);
      return;
    }

    // Wait for dynamic content to load (AI-first approach)
    await this.waitForDynamicContent();

    // Get page state (screenshot + accessibility tree)
    const pageState = await this.capturePageState(url);
    if (!pageState) {
      console.error('❌ Failed to capture page state');
      return;
    }

    // Analyze page with AI — one call, trust the AI's judgment
    const analysis = await this.analyzePageWithAI(pageState);
    if (!analysis?.suggestedActions?.length) {
      this.pages.push(pageState);
      return;
    }

    pageState.visionAnalysis = this.convertToVisionAnalysis(analysis);
    this.pages.push(pageState);

    // Separate within-page actions from navigation actions
    const withinPageActions = analysis.suggestedActions.filter(
      a => a.tool !== 'browser_navigate' && !this.isNavigationClick(a)
    );
    const navigationActions = analysis.suggestedActions.filter(
      a => a.tool === 'browser_navigate' || this.isNavigationClick(a)
    );

    // Execute within-page actions first (filters, toggles, etc.)
    // If an action fails from stale refs, it just gets skipped — no re-analysis needed
    const maxActionsThisPage = Math.min(10, this.options.maxActions - this.actionCount);
    if (withinPageActions.length > 0) {
      const result = await this.executeActions(withinPageActions, pageState, maxActionsThisPage);
      if (result.navigationOccurred) {
        return; // explorePage was called recursively already
      }
    }

    // Then execute navigation actions to discover new pages
    if (navigationActions.length > 0 && this.actionCount < this.options.maxActions) {
      // Refresh refs since within-page actions may have changed the DOM
      const freshSnap = await this.mcpClient.getSnapshot();
      if (freshSnap) {
        const freshNavActions = this.refreshNavigationActions(navigationActions, freshSnap.rawYaml);
        const remainingBudget = maxActionsThisPage - withinPageActions.length;
        await this.executeActions(freshNavActions, pageState, Math.max(remainingBudget, 2));
      }
    }
  }

  /**
   * AI-first wait for dynamic content to finish loading.
   * Short buffer wait, then AI vision check to confirm page is ready.
   */
  private async waitForDynamicContent(): Promise<void> {
    // Short buffer wait - catches most timing issues without AI cost
    await this.mcpClient.waitFor({ time: 2000 });

    // Take a screenshot for AI to evaluate
    const screenshot = await this.mcpClient.takeScreenshot();
    if (!screenshot) {
      console.log('⚠️  Could not take screenshot for loading check');
      return;
    }

    // Save temp screenshot for AI analysis
    const timestamp = Date.now();
    const tempPath = join(this.options.screenshotDir, `loading-check-${timestamp}.png`);
    const buffer = Buffer.from(screenshot.data, 'base64');
    await writeFile(tempPath, buffer);

    try {
      const result = await this.visionService.isPageLoaded(tempPath);

      if (result.loaded) {
        console.log(`✅ Page loaded: ${result.reason}`);
        try { (await import('fs')).unlinkSync(tempPath); } catch {}
        return;
      }

      // AI says still loading - wait and re-check (up to 2 more times)
      console.log(`⏳ Page still loading: ${result.reason}`);
      const maxRetries = 2;
      for (let i = 0; i < maxRetries; i++) {
        await this.mcpClient.waitFor({ time: 5000 });

        const retryScreenshot = await this.mcpClient.takeScreenshot();
        if (!retryScreenshot) break;

        const retryBuffer = Buffer.from(retryScreenshot.data, 'base64');
        await writeFile(tempPath, retryBuffer);

        const recheck = await this.visionService.isPageLoaded(tempPath);
        if (recheck.loaded) {
          console.log(`✅ Page loaded after extra wait: ${recheck.reason}`);
          try { (await import('fs')).unlinkSync(tempPath); } catch {}
          return;
        }
        console.log(`⏳ Still loading (check ${i + 2}): ${recheck.reason}`);
      }

      console.log('⚠️  Page may still be loading after max wait - proceeding');
      try { (await import('fs')).unlinkSync(tempPath); } catch {}
    } catch (error) {
      console.warn(`⚠️  Loading check failed, proceeding: ${error}`);
      try { (await import('fs')).unlinkSync(tempPath); } catch {}
    }
  }

  /**
   * Capture current page state (screenshot + accessibility tree)
   */
  private async capturePageState(url: string): Promise<PageState | null> {
    // Get accessibility snapshot
    const snapshot = await this.mcpClient.getSnapshot();
    if (!snapshot) {
      return null;
    }

    // Get screenshot
    const screenshot = await this.mcpClient.takeScreenshot();
    if (!screenshot) {
      return null;
    }

    // Save screenshot to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = join(this.options.screenshotDir, `page-${this.pages.length + 1}-${timestamp}.png`);

    // Convert base64 to buffer and save
    const buffer = Buffer.from(screenshot.data, 'base64');
    await writeFile(screenshotPath, buffer);
    console.log(`📸 Screenshot saved: ${screenshotPath}`);

    // Parse elements from accessibility tree
    const discoveredElements = this.parseDiscoveredElements(snapshot.rawYaml);

    return {
      url: snapshot.url || url,
      title: snapshot.title || '',
      screenshot: screenshotPath,
      timestamp: new Date(),
      actions: [],
      discoveredElements,
      accessibilityTree: snapshot.rawYaml,
    };
  }

  /**
   * Parse discovered elements from accessibility tree
   */
  private parseDiscoveredElements(yaml: string): DiscoveredElements {
    const elements = this.mcpClient.parseElements(yaml);

    const links: DiscoveredLink[] = [];
    const buttons: DiscoveredButton[] = [];
    const headings: DiscoveredHeading[] = [];

    for (const el of elements) {
      if (el.type === 'link') {
        links.push({
          text: el.text,
          href: el.url || '',
          isExternal: el.url?.startsWith('http') && !el.url?.includes('localhost') || false,
          mcpRef: el.ref,
        });
      } else if (el.type === 'button') {
        buttons.push({
          text: el.text,
          type: 'button',
          visible: true,
          mcpRef: el.ref,
        });
      } else if (el.type === 'heading') {
        headings.push({
          level: el.level || 1,
          text: el.text,
          mcpRef: el.ref,
        });
      }
    }

    return {
      links,
      buttons,
      forms: [], // TODO: Parse forms from accessibility tree
      headings,
      navigationItems: links.filter(l => !l.isExternal).map(l => l.text),
    };
  }

  /**
   * Analyze page with AI Vision - sends both screenshot and accessibility tree
   */
  private async analyzePageWithAI(pageState: PageState): Promise<MCPAnalysisResponse | null> {
    console.log('🤖 Analyzing page with AI Vision + MCP context...');

    // Build context for AI
    let contextPrompt = '';
    const credentials = this.options.contextFile?.credentials || this.options.contextFile?.authentication?.credentials;
    if (this.options.contextFile) {
      if (this.options.contextFile.siteDescription) {
        contextPrompt += `Site Description: ${this.options.contextFile.siteDescription}\n`;
      }
      if (credentials) {
        contextPrompt += `Credentials available: username=${credentials.username || credentials.email}, password is available\n`;
        contextPrompt += `IMPORTANT: When on a login page, use browser_type to fill in credentials. Use {{username}} for username/email and {{password}} for password.\n`;
      }
    }

    const prompt = `You are an AI-first exploratory QA agent. You have TWO sources of information about this page:

1. **SCREENSHOT**: Visual representation of the page (attached image)
2. **ACCESSIBILITY TREE**: Structured element data with refs for targeting (below)

${contextPrompt ? `**SITE CONTEXT:**\n${contextPrompt}\n` : ''}

**CURRENT URL:** ${pageState.url}
**PAGE TITLE:** ${pageState.title}

**ALREADY VISITED PAGES (do NOT suggest navigating to these):**
${Array.from(this.visitedUrls).map(u => `- ${u}`).join('\n') || '- (none yet)'}

**ACCESSIBILITY TREE (use refs for actions):**
\`\`\`yaml
${pageState.accessibilityTree?.substring(0, 4000) || 'No accessibility tree available'}
\`\`\`

=== YOUR TASK ===
1. Look at the screenshot to understand the page visually
2. Use the accessibility tree to find exact element refs
3. Decide what actions to take for exploration/testing
4. Return actions using MCP refs (e.g., ref=e19) for deterministic targeting

=== RESPONSE FORMAT ===
Respond with a JSON object (no markdown code blocks):

{
  "pageClassification": {
    "type": "auth_gate | public_marketing | app_core | settings | error | unknown",
    "purpose": "One sentence describing the page"
  },
  "pageDescription": "2-4 sentences about what you see",
  "suggestedActions": [
    {
      "tool": "browser_click | browser_type | browser_navigate",
      "ref": "eXX",
      "text": "for browser_type, the text to type",
      "element": "human description of element",
      "reason": "why this action"
    }
  ],
  "loginInfo": {
    "isLoginPage": true/false,
    "hasCredentialFields": true/false
  }
}

=== EXPLORATION STRATEGY ===
You are building a mental model of this site. Be STRATEGIC, not exhaustive.

Suggest up to 5 actions, split into two categories:

**WITHIN-PAGE INTERACTIONS (1-3 actions):**
Pick REPRESENTATIVE interactions that reveal different behaviors.
- If there are 5 filters, click ONE (not all 5 — the rest work the same way).
- If there are tabs, try ONE tab switch.
- Prefer actions that reveal NEW functionality: search, toggles, dropdowns, form submissions.
- Do NOT click multiple similar elements (e.g., don't click 3 different filter buttons).
- Do NOT repeat actions listed in "ACTIONS ALREADY TAKEN" above.

**NAVIGATION TO UNVISITED PAGES (1-2 actions):**
Always include navigation to discover new pages.
- Click links to NEW pages not in the "ALREADY VISITED" list.
- Prioritize core app sections (dashboard, features) over marketing/about pages.
- Mark navigation actions clearly with reason: "Navigate to [page name]"

**NEVER click external links** (links to other domains like YouTube, news sites, etc.).
Only interact with elements on this site.

=== ACTION FORMAT ===
- Use "browser_click" with "ref" to click elements
- Use "browser_type" with "ref" and "text" to fill fields
- Use "browser_navigate" with "url" to go to a new page
- For login: fill username first, then password, then click submit
- **NEVER click mailto:, tel:, javascript: or other external protocol links** - only click links that navigate within the site

IMPORTANT: Return ONLY the JSON object.`;

    try {
      // Read screenshot file and convert to base64
      const { readFile } = await import('fs/promises');
      const screenshotBuffer = await readFile(pageState.screenshot);
      const base64Image = screenshotBuffer.toString('base64');

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${base64Image}` },
              },
            ],
          },
        ],
        max_completion_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '';
      console.log(`📄 AI Response (first 300 chars): ${content.substring(0, 300)}...`);

      const parsed: MCPAnalysisResponse = JSON.parse(content);
      console.log(`✅ Parsed ${parsed.suggestedActions?.length || 0} suggested actions`);

      return parsed;
    } catch (error) {
      console.error('❌ AI analysis failed:', error);
      return null;
    }
  }

  /**
   * Convert MCP analysis to VisionAnalysis format for compatibility
   */
  private convertToVisionAnalysis(analysis: MCPAnalysisResponse): VisionAnalysis {
    return {
      description: analysis.pageDescription,
      interactiveElements: [],
      suggestedActions: analysis.suggestedActions.map(a => ({
        action: `${a.tool}(${a.ref || a.url || ''})`,
        reason: a.reason,
        priority: 'high' as const,
      })),
      pageType: analysis.pageClassification.type,
      risks: [],
      architecture: {
        layout: '',
        navigation: [],
        forms: [],
        keyFeatures: [],
        technology: [],
      },
      loginInfo: analysis.loginInfo ? {
        isLoginPage: analysis.loginInfo.isLoginPage,
        credentialsVisible: analysis.loginInfo.hasCredentialFields,
        shouldLogin: analysis.loginInfo.isLoginPage,
      } : undefined,
    };
  }

  /**
   * Execute suggested actions, returning what happened.
   * Runs all actions in sequence. Failed refs from stale DOM just get skipped.
   * Breaks only on navigation (remaining refs are definitely stale after page change).
   */
  private async executeActions(actions: MCPAction[], pageState: PageState, maxActionsThisBatch: number = Infinity): Promise<ExecuteActionsResult> {
    const result: ExecuteActionsResult = {
      navigationOccurred: false,
      inlineChangesDetected: false,
      actionsExecuted: 0,
    };

    for (const action of actions) {
      if (this.actionCount >= this.options.maxActions) {
        console.log(`⚠️ Max actions reached, stopping`);
        break;
      }

      if (result.actionsExecuted >= maxActionsThisBatch) {
        console.log(`⚠️ Per-page action budget exhausted, stopping`);
        break;
      }

      console.log(`\n▶️ Executing: ${action.tool} ${action.ref || action.url || ''} - ${action.reason}`);

      const actionRecord: Action = {
        type: this.mapToolToActionType(action.tool),
        target: action.ref || action.url,
        value: action.text,
        description: action.reason,
        timestamp: new Date(),
        success: false,
      };

      // FLOW-AWARE: Capture state BEFORE the action
      const stateBefore = await this.captureQuickState();

      try {
        let mcpResult: { success: boolean; error?: string };

        switch (action.tool) {
          case 'browser_click':
            if (!action.ref) {
              console.log('⚠️ No ref provided for click');
              continue;
            }
            // Check if this element has a blocked protocol URL (mailto:, tel:, etc.)
            const blockedReason = this.checkBlockedProtocol(action.ref, pageState.accessibilityTree || '');
            if (blockedReason) {
              console.log(`⏭️ Skipping click: ${blockedReason}`);
              actionRecord.success = false;
              actionRecord.error = blockedReason;
              pageState.actions.push(actionRecord);
              continue;
            }
            mcpResult = await this.mcpClient.click(action.ref, action.element);
            break;

          case 'browser_type':
            if (!action.ref || !action.text) {
              console.log('⚠️ Missing ref or text for type');
              continue;
            }
            // Check if this is a credential field - support both contextFile.credentials and contextFile.authentication.credentials
            let textToType = action.text;
            const creds = this.options.contextFile?.credentials || this.options.contextFile?.authentication?.credentials;
            if (creds) {
              if (action.text === '{{username}}' || action.text === '{{credentials.username}}' || action.text === '{{email}}') {
                textToType = creds.username || creds.email || '';
                console.log(`🔐 Substituting credential placeholder with: ${textToType.substring(0, 3)}...`);
              } else if (action.text === '{{password}}' || action.text === '{{credentials.password}}') {
                textToType = creds.password || '';
                console.log(`🔐 Substituting password placeholder`);
              }
            }
            mcpResult = await this.mcpClient.type(action.ref, textToType, { elementDescription: action.element });
            break;

          case 'browser_navigate':
            if (!action.url) {
              console.log('⚠️ No URL provided for navigate');
              continue;
            }
            mcpResult = await this.mcpClient.navigate(action.url);
            // After navigation, explore the new page
            if (mcpResult.success) {
              this.actionCount++;
              result.actionsExecuted++;
              result.navigationOccurred = true;
              actionRecord.success = true;
              // FLOW-AWARE: Record navigation outcome
              actionRecord.outcome = {
                urlBefore: stateBefore.url,
                urlAfter: action.url,
                navigationOccurred: true,
              };
              pageState.actions.push(actionRecord);
              await this.explorePage(action.url);
              return result;
            }
            break;

          case 'browser_hover':
            if (!action.ref) {
              console.log('⚠️ No ref provided for hover');
              continue;
            }
            mcpResult = await this.mcpClient.hover(action.ref, action.element);
            break;

          default:
            console.log(`⚠️ Unknown tool: ${action.tool}`);
            continue;
        }

        this.actionCount++;
        result.actionsExecuted++;
        actionRecord.success = mcpResult.success;
        if (!mcpResult.success) {
          actionRecord.error = mcpResult.error;
          console.log(`❌ Action failed: ${mcpResult.error}`);
        } else {
          console.log(`✅ Action successful`);

          // FLOW-AWARE: Capture state AFTER successful action and detect outcome
          await this.waitForMCPStateStabilization(2000);
          const stateAfter = await this.captureQuickState();
          const outcome = this.detectMCPActionOutcome(stateBefore, stateAfter);
          actionRecord.outcome = outcome;

          // Log what we observed
          if (outcome.navigationOccurred) {
            console.log(`   📍 OBSERVED: Navigation to ${outcome.urlAfter}`);
          }
          if (outcome.modalAppeared?.detected) {
            console.log(`   📍 OBSERVED: Modal appeared${outcome.modalAppeared.title ? `: "${outcome.modalAppeared.title}"` : ''}`);
          }
          if (outcome.inlineUpdateDetected) {
            console.log(`   📍 OBSERVED: Inline content update (no navigation)`);
          }

          // Get AI interpretation for significant state changes
          if (outcome.navigationOccurred || outcome.modalAppeared?.detected || outcome.inlineUpdateDetected) {
            try {
              const interpretation = await this.visionService.getQuickInterpretation(
                action.reason || action.element || 'action',
                outcome
              );
              if (interpretation) {
                outcome.aiInterpretation = interpretation;
                console.log(`   🤖 AI Interpretation: ${interpretation}`);
              }
            } catch (err) {
              // AI interpretation is optional, don't fail the action
              console.warn(`   ⚠️ AI interpretation failed: ${err}`);
            }
          }
        }
      } catch (error) {
        actionRecord.error = String(error);
        console.log(`❌ Action error: ${error}`);
      }

      pageState.actions.push(actionRecord);

      // After click actions, check if we navigated to a new page
      if (action.tool === 'browser_click' && actionRecord.outcome?.navigationOccurred) {
        // We already detected navigation via outcome detection
        const newUrl = actionRecord.outcome.urlAfter;
        console.log(`📍 Navigated to new page: ${newUrl}`);
        result.navigationOccurred = true;
        await this.explorePage(newUrl);
        // IMPORTANT: Break out - remaining refs are from old page and are stale
        return result;
      } else if (action.tool === 'browser_click' && !actionRecord.outcome) {
        // Fallback: if outcome detection wasn't run (e.g., action failed), check snapshot
        const snapshot = await this.mcpClient.getSnapshot();
        if (snapshot && snapshot.url !== pageState.url) {
          // Only treat as navigation if pathname changed (not just query params)
          try {
            const oldUrl = new URL(pageState.url);
            const newUrl = new URL(snapshot.url);
            if (oldUrl.origin !== newUrl.origin || oldUrl.pathname !== newUrl.pathname) {
              console.log(`📍 Navigated to new page: ${snapshot.url}`);
              result.navigationOccurred = true;
              await this.explorePage(snapshot.url);
              return result;
            }
          } catch {
            console.log(`📍 Navigated to new page: ${snapshot.url}`);
            result.navigationOccurred = true;
            await this.explorePage(snapshot.url);
            return result;
          }
        }
      }

      // Track inline DOM changes (but keep executing — stale refs just fail gracefully)
      if (actionRecord.outcome?.inlineUpdateDetected || actionRecord.outcome?.modalAppeared?.detected) {
        result.inlineChangesDetected = true;
      }
    }

    return result;
  }

  // ============================================================================
  // FLOW-AWARE: State capture and outcome detection for MCP exploration
  // ============================================================================

  /**
   * Capture a quick state snapshot for before/after comparison.
   * Uses browser_evaluate to get URL and content fingerprint WITHOUT calling
   * browser_snapshot (which would invalidate all existing MCP refs).
   */
  private async captureQuickState(): Promise<{
    url: string;
    contentHash: string;
    hasDialogs: boolean;
    dialogTitles: string[];
  }> {
    const defaults = { url: '', contentHash: '', hasDialogs: false, dialogTitles: [] as string[] };

    try {
      // Use querySelectorAll('*').length instead of innerText.length to avoid
      // expensive layout reflow that can timeout on content-heavy pages.
      const evaluatePromise = this.mcpClient.evaluate(`
        JSON.stringify({
          url: window.location.href,
          nodeCount: document.querySelectorAll('*').length,
          title: document.title,
          hasDialogs: !!document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]'),
          dialogTitles: Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]'))
            .map(d => d.getAttribute('aria-label') || d.querySelector('h1,h2,h3,h4,[class*="title"]')?.textContent || '')
            .filter(Boolean)
        })
      `);

      // 5-second timeout guard so a slow evaluate can't block the action loop
      const result = await Promise.race([
        evaluatePromise,
        new Promise<{ success: false; result?: string; error?: string }>(resolve =>
          setTimeout(() => resolve({ success: false, error: 'captureQuickState timeout (5s)' }), 5000)
        ),
      ]);

      if (!result.success || !result.result) {
        console.warn(`⚠️ captureQuickState evaluate failed: success=${result.success}, error="${result.error || 'no result'}", result="${(result.result || '').substring(0, 100)}"`);
        return defaults;
      }

      let state: { url?: string; nodeCount?: number; title?: string; hasDialogs?: boolean; dialogTitles?: string[] };
      try {
        state = JSON.parse(result.result);
      } catch (parseErr) {
        console.warn(`⚠️ captureQuickState JSON.parse failed: ${parseErr}, raw="${result.result.substring(0, 200)}"`);
        return defaults;
      }

      const contentHash = `${state.nodeCount || 0}:${state.title || ''}`;

      return {
        url: state.url || '',
        contentHash,
        hasDialogs: state.hasDialogs || false,
        dialogTitles: state.dialogTitles || [],
      };
    } catch (error) {
      console.warn(`⚠️ captureQuickState failed: ${error}`);
      return defaults;
    }
  }

  /**
   * Detect what happened after an action by comparing before/after states.
   * Adapted for MCP (uses accessibility tree instead of DOM evaluation).
   */
  private detectMCPActionOutcome(
    stateBefore: { url: string; contentHash: string; hasDialogs: boolean; dialogTitles: string[] },
    stateAfter: { url: string; contentHash: string; hasDialogs: boolean; dialogTitles: string[] }
  ): ActionOutcome {
    // Distinguish real page navigation from query-param-only changes (e.g., filters)
    let navigationOccurred = false;
    if (stateBefore.url !== stateAfter.url) {
      try {
        const before = new URL(stateBefore.url);
        const after = new URL(stateAfter.url);
        // Different origin or pathname = real navigation
        // Same pathname but different query/hash = inline update (filters, tabs, etc.)
        navigationOccurred = before.origin !== after.origin || before.pathname !== after.pathname;
      } catch {
        navigationOccurred = true; // can't parse, assume navigation
      }
    }

    const outcome: ActionOutcome = {
      urlBefore: stateBefore.url,
      urlAfter: stateAfter.url,
      navigationOccurred,
      contentHashBefore: stateBefore.contentHash,
      contentHashAfter: stateAfter.contentHash,
    };

    // Check for new modals/dialogs
    if (!stateBefore.hasDialogs && stateAfter.hasDialogs) {
      outcome.modalAppeared = {
        detected: true,
        title: stateAfter.dialogTitles[0],
        type: 'dialog',
      };
    } else if (stateAfter.dialogTitles.length > stateBefore.dialogTitles.length) {
      // New dialog appeared (even if there were already some)
      const newTitle = stateAfter.dialogTitles.find(t => !stateBefore.dialogTitles.includes(t));
      outcome.modalAppeared = {
        detected: true,
        title: newTitle,
        type: 'dialog',
      };
    }

    // Check for inline content updates (content changed but URL didn't)
    if (!outcome.navigationOccurred && stateBefore.contentHash !== stateAfter.contentHash) {
      outcome.inlineUpdateDetected = true;
    }

    return outcome;
  }

  /**
   * Wait for MCP page state to stabilize after an action.
   * Polls the accessibility snapshot to detect when changes stop.
   */
  private async waitForMCPStateStabilization(maxWaitMs: number = 2000): Promise<void> {
    const checkInterval = 500;
    let waitedTime = 0;
    let lastState = await this.captureQuickState();

    while (waitedTime < maxWaitMs) {
      await this.mcpClient.waitFor({ time: checkInterval });
      waitedTime += checkInterval;

      const currentState = await this.captureQuickState();

      // Check if state has stabilized
      if (currentState.url === lastState.url && currentState.contentHash === lastState.contentHash) {
        break; // State is stable
      }

      lastState = currentState;
    }
  }

  private mapToolToActionType(tool: string): Action['type'] {
    switch (tool) {
      case 'browser_click':
        return 'click';
      case 'browser_type':
        return 'type';
      case 'browser_navigate':
        return 'navigate';
      case 'browser_select_option':
        return 'select';
      default:
        return 'click';
    }
  }

  /**
   * Heuristic: does this action look like navigation to a different page?
   * Checks if the AI's reason mentions "navigate", "go to", "visit", or "new page".
   */
  private isNavigationClick(action: MCPAction): boolean {
    if (action.tool === 'browser_navigate') return true;
    const reason = (action.reason || '').toLowerCase();
    const element = (action.element || '').toLowerCase();
    // Navigation keywords in the reason
    const navKeywords = ['navigate', 'go to', 'visit', 'new page', 'explore a new', 'different page'];
    if (navKeywords.some(kw => reason.includes(kw))) return true;
    // If the element is described as a nav link
    if (element.includes('nav') && element.includes('link')) return true;
    return false;
  }

  /**
   * Re-resolve navigation actions against a fresh accessibility tree.
   * Navigation links (Archive, Analytics, etc.) are usually stable,
   * but their refs change after DOM mutations.
   */
  private refreshNavigationActions(actions: MCPAction[], freshYaml: string): MCPAction[] {
    const elements = this.mcpClient.parseElements(freshYaml);
    const refreshed: MCPAction[] = [];

    for (const action of actions) {
      if (action.tool === 'browser_navigate') {
        // URL-based navigation doesn't need ref refresh
        refreshed.push(action);
        continue;
      }

      // Try to find the same element by text match
      const targetText = (action.element || '').toLowerCase().trim();
      const match = elements.find(e =>
        e.text.toLowerCase().includes(targetText) || targetText.includes(e.text.toLowerCase())
      );

      if (match?.ref) {
        refreshed.push({ ...action, ref: match.ref });
      } else {
        // Keep original ref as fallback — it might still work
        refreshed.push(action);
      }
    }

    return refreshed;
  }

  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Keep query params for now, just normalize protocol and trailing slashes
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}`;
    } catch {
      return url;
    }
  }

  /**
   * Get the MCP client for direct access if needed
   */
  getMCPClient(): MCPClient {
    return this.mcpClient;
  }

  /**
   * Check if an element's URL uses a blocked protocol (mailto:, tel:, etc.)
   * Uses the already-captured accessibility tree to avoid calling getSnapshot() (which invalidates refs).
   */
  private checkBlockedProtocol(ref: string, accessibilityTree: string): string | null {
    try {
      const elements = this.mcpClient.parseElements(accessibilityTree);
      const element = elements.find(e => e.ref === ref);

      if (element?.url) {
        const url = element.url.toLowerCase();
        for (const protocol of MCPExplorer.BLOCKED_PROTOCOLS) {
          if (url.startsWith(protocol)) {
            return `Element has ${protocol} URL which would open external application`;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
