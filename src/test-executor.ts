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
      
      console.log(`\n📋 [Step ${stepNumber}] Action: "${step.action}" | Description: "${step.description}"`);

      // Parse target for element type hint (e.g., "button:Sign In" -> type:"button", text:"Sign In")
      // Do this early so it's available for all action types
      let target: string | undefined = step.target;
      let elementTypeHint: string | undefined;
      if (target && target.includes(':')) {
        const colonIndex = target.indexOf(':');
        const possibleType = target.substring(0, colonIndex).toLowerCase();
        const possibleText = target.substring(colonIndex + 1);

        // Only parse as type hint if it's a valid element type
        if (['button', 'link', 'input', 'textarea', 'select'].includes(possibleType)) {
          elementTypeHint = possibleType;
          target = possibleText;
          console.log(`   🎯 AI provided element type hint: ${elementTypeHint} for "${target}"`);
        }
      }

      // Navigate action
      if (action === 'navigate' || description.includes('navigate')) {
        const urlOrLinkText = target || testCase.pageUrl || this.page.url();

        // Check if target is a valid URL or just link text
        const isValidUrl = urlOrLinkText.startsWith('http://') ||
                          urlOrLinkText.startsWith('https://') ||
                          urlOrLinkText.startsWith('/');

        if (!isValidUrl) {
          // Target is link text (e.g., "Home", "Data Table") - find and click the link
          console.log(`   🔗 Navigate target "${urlOrLinkText}" is link text, will click the link`);

          const urlBeforeClick = this.page.url();

          // Try to find and click the link
          const selectors = [
            `a:has-text("${urlOrLinkText}")`,
            `text=${urlOrLinkText}`,
            `[role="link"]:has-text("${urlOrLinkText}")`,
          ];

          let clicked = false;
          for (const selector of selectors) {
            try {
              const link = await this.page.$(selector);
              if (link) {
                await link.click();
                clicked = true;
                console.log(`   ✅ Clicked link "${urlOrLinkText}" using selector: ${selector}`);
                break;
              }
            } catch {
              continue;
            }
          }

          if (!clicked) {
            throw new Error(`Could not find link with text: ${urlOrLinkText}`);
          }

          // Wait for navigation
          await this.page.waitForLoadState('load', { timeout: 10000 });
          await this.page.waitForTimeout(1000);
          const currentUrl = this.page.url();

          return {
            stepNumber,
            description: step.description,
            action: 'navigate',
            status: 'passed',
            expected: `Click link "${urlOrLinkText}" to navigate`,
            actual: `Clicked link "${urlOrLinkText}" → Navigated to ${currentUrl}`,
            verified: currentUrl !== urlBeforeClick,
            details: {
              navigationInfo: {
                sourceUrl: urlBeforeClick,
                targetUrl: urlOrLinkText,
                finalUrl: currentUrl,
              },
            },
          };
        }

        // Target is a valid URL - use page.goto()
        const url = urlOrLinkText;
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

      // Click action - enhanced with contextual finding (check BEFORE extract to avoid conflicts)
      // If action is explicitly "click", always allow it. Otherwise, check description.
      const isClickAction = action === 'click' || 
        (description.includes('click') && 
         !description.match(/\bextract\b/i) && // Block "extract" verb, but allow "extracted" past participle
         !description.includes('count') && 
         !description.includes('verify'));
      
      if (isClickAction) {
        console.log(`\n🖱️  [Step ${stepNumber}] CLICK ACTION`);
        console.log(`   Description: ${step.description}`);

        // Check if we need to click the element that was extracted from in a previous step
        let useExtractedElement = false;

        if (!target || target === 'Top Companies Mentioned section' || description.includes('from which the count was extracted')) {
          // Look for previous extract step to find the element that was used
          const testCaseSteps = testCase.steps;
          const currentStepIndex = stepNumber - 1;

          for (let i = currentStepIndex - 1; i >= 0; i--) {
            const prevStep = testCaseSteps[i];
            if ((prevStep as any).extractedElementText) {
              target = (prevStep as any).extractedElementText;
              useExtractedElement = true;
              console.log(`   🔗 Found extracted element from step ${i + 1}: "${target}"`);
              break;
            }
          }
        }

        if (!target) {
          target = this.findClickableElement(description) || undefined;
        }

        console.log(`   Target: ${target || 'none'}`);

        if (target) {
          // Store URL before click for navigation tracking
          const urlBeforeClick = this.page.url();
          
          // If we're using the extracted element, try to find it by its text first
          let clickedElement = null;
          let clicked = false;
          let elementText = '';
          
          if (useExtractedElement && target) {
            console.log(`   🔍 Looking for extracted element by text: "${target}"`);
            try {
              clickedElement = await this.page.$(`text=${target}`);
              if (clickedElement) {
                elementText = await clickedElement.textContent() || target;
                console.log(`   ✅ Found extracted element: "${elementText}"`);
                await clickedElement.click();
                clicked = true;
              }
            } catch {
              // Fall through to contextual finding
            }
          }
          
          // Try contextual finding first (find by section/heading relationship)
          if (!clicked) {
            console.log(`   🔍 Trying contextual finding...`);
            clickedElement = await this.findElementByContext(description, target);

              if (clickedElement) {
                try {
                  elementText = await clickedElement.textContent() || target;
                  console.log(`   ✅ Found element via context: "${elementText}"`);
                  await clickedElement.click();
                  clicked = true;
              } catch (err) {
                console.log(`   ⚠️  Contextual click failed: ${err instanceof Error ? err.message : String(err)}`);
                clickedElement = null;
              }
            } else {
              console.log(`   ⚠️  No element found via context`);
            }
          }

          // Fallback to standard selectors if contextual finding didn't work
          if (!clicked) {
            console.log(`   🔍 Trying standard selectors...`);
            const selectors = this.generateSelectors(target, elementTypeHint);
            for (const selector of selectors) {
              try {
                const element = await this.page.$(selector);
                if (element) {
                  clickedElement = element;
                  elementText = await element.textContent() || target;
                  console.log(`   ✅ Found element via selector "${selector}": "${elementText}"`);
                  await element.click();
                  clicked = true;
                  break;
                }
              } catch {
                continue;
              }
            }
          }

          if (!clicked) {
            // Try text-based click
            console.log(`   🔍 Trying text-based click...`);
            try {
              clickedElement = await this.page.$(`text=${target}`);
              if (clickedElement) {
                elementText = await clickedElement.textContent() || target;
                console.log(`   ✅ Found element via text: "${elementText}"`);
                await clickedElement.click();
                clicked = true;
              }
            } catch (err) {
              console.log(`   ⚠️  Text-based click failed: ${err instanceof Error ? err.message : String(err)}`);
              // Last fallback: try to find any clickable element matching description pattern
              console.log(`   🔍 Trying fallback contextual finding...`);
              clickedElement = await this.findElementByContext(description, null);
              if (clickedElement) {
                try {
                  elementText = await clickedElement.textContent() || 'element';
                  console.log(`   ✅ Found element via fallback context: "${elementText}"`);
                  await clickedElement.click();
                  clicked = true;
                } catch (err2) {
                  console.log(`   ⚠️  Fallback click failed: ${err2 instanceof Error ? err2.message : String(err2)}`);
                  // Final fallback
                  console.log(`   🔍 Trying final fallback (first clickable element)...`);
                  const buttons = await this.page.$$('button, a[href], [role="button"]');
                  if (buttons.length > 0) {
                    clickedElement = buttons[0];
                    elementText = await buttons[0].textContent() || 'element';
                    console.log(`   ⚠️  Using first clickable element: "${elementText}"`);
                    await buttons[0].click();
                    clicked = true;
                  }
                }
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
              const tagName = await clickedElement.evaluate((el: Element) => el.tagName.toLowerCase());
              const isVisible = await clickedElement.isVisible();
              const isEnabled = await clickedElement.isEnabled();
              const computedSelector = await clickedElement.evaluate((el: Element) => {
                if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
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
          let urlAfterClick = this.page.url();
          const navigated = urlAfterClick !== urlBeforeClick;
          
          if (navigated) {
            console.log(`   🔍 Navigation detected: ${urlBeforeClick} → ${urlAfterClick}`);
            // Wait for navigation to complete
            try {
              await this.page.waitForLoadState('load', { timeout: 10000 });
              console.log(`   ✅ Page load complete`);
              // Wait a bit more for dynamic content to render
              await this.page.waitForTimeout(2000);
              urlAfterClick = this.page.url(); // Get final URL after navigation
            } catch {
              console.log(`   ⚠️  Navigation wait timed out, continuing...`);
            }
          } else {
            // No navigation, but wait for client-side filtering to apply
            console.log(`   🔍 No navigation, waiting for client-side filtering...`);
            await this.page.waitForTimeout(3000);
          }
          
          const newTitle = await this.page.title();
          
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

      // Extract action - extract values from elements (generic, works for any site)
      // Check AFTER click to avoid conflicts
      if (action === 'extract' || (description.includes('extract') && !description.includes('click') && !description.includes('count') && !description.includes('verify'))) {
        console.log(`\n🔍 [Step ${stepNumber}] EXTRACT ACTION`);
        console.log(`   Description: ${step.description}`);
        console.log(`   Target: ${step.target || 'none'}`);
        
        const extractResult = await this.extractValueFromPage(description, step.target || null);
        const extractedValue = extractResult?.value ?? null;
        const extractedElementText = extractResult?.elementText ?? null;
        
        console.log(`   ✅ Extracted value: ${extractedValue !== null ? extractedValue : 'null'}`);
        if (extractedElementText) {
          console.log(`   ✅ Extracted from element: "${extractedElementText}"`);
        }
        
        // Store extracted value AND the element that was used for extraction
        (step as any).extractedValue = extractedValue;
        (step as any).extractedElementText = extractedElementText;
        
        return {
          stepNumber,
          description: step.description,
          action: 'extract',
          status: 'passed',
          expected: `Extract value from ${step.target || 'element'}`,
          actual: `Extracted: ${extractedValue !== null ? String(extractedValue) : 'No value found'}`,
          verified: extractedValue !== null,
          details: {
            // Store in generic details object
          } as any,
        };
      }

      // Count action - count elements on page (generic, works for any site)
      // Check BEFORE verify to avoid conflicts
      if (action === 'count' || (description.includes('count') && !description.includes('extract') && !description.includes('click') && !description.includes('verify'))) {
        console.log(`\n🔢 [Step ${stepNumber}] COUNT ACTION`);
        console.log(`   Description: ${step.description}`);
        
        const count = await this.countElements(description);
        const target = this.getCountTarget(description);
        
        console.log(`   ✅ Counted: ${count} ${target}`);
        
        // Store count in step context for later use
        (step as any).countedValue = count;
        
        return {
          stepNumber,
          description: step.description,
          action: 'count',
          status: 'passed',
          expected: `Count ${target}`,
          actual: `Counted: ${count} ${target}`,
          verified: count >= 0,
          details: {
            // Store in generic details object
          } as any,
        };
      }

      // Type action
      if (action === 'type' || description.includes('type') || description.includes('enter')) {
        let input = null;
        const value = step.value || this.generateTestValue(step.description);

        // Try to find the specific input field using element type hint and target
        if (elementTypeHint && target) {
          console.log(`   🎯 Using element type hint to find input: ${elementTypeHint}:${target}`);

          // Build selectors based on element type hint
          const selectors: string[] = [];

          if (elementTypeHint === 'input') {
            // For inputs, try to match by placeholder, name, aria-label, or type
            if (target.toLowerCase() === 'text') {
              selectors.push('input[type="text"]');
            } else if (target.toLowerCase() === 'password') {
              selectors.push('input[type="password"]');
            } else if (target.toLowerCase() === 'email') {
              selectors.push('input[type="email"]');
            } else {
              // Try matching by placeholder, name, or aria-label
              selectors.push(`input[placeholder*="${target}" i]`);
              selectors.push(`input[name*="${target}" i]`);
              selectors.push(`input[aria-label*="${target}" i]`);
            }
          } else if (elementTypeHint === 'textarea') {
            selectors.push(`textarea[placeholder*="${target}" i]`);
            selectors.push(`textarea[name*="${target}" i]`);
          }

          // Try each selector
          for (const selector of selectors) {
            try {
              const element = await this.page.$(selector);
              if (element && await element.isVisible()) {
                input = element;
                console.log(`   ✅ Found input via selector: ${selector}`);
                break;
              }
            } catch {
              continue;
            }
          }
        }

        // Fallback: If no element type hint or couldn't find specific input, use smart inference
        if (!input) {
          console.log(`   🔍 Falling back to input field inference...`);

          // Get all visible input fields
          const allInputs = await this.page.$$('input[type="text"], input[type="password"], input[type="email"], textarea');
          const visibleInputs = [];

          for (const inp of allInputs) {
            if (await inp.isVisible()) {
              visibleInputs.push(inp);
            }
          }

          if (visibleInputs.length > 0) {
            // Try to infer which input based on description
            const descLower = description.toLowerCase();

            if (descLower.includes('password')) {
              // Find password field
              const passwordInput = await this.page.$('input[type="password"]');
              if (passwordInput && await passwordInput.isVisible()) {
                input = passwordInput;
                console.log(`   ✅ Inferred password field from description`);
              }
            } else if (descLower.includes('email')) {
              // Find email field
              const emailInput = await this.page.$('input[type="email"]');
              if (emailInput && await emailInput.isVisible()) {
                input = emailInput;
                console.log(`   ✅ Inferred email field from description`);
              }
            } else if (descLower.includes('username') || descLower.includes('user')) {
              // Find username field (usually first text input)
              const textInputs = await this.page.$$('input[type="text"]');
              for (const txtInput of textInputs) {
                if (await txtInput.isVisible()) {
                  input = txtInput;
                  console.log(`   ✅ Inferred username field from description`);
                  break;
                }
              }
            }

            // If still no match, use first visible input
            if (!input) {
              input = visibleInputs[0];
              console.log(`   ⚠️  Using first visible input field as fallback`);
            }
          }
        }

        if (input) {
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

      // Verify action - enhanced with dynamic comparison support
      // Check AFTER count to avoid conflicts
      if (action === 'verify' || (description.includes('verify') && !description.includes('extract') && !description.includes('count') && !description.includes('click')) || (description.includes('check') && !description.includes('extract') && !description.includes('count'))) {
        console.log(`\n✅ [Step ${stepNumber}] VERIFY ACTION`);
        console.log(`   Description: ${step.description}`);
        
        // Check if this is a comparison verification (matches, equals, etc.)
        if (description.includes('match') || description.includes('equals') || description.includes('same') || description.includes('compare')) {
          // Try to get previously extracted/counted values from test case context
          const testCaseSteps = testCase.steps;
          const currentStepIndex = stepNumber - 1;
          
          // Look for extract/count steps before this verify step
          let extractedValue: number | null = null;
          let countedValue: number | null = null;
          
          for (let i = 0; i < currentStepIndex; i++) {
            const prevStep = testCaseSteps[i];
            if ((prevStep as any).extractedValue !== undefined) {
              extractedValue = parseInt(String((prevStep as any).extractedValue)) || null;
            }
            if ((prevStep as any).countedValue !== undefined) {
              countedValue = (prevStep as any).countedValue;
            }
          }
          
          // If we have both extracted and counted values, compare them
          if (extractedValue !== null && countedValue !== null) {
            const matches = extractedValue === countedValue;
            console.log(`\n✅ [Step ${stepNumber}] VERIFY COMPARISON`);
            console.log(`   Extracted value: ${extractedValue}`);
            console.log(`   Counted value: ${countedValue}`);
            console.log(`   Match: ${matches ? 'YES ✓' : `NO ✗ (Expected ${extractedValue}, Got ${countedValue})`}`);
            
            return {
              stepNumber,
              description: step.description,
              action: 'verify',
              status: matches ? 'passed' : 'failed',
              expected: `Extracted value (${extractedValue}) should match counted value (${countedValue})`,
              actual: `Extracted value: ${extractedValue}, Counted articles: ${countedValue}, Match: ${matches ? 'Yes ✓' : `No ✗ (Expected ${extractedValue}, Got ${countedValue})`}`,
              verified: matches,
              details: {
                extractedValue: String(extractedValue),
                countedValue: String(countedValue),
                match: matches,
              } as any,
            };
          }
          
          // If we only have one value, try to extract/count on the fly
          if (extractedValue === null && description.includes('extracted')) {
            const extractResult = await this.extractValueFromPage(description, null);
            extractedValue = extractResult?.value ?? null;
          }
          if (countedValue === null && description.includes('count')) {
            countedValue = await this.countElements(description);
          }
          
          if (extractedValue !== null && countedValue !== null) {
            const matches = extractedValue === countedValue;
            return {
              stepNumber,
              description: step.description,
              action: 'verify',
              status: matches ? 'passed' : 'failed',
              expected: `Extracted value (${extractedValue}) should match counted value (${countedValue})`,
              actual: `Extracted value: ${extractedValue}, Counted articles: ${countedValue}, Match: ${matches ? 'Yes ✓' : `No ✗ (Expected ${extractedValue}, Got ${countedValue})`}`,
              verified: matches,
              details: {
                extractedValue: String(extractedValue),
                countedValue: String(countedValue),
                match: matches,
              } as any,
            };
          }
        }
        
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
          verified = !!(title && title.length > 0);
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
          
          verified = !!(bodyText && bodyText.trim().length > 0);
          details = contentDetails;
        } else {
          // Generic verification
          verified = !!(title && title.length > 0 && bodyText && bodyText.trim().length > 0);
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
   * Find element by context (generic - works for any site)
   * Finds elements based on their relationship to headings/sections
   */
  private async findElementByContext(description: string, target: string | null): Promise<any> {
    const descLower = description.toLowerCase();
    
    // Extract section/heading name from description
    const sectionPatterns = [
      /(?:in|within|under|below)\s+(?:the\s+)?(.+?)(?:\s+section|\s+area|\s+region)?/i,
      /(.+?)\s+section/i,
    ];
    
    let sectionName: string | null = null;
    for (const pattern of sectionPatterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        sectionName = match[1].trim();
        break;
      }
    }
    
    // If we have a section name, find elements near that heading
    if (sectionName) {
      try {
        // Find heading that contains the section name
        const headings = await this.page.$$('h1, h2, h3, h4, h5, h6');
        for (const heading of headings) {
          const headingText = await heading.textContent();
          if (headingText && headingText.toLowerCase().includes(sectionName.toLowerCase())) {
            // Find clickable elements near this heading (siblings or in same container)
            const parent = await heading.evaluateHandle(el => el.parentElement);
            if (parent) {
              // Look for clickable elements in the same container
              const clickables = await this.page.evaluateHandle((parentEl: Element | null) => {
                if (!parentEl) return [];
                return Array.from(parentEl.querySelectorAll('button, a[href], [role="button"], [onclick], .clickable, [data-clickable]'))
                  .filter((el: Element) => (el as HTMLElement).offsetParent !== null) as Element[]; // Only visible elements
              }, parent);
              
              if (clickables && (clickables as any).length > 0) {
                // Return first clickable element, or one matching target if provided
                const elements = await this.page.$$('button, a[href], [role="button"]');
                for (const el of elements) {
                  const text = await el.textContent();
                  if (!target || (text && text.toLowerCase().includes(target.toLowerCase()))) {
                    return el;
                  }
                }
                // If no match, return first element
                if (elements.length > 0) {
                  return elements[0];
                }
              }
            }
          }
        }
      } catch {
        // Fall through to return null
      }
    }
    
    // Fallback: if description mentions "first", "any", or pattern, find first matching element
    if (descLower.includes('first') || descLower.includes('any') || descLower.includes('a filter') || descLower.includes('an element')) {
      const clickables = await this.page.$$('button, a[href], [role="button"]');
      if (clickables.length > 0) {
        // If target provided, try to match it
        if (target) {
          for (const el of clickables) {
            const text = await el.textContent();
            if (text && text.toLowerCase().includes(target.toLowerCase())) {
              return el;
            }
          }
        }
        // Return first clickable
        return clickables[0];
      }
    }
    
    return null;
  }

  /**
   * Extract numeric value from page (generic - works for any site)
   * Extracts numbers from element text, useful for counts, mentions, etc.
   * Prioritizes finding numbers in filter-like elements or elements with count/mention keywords
   * Returns both the value and the element text for later reference
   */
  private async extractValueFromPage(description: string, target: string | null): Promise<{ value: number | null; elementText: string | null }> {
    try {
      const descLower = description.toLowerCase();
      const isMentionCount = descLower.includes('mention') || descLower.includes('count');
      
      console.log(`      🔍 Extract: isMentionCount=${isMentionCount}, target="${target}"`);
      
      // If we have a target section, try to find elements in that section first
      if (target) {
        console.log(`      🔍 Looking for element in section: "${target}"`);
        const element = await this.findElementByContext(description, target);
        if (element) {
          const text = await element.textContent();
          console.log(`      ✅ Found element with text: "${text?.substring(0, 100)}"`);
          if (text) {
            // For mention counts, look for patterns like "X mentions" or "X items"
            if (isMentionCount) {
              const mentionMatch = text.match(/(\d+)\s*(?:mention|mentions|item|items|result|results)/i);
              if (mentionMatch) {
                const value = parseInt(mentionMatch[1], 10);
                console.log(`      ✅ Extracted from mention pattern: ${value}`);
                return { value, elementText: text.trim() };
              }
            }
            // Extract largest number from text (more likely to be the count)
            const numbers = text.match(/\d+/g);
            if (numbers && numbers.length > 0) {
              // Return the largest number found (more likely to be a count)
              const maxNumber = Math.max(...numbers.map((n: string) => parseInt(n, 10)));
              console.log(`      ✅ Extracted max number from text: ${maxNumber} (from: ${numbers.join(', ')})`);
              if (maxNumber > 0) {
                return { value: maxNumber, elementText: text.trim() };
              }
            }
          }
        } else {
          console.log(`      ⚠️  No element found in section "${target}"`);
        }
      }
      
      // Try to find element by context and extract number
      console.log(`      🔍 Trying context-based finding without target...`);
      const element = await this.findElementByContext(description, null);
      if (element) {
        const text = await element.textContent();
        console.log(`      ✅ Found element with text: "${text?.substring(0, 100)}"`);
        if (text) {
          // For mention counts, look for patterns like "X mentions"
          if (isMentionCount) {
            const mentionMatch = text.match(/(\d+)\s*(?:mention|mentions|item|items|result|results)/i);
            if (mentionMatch) {
              const value = parseInt(mentionMatch[1], 10);
              console.log(`      ✅ Extracted from mention pattern: ${value}`);
              return { value, elementText: text.trim() };
            }
          }
          // Extract largest number from text
          const numbers = text.match(/\d+/g);
          if (numbers && numbers.length > 0) {
            const maxNumber = Math.max(...numbers.map((n: string) => parseInt(n, 10)));
            console.log(`      ✅ Extracted max number: ${maxNumber} (from: ${numbers.join(', ')})`);
            if (maxNumber > 0) {
              return { value: maxNumber, elementText: text.trim() };
            }
          }
        }
      } else {
        console.log(`      ⚠️  No element found via context`);
      }
      
      // Fallback: search all clickable elements for numbers, prioritizing those with mention/count keywords
      console.log(`      🔍 Searching all clickable elements...`);
      const clickables = await this.page.$$('button, a[href], [role="button"]');
      console.log(`      📊 Found ${clickables.length} clickable elements`);
      
      // First pass: look for elements with mention/count keywords
      if (isMentionCount) {
        console.log(`      🔍 First pass: looking for elements with "mention" or "count" keywords...`);
        for (const el of clickables) {
          const text = await el.textContent();
          if (text && (text.toLowerCase().includes('mention') || text.toLowerCase().includes('count'))) {
            console.log(`         Found element with mention/count: "${text.substring(0, 50)}"`);
            const mentionMatch = text.match(/(\d+)\s*(?:mention|mentions|item|items|result|results)/i);
            if (mentionMatch) {
              const value = parseInt(mentionMatch[1], 10);
              console.log(`      ✅ Extracted from mention pattern: ${value}`);
              return { value, elementText: text.trim() };
            }
          }
        }
      }
      
      // Second pass: find largest number in any clickable element
      console.log(`      🔍 Second pass: finding largest number in all clickable elements...`);
      let maxFound = 0;
      let maxFoundText = '';
      for (const el of clickables) {
        const text = await el.textContent();
        if (text && /\d+/.test(text)) {
          const numbers = text.match(/\d+/g);
          if (numbers) {
            const maxInText = Math.max(...numbers.map((n: string) => parseInt(n, 10)));
            if (maxInText > maxFound) {
              maxFound = maxInText;
              maxFoundText = text.trim();
            }
          }
        }
      }
      
      if (maxFound > 0) {
        console.log(`      ✅ Extracted max number from all clickables: ${maxFound} (from: "${maxFoundText.substring(0, 50)}")`);
        return { value: maxFound, elementText: maxFoundText };
      }
      
      console.log(`      ⚠️  No number found in any element`);
    } catch {
      // Return null if extraction fails
    }
    
    return { value: null, elementText: null };
  }

  /**
   * Count elements on page (generic - works for any site)
   * Tries to focus on main content area to avoid counting navigation/header/footer elements
   */
  private async countElements(description: string): Promise<number> {
    const descLower = description.toLowerCase();
    
    console.log(`      🔍 Counting elements based on description: "${description}"`);
    
    // Determine what to count based on description
    if (descLower.includes('article') || descLower.includes('item') || descLower.includes('result')) {
      // First, try to find the main content container to focus counting there
      console.log(`      🔍 Looking for main content container...`);
      const mainContentSelectors = [
        'main',
        '[role="main"]',
        '.content',
        '#content',
        '.main-content',
        '[class*="archive"]',
        '[class*="results"]',
        '[class*="list"]',
        '[class*="grid"]'
      ];
      
      let mainContainer: any = null;
      for (const selector of mainContentSelectors) {
        try {
          mainContainer = await this.page.$(selector);
          if (mainContainer) {
            console.log(`      ✅ Found main container: ${selector}`);
            break;
          }
        } catch {
          // Continue to next selector
        }
      }
      
      if (mainContainer) {
        // Count within the main container
        console.log(`      🔍 Counting articles within main container...`);
        const articleSelectors = [
          'article',
          '[class*="article"]',
          '[class*="item"]:not(nav [class*="item"]):not(header [class*="item"]):not(footer [class*="item"])',
          '[class*="card"]:not(nav [class*="card"]):not(header [class*="card"]):not(footer [class*="card"])',
          '[class*="result"]',
          'li:not(nav li):not(header li):not(footer li)'
        ];
        
        for (const selector of articleSelectors) {
          try {
            const count = await mainContainer.$$eval(selector, (els: Element[]) => {
              // Filter to only visible elements
              return els.filter((el: Element) => {
                const htmlEl = el as HTMLElement;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && htmlEl.offsetHeight > 0;
              }).length;
            });
            if (count > 0) {
              console.log(`      ✅ Counted ${count} articles using selector: ${selector}`);
              // Log first few elements for debugging
              const sample = await mainContainer.$$eval(selector, (els: Element[]) => 
                els.slice(0, 3).map((el: Element) => el.textContent?.trim().substring(0, 50) || '').filter(Boolean)
              );
              if (sample.length > 0) {
                console.log(`      📊 Sample elements: ${sample.join(' | ')}`);
              }
              return count;
            }
          } catch {
            // Continue to next selector
          }
        }
      }
      
      // Fallback: count article-like elements on entire page, but exclude nav/header/footer
      console.log(`      🔍 Fallback: counting articles on entire page (excluding nav/header/footer)...`);
      try {
        const count = await this.page.$$eval(
          'article, [class*="article"], [class*="item"], [class*="card"], [class*="result"]',
          (els: Element[]) => {
            return els.filter((el: Element) => {
              // Exclude elements in nav, header, footer
              const parent = el.closest('nav, header, footer');
              if (parent) return false;
              
              // Only count visible elements
              const htmlEl = el as HTMLElement;
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && htmlEl.offsetHeight > 0;
            }).length;
          }
        );
        console.log(`      ✅ Counted ${count} article-like elements (excluding nav/header/footer)`);
        if (count > 0) {
          // Log sample for debugging
          const sample = await this.page.$$eval(
            'article, [class*="article"], [class*="item"], [class*="card"], [class*="result"]',
            (els: Element[]) => {
              const filtered = els.filter((el: Element) => {
                const parent = el.closest('nav, header, footer');
                if (parent) return false;
                const htmlEl = el as HTMLElement;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && htmlEl.offsetHeight > 0;
              });
              return filtered.slice(0, 3).map((el: Element) => el.textContent?.trim().substring(0, 50) || '').filter(Boolean);
            }
          );
          if (sample.length > 0) {
            console.log(`      📊 Sample elements: ${sample.join(' | ')}`);
          }
          return count;
        }
      } catch (err) {
        console.log(`      ⚠️  Error counting with fallback: ${err}`);
      }
      
      // Last resort: count list items
      console.log(`      🔍 Last resort: counting list items...`);
      const listItems = await this.page.$$eval('li', (els: Element[]) => {
        return els.filter((el: Element) => {
          const parent = el.closest('nav, header, footer');
          if (parent) return false;
          const htmlEl = el as HTMLElement;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && htmlEl.offsetHeight > 0;
        }).length;
      });
      console.log(`      ✅ Counted ${listItems} list items (excluding nav/header/footer)`);
      return listItems;
    } else if (descLower.includes('link')) {
      const count = await this.page.$$eval('a[href]', (links) => links.length);
      console.log(`      ✅ Counted ${count} links`);
      return count;
    } else if (descLower.includes('button')) {
      const count = await this.page.$$eval('button, [role="button"]', (buttons) => buttons.length);
      console.log(`      ✅ Counted ${count} buttons`);
      return count;
    } else if (descLower.includes('filter')) {
      // Count clickable elements that might be filters
      const count = await this.page.$$eval('button, a[href], [role="button"]', (els) => els.length);
      console.log(`      ✅ Counted ${count} clickable elements (filters)`);
      return count;
    } else {
      // Default: count visible content elements
      console.log(`      🔍 Using default selectors for content elements...`);
      const count = await this.page.$$eval('article, [class*="item"], [class*="card"], li', (els: Element[]) => {
        return els.filter((el: Element) => {
          const parent = el.closest('nav, header, footer');
          if (parent) return false;
          const htmlEl = el as HTMLElement;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && htmlEl.offsetHeight > 0;
        }).length;
      });
      console.log(`      ✅ Counted ${count} content elements (excluding nav/header/footer)`);
      return count;
    }
  }

  /**
   * Get what we're counting from description
   */
  private getCountTarget(description: string): string {
    const descLower = description.toLowerCase();
    if (descLower.includes('article')) return 'articles';
    if (descLower.includes('item')) return 'items';
    if (descLower.includes('result')) return 'results';
    if (descLower.includes('link')) return 'links';
    if (descLower.includes('button')) return 'buttons';
    if (descLower.includes('filter')) return 'filters';
    return 'elements';
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
  private generateSelectors(target: string, elementTypeHint?: string): string[] {
    const selectors: string[] = [];

    // If AI provided element type hint, prioritize selectors matching that type
    if (elementTypeHint) {
      if (elementTypeHint === 'button') {
        selectors.push(`button:has-text("${target}")`);
        selectors.push(`[role="button"]:has-text("${target}")`);
        selectors.push(`input[type="button"]:has-text("${target}")`);
        selectors.push(`input[type="submit"]:has-text("${target}")`);
      } else if (elementTypeHint === 'link') {
        selectors.push(`a:has-text("${target}")`);
        selectors.push(`[role="link"]:has-text("${target}")`);
      } else if (elementTypeHint === 'input') {
        selectors.push(`input[placeholder*="${target}"]`);
        selectors.push(`input[name*="${target}"]`);
        selectors.push(`input[aria-label*="${target}"]`);
      } else if (elementTypeHint === 'textarea') {
        selectors.push(`textarea[placeholder*="${target}"]`);
        selectors.push(`textarea[name*="${target}"]`);
      } else if (elementTypeHint === 'select') {
        selectors.push(`select[name*="${target}"]`);
        selectors.push(`select[aria-label*="${target}"]`);
      }
    }

    // Try various selector strategies (fallback if type hint doesn't match)
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

