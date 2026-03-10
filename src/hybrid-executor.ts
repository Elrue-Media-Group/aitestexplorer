/**
 * Hybrid Test Executor
 *
 * Executes test cases using MCP refs for deterministic targeting.
 * Uses tiered self-healing: ref → text search → AI rescue → fail
 *
 * Key features:
 * - Uses MCPClient from exploration (preserves auth session)
 * - Executes steps without AI per step (fast, cheap)
 * - Structured verification (URL, element presence)
 * - Self-healing fallbacks when refs become stale
 */

import { MCPClient, MCPSnapshot } from './mcp-client.js';
import { AIVisionService } from './ai-vision.js';
import {
  HybridTestCase,
  HybridTestStep,
  HybridTestResult,
  HybridStepResult,
  HybridVerification,
  HybridVerificationResult,
  ElementTarget,
  Config,
  ContextFileConfig,
} from './types.js';
import OpenAI from 'openai';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface HybridExecutorOptions {
  outputDir: string;
  screenshotDir: string;
  headless: boolean;
  contextFile?: ContextFileConfig;
  /** Enable AI rescue on element resolution failure */
  enableAIRescue?: boolean;
  /** Max retries per step before failing */
  maxRetries?: number;
}

interface ResolvedElement {
  ref: string;
  resolvedBy: 'mcpRef' | 'selector' | 'text' | 'ai_rescue';
}

export class HybridTestExecutor {
  private mcpClient: MCPClient;
  private openai: OpenAI;
  private model: string;
  private options: HybridExecutorOptions;
  private ownsMCPClient: boolean = false;
  private testOrigin: string = ''; // Same-origin guard: track the site under test

  constructor(
    config: Config,
    options: HybridExecutorOptions,
    mcpClient?: MCPClient
  ) {
    if (mcpClient) {
      this.mcpClient = mcpClient;
      this.ownsMCPClient = false;
    } else {
      this.mcpClient = new MCPClient({ headless: options.headless });
      this.ownsMCPClient = true;
    }
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiModel;
    this.options = {
      enableAIRescue: true,
      maxRetries: 2,
      ...options,
    };
  }

