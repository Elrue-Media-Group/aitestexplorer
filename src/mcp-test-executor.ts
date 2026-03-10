/**
 * MCP Test Executor
 *
 * AI-driven test execution using MCP for browser interaction.
 * Instead of running scripted steps, this executor:
 * 1. Understands the test intent
 * 2. Uses AI to plan and execute actions dynamically
 * 3. Adapts to page state (e.g., handles login if needed)
 * 4. Verifies outcomes using structured checks + AI vision
 *
 * Optimizations for token efficiency:
 * - Batch action planning (3-5 actions at once)
 * - Structured verification when possible (URL, element presence)
 * - AI vision only for complex verification
 * - Truncated accessibility trees
 */

import { MCPClient, MCPSnapshot } from './mcp-client.js';
import {
  IntentTestCase,
  IntentTestResult,
  ExecutionStep,
  VerificationResult,
  Config,
  ContextFileConfig,
} from './types.js';
import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface MCPTestExecutorOptions {
  headless: boolean;
  screenshotDir: string;
  evidenceDir: string;
  contextFile?: ContextFileConfig;
  maxActionsPerTest?: number;
}

interface PlannedAction {
  action: 'click' | 'type' | 'navigate' | 'select' | 'wait' | 'verify';
  ref?: string;
  url?: string;
  text?: string;
  element?: string;
  reason: string;
}

interface ExecutionPlan {
  actions: PlannedAction[];
  reasoning: string;
  needsAuthentication: boolean;
}

export class MCPTestExecutor {
  private mcpClient: MCPClient;
  private openai: OpenAI;
  private model: string;
  private options: MCPTestExecutorOptions;
  private isConnected: boolean = false;
  private isAuthenticated: boolean = false;
  private totalTokensUsed: { input: number; output: number } = { input: 0, output: 0 };

  constructor(config: Config, options: MCPTestExecutorOptions) {
    this.mcpClient = new MCPClient({ headless: options.headless });
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiModel;
    this.options = {
      maxActionsPerTest: 7, // Reduced from 15 to prevent loops and speed up tests
      ...options,
    };
  }

  /**
   * Initialize the executor - connect to MCP
   */
  async initialize(): Promise<void> {
    if (!this.isConnected) {
      await this.mcpClient.connect();
      this.isConnected = true;
      console.log('🔌 MCP Test Executor connected');
    }

    // Ensure directories exist
    if (!existsSync(this.options.screenshotDir)) {
      await mkdir(this.options.screenshotDir, { recursive: true });
    }
    if (!existsSync(this.options.evidenceDir)) {
      await mkdir(this.options.evidenceDir, { recursive: true });
    }
  }

