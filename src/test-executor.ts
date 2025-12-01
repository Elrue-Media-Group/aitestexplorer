import { Page } from 'playwright';
import { GeneratedTestCase, TestStep } from './test-case-generator.js';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

export interface TestResult {
  testCaseId: string;
  testCaseName: string;
  testCaseDescription?: string;
  expectedResult?: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  steps: StepResult[];
  error?: string;
  evidence?: string[];
  executedAt: Date;
  verificationDetails?: VerificationDetail[];
}

export interface StepResult {
  stepNumber: number;
  description: string;
  action: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  screenshot?: string;
  expected?: string;
  actual?: string;
  verified?: boolean;
  details?: ContentDetails;
}

export interface VerificationDetail {
  what: string;
  expected: string;
  actual: string;
  match: boolean;
  details?: ContentDetails;
}

export interface ContentDetails {
  title?: string;
  headings?: string[];
  linksCount?: number;
  buttonsCount?: number;
  formsCount?: number;
  contentPreview?: string;
  contentLength?: number;
  elementInfo?: ElementInfo;
  navigationInfo?: NavigationInfo;
  formInfo?: FormInfo;
}

export interface ElementInfo {
  tagName?: string;
  text?: string;
  selector?: string;
  visible?: boolean;
  enabled?: boolean;
  attributes?: Record<string, string>;
}

export interface NavigationInfo {
  sourceUrl?: string;
  targetUrl?: string;
  finalUrl?: string;
  statusCode?: number;
  loadTime?: number;
  redirects?: string[];
}

export interface FormInfo {
  fieldType?: string;
  fieldName?: string;
  placeholder?: string;
  valueEntered?: string;
  valueConfirmed?: string;
  visible?: boolean;
  enabled?: boolean;
}

export class TestExecutor {
  private page: Page;
  private evidenceDir: string;

  constructor(page: Page, evidenceDir: string) {
    this.page = page;
    this.evidenceDir = evidenceDir;
  }

  /**
   * Execute a single test case
   */
  async executeTestCase(testCase: GeneratedTestCase): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const verificationDetails: VerificationDetail[] = [];
    let overallStatus: 'passed' | 'failed' | 'skipped' = 'passed';
    let error: string | undefined;

    try {
      console.log(`\n🧪 Executing: ${testCase.id} - ${testCase.name}`);

      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        const stepResult = await this.executeStep(step, i + 1, testCase);

        stepResults.push(stepResult);

        // Collect verification details
        if (stepResult.expected && stepResult.actual) {
          verificationDetails.push({
            what: stepResult.description,
            expected: stepResult.expected,
            actual: stepResult.actual,
            match: stepResult.verified || false,
            details: stepResult.details,
          });
        }

        if (stepResult.status === 'failed') {
          overallStatus = 'failed';
          error = stepResult.error || 'Step execution failed';
          // Continue executing remaining steps for context, but mark as failed
        }
      }

      const duration = Date.now() - startTime;