  /**
   * Execute all test cases
   */
  async executeAll(testCases: HybridTestCase[]): Promise<HybridTestResult[]> {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🚀 Hybrid Test Executor - Starting Execution');
    console.log('='.repeat(60));
    console.log(`Total tests: ${testCases.length}`);

    // Ensure directories exist
    if (!existsSync(this.options.screenshotDir)) {
      await mkdir(this.options.screenshotDir, { recursive: true });
    }

    // Connect if we own the client
    if (this.ownsMCPClient) {
      await this.mcpClient.connect();
    }

    const results: HybridTestResult[] = [];

    try {
      for (const testCase of testCases) {
        const result = await this.executeTest(testCase);
        results.push(result);

        const icon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
        console.log(`${icon} ${testCase.id}: ${testCase.name} - ${result.status.toUpperCase()}`);

        // Log failure reason if test failed
        if (result.status === 'failed' && result.failureReason) {
          console.log(`   └── Reason: ${result.failureReason}`);
        }
      }
    } finally {
      // Only close if we own the client
      if (this.ownsMCPClient) {
        await this.mcpClient.close();
        await this.mcpClient.disconnect();
      }
    }

    // Print summary
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed} | Total: ${results.length}`);
    console.log('='.repeat(60));

    return results;
  }

  /**
   * Execute a single test case
   */
  async executeTest(testCase: HybridTestCase): Promise<HybridTestResult> {
    console.log(`\n📋 Executing: ${testCase.id} - ${testCase.name}`);
    const startTime = Date.now();
    const stepResults: HybridStepResult[] = [];
    const screenshots: string[] = [];
    let usedAIRescue = false;

    try {
      // Record origin for same-origin guard
      try { this.testOrigin = new URL(testCase.startUrl).origin; } catch { this.testOrigin = ''; }

      // Navigate to start URL
      console.log(`📍 Navigating to: ${testCase.startUrl}`);
      const navResult = await this.mcpClient.navigate(testCase.startUrl);
      if (!navResult.success) {
        return this.createFailedResult(testCase, startTime, `Failed to navigate: ${navResult.error}`, stepResults, screenshots, usedAIRescue);
      }

      // Wait for page to settle
      await this.wait(500);

      // Execute each step
      for (const step of testCase.steps) {
        console.log(`  Step ${step.stepNumber}: ${step.action} - ${step.description}`);

        const stepResult = await this.executeStep(step);
        stepResults.push(stepResult);

        if (stepResult.resolvedBy === 'ai_rescue') {
          usedAIRescue = true;
        }

        if (stepResult.status === 'failed') {
          // Capture failure screenshot
          const screenshotPath = await this.captureScreenshot(`${testCase.id}-step${step.stepNumber}-failed`);
          if (screenshotPath) {
            stepResult.screenshot = screenshotPath;
            screenshots.push(screenshotPath);
          }

          return this.createFailedResult(
            testCase,
            startTime,
            `Step ${step.stepNumber} failed: ${stepResult.error}`,
            stepResults,
            screenshots,
            usedAIRescue
          );
        }

        // Skipped steps (e.g., mailto: links) don't fail the test - just continue
        if (stepResult.status === 'skipped') {
          console.log(`    ⏭️ Step skipped: ${stepResult.error}`);
        }

        // Small delay between steps
        await this.wait(300);
      }

      // All steps passed (including verify steps) - test succeeds!
      // Note: verificationResults is kept for backwards compatibility but will be empty
      // since all verifications are now executed as steps
      return {
        testCase,
        status: 'passed',
        stepResults,
        verificationResults: [],
        duration: Date.now() - startTime,
        screenshots,
        usedAIRescue,
        executedAt: new Date(),
      };
    } catch (error) {
      const screenshotPath = await this.captureScreenshot(`${testCase.id}-error`);
      if (screenshotPath) {
        screenshots.push(screenshotPath);
      }

      return this.createFailedResult(
        testCase,
        startTime,
        `Unexpected error: ${error}`,
        stepResults,
        screenshots,
        usedAIRescue
      );
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: HybridTestStep): Promise<HybridStepResult> {
    const startTime = Date.now();

    try {
      switch (step.action) {
        case 'navigate':
          if (!step.url) {
            return this.createStepResult(step, 'failed', startTime, undefined, 'No URL provided for navigate');
          }
          // Block navigation to external sites entirely
          if (this.testOrigin) {
            try {
              const targetOrigin = new URL(step.url).origin;
              if (targetOrigin !== this.testOrigin) {
                console.log(`    ⏭️ Blocking off-site navigation to: ${step.url}`);
                return this.createStepResult(step, 'skipped', startTime, undefined, `Blocked off-site navigation to ${targetOrigin}`);
              }
            } catch { /* malformed URL, let it fail at navigation */ }
          }
          const navResult = await this.mcpClient.navigate(step.url);
          if (!navResult.success) {
            return this.createStepResult(step, 'failed', startTime, undefined, navResult.error);
          }
          await this.wait(500);
          return this.createStepResult(step, 'passed', startTime);

        case 'wait':
          const waitTime = step.value ? parseInt(step.value) : 1000;
          await this.wait(waitTime);
          return this.createStepResult(step, 'passed', startTime);

        case 'click':
          if (!step.target) {
            return this.createStepResult(step, 'failed', startTime, undefined, 'No target for click');
          }
          return await this.executeClickStep(step, startTime);

        case 'type':
          if (!step.target) {
            return this.createStepResult(step, 'failed', startTime, undefined, 'No target for type action');
          }
          // Allow empty string for clearing fields, but require value to be defined
          if (step.value === undefined || step.value === null) {
            return this.createStepResult(step, 'failed', startTime, undefined, 'No value for type action (use empty string to clear)');
          }
          return await this.executeTypeStep(step, startTime);

        case 'verify':
          // Execute verification as a step - if it fails, the step fails
          return await this.executeVerifyStep(step, startTime);

        default:
          return this.createStepResult(step, 'failed', startTime, undefined, `Unknown action: ${step.action}`);
      }
    } catch (error) {
      return this.createStepResult(step, 'failed', startTime, undefined, String(error));
    }
  }

  /**
   * External protocols that should not be clicked (would open external apps)
   */
  private static readonly BLOCKED_PROTOCOLS = ['mailto:', 'tel:', 'javascript:', 'data:', 'blob:', 'file:'];

  /**
   * Execute a click step with self-healing
   */
  private async executeClickStep(step: HybridTestStep, startTime: number): Promise<HybridStepResult> {
    const resolved = await this.resolveElement(step.target!);

    if (!resolved) {
      return this.createStepResult(step, 'failed', startTime, undefined, `Could not resolve element: ${step.target?.description}`);
    }

    // Check if this element has a blocked protocol URL (mailto:, tel:, etc.)
    const blockedReason = await this.checkBlockedProtocol(resolved.ref);
    if (blockedReason) {
      console.log(`    ⏭️ Skipping click: ${blockedReason}`);
      return this.createStepResult(step, 'skipped', startTime, resolved, blockedReason);
    }

    const result = await this.mcpClient.click(resolved.ref, step.target?.description);

    if (!result.success) {
      return this.createStepResult(step, 'failed', startTime, resolved, result.error);
    }

    // Wait for any navigation/updates
    await this.wait(500);

    // Same-origin guard: if we navigated off-site, navigate back immediately
    await this.guardSameOrigin(step);

    return this.createStepResult(step, 'passed', startTime, resolved);
  }

  /**
   * Check if an element's URL uses a blocked protocol (mailto:, tel:, etc.)
   */
  private async checkBlockedProtocol(ref: string): Promise<string | null> {
    try {
      const snapshot = await this.mcpClient.getSnapshot();
      if (!snapshot) return null;

      const elements = this.mcpClient.parseElements(snapshot.rawYaml);
      const element = elements.find(e => e.ref === ref);

      if (element?.url) {
        const url = element.url.toLowerCase();
        for (const protocol of HybridTestExecutor.BLOCKED_PROTOCOLS) {
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

  /**
   * Execute a type step with self-healing
   */
  private async executeTypeStep(step: HybridTestStep, startTime: number): Promise<HybridStepResult> {
    const resolved = await this.resolveElement(step.target!);

    if (!resolved) {
      return this.createStepResult(step, 'failed', startTime, undefined, `Could not resolve element: ${step.target?.description}`);
    }

    // Substitute credential placeholders
    let valueToType = step.value!;
    const creds = this.options.contextFile?.credentials || this.options.contextFile?.authentication?.credentials;
    if (creds) {
      if (valueToType === '{{username}}' || valueToType === '{{email}}') {
        valueToType = creds.username || creds.email || '';
      } else if (valueToType === '{{password}}') {
        valueToType = creds.password || '';
      }
    }

    const result = await this.mcpClient.type(resolved.ref, valueToType, {
      elementDescription: step.target?.description,
    });

    if (!result.success) {
      return this.createStepResult(step, 'failed', startTime, resolved, result.error);
    }

    // Wait for DOM to update with the typed value before verification steps run
    await this.wait(300);

    return this.createStepResult(step, 'passed', startTime, resolved);
  }

  /**
   * Execute a verify step - performs verification and fails step if verification fails
   */
  private async executeVerifyStep(step: HybridTestStep, startTime: number): Promise<HybridStepResult> {
    const snapshot = await this.mcpClient.getSnapshot();

    if (!snapshot) {
      return this.createStepResult(step, 'failed', startTime, undefined, 'Could not get page snapshot for verification');
    }

    const verifyType = step.verifyType || 'url_contains';
    const expected = step.expected || '';

    switch (verifyType) {
      case 'url_contains': {
        const currentUrl = snapshot.url || '';
        if (currentUrl.includes(expected)) {
          return this.createStepResultWithEvidence(step, 'passed', startTime, `URL "${currentUrl}" contains "${expected}"`);
        }
        return this.createStepResultWithEvidence(step, 'failed', startTime, `URL "${currentUrl}" does not contain "${expected}"`, expected, currentUrl);
      }

      case 'url_equals': {
        const currentUrl = snapshot.url || '';
        if (currentUrl === expected) {
          return this.createStepResultWithEvidence(step, 'passed', startTime, `URL matches expected`);
        }
        return this.createStepResultWithEvidence(step, 'failed', startTime, `URL "${currentUrl}" does not equal "${expected}"`, expected, currentUrl);
      }

      case 'page_title': {
        const title = snapshot.title || '';
        if (title.toLowerCase().includes(expected.toLowerCase())) {
          return this.createStepResultWithEvidence(step, 'passed', startTime, `Title "${title}" contains "${expected}"`);
        }
        return this.createStepResultWithEvidence(step, 'failed', startTime, `Title "${title}" does not contain "${expected}"`, expected, title);
      }

      case 'element_visible': {
        if (!step.target) {
          return this.createStepResult(step, 'failed', startTime, undefined, 'No target specified for element_visible verification');
        }
        const resolved = await this.resolveElement(step.target);
        if (resolved) {
          return this.createStepResultWithEvidence(step, 'passed', startTime, `Element found: ${step.target.description} (${resolved.ref})`);
        }
        return this.createStepResultWithEvidence(step, 'failed', startTime, `Element not found: ${step.target.description || step.target.text}`, step.target.description || 'element', 'not found');
      }

      case 'element_not_visible': {
        // INVERTED LOGIC: Element NOT found = PASS (useful for loading indicators)
        if (!step.target) {
          return this.createStepResult(step, 'failed', startTime, undefined, 'No target specified for element_not_visible verification');
        }
        const resolvedForNotVisible = await this.resolveElement(step.target);
        if (!resolvedForNotVisible) {
          // Element NOT found = PASS (this is what we want)
          return this.createStepResultWithEvidence(step, 'passed', startTime, `Element correctly not found: ${step.target.description || step.target.text}`);
        }
        // Element WAS found = FAIL (we didn't want it to be there)
        return this.createStepResultWithEvidence(step, 'failed', startTime, `Element should not be visible but was found: ${step.target.description} (${resolvedForNotVisible.ref})`, 'not visible', 'visible');
      }

      case 'element_text':
      case 'text_on_page': {
        // Search for text anywhere on the page
        // Strategy 1: Search accessibility tree for visible text content
        const elements = this.mcpClient.parseElements(snapshot.rawYaml);
        const textElement = elements.find(e =>
          e.text.toLowerCase().includes(expected.toLowerCase())
        );
        if (textElement) {
          return this.createStepResultWithEvidence(step, 'passed', startTime, `Found text "${textElement.text}" matching "${expected}"`);
        }

        // Strategy 2: Check input field values
        const inputResult = await this.mcpClient.findTextInInputs(expected);
        if (inputResult.found) {
          return this.createStepResultWithEvidence(step, 'passed', startTime, `Found "${expected}" in ${inputResult.fieldType || 'input'} field`);
        }

        return this.createStepResultWithEvidence(step, 'failed', startTime, `Text "${expected}" not found in page content or input fields`, expected, 'not found');
      }

      case 'text_not_on_page': {
        // INVERTED LOGIC: Text NOT found = PASS (useful for error messages that should be gone)
        const elementsForNotOnPage = this.mcpClient.parseElements(snapshot.rawYaml);
        const textElementNotOnPage = elementsForNotOnPage.find(e =>
          e.text.toLowerCase().includes(expected.toLowerCase())
        );
        if (textElementNotOnPage) {
          // Text WAS found = FAIL (we didn't want it to be there)
          return this.createStepResultWithEvidence(step, 'failed', startTime, `Text "${expected}" should not be on page but was found: "${textElementNotOnPage.text}"`, 'not on page', 'found on page');
        }

        // Also check input fields
        const inputResultNotOnPage = await this.mcpClient.findTextInInputs(expected);
        if (inputResultNotOnPage.found) {
          return this.createStepResultWithEvidence(step, 'failed', startTime, `Text "${expected}" should not be on page but was found in input field`, 'not on page', 'found in input');
        }

        // Text NOT found = PASS (this is what we want)
        return this.createStepResultWithEvidence(step, 'passed', startTime, `Text "${expected}" correctly not found on page`);
      }

      default:
        return this.createStepResult(step, 'failed', startTime, undefined, `Unknown verify type: ${verifyType}`);
    }
  }

  /**
   * Helper to create step result with evidence for verify steps
   */
  private createStepResultWithEvidence(
    step: HybridTestStep,
    status: 'passed' | 'failed',
    startTime: number,
    evidence: string,
    expected?: string,
    actual?: string
  ): HybridStepResult {
    return {
      step,
      status,
      resolvedBy: 'none',
      duration: Date.now() - startTime,
      error: status === 'failed' ? evidence : undefined,
      evidence,
      expected,
      actual,
    };
  }

  /**
   * Resolve an element target using AI-first tiered strategies
   * Does NOT rely on stored mcpRef - finds elements fresh each time
   */
  private async resolveElement(target: ElementTarget): Promise<ResolvedElement | null> {
    // Get fresh snapshot
    const snapshot = await this.mcpClient.getSnapshot();
    if (!snapshot) {
      console.log('    ⚠️ Could not get accessibility snapshot');
      return null;
    }

    const elements = this.mcpClient.parseElements(snapshot.rawYaml);

    // Normalize text for matching
    const normalizeText = (text: string) => text.toLowerCase().trim().replace(/\s+/g, ' ');
    // Strip emoji characters for comparison (handles "📰 News", "🎥 Video", etc.)
    const stripEmoji = (text: string) => text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
    let targetText = target.text ? normalizeText(target.text) : null;
    const targetDesc = normalizeText(target.description);

    // Fallback: if target.text is missing, try to extract usable text from description
    // Handles patterns like "Content type filter: News" → "news"
    if (!targetText && target.description) {
      const colonSplit = target.description.split(':');
      if (colonSplit.length > 1) {
        const extracted = normalizeText(colonSplit[colonSplit.length - 1]);
        if (extracted.length >= 2) {
          targetText = extracted;
          console.log(`    🔍 Extracted text from description: "${extracted}"`);
        }
      }
    }

    // Strategy 1: Exact text + type match (most reliable)
    if (targetText) {
      const exactMatch = elements.find(e => {
        const elementText = normalizeText(e.text);
        const textMatches = elementText === targetText;
        const typeMatches = !target.elementType || this.elementTypeMatches(e.type, target.elementType);
        return textMatches && typeMatches;
      });
      if (exactMatch?.ref) {
        console.log(`    ✅ Resolved by exact match: "${target.text}" → ${exactMatch.ref}`);
        return { ref: exactMatch.ref, resolvedBy: 'text' };
      }
    }

    // Strategy 2: Partial text match with type preference (includes emoji-aware matching)
    if (targetText) {
      const strippedTarget = stripEmoji(targetText);

      // First try: text contains target, matching type
      const partialWithType = elements.find(e => {
        const elementText = normalizeText(e.text);
        const strippedElement = stripEmoji(elementText);
        const textMatches = elementText.includes(targetText) || targetText.includes(elementText)
          || strippedElement.includes(strippedTarget) || strippedTarget.includes(strippedElement);
        const typeMatches = !target.elementType || this.elementTypeMatches(e.type, target.elementType);
        return textMatches && typeMatches && strippedElement.length > 0;
      });
      if (partialWithType?.ref) {
        console.log(`    ✅ Resolved by partial match (with type): "${targetText}" → ${partialWithType.ref}`);
        return { ref: partialWithType.ref, resolvedBy: 'text' };
      }

      // Second try: text contains target, any type
      const partialAnyType = elements.find(e => {
        const elementText = normalizeText(e.text);
        const strippedElement = stripEmoji(elementText);
        return (elementText.includes(targetText) || targetText.includes(elementText)
          || strippedElement.includes(strippedTarget) || strippedTarget.includes(strippedElement))
          && strippedElement.length > 0;
      });
      if (partialAnyType?.ref) {
        console.log(`    ✅ Resolved by partial match (any type): "${targetText}" → ${partialAnyType.ref}`);
        return { ref: partialAnyType.ref, resolvedBy: 'text' };
      }
    }

    // Strategy 3: Description keyword matching
    // Extract key action words from description (e.g., "Click the Sign In button" -> "Sign In")
    const keywordMatch = this.findElementByDescription(elements, targetDesc, target.elementType);
    if (keywordMatch?.ref) {
      console.log(`    ✅ Resolved by description keywords: "${target.description}" → ${keywordMatch.ref}`);
      return { ref: keywordMatch.ref, resolvedBy: 'text' };
    }

    // Strategy 4: Type-based search (find first element of matching type)
    if (target.elementType && !targetText) {
      const typeMatch = elements.find(e => this.elementTypeMatches(e.type, target.elementType!));
      if (typeMatch?.ref) {
        console.log(`    ✅ Resolved by type match: ${target.elementType} → ${typeMatch.ref}`);
        return { ref: typeMatch.ref, resolvedBy: 'text' };
      }
    }

    // Strategy 5: AI rescue (if enabled) - uses vision + accessibility tree
    if (this.options.enableAIRescue) {
      console.log(`    🤖 Attempting AI rescue for: ${target.description}`);
      const aiRef = await this.aiResolveElement(target, snapshot);
      if (aiRef) {
        console.log(`    ✅ Resolved by AI rescue: ${aiRef}`);
        return { ref: aiRef, resolvedBy: 'ai_rescue' };
      }
    }

    console.log(`    ❌ Could not resolve element: ${target.description}`);
    return null;
  }

  /**
   * Check if element type matches target type (handles MCP type variations)
   */
  private elementTypeMatches(elementType: string, targetType: string): boolean {
    const typeMap: Record<string, string[]> = {
      'button': ['button'],
      'link': ['link'],
      'input': ['textbox', 'searchbox', 'combobox', 'input'],
      'heading': ['heading'],
      'text': ['text', 'statictext'],
      'checkbox': ['checkbox'],
      'radio': ['radio'],
    };

    const validTypes = typeMap[targetType] || [targetType];
    return validTypes.includes(elementType.toLowerCase());
  }

  /**
   * Find element by extracting keywords from description
   */
  private findElementByDescription(
    elements: Array<{ type: string; ref: string; text: string }>,
    description: string,
    elementType?: string
  ): { type: string; ref: string; text: string } | null {
    // Extract potential element text from description
    // Patterns: "Click the X button", "Enter text in X field", "Click X", "X button"
    // Also handles "Category: Text" format (e.g., "Content type filter: News")
    const patterns = [
      /:\s*(.+?)$/i,  // "Content type filter: News" → "News"
      /(?:click|tap|press|select|choose)\s+(?:the\s+)?(?:on\s+)?["']?([^"']+?)["']?\s*(?:button|link|tab|option)?/i,
      /(?:click|tap|press)\s+["']?([^"']+?)["']?$/i,
      /["']([^"']+)["']/,  // Quoted text
      /(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:button|link|field|input|tab)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        const keyword = match[1].toLowerCase().trim();
        if (keyword.length < 2) continue;  // Skip very short matches

        // Find element with this keyword (emoji-aware)
        const stripEmoji = (text: string) => text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
        const strippedKeyword = stripEmoji(keyword);
        const found = elements.find(e => {
          const elementText = e.text.toLowerCase();
          const strippedElement = stripEmoji(elementText);
          const textMatches = elementText.includes(keyword) || keyword.includes(elementText)
            || strippedElement.includes(strippedKeyword) || strippedKeyword.includes(strippedElement);
          const typeMatches = !elementType || this.elementTypeMatches(e.type, elementType);
          return textMatches && typeMatches && e.text.length > 0;
        });

        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Use AI to find an element when other strategies fail
   * AI-first approach: uses vision + accessibility tree for intelligent matching
   */
  private async aiResolveElement(target: ElementTarget, snapshot: MCPSnapshot): Promise<string | null> {
    try {
      // Take screenshot for AI context
      const screenshot = await this.mcpClient.takeScreenshot();
      if (!screenshot) {
        return null;
      }

      const prompt = `You are an AI helping to find a UI element on a web page for automated testing.

**What I'm looking for:**
${target.description}
${target.text ? `- Should contain or match text: "${target.text}"` : ''}
${target.elementType ? `- Expected element type: ${target.elementType}` : ''}

**Current page:** ${snapshot.url}

**Accessibility Tree (elements with refs):**
\`\`\`yaml
${snapshot.rawYaml.substring(0, 6000)}
\`\`\`

**Your task:**
1. Look at the screenshot to visually identify the element
2. Find the matching element ref in the accessibility tree
3. Consider: buttons, links, inputs, headings - match by text/purpose

**Important:**
- The ref format is like "e42", "e15", etc.
- Match by meaning, not exact text (e.g., "Sign In" matches "Log In")
- If multiple candidates, pick the most visible/prominent one
- If the element is clearly not on this page, respond NOT_FOUND

Respond with ONLY the ref (e.g., "e42") or "NOT_FOUND".`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${screenshot.data}` },
              },
            ],
          },
        ],
        max_completion_tokens: 100,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';

      // Extract ref from response (handle "e42" or just the ref in a sentence)
      const refMatch = content.match(/e\d+/);
      if (refMatch) {
        return refMatch[0];
      }

      return null;
    } catch (error) {
      console.log(`    ⚠️ AI rescue failed: ${error}`);
      return null;
    }
  }

  /**
   * Run verification checks
   */
  private async runVerifications(verifications: HybridVerification[]): Promise<HybridVerificationResult[]> {
    const results: HybridVerificationResult[] = [];

    if (verifications.length === 0) {
      console.log('  ⚠️ No verifications defined for this test');
    }

    for (const verification of verifications) {
      const result = await this.runVerification(verification);
      results.push(result);

      const icon = result.passed ? '✅' : '❌';
      console.log(`  ${icon} Verify: ${verification.description}`);

      // Log evidence for failed verifications
      if (!result.passed && result.evidence) {
        console.log(`     └── ${result.evidence}`);
      }
    }

    return results;
  }

  /**
   * Run a single verification
   */
  private async runVerification(verification: HybridVerification): Promise<HybridVerificationResult> {
    const snapshot = await this.mcpClient.getSnapshot();

    switch (verification.type) {
      case 'url_contains':
        const currentUrl = snapshot?.url || '';
        const urlContains = currentUrl.includes(verification.expected);
        return {
          verification,
          passed: urlContains,
          actual: currentUrl,
          evidence: urlContains
            ? `URL "${currentUrl}" contains "${verification.expected}"`
            : `URL "${currentUrl}" does not contain "${verification.expected}"`,
        };

      case 'url_equals':
        const urlEquals = snapshot?.url === verification.expected;
        return {
          verification,
          passed: urlEquals,
          actual: snapshot?.url,
          evidence: urlEquals
            ? `URL matches expected`
            : `URL "${snapshot?.url}" does not equal "${verification.expected}"`,
        };

      case 'page_title':
        const titleMatches = snapshot?.title?.toLowerCase().includes(verification.expected.toLowerCase());
        return {
          verification,
          passed: !!titleMatches,
          actual: snapshot?.title,
          evidence: titleMatches
            ? `Title "${snapshot?.title}" contains "${verification.expected}"`
            : `Title "${snapshot?.title}" does not contain "${verification.expected}"`,
        };

      case 'element_visible':
        if (!verification.target || !snapshot) {
          return {
            verification,
            passed: false,
            evidence: 'No target specified or could not get snapshot',
          };
        }
        const resolved = await this.resolveElement(verification.target);
        return {
          verification,
          passed: !!resolved,
          evidence: resolved
            ? `Element found: ${verification.target.description} (${resolved.ref})`
            : `Element not found: ${verification.target.description}`,
        };

      case 'element_text':
        if (!snapshot) {
          return {
            verification,
            passed: false,
            evidence: 'Could not get page snapshot',
          };
        }

        // Strategy 1: Search accessibility tree for visible text content
        const elements = this.mcpClient.parseElements(snapshot.rawYaml);
        const textElement = elements.find(e =>
          e.text.toLowerCase().includes(verification.expected.toLowerCase())
        );
        if (textElement) {
          return {
            verification,
            passed: true,
            actual: textElement.text,
            evidence: `Found text "${textElement.text}" matching "${verification.expected}"`,
          };
        }

        // Strategy 2: Check input field values (text typed into forms won't appear in accessibility tree)
        const inputResult = await this.mcpClient.findTextInInputs(verification.expected);
        if (inputResult.found) {
          return {
            verification,
            passed: true,
            actual: inputResult.value,
            evidence: `Found "${verification.expected}" in ${inputResult.fieldType || 'input'} field with value "${inputResult.value}"`,
          };
        }

        return {
          verification,
          passed: false,
          actual: 'Not found',
          evidence: `Text "${verification.expected}" not found in page content or input fields`,
        };

      default:
        return {
          verification,
          passed: false,
          evidence: `Unknown verification type: ${verification.type}`,
        };
    }
  }

  /**
   * Capture a screenshot
   */
  private async captureScreenshot(name: string): Promise<string | null> {
    try {
      const screenshot = await this.mcpClient.takeScreenshot();
      if (!screenshot) {
        console.log(`    ⚠️ Could not capture screenshot: ${name} (no screenshot data)`);
        return null;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      const filepath = join(this.options.screenshotDir, filename);

      const buffer = Buffer.from(screenshot.data, 'base64');
      await writeFile(filepath, buffer);

      console.log(`    📸 Screenshot saved: ${filename}`);
      return filepath;
    } catch (error) {
      console.log(`    ⚠️ Screenshot capture failed: ${name} - ${error}`);
      return null;
    }
  }

  /**
   * Helper to create step results
   */
  private createStepResult(
    step: HybridTestStep,
    status: 'passed' | 'failed' | 'skipped',
    startTime: number,
    resolved?: ResolvedElement,
    error?: string
  ): HybridStepResult {
    return {
      step,
      status,
      resolvedBy: resolved?.resolvedBy || 'none',
      actualRef: resolved?.ref,
      duration: Date.now() - startTime,
      error,
    };
  }

  /**
   * Helper to create failed result
   */
  private createFailedResult(
    testCase: HybridTestCase,
    startTime: number,
    failureReason: string,
    stepResults: HybridStepResult[],
    screenshots: string[],
    usedAIRescue: boolean
  ): HybridTestResult {
    return {
      testCase,
      status: 'failed',
      stepResults,
      verificationResults: [],
      duration: Date.now() - startTime,
      failureReason,
      screenshots,
      usedAIRescue,
      executedAt: new Date(),
    };
  }

  /**
   * Same-origin guard: if a click navigated us off-site, navigate back.
   * Prevents automated interaction with third-party sites.
   */
  private async guardSameOrigin(step: HybridTestStep): Promise<void> {
    if (!this.testOrigin) return;

    try {
      const snapshot = await this.mcpClient.getSnapshot();
      if (!snapshot?.url) return;

      const currentOrigin = new URL(snapshot.url).origin;
      if (currentOrigin !== this.testOrigin) {
        console.log(`    ⚠️ Off-site navigation detected (${currentOrigin}), navigating back`);
        // Navigate back to the test's start page — don't interact with external site
        await this.mcpClient.navigate(this.testOrigin);
        await this.wait(500);
      }
    } catch { /* ignore parse errors */ }
  }

  /**
   * Wait helper
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the MCP client (for reuse)
   */
  getMCPClient(): MCPClient {
    return this.mcpClient;
  }
}