  /**
   * Execute a single intent-based test case
   */
  async executeTest(testCase: IntentTestCase): Promise<IntentTestResult> {
    const startTime = Date.now();
    const executionLog: ExecutionStep[] = [];
    const screenshots: string[] = [];
    let stepNumber = 0;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 Executing: ${testCase.id} - ${testCase.name}`);
    console.log(`   Intent: ${testCase.intent}`);
    console.log(`   Success Criteria: ${testCase.successCriteria.join(', ')}`);
    console.log('='.repeat(60));

    try {
      // Navigate to starting point
      const startUrl = testCase.startingPoint || this.options.contextFile?.authentication?.loginPage || '/';
      const fullUrl = startUrl.startsWith('http') ? startUrl : `http://localhost:4002${startUrl}`;

      console.log(`\n📍 Navigating to starting point: ${fullUrl}`);
      await this.mcpClient.navigate(fullUrl);
      await this.waitForPageLoad();

      // Main execution loop
      let actionCount = 0;
      let testComplete = false;
      const recentActions: string[] = []; // Track for loop detection

      while (!testComplete && actionCount < (this.options.maxActionsPerTest || 7)) {
        // Capture current state
        const snapshot = await this.mcpClient.getSnapshot();
        const screenshot = await this.captureScreenshot(`step-${stepNumber}`);
        if (screenshot) screenshots.push(screenshot);

        // Check if we need to authenticate
        if (this.needsAuthentication(snapshot) && !this.isAuthenticated) {
          console.log('\n🔐 Authentication required, logging in...');
          const authSteps = await this.performAuthentication(snapshot);
          executionLog.push(...authSteps);
          stepNumber += authSteps.length;
          actionCount += authSteps.length;
          this.isAuthenticated = true;
          continue;
        }

        // Ask AI to plan next actions
        const plan = await this.planNextActions(testCase, snapshot, executionLog);

        if (plan.actions.length === 0) {
          console.log('✅ AI indicates test actions complete, proceeding to verification');
          testComplete = true;
          break;
        }

        // Execute planned actions (one at a time to avoid stale refs)
        for (const action of plan.actions) {
          if (actionCount >= (this.options.maxActionsPerTest || 7)) {
            console.log('⚠️ Max actions reached');
            testComplete = true;
            break;
          }

          // Loop detection - track action signatures
          const actionSig = `${action.action}:${action.ref || action.url || ''}`;
          recentActions.push(actionSig);

          // Check for repeated actions (same action 3+ times in last 5)
          const last5 = recentActions.slice(-5);
          const actionCounts = last5.reduce((acc, a) => {
            acc[a] = (acc[a] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          if (Object.values(actionCounts).some(c => c >= 3)) {
            console.log('⚠️ Loop detected - same action repeated, moving to verification');
            testComplete = true;
            break;
          }

          stepNumber++;
          const step = await this.executeAction(action, stepNumber);
          executionLog.push(step);
          actionCount++;

          if (!step.success) {
            console.log(`❌ Action failed: ${step.error}`);
            // Don't break - AI might recover on next planning cycle
          }

          // Wait for page to settle after action
          await this.waitForPageLoad();

          // After a click or navigate, break to get fresh snapshot
          // This prevents stale refs from being used
          if (action.action === 'click' || action.action === 'navigate') {
            break;
          }
        }
      }

      // Verify success criteria
      console.log('\n🔍 Verifying success criteria...');
      const finalSnapshot = await this.mcpClient.getSnapshot();
      const finalScreenshot = await this.captureScreenshot('final');
      if (finalScreenshot) screenshots.push(finalScreenshot);

      const verifications = await this.verifySuccessCriteria(
        testCase.successCriteria,
        finalSnapshot,
        finalScreenshot
      );

      // Determine overall result
      const allPassed = verifications.every(v => v.passed);
      const status = allPassed ? 'passed' : 'failed';

      const result: IntentTestResult = {
        testCase,
        status,
        executionLog,
        verifications,
        aiAssessment: allPassed
          ? 'All success criteria met'
          : `Failed criteria: ${verifications.filter(v => !v.passed).map(v => v.criterion).join(', ')}`,
        screenshots,
        failureReason: allPassed ? undefined : verifications.find(v => !v.passed)?.evidence,
        duration: Date.now() - startTime,
        tokenUsage: { ...this.totalTokensUsed },
      };

      console.log(`\n${status === 'passed' ? '✅' : '❌'} Test ${status.toUpperCase()}: ${testCase.name}`);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`\n❌ Test ERROR: ${errorMessage}`);

      return {
        testCase,
        status: 'failed',
        executionLog,
        verifications: [],
        aiAssessment: `Test failed due to error: ${errorMessage}`,
        screenshots,
        failureReason: errorMessage,
        duration: Date.now() - startTime,
        tokenUsage: { ...this.totalTokensUsed },
      };
    }
  }

  /**
   * Plan the next batch of actions using AI
   */
  private async planNextActions(
    testCase: IntentTestCase,
    snapshot: MCPSnapshot | null,
    previousSteps: ExecutionStep[]
  ): Promise<ExecutionPlan> {
    const truncatedTree = this.truncateAccessibilityTree(snapshot?.rawYaml || '', 2000);

    const recentSteps = previousSteps.slice(-5).map(s =>
      `  ${s.stepNumber}. ${s.action}${s.target ? ` on "${s.target}"` : ''} - ${s.success ? '✓' : '✗'}`
    ).join('\n');

    const prompt = `You are an AI test executor. Plan the next actions to accomplish the test intent.

**TEST INTENT:** ${testCase.intent}

**SUCCESS CRITERIA:**
${testCase.successCriteria.map(c => `- ${c}`).join('\n')}

**CURRENT URL:** ${snapshot?.url || 'unknown'}
**CURRENT PAGE TITLE:** ${snapshot?.title || 'unknown'}

**RECENT ACTIONS TAKEN:**
${recentSteps || '(none yet)'}

**CURRENT PAGE ELEMENTS (accessibility tree):**
\`\`\`
${truncatedTree}
\`\`\`

${this.options.contextFile?.credentials || this.options.contextFile?.authentication?.credentials
  ? '**CREDENTIALS AVAILABLE:** Use {{username}} and {{password}} placeholders for login fields.\n' : ''}

**YOUR TASK:**
1. Analyze current state vs test intent
2. If the test goal appears accomplished, return empty actions
3. Otherwise, plan 1-2 actions to progress toward the goal
4. Use element refs (e.g., e15) for clicks/typing
5. IMPORTANT: For navigate actions, you MUST provide a full URL (e.g., "http://localhost:4002/dashboard")
6. IMPORTANT: Only plan 1-2 actions at a time - the page state will change after each action

**RESPOND WITH JSON:**
{
  "reasoning": "Brief explanation of current state and plan",
  "actionsComplete": true/false,
  "actions": [
    {
      "action": "click|type|navigate|wait",
      "ref": "eXX (required for click/type)",
      "url": "http://... (required for navigate)",
      "text": "for type actions",
      "element": "description of element",
      "reason": "why this action"
    }
  ]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 800,
        response_format: { type: 'json_object' },
      });

      // Track token usage
      if (response.usage) {
        this.totalTokensUsed.input += response.usage.prompt_tokens;
        this.totalTokensUsed.output += response.usage.completion_tokens;
      }

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      console.log(`\n🤖 AI Plan: ${parsed.reasoning}`);

      if (parsed.actionsComplete) {
        return { actions: [], reasoning: parsed.reasoning, needsAuthentication: false };
      }

      return {
        actions: parsed.actions || [],
        reasoning: parsed.reasoning || '',
        needsAuthentication: false,
      };
    } catch (error) {
      console.error('❌ Planning failed:', error);
      return { actions: [], reasoning: 'Planning failed', needsAuthentication: false };
    }
  }

  /**
   * Execute a single planned action
   */
  private async executeAction(action: PlannedAction, stepNumber: number): Promise<ExecutionStep> {
    console.log(`\n▶️ Step ${stepNumber}: ${action.action} ${action.ref || action.url || ''} - ${action.reason}`);

    const step: ExecutionStep = {
      stepNumber,
      action: action.action,
      target: action.ref || action.url,
      value: action.text,
      reasoning: action.reason,
      success: false,
      timestamp: new Date(),
    };

    try {
      switch (action.action) {
        case 'click':
          if (!action.ref) throw new Error('No ref for click');
          const clickResult = await this.mcpClient.click(action.ref, action.element);
          step.success = clickResult.success;
          step.error = clickResult.error;
          break;

        case 'type':
          if (!action.ref || !action.text) throw new Error('Missing ref or text for type');
          let textToType = action.text;

          // Substitute credentials
          const creds = this.options.contextFile?.credentials ||
                       this.options.contextFile?.authentication?.credentials;
          if (creds) {
            if (action.text === '{{username}}' || action.text === '{{email}}') {
              textToType = creds.username || creds.email || '';
              console.log(`   🔐 Using credential: ${textToType.substring(0, 3)}...`);
            } else if (action.text === '{{password}}') {
              textToType = creds.password || '';
              console.log(`   🔐 Using password`);
            }
          }

          const typeResult = await this.mcpClient.type(action.ref, textToType);
          step.success = typeResult.success;
          step.error = typeResult.error;
          break;

        case 'navigate':
          if (!action.url) throw new Error('No URL for navigate');
          const navResult = await this.mcpClient.navigate(action.url);
          step.success = navResult.success;
          step.error = navResult.error;
          break;

        case 'wait':
          await new Promise(resolve => setTimeout(resolve, 1000));
          step.success = true;
          break;

        default:
          throw new Error(`Unknown action: ${action.action}`);
      }

      console.log(`   ${step.success ? '✅' : '❌'} ${step.success ? 'Success' : step.error}`);
    } catch (error) {
      step.error = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Error: ${step.error}`);
    }