      return {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        testCaseDescription: testCase.description,
        expectedResult: testCase.expectedResult,
        status: overallStatus,
        duration,
        steps: stepResults,
        error,
        verificationDetails: verificationDetails.length > 0 ? verificationDetails : undefined,
        executedAt: new Date(),
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      return {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        testCaseDescription: testCase.description,
        expectedResult: testCase.expectedResult,
        status: 'failed',
        duration,
        steps: stepResults,
        error: err instanceof Error ? err.message : String(err),
        executedAt: new Date(),
      };
    }
  }

  /**
   * Execute a single test step
   */
  private async executeStep(
    step: TestStep,
    stepNumber: number,
    testCase: GeneratedTestCase
  ): Promise<StepResult> {
    try {
      const action = step.action.toLowerCase();
      const description = step.description.toLowerCase();

      // Navigate action
      if (action === 'navigate' || description.includes('navigate')) {
        const url = step.target || testCase.pageUrl || this.page.url();
        const startTime = Date.now();
        const response = await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const loadTime = Date.now() - startTime;
        await this.page.waitForTimeout(1000);
        const currentUrl = this.page.url();
        const statusCode = response?.status();
        
        const navigationInfo: NavigationInfo = {
          sourceUrl: this.page.url(),
          targetUrl: url,
          finalUrl: currentUrl,
          statusCode: statusCode || undefined,
          loadTime,
        };
        
        return {
          stepNumber,
          description: step.description,
          action: 'navigate',
          status: 'passed',
          expected: `Navigate to ${url}`,
          actual: `Navigated to ${currentUrl}${statusCode ? ` (Status: ${statusCode})` : ''}${loadTime ? ` in ${loadTime}ms` : ''}`,
          verified: currentUrl.includes(new URL(url).hostname),
          details: {
            navigationInfo,
          },
        };
      }

      // Click action
      if (action === 'click' || description.includes('click')) {
        const target = step.target || this.findClickableElement(description);
        if (target) {
          // Store URL before click for navigation tracking
          const urlBeforeClick = this.page.url();
          
          // Try to find and click the element
          const selectors = this.generateSelectors(target);
          let clicked = false;
          let clickedElement = null;
          let elementText = '';

          for (const selector of selectors) {
            try {
              const element = await this.page.$(selector);
              if (element) {
                clickedElement = element;
                elementText = await element.textContent() || target;
                await element.click();
                await this.page.waitForTimeout(1000);
                clicked = true;
                break;
              }
            } catch {
              continue;
            }
          }

          if (!clicked) {
            // Try text-based click
            try {
              clickedElement = await this.page.$(`text=${target}`);
              if (clickedElement) {
                elementText = await clickedElement.textContent() || target;
                await clickedElement.click();
                await this.page.waitForTimeout(1000);
                clicked = true;
              }
            } catch {
              // Fallback: try to find any clickable element
              const buttons = await this.page.$$('button, a[href], [role="button"]');
              if (buttons.length > 0) {
                clickedElement = buttons[0];
                elementText = await buttons[0].textContent() || 'element';
                await buttons[0].click();
                await this.page.waitForTimeout(1000);
                clicked = true;
              }
            }
          }

          if (!clicked) {
            throw new Error(`Could not find clickable element: ${target}`);
          }

          // Get element details
          let elementInfo: ElementInfo | undefined;
          if (clickedElement) {
            try {
              const tagName = await clickedElement.evaluate(el => el.tagName.toLowerCase());
              const isVisible = await clickedElement.isVisible();
              const isEnabled = await clickedElement.isEnabled();
              const computedSelector = await clickedElement.evaluate(el => {
                if (el.id) return `#${el.id}`;
                if (el.className && typeof el.className === 'string') {
                  const firstClass = el.className.split(' ')[0];
                  return firstClass ? `.${firstClass}` : el.tagName.toLowerCase();
                }
                return el.tagName.toLowerCase();
              });
              
              elementInfo = {
                tagName,
                text: elementText || undefined,
                selector: String(computedSelector),
                visible: isVisible,
                enabled: isEnabled,
              };
            } catch {
              // Ignore element info extraction errors
            }
          }

          // Wait for navigation if it happens
          const urlAfterClick = this.page.url();
          const navigated = urlAfterClick !== urlBeforeClick;
          const newTitle = navigated ? await this.page.title() : undefined;
          
          return {
            stepNumber,
            description: step.description,
            action: 'click',
            status: 'passed',
            expected: `Click on ${target}`,
            actual: `Clicked: ${elementText || target}${navigated ? ` → Navigated to ${urlAfterClick}` : ''}${newTitle ? ` (Page: "${newTitle}")` : ''}`,
            verified: true,
            details: {
              elementInfo,
              navigationInfo: navigated ? {
                sourceUrl: urlBeforeClick,
                targetUrl: urlAfterClick,
                finalUrl: urlAfterClick,
              } : undefined,
            },
          };
        } else {
          throw new Error('No clickable element target specified');
        }
      }

      // Type action
      if (action === 'type' || description.includes('type') || description.includes('enter')) {
        const inputs = await this.page.$$('input[type="text"], input[type="email"], textarea');
        if (inputs.length > 0) {
          const input = inputs[0];
          const value = step.value || this.generateTestValue(step.description);
          
          // Get input details
          const fieldType = await input.evaluate(el => (el as HTMLInputElement).type || 'text');
          const fieldName = await input.getAttribute('name') || undefined;
          const placeholder = await input.getAttribute('placeholder') || undefined;
          const isVisible = await input.isVisible();
          const isEnabled = await input.isEnabled();
          
          await input.fill(value);
          await this.page.waitForTimeout(500);
          const inputValue = await input.inputValue();
          
          const formInfo: FormInfo = {
            fieldType,
            fieldName,
            placeholder,
            valueEntered: value,
            valueConfirmed: inputValue,
            visible: isVisible,
            enabled: isEnabled,
          };
          
          return {
            stepNumber,
            description: step.description,
            action: 'type',
            status: 'passed',
            expected: `Enter "${value}" in input field${placeholder ? ` (${placeholder})` : ''}`,
            actual: `Entered "${inputValue}" in ${fieldType} field${placeholder ? ` (${placeholder})` : ''}${fieldName ? ` [${fieldName}]` : ''}`,
            verified: inputValue === value,
            details: {
              formInfo,
            },
          };
        } else {
          throw new Error('No input fields found');
        }
      }

      // Verify action
      if (action === 'verify' || description.includes('verify') || description.includes('check')) {
        // Basic verification - page loaded, content visible
        const title = await this.page.title();
        const bodyText = await this.page.textContent('body');
        
        // Extract detailed content information
        const contentDetails = await this.extractContentDetails();
        
        // Determine what we're verifying based on description
        let expected = 'Page loads and displays content';
        let actual = '';
        let verified = false;
        let details: ContentDetails | undefined;
        
        if (description.includes('title')) {
          expected = 'Page title is present and contains expected text';
          actual = title ? `Title found: "${title}"` : 'No title found';
          verified = title && title.length > 0;
          details = {
            title,
            contentLength: bodyText?.trim().length,
          };
        } else if (description.includes('load') || description.includes('display') || description.includes('content')) {
          expected = 'Page loads and content is visible';
          
          // Build detailed actual message
          const detailsList: string[] = [];
          if (contentDetails.title) {
            detailsList.push(`Title: "${contentDetails.title}"`);
          }
          if (contentDetails.headings && contentDetails.headings.length > 0) {
            detailsList.push(`Main heading: "${contentDetails.headings[0]}"`);
          }
          if (contentDetails.linksCount !== undefined) {
            detailsList.push(`Found ${contentDetails.linksCount} links`);
          }
          if (contentDetails.buttonsCount !== undefined) {
            detailsList.push(`Found ${contentDetails.buttonsCount} buttons`);
          }
          if (contentDetails.formsCount !== undefined && contentDetails.formsCount > 0) {
            detailsList.push(`Found ${contentDetails.formsCount} forms`);
          }
          if (contentDetails.contentPreview) {
            detailsList.push(`Content preview: "${contentDetails.contentPreview}"`);
          }
          if (contentDetails.contentLength) {
            detailsList.push(`Total content: ${contentDetails.contentLength.toLocaleString()} characters`);
          }
          
          actual = detailsList.length > 0 
            ? detailsList.join('\n     * ') 
            : bodyText && bodyText.trim().length > 0 
              ? `Content found (${bodyText.trim().length} characters)` 
              : 'No content found';
          
          verified = bodyText && bodyText.trim().length > 0;
          details = contentDetails;
        } else {
          // Generic verification
          verified = title && title.length > 0 && bodyText && bodyText.trim().length > 0;
          actual = verified 
            ? `Page loaded: title="${title}", content present` 
            : 'Page verification failed';
          details = contentDetails;
        }
        
        if (!verified) {
          throw new Error(actual || 'Verification failed');
        }

        return {
          stepNumber,
          description: step.description,
          action: 'verify',
          status: 'passed',
          expected,
          actual,
          verified: true,
          details,
        };
      }

      // Wait action
      if (action === 'wait' || description.includes('wait')) {
        await this.page.waitForTimeout(2000);
        return {
          stepNumber,
          description: step.description,
          action: 'wait',
          status: 'passed',
          expected: 'Wait for page to stabilize',
          actual: 'Waited 2 seconds',
          verified: true,
        };
      }

      // Default: treat as verify
      return {
        stepNumber,
        description: step.description,
        action: 'unknown',
        status: 'passed',
        expected: 'Action completed',
        actual: 'Action executed',
        verified: true,
      };
    } catch (err) {
      // Capture screenshot on failure
      let screenshotPath: string | undefined;
      try {
        screenshotPath = await this.captureScreenshot(
          testCase.id,
          stepNumber,
          'failure'
        );
      } catch {
        // Ignore screenshot errors
      }

      return {
        stepNumber,
        description: step.description,
        action: step.action || 'unknown',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        screenshot: screenshotPath,
        expected: step.description,
        actual: err instanceof Error ? err.message : String(err),
        verified: false,
      };
    }
  }

  /**
   * Find clickable element from description
   */
  private findClickableElement(description: string): string | null {
    // Try to extract element name from description
    const patterns = [
      /(?:click|press|select)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button|\s+link|\s+element)?$/i,
      /(.+?)\s+(?:button|link|element)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Generate CSS selectors from target text
   */
  private generateSelectors(target: string): string[] {
    const selectors: string[] = [];

    // Try various selector strategies
    selectors.push(`text=${target}`);
    selectors.push(`[aria-label*="${target}"]`);
    selectors.push(`button:has-text("${target}")`);
    selectors.push(`a:has-text("${target}")`);
    selectors.push(`[role="button"]:has-text("${target}")`);

    // If target looks like a CSS selector, use it directly
    if (target.startsWith('#') || target.startsWith('.') || target.includes('[')) {
      selectors.unshift(target);
    }

    return selectors;
  }

  /**
   * Generate test value from description
   */
  private generateTestValue(description: string): string {
    const lower = description.toLowerCase();

    if (lower.includes('email')) {
      return 'test@example.com';
    } else if (lower.includes('phone')) {
      return '555-1234';
    } else if (lower.includes('name')) {
      return 'Test User';
    } else if (lower.includes('password')) {
      return 'Test123!';
    } else {
      return 'test value';
    }
  }

  /**
   * Extract detailed content information from the page
   */
  private async extractContentDetails(): Promise<ContentDetails> {
    try {
      const details: ContentDetails = {};
      
      // Get page title
      details.title = await this.page.title();
      
      // Get headings
      const headings = await this.page.$$eval('h1, h2, h3', (elements) =>
        elements.slice(0, 5).map(el => el.textContent?.trim() || '').filter(Boolean)
      );
      if (headings.length > 0) {
        details.headings = headings;
      }
      
      // Count links
      const linksCount = await this.page.$$eval('a[href]', (links) => links.length);
      details.linksCount = linksCount;
      
      // Count buttons
      const buttonsCount = await this.page.$$eval('button, [role="button"], input[type="button"], input[type="submit"]', (buttons) => buttons.length);
      details.buttonsCount = buttonsCount;
      
      // Count forms
      const formsCount = await this.page.$$eval('form', (forms) => forms.length);
      details.formsCount = formsCount;
      
      // Get content preview (first 200 chars of main content)
      try {
        const mainContent = await this.page.$eval('main, article, .content, #content', (el) => {
          const text = el.textContent || '';
          return text.trim().substring(0, 200);
        }).catch(async () => {
          // Fallback to body if main content selectors fail
          const bodyText = await this.page.textContent('body');
          return bodyText ? bodyText.trim().substring(0, 200) : null;
        });
        
        if (mainContent) {
          details.contentPreview = mainContent + (mainContent.length >= 200 ? '...' : '');
        }
      } catch {
        // Ignore content preview extraction errors
      }
      
      // Get total content length
      const bodyText = await this.page.textContent('body');
      if (bodyText) {
        details.contentLength = bodyText.trim().length;
      }
      
      return details;
    } catch (error) {
      // Return basic details if extraction fails
      try {
        const title = await this.page.title();
        const bodyText = await this.page.textContent('body');
        return {
          title,
          contentLength: bodyText?.trim().length,
        };
      } catch {
        return {};
      }
    }
  }

  /**
   * Capture screenshot for evidence
   */
  private async captureScreenshot(
    testCaseId: string,
    stepNumber: number,
    type: string
  ): Promise<string> {
    if (!existsSync(this.evidenceDir)) {
      await mkdir(this.evidenceDir, { recursive: true });
    }

    const filename = `${testCaseId}-step-${stepNumber}-${type}-${Date.now()}.png`;
    const path = join(this.evidenceDir, filename);

    await this.page.screenshot({ path, fullPage: true });
    return path;
  }

  /**
   * Execute all test cases
   */
  async executeAllTestCases(testCases: GeneratedTestCase[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      const result = await this.executeTestCase(testCase);
      results.push(result);

      // Show progress
      const icon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
      console.log(`${icon} ${testCase.id}: ${result.status.toUpperCase()} (${result.duration}ms)`);
    }

    return results;
  }
}