    return step;
  }

  /**
   * Verify success criteria using structured checks + AI vision
   */
  private async verifySuccessCriteria(
    criteria: string[],
    snapshot: MCPSnapshot | null,
    screenshotPath: string | null
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const criterion of criteria) {
      console.log(`   Checking: "${criterion}"`);

      // Try structured verification first
      const structuredResult = this.tryStructuredVerification(criterion, snapshot);
      if (structuredResult) {
        results.push(structuredResult);
        console.log(`      ${structuredResult.passed ? '✅' : '❌'} (structured): ${structuredResult.evidence}`);
        continue;
      }

      // Fall back to AI vision verification
      const aiResult = await this.aiVerification(criterion, snapshot, screenshotPath);
      results.push(aiResult);
      console.log(`      ${aiResult.passed ? '✅' : '❌'} (AI): ${aiResult.evidence}`);
    }

    return results;
  }

  /**
   * Try to verify criterion using structured data (no AI call)
   */
  private tryStructuredVerification(
    criterion: string,
    snapshot: MCPSnapshot | null
  ): VerificationResult | null {
    const criterionLower = criterion.toLowerCase();
    const url = snapshot?.url || '';
    const tree = snapshot?.rawYaml || '';

    // URL checks
    if (criterionLower.includes('url contains') || criterionLower.includes('on the')) {
      const urlPatterns = [
        /url contains ['"](.*?)['"]/i,
        /on the (.*?) page/i,
        /navigated to (.*)/i,
        /redirects? to (.*)/i,
      ];

      for (const pattern of urlPatterns) {
        const match = criterion.match(pattern);
        if (match) {
          const expected = match[1].toLowerCase().replace(/\s+/g, '');
          const urlLower = url.toLowerCase();
          const passed = urlLower.includes(expected) || urlLower.includes(expected.replace(/ /g, '-'));

          return {
            criterion,
            passed,
            method: 'structured',
            evidence: passed
              ? `URL "${url}" contains expected pattern`
              : `URL "${url}" does not contain "${expected}"`,
          };
        }
      }
    }

    // Element existence checks
    if (criterionLower.includes('visible') || criterionLower.includes('displayed') || criterionLower.includes('shows') || criterionLower.includes('appears')) {
      const elementPatterns = [
        /['"](.*?)['"] (?:is )?(?:visible|displayed|shown|appears)/i,
        /(?:shows?|displays?|see) ['"](.*?)['"]/i,
        /(?:shows?|displays?|see) (?:a |the )?(.*?)(?:\.|$)/i,
      ];

      for (const pattern of elementPatterns) {
        const match = criterion.match(pattern);
        if (match) {
          const expected = match[1].toLowerCase();
          const treeLower = tree.toLowerCase();
          const passed = treeLower.includes(expected);

          return {
            criterion,
            passed,
            method: 'structured',
            evidence: passed
              ? `Found "${expected}" in page elements`
              : `Could not find "${expected}" in page elements`,
          };
        }
      }
    }

    // Can't verify structurally
    return null;
  }

  /**
   * Verify criterion using AI vision (screenshot analysis)
   */
  private async aiVerification(
    criterion: string,
    snapshot: MCPSnapshot | null,
    screenshotPath: string | null
  ): Promise<VerificationResult> {
    // If no screenshot, use accessibility tree only
    const prompt = `Verify if this criterion is met based on the page state.

**CRITERION:** ${criterion}

**CURRENT URL:** ${snapshot?.url || 'unknown'}

**PAGE ELEMENTS:**
\`\`\`
${this.truncateAccessibilityTree(snapshot?.rawYaml || '', 1500)}
\`\`\`

**RESPOND WITH JSON:**
{
  "passed": true/false,
  "evidence": "Brief explanation of why it passed or failed"
}`;

    try {
      const messages: any[] = [{ role: 'user', content: prompt }];

      // Add screenshot if available
      if (screenshotPath && existsSync(screenshotPath)) {
        const { readFile } = await import('fs/promises');
        const screenshotBuffer = await readFile(screenshotPath);
        const base64Image = screenshotBuffer.toString('base64');

        messages[0].content = [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
        ];
      }

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' },
      });

      if (response.usage) {
        this.totalTokensUsed.input += response.usage.prompt_tokens;
        this.totalTokensUsed.output += response.usage.completion_tokens;
      }

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      return {
        criterion,
        passed: parsed.passed || false,
        method: 'ai_vision',
        evidence: parsed.evidence || 'No evidence provided',
      };
    } catch (error) {
      return {
        criterion,
        passed: false,
        method: 'ai_vision',
        evidence: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Check if current page requires authentication
   */
  private needsAuthentication(snapshot: MCPSnapshot | null): boolean {
    if (!snapshot) return false;

    const url = snapshot.url.toLowerCase();
    const tree = snapshot.rawYaml.toLowerCase();

    // Check URL patterns
    if (url.includes('/login') || url.includes('/signin') || url.includes('cognito')) {
      return true;
    }

    // Check for login-related elements
    if (tree.includes('sign in') || tree.includes('log in') || tree.includes('password')) {
      // But not if we're on the dashboard (already logged in)
      if (url.includes('/dashboard')) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Perform authentication flow
   */
  private async performAuthentication(initialSnapshot: MCPSnapshot | null): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    let stepNum = 0;

    const creds = this.options.contextFile?.credentials ||
                  this.options.contextFile?.authentication?.credentials;

    if (!creds) {
      console.log('⚠️ No credentials available for authentication');
      return steps;
    }

    // Simple auth loop - let AI guide us through login
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      attempts++;
      const snapshot = await this.mcpClient.getSnapshot();

      // Check if we're past login
      if (snapshot?.url.includes('/dashboard')) {
        console.log('✅ Authentication complete - on dashboard');
        break;
      }

      // Ask AI what to do for login
      const plan = await this.planLoginAction(snapshot, creds);

      if (plan.actions.length === 0) {
        break;
      }

      for (const action of plan.actions) {
        stepNum++;
        const step = await this.executeAction(action, stepNum);
        steps.push(step);
        await this.waitForPageLoad();
      }
    }

    return steps;
  }

  /**
   * Plan a single login action
   */
  private async planLoginAction(
    snapshot: MCPSnapshot | null,
    creds: { username?: string; email?: string; password?: string }
  ): Promise<ExecutionPlan> {
    const truncatedTree = this.truncateAccessibilityTree(snapshot?.rawYaml || '', 1500);

    const prompt = `You are logging into a web application. Determine the next action.

**CURRENT URL:** ${snapshot?.url || 'unknown'}

**AVAILABLE CREDENTIALS:**
- Username/Email: ${creds.username || creds.email || 'not provided'}
- Password: (available)

**PAGE ELEMENTS:**
\`\`\`
${truncatedTree}
\`\`\`

**INSTRUCTIONS:**
- If you see an email/username field, type {{username}} into it
- If you see a password field, type {{password}} into it
- If you see a submit/sign-in/next button, click it
- If already logged in (dashboard visible), return empty actions

**RESPOND WITH JSON:**
{
  "reasoning": "What you see and plan to do",
  "actions": [
    {
      "action": "click|type",
      "ref": "eXX",
      "text": "{{username}} or {{password}} for type actions",
      "element": "description",
      "reason": "why"
    }
  ]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 500,
        response_format: { type: 'json_object' },
      });

      if (response.usage) {
        this.totalTokensUsed.input += response.usage.prompt_tokens;
        this.totalTokensUsed.output += response.usage.completion_tokens;
      }

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      console.log(`   🔐 Login step: ${parsed.reasoning}`);

      return {
        actions: parsed.actions || [],
        reasoning: parsed.reasoning || '',
        needsAuthentication: false,
      };
    } catch (error) {
      console.error('❌ Login planning failed:', error);
      return { actions: [], reasoning: 'Login planning failed', needsAuthentication: false };
    }
  }

  /**
   * Capture a screenshot
   */
  private async captureScreenshot(name: string): Promise<string | null> {
    try {
      const screenshot = await this.mcpClient.takeScreenshot();
      if (!screenshot) return null;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      const filepath = join(this.options.evidenceDir, filename);

      const buffer = Buffer.from(screenshot.data, 'base64');
      await writeFile(filepath, buffer);

      return filepath;
    } catch (error) {
      console.error('Screenshot failed:', error);
      return null;
    }
  }

  /**
   * Truncate accessibility tree to reduce tokens
   */
  private truncateAccessibilityTree(yaml: string, maxLength: number): string {
    if (yaml.length <= maxLength) return yaml;

    // Try to cut at a line boundary
    const truncated = yaml.substring(0, maxLength);
    const lastNewline = truncated.lastIndexOf('\n');

    if (lastNewline > maxLength * 0.8) {
      return truncated.substring(0, lastNewline) + '\n... (truncated)';
    }

    return truncated + '... (truncated)';
  }

  /**
   * Wait for page to settle
   */
  private async waitForPageLoad(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Execute all tests in a suite
   */
  async executeTests(testCases: IntentTestCase[]): Promise<IntentTestResult[]> {
    const results: IntentTestResult[] = [];

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`\n📋 Test ${i + 1}/${testCases.length}`);

      const result = await this.executeTest(testCase);
      results.push(result);

      // Reset auth state between tests if needed
      // this.isAuthenticated = false;
    }

    return results;
  }

  /**
   * Close the executor
   */
  async close(): Promise<void> {
    if (this.isConnected) {
      await this.mcpClient.close();
      await this.mcpClient.disconnect();
      this.isConnected = false;
      console.log('🔌 MCP Test Executor disconnected');
    }
  }

  /**
   * Get total token usage
   */
  getTokenUsage(): { input: number; output: number } {
    return { ...this.totalTokensUsed };
  }
}
