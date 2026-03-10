/**
 * Test Case Generator
 * 
 * Generates test cases from website exploration data using AI.
 * Combines:
 * - AI-generated test cases based on discovered elements
 * - Custom test cases from context files
 * - Validation against actual page elements
 */

import { PageState, TestCase, ContextFileConfig, HybridTestCase, HybridTestStep, HybridVerification, ElementTarget } from './types.js';
import { AIVisionService } from './ai-vision.js';
import { Config } from './types.js';
import { MCPClient } from './mcp-client.js';

/**
 * Site context passed to test generation
 */
export interface SiteContext {
  architecture?: unknown;
  risks?: unknown[];
  fullReport?: string;
  sitePurpose?: string;
  contentNature?: 'static' | 'dynamic' | 'mixed';
  contentPatterns?: string[];
  testingGuidance?: string;
  updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
  contextFile?: ContextFileConfig;
  /** Whether exploration successfully authenticated (tests start in logged-in state) */
  explorationAuthenticated?: boolean;
}

export interface GeneratedTestCase {
  id: string;
  name: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  steps: TestStep[];
  expectedResult: string;
  pageUrl?: string;
}

export interface TestStep {
  action: string;
  description: string;
  target?: string;
  value?: string;
  // AI Intelligence Metadata - preserves AI's understanding of the element
  elementMetadata?: {
    // Structural Understanding
    elementType?: 'button' | 'link' | 'input' | 'form' | 'dropdown' | 'checkbox' | 'radio';
    selector?: string;  // CSS selector from DOM discovery
    context?: string;   // "Name Display Demo section", "login form", etc.
    location?: string;  // "top navigation", "main content area"
    pageUrl?: string;   // Which page this element belongs to
    
    // Functional Understanding - AI's understanding of what the element does
    purpose?: string;   // "updates the name display", "submits login credentials"
    behavior?: string;  // "takes input text and displays it back", "navigates to home page"
    workflow?: string;  // "User enters text → Clicks Update Name → Display panel updates"
    relatedElements?: string[];  // ["name input field", "name display panel"]
    expectedStateChange?: string;  // "Display panel updates with entered name"
    functionalDescription?: string;  // Full AI understanding from vision analysis
  };
}

export class TestCaseGenerator {
  private visionService: AIVisionService;
  private config: Config;

  constructor(config: Config, visionService: AIVisionService) {
    this.config = config;
    this.visionService = visionService;
  }

  /**
   * Generate test cases from exploration data
   */
  async generateTestCases(
    pages: PageState[],
    startUrl: string,
    siteContext?: SiteContext
  ): Promise<GeneratedTestCase[]> {
    // Extract information from exploration with discovered elements
    const pageInfo = pages.map(p => ({
      url: p.url,
      title: p.title,
      actions: p.actions.map(a => a.description),
      features: this.extractFeatures(p),
      discoveredElements: p.discoveredElements || {
        links: [],
        buttons: [],
        forms: [],
        headings: [],
        navigationItems: [],
      },
      visionAnalysis: p.visionAnalysis,
    }));

    // Aggregate site characteristics from all vision analyses
    const aggregatedSiteContext = this.aggregateSiteCharacteristics(pages, siteContext);

    // Use AI to generate test cases based on what was ACTUALLY discovered
    // The AI will use importantTests from context file as guidance for required coverage
    // FLOW-AWARE: Pass pages to include observed action flows in the prompt
    const aiTestCases = await this.generateWithAI(pageInfo, startUrl, aggregatedSiteContext, pages);

    // Verify that required test scenarios from context file are covered
    const contextFile = siteContext?.contextFile;
    const importantTests = contextFile?.importantTests || contextFile?.customTestCases;
    if (importantTests && Array.isArray(importantTests) && importantTests.length > 0) {
      this.verifyTestCoverage(aiTestCases, importantTests);
    }

    // Validate test cases against discovered elements
    const validatedTestCases = this.validateTestCases(aiTestCases, pageInfo);

    return validatedTestCases;
  }

  /**
   * Aggregate site characteristics from vision analyses and full report
   */
  private aggregateSiteCharacteristics(
    pages: PageState[],
    siteContext?: SiteContext
  ): SiteContext {
    const characteristics: SiteContext = {};

    // Collect from vision analyses
    const allCharacteristics = pages
      .map(p => p.visionAnalysis?.siteCharacteristics)
      .filter((sc): sc is NonNullable<typeof sc> => sc !== undefined);

    if (allCharacteristics.length > 0) {
      // Aggregate site purpose (most common or first)
      const purposes = allCharacteristics.map(sc => sc.sitePurpose).filter(Boolean);
      if (purposes.length > 0) {
        characteristics.sitePurpose = purposes[0]; // Use first, could be improved with voting
      }

      // Aggregate content nature (most dynamic wins)
      const natures = allCharacteristics.map(sc => sc.contentNature).filter(Boolean);
      if (natures.length > 0) {
        if (natures.some(n => n === 'dynamic')) {
          characteristics.contentNature = 'dynamic';
        } else if (natures.some(n => n === 'mixed')) {
          characteristics.contentNature = 'mixed';
        } else {
          characteristics.contentNature = 'static';
        }
      }

      // Aggregate content patterns
      const allPatterns = allCharacteristics.flatMap(sc => sc.contentPatterns || []);
      if (allPatterns.length > 0) {
        characteristics.contentPatterns = [...new Set(allPatterns)];
      }

      // Aggregate update frequency (most frequent wins)
      const frequencies = allCharacteristics.map(sc => sc.updateFrequency).filter(Boolean);
      if (frequencies.length > 0) {
        const freqOrder = ['real-time', 'frequent', 'periodic', 'rare'];
        characteristics.updateFrequency = frequencies.reduce((prev, curr) => {
          const prevIdx = freqOrder.indexOf(prev || 'rare');
          const currIdx = freqOrder.indexOf(curr || 'rare');
          return currIdx < prevIdx ? curr : prev;
        }, frequencies[0]);
      }
    }

    // Generate testing guidance based on aggregated characteristics
    const guidance: string[] = [];
    
    if (characteristics.contentNature === 'dynamic' || characteristics.updateFrequency === 'frequent' || characteristics.updateFrequency === 'real-time') {
      guidance.push('Content updates frequently - test structure and functionality, not specific content');
      guidance.push('Avoid testing specific headlines, titles, or card content that changes regularly');
      guidance.push('Test filters, navigation, and interactive elements that remain consistent');
    } else if (characteristics.contentNature === 'static') {
      guidance.push('Content is relatively static - can test specific content elements');
      guidance.push('Test both structure and specific content');
    } else {
      guidance.push('Mixed content nature - test structure and functionality primarily');
      guidance.push('Be selective about testing specific content (only if it appears stable)');
    }

    if (characteristics.contentPatterns) {
      if (characteristics.contentPatterns.some(p => p.toLowerCase().includes('feed'))) {
        guidance.push('Feed-based content - test feed loading, pagination, and filtering');
      }
      if (characteristics.contentPatterns.some(p => p.toLowerCase().includes('time') || p.toLowerCase().includes('timestamp'))) {
        guidance.push('Time-sensitive content - avoid testing specific time-based elements');
      }
    }

    if (guidance.length > 0) {
      characteristics.testingGuidance = guidance.join('. ');
    }

    // Include full report context if available
    if (siteContext) {
      characteristics.architecture = siteContext.architecture;
      characteristics.risks = siteContext.risks;
      characteristics.fullReport = siteContext.fullReport;
      characteristics.contextFile = siteContext.contextFile; // CRITICAL: Pass through context file with credentials
    }

    return characteristics;
  }

  /**
   * Extract features from a page state
   */
  private extractFeatures(page: PageState): string[] {
    const features: string[] = [];
    
    // Analyze actions to infer features
    const actionTypes = new Set(page.actions.map(a => a.type));
    
    if (actionTypes.has('click')) {
      features.push('Interactive elements (buttons, links)');
    }
    if (actionTypes.has('type')) {
      features.push('Form inputs');
    }
    if (actionTypes.has('scroll')) {
      features.push('Scrollable content');
    }
    
    // Use discovered elements if available
    if (page.discoveredElements) {
      if (page.discoveredElements.links.length > 0) {
        features.push(`${page.discoveredElements.links.length} links found`);
      }
      if (page.discoveredElements.buttons.length > 0) {
        features.push(`${page.discoveredElements.buttons.length} buttons found`);
      }
      if (page.discoveredElements.forms.length > 0) {
        features.push(`${page.discoveredElements.forms.length} forms found`);
      }
    }
    
    // Infer from URL
    if (page.url.includes('search') || page.url.includes('query')) {
      features.push('Search functionality');
    }
    if (page.url.includes('login') || page.url.includes('signin')) {
      features.push('Authentication');
    }
    
    return features;
  }

  /**
   * Build discovery summary for AI prompt
   */
  private buildDiscoverySummary(
    pageInfo: Array<{
      url: string;
      title: string;
      actions: string[];
      features: string[];
      discoveredElements: import('./types.js').DiscoveredElements;
      visionAnalysis?: import('./types.js').VisionAnalysis;
    }>,
    pages?: import('./types.js').PageState[]
  ): string {
    let summary = '\nDISCOVERED PAGES & FEATURES:\n\n';

    for (let i = 0; i < pageInfo.length; i++) {
      const p = pageInfo[i];
      const elements = p.discoveredElements;
      const vision = p.visionAnalysis;

      summary += `Page ${i + 1}: ${p.url}\n`;
      summary += `  Title: ${p.title}\n`;

      // Include AI's understanding of what this page IS
      if (vision) {
        if (vision.pageType) {
          summary += `  Type: ${vision.pageType}\n`;
        }
        if (vision.description) {
          summary += `  Description: ${vision.description}\n`;
        }
      }

      // List interactive elements
      const parts = [];
      if (elements.links.length > 0) {
        const linkTexts = elements.links.slice(0, 10).map(l => `"${l.text}"`).join(', ');
        parts.push(`${elements.links.length} links (${linkTexts}${elements.links.length > 10 ? '...' : ''})`);
      }
      if (elements.buttons.length > 0) {
        const btnTexts = elements.buttons.slice(0, 10).map(b => `"${b.text}"`).join(', ');
        parts.push(`${elements.buttons.length} buttons (${btnTexts}${elements.buttons.length > 10 ? '...' : ''})`);
      }
      if (elements.forms.length > 0) {
        const formDescs = elements.forms.map((f, idx) => {
          const fieldDescs = f.fields.map(field =>
            field.label || field.placeholder || field.name || field.type
          ).join(', ');
          return `form-${idx+1}: [${fieldDescs}]`;
        }).join('; ');
        parts.push(`${elements.forms.length} forms (${formDescs})`);
      }

      if (parts.length > 0) {
        summary += `  Elements: ${parts.join('; ')}\n`;
      }

      // Include key interactive elements from vision analysis
      if (vision?.interactiveElements && vision.interactiveElements.length > 0) {
        const keyElements = vision.interactiveElements.slice(0, 5).map(el =>
          `${el.type}: "${el.description}" (${el.purpose})`
        ).join('; ');
        summary += `  Key Features: ${keyElements}\n`;
      }

      summary += '\n';
    }

    // FLOW-AWARE: Include observed action flows from exploration
    if (pages && pages.length > 0) {
      const observedFlows = this.buildObservedActionFlows(pages);
      if (observedFlows) {
        summary += observedFlows;
      }
    }

    return summary;
  }

  /**
   * Build a summary of observed action flows from exploration
   * This tells the AI what ACTUALLY happens when actions are performed
   */
  private buildObservedActionFlows(pages: import('./types.js').PageState[]): string {
    let flows = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    flows += 'OBSERVED ACTION FLOWS (What actually happened during exploration):\n';
    flows += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    let hasFlows = false;

    for (const page of pages) {
      const actionsWithOutcomes = page.actions.filter(a => a.outcome && a.success);

      for (const action of actionsWithOutcomes) {
        const outcome = action.outcome!;

        // Only include actions with interesting outcomes
        if (!outcome.navigationOccurred && !outcome.modalAppeared?.detected && !outcome.inlineUpdateDetected) {
          continue;
        }

        hasFlows = true;
        let flowDesc = `• ${action.description}`;

        if (outcome.navigationOccurred) {
          // Extract meaningful path from URL
          try {
            const newPath = new URL(outcome.urlAfter).pathname;
            flowDesc += ` → NAVIGATES TO: ${newPath}`;

            // Try to identify page type
            if (newPath.match(/\/[a-f0-9-]{20,}$/i)) {
              flowDesc += ' (detail page with ID)';
            } else if (newPath.includes('/new') || newPath.includes('/create')) {
              flowDesc += ' (creation page)';
            } else if (newPath.includes('/edit')) {
              flowDesc += ' (edit page)';
            } else if (newPath.includes('/list') || newPath.endsWith('s')) {
              flowDesc += ' (list page)';
            }
          } catch {
            flowDesc += ` → NAVIGATES TO: ${outcome.urlAfter}`;
          }
        }

        if (outcome.modalAppeared?.detected) {
          flowDesc += ` → OPENS ${outcome.modalAppeared.type?.toUpperCase() || 'MODAL'}`;
          if (outcome.modalAppeared.title) {
            flowDesc += `: "${outcome.modalAppeared.title}"`;
          }
        }

        if (outcome.inlineUpdateDetected && !outcome.navigationOccurred && !outcome.modalAppeared?.detected) {
          flowDesc += ' → INLINE UPDATE (content changed, no navigation)';
        }

        if (outcome.aiInterpretation) {
          flowDesc += `\n  AI Interpretation: ${outcome.aiInterpretation}`;
        }

        flows += flowDesc + '\n';
      }
    }

    if (!hasFlows) {
      return ''; // No interesting flows to report
    }

    flows += '\n⚠️ IMPORTANT: Use these OBSERVED flows to understand actual navigation patterns!\n';
    flows += '   - If an action NAVIGATES TO a detail page, verify on that page (not the list)\n';
    flows += '   - If an action OPENS A MODAL, interact with the modal (don\'t assume form is inline)\n';
    flows += '   - If an action causes INLINE UPDATE, verify the change on the same page\n';
    flows += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    return flows;
  }

  /**
   * Build site context section for AI prompt
   */
  private buildSiteContextSection(siteContext?: {
    sitePurpose?: string;
    contentNature?: 'static' | 'dynamic' | 'mixed';
    contentPatterns?: string[];
    testingGuidance?: string;
    updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
    architecture?: any;
    risks?: any[];
    fullReport?: string;
    contextFile?: any; // Optional context file data
    explorationAuthenticated?: boolean; // Whether exploration successfully logged in
  }): string {
    let context = 'SITE CONTEXT (from AI Vision Analysis, Full Report, and Context File):\n';
    context += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    // Check if we have a context file (user-provided domain knowledge)
    const contextFile = siteContext?.contextFile;
    if (contextFile) {
      context += '📋 CONTEXT FILE PROVIDED (User Domain Knowledge):\n';
      if (contextFile.siteName) {
        context += `Site Name: ${contextFile.siteName}\n`;
      }
      // Support both old 'description' and new 'siteDescription' fields
      const description = contextFile.siteDescription || contextFile.description;
      if (description) {
        context += `Description: ${description}\n`;
      }
      if (contextFile.primaryPurpose) {
        context += `Primary Purpose: ${contextFile.primaryPurpose}\n`;
      }
      // CRITICAL: Add credentials if available (check both top-level and authentication.credentials)
      const credentials = contextFile.credentials || contextFile.authentication?.credentials || contextFile.demoCredentials;
      if (credentials) {
        context += `\n🔐 LOGIN CREDENTIALS (USE THESE FOR LOGIN STEPS):\n`;
        context += `  Email/Username: ${credentials.email || credentials.username || 'NOT PROVIDED'}\n`;
        context += `  Password: ${credentials.password || 'NOT PROVIDED'}\n`;
        context += `  ⚠️  IMPORTANT: For login tests, you MUST:\n`;
        context += `     1. Navigate to login page\n`;
        context += `     2. Type the email/username into the username/email field\n`;
        context += `     3. Type the password into the password field\n`;
        context += `     4. Click the submit/sign-in button\n`;
        context += `     5. Wait for redirect back to the app\n`;
        context += `     6. Verify you landed on the expected page\n`;
        context += `  Do NOT just wait for login to happen "externally" - actually fill in the credentials!\n`;
      }

      // Check if exploration already authenticated
      if (siteContext?.explorationAuthenticated) {
        context += `\n⚠️ IMPORTANT - EXPLORATION ALREADY AUTHENTICATED:\n`;
        context += `  The browser exploration successfully logged in and visited authenticated pages.\n`;
        context += `  Tests will run in the SAME browser session, already logged in.\n`;
        context += `  DO NOT generate a separate login test - authentication was already validated during exploration.\n`;
        context += `  All tests should assume they start in an AUTHENTICATED state.\n`;
      }
      if (contextFile.technology) {
        context += `Technology: ${JSON.stringify(contextFile.technology)}\n`;
      }
      if (contextFile.updateSchedule) {
        context += `Update Schedule: ${JSON.stringify(contextFile.updateSchedule)}\n`;
      }
      if (contextFile.keyPages && contextFile.keyPages.length > 0) {
        context += `\nKey Pages:\n`;
        for (const page of contextFile.keyPages.slice(0, 5)) {
          context += `  - ${page.name} (${page.url}): ${page.description}\n`;
          if (page.importantElements && page.importantElements.length > 0) {
            context += `    Important Elements: ${page.importantElements.slice(0, 3).join(', ')}\n`;
          }
        }
      }
      if (contextFile.filterBehavior) {
        context += `\nFilter Behavior:\n`;
        if (contextFile.filterBehavior.contentTypeFilters) {
          context += `  Content Type Filters: ${Object.keys(contextFile.filterBehavior.contentTypeFilters).join(', ')}\n`;
        }
        if (contextFile.filterBehavior.topicFilters) {
          context += `  Topic Filters: ${contextFile.filterBehavior.topicFilters.slice(0, 5).join(', ')}\n`;
        }
      }
      // Support both old testingGuidance object, string format, and testingNotes field
      if (contextFile.testingNotes) {
        context += `\n📝 Testing Notes from Context File:\n`;
        context += `  ${contextFile.testingNotes}\n`;
      } else if (contextFile.testingGuidance) {
        context += `\n📝 Testing Guidance from Context File:\n`;
        // Handle string format (simple guidance text)
        if (typeof contextFile.testingGuidance === 'string') {
          context += `  ${contextFile.testingGuidance}\n`;
        } else {
          // Handle object format (structured guidance)
          if (contextFile.testingGuidance.testThese) {
            context += `  Test These: ${contextFile.testingGuidance.testThese.slice(0, 5).join(', ')}\n`;
          }
          if (contextFile.testingGuidance.dontTestThese) {
            context += `  Don't Test These: ${contextFile.testingGuidance.dontTestThese.slice(0, 5).join(', ')}\n`;
          }
          if (contextFile.testingGuidance.priority) {
            context += `  Priority: ${contextFile.testingGuidance.priority}\n`;
          }
          if (contextFile.testingGuidance.specialNotes) {
            context += `  Special Notes: ${contextFile.testingGuidance.specialNotes.slice(0, 2).join('; ')}\n`;
          }
        }
      }

      // Add important test requirements (guidance for test generation)
      const importantTests = contextFile.importantTests || contextFile.customTestCases;
      if (importantTests && Array.isArray(importantTests) && importantTests.length > 0) {
        context += `\n🎯 REQUIRED TEST COVERAGE (Must include these scenarios):\n`;
        for (let i = 0; i < Math.min(importantTests.length, 5); i++) {
          const test = importantTests[i];
          context += `  ${i + 1}. ${test.name}\n`;
          if (test.description) {
            context += `     ${test.description}\n`;
          }
        }
        context += `  ⚠️  Generate test cases covering each scenario above using discovered elements.\n`;
      }
      context += '\n';
    }

    // Use aggregated site characteristics if available (from AI discovery)
    if (siteContext) {
      context += '🤖 AI-DISCOVERED CONTEXT:\n';
      if (siteContext.sitePurpose) {
        context += `Site Purpose: ${siteContext.sitePurpose}\n`;
      }

      if (siteContext.contentNature) {
        context += `Content Nature: ${siteContext.contentNature}\n`;
      }

      if (siteContext.updateFrequency) {
        context += `Update Frequency: ${siteContext.updateFrequency}\n`;
      }

      if (siteContext.contentPatterns && siteContext.contentPatterns.length > 0) {
        context += `Content Patterns: ${siteContext.contentPatterns.join(', ')}\n`;
      }

      if (siteContext.testingGuidance && !contextFile) {
        context += `\nTesting Guidance:\n${siteContext.testingGuidance}\n`;
      }

      // Include relevant architecture insights if available
      if (siteContext.architecture && siteContext.architecture.siteStructure) {
        context += `\nSite Structure: ${siteContext.architecture.siteStructure.substring(0, 200)}...\n`;
      }

      // Include full report summary if available (first 500 chars)
      if (siteContext.fullReport) {
        context += `\nFull Report Summary:\n${siteContext.fullReport.substring(0, 500)}...\n`;
      }
    } else {
      context += 'No specific site characteristics detected. Generate general test cases.\n';
    }

    context += '\nUse this context to generate appropriate test cases:\n';
    if (contextFile?.testingGuidance) {
      context += '- PRIORITY: Follow the testing guidance from the context file above\n';
    }
    context += '- Follow the testing guidance above\n';
    context += '- If content is dynamic/frequently updated, test structure and functionality, not specific content\n';
    context += '- If content is static, you can test specific content elements\n';
    context += '- Adapt test cases to match the site\'s purpose and content nature\n';
    context += '- Consider the site structure and architecture when generating tests\n';
    if (contextFile?.keyPages) {
      context += '- Reference the key pages listed above when generating navigation tests\n';
    }
    context += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    return context;
  }

  /**
   * Infer page type from URL and title
   */
  private inferPageType(url: string, title: string): string {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    
    if (urlLower.includes('about')) return 'About Page';
    if (urlLower.includes('contact')) return 'Contact Page';
    if (urlLower.includes('home') || urlLower.endsWith('/') || urlLower.match(/^https?:\/\/[^\/]+$/)) return 'Homepage';
    if (urlLower.includes('archive')) return 'Archive Page';
    if (urlLower.includes('search')) return 'Search Page';
    if (urlLower.includes('login') || urlLower.includes('signin')) return 'Login Page';
    
    return 'Content Page';
  }

  /**
   * Validate test cases against discovered elements
   */
  private validateTestCases(
    testCases: GeneratedTestCase[],
    pageInfo: Array<{ 
      url: string; 
      title: string; 
      actions: string[]; 
      features: string[];
      discoveredElements: import('./types.js').DiscoveredElements;
    }>
  ): GeneratedTestCase[] {
    // Build a map of page URL to discovered elements
    const pageElementMap = new Map<string, {
      links: Set<string>;
      buttons: Set<string>;
      navigationItems: Set<string>;
    }>();
    
    for (const page of pageInfo) {
      const elements = page.discoveredElements;
      const linkTexts = new Set(elements.links.map(l => l.text.toLowerCase()));
      const buttonTexts = new Set(elements.buttons.map(b => b.text.toLowerCase()));
      const navTexts = new Set(elements.navigationItems.map(n => n.toLowerCase()));
      
      pageElementMap.set(page.url, {
        links: linkTexts,
        buttons: buttonTexts,
        navigationItems: navTexts,
      });
    }
    
    // Collect all discovered element texts across all pages (for general validation)
    const allDiscoveredTexts = new Set<string>();
    const allDiscoveredLinks = new Set<string>();
    
    for (const page of pageInfo) {
      const elements = page.discoveredElements;
      elements.links.forEach(link => {
        allDiscoveredLinks.add(link.text.toLowerCase());
        allDiscoveredTexts.add(link.text.toLowerCase());
      });
      elements.buttons.forEach(button => {
        allDiscoveredTexts.add(button.text.toLowerCase());
      });
      elements.navigationItems.forEach(nav => {
        allDiscoveredTexts.add(nav.toLowerCase());
      });
    }
    
    // Validate each test case
    const validated: GeneratedTestCase[] = [];
    const warnings: string[] = [];
    
    for (const testCase of testCases) {
      const issues: string[] = [];
      const testCasePageUrl = testCase.pageUrl;
      
      // Find which page this test case is for
      const testCasePage = pageInfo.find(p => p.url === testCasePageUrl);
      if (!testCasePage && testCasePageUrl) {
        issues.push(`Test case references page URL "${testCasePageUrl}" which was not explored`);
      }
      
      // Check if test case tests elements on the correct page
      if (testCasePage) {
        const pageElements = pageElementMap.get(testCasePage.url);
        if (pageElements) {
          // Check each step for element references
          for (const step of testCase.steps) {
            const stepText = step.description.toLowerCase();
            const targetText = step.target?.toLowerCase() || '';
            
            // Skip navigation steps
            if (step.action === 'navigate' || stepText.includes('navigate')) {
              continue;
            }
            
            // Check if step references an element that exists on this page
            if (step.target) {
              const targetLower = step.target.toLowerCase();
              const elementExists = 
                pageElements.links.has(targetLower) ||
                pageElements.buttons.has(targetLower) ||
                pageElements.navigationItems.has(targetLower);
              
              if (!elementExists) {
                // Check if it exists on any other page
                let existsOnOtherPage = false;
                for (const [pageUrl, elements] of pageElementMap.entries()) {
                  if (pageUrl !== testCasePage.url) {
                    if (elements.links.has(targetLower) || 
                        elements.buttons.has(targetLower) || 
                        elements.navigationItems.has(targetLower)) {
                      existsOnOtherPage = true;
                      issues.push(`Element "${step.target}" exists on a different page (${pageUrl}), not on test case page (${testCasePage.url})`);
                      break;
                    }
                  }
                }
                
                if (!existsOnOtherPage && targetLower.length > 3) {
                  issues.push(`Element "${step.target}" may not exist on page ${testCasePage.url}`);
                }
              }
            }
          }
        }
      }
      
      // Check for common assumptions
      for (const step of testCase.steps) {
        const stepText = step.description.toLowerCase();
        const targetText = step.target?.toLowerCase() || '';
        
        const commonAssumptions = ['about us', 'contact', 'contact us', 'privacy policy', 'terms of service'];
        for (const assumption of commonAssumptions) {
          if (stepText.includes(assumption) || targetText.includes(assumption)) {
            if (!allDiscoveredTexts.has(assumption) && !allDiscoveredLinks.has(assumption)) {
              issues.push(`References "${assumption}" which was not discovered`);
            }
          }
        }
      }
      
      if (issues.length > 0) {
        warnings.push(`TC-${testCase.id}: ${testCase.name} - ${issues.join('; ')}`);
      }
      
      validated.push(testCase);
    }
    
    if (warnings.length > 0) {
      console.warn('\n⚠️  Test case validation warnings:');
      warnings.forEach(w => console.warn(`  - ${w}`));
      console.warn('');
    }
    
    return validated;
  }

  /**
   * Verify that required test scenarios from context file are covered by generated tests
   */
  private verifyTestCoverage(
    generatedTests: GeneratedTestCase[],
    importantTests: Array<{ name: string; description?: string; priority?: string }>
  ): void {
    console.log(`\n🔍 Verifying coverage of ${importantTests.length} required test scenario(s)...`);

    const missing: string[] = [];
    const covered: string[] = [];

    for (const required of importantTests) {
      const requiredName = required.name.toLowerCase();
      const requiredDesc = (required.description || '').toLowerCase();

      // Check if any generated test covers this requirement
      const isCovered = generatedTests.some(test => {
        const testText = `${test.name} ${test.description}`.toLowerCase();

        // Match if test name/description contains key words from required test
        const keyWords = requiredName.split(' ').filter(w => w.length > 3);
        return keyWords.some(word => testText.includes(word)) ||
               (requiredDesc && testText.includes(requiredDesc.substring(0, 50)));
      });

      if (isCovered) {
        covered.push(required.name);
      } else {
        missing.push(required.name);
      }
    }

    if (covered.length > 0) {
      console.log(`✅ Covered ${covered.length}/${importantTests.length} required scenarios`);
    }

    if (missing.length > 0) {
      console.warn(`⚠️  Required scenarios that may not be covered:`);
      missing.forEach(name => console.warn(`   - ${name}`));
      console.warn(`   Review generated tests to confirm coverage.\n`);
    } else {
      console.log(`✅ All required test scenarios appear to be covered!\n`);
    }
  }

  /**
   * Generate test cases using AI
   */
  private async generateWithAI(
    pageInfo: Array<{
      url: string;
      title: string;
      actions: string[];
      features: string[];
      discoveredElements: import('./types.js').DiscoveredElements;
      visionAnalysis?: import('./types.js').VisionAnalysis;
    }>,
    startUrl: string,
    siteContext?: {
      sitePurpose?: string;
      contentNature?: 'static' | 'dynamic' | 'mixed';
      contentPatterns?: string[];
      testingGuidance?: string;
      updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
      architecture?: any;
      risks?: any[];
      fullReport?: string;
      contextFile?: any; // CRITICAL: Context file with credentials
    },
    pages?: PageState[] // FLOW-AWARE: Pass pages for observed action flows
  ): Promise<GeneratedTestCase[]> {
    // Debug: Log what siteContext contains
    console.log('🔍 [TestCaseGenerator] siteContext keys:', Object.keys(siteContext || {}));
    console.log('🔍 [TestCaseGenerator] Has contextFile?', !!siteContext?.contextFile);
    const contextFile = siteContext?.contextFile;
    const credentials = contextFile?.credentials || contextFile?.authentication?.credentials || contextFile?.demoCredentials;
    if (credentials) {
      console.log('🔍 [TestCaseGenerator] Credentials found:', {
        email: credentials.email,
        username: credentials.username,
        hasPassword: !!credentials.password,
        source: contextFile?.credentials ? 'credentials' : contextFile?.authentication?.credentials ? 'authentication.credentials' : 'demoCredentials'
      });
    } else {
      console.log('⚠️ [TestCaseGenerator] No credentials found in contextFile');
    }

    // Build discovery summary (includes observed action flows if pages provided)
    const discoverySummary = this.buildDiscoverySummary(pageInfo, pages);

    // Build site context section
    const siteContextSection = this.buildSiteContextSection(siteContext);

    // Debug: Log if credentials made it to the context section
    if (siteContextSection.includes('LOGIN CREDENTIALS')) {
      console.log('✅ [TestCaseGenerator] Credentials section IS in prompt');
    } else {
      console.log('❌ [TestCaseGenerator] Credentials section NOT in prompt');
      console.log('🔍 [TestCaseGenerator] Context section preview:', siteContextSection.substring(0, 500));
    }
    
    const prompt = `You are an expert QA engineer. Based on your analysis of this website, generate FUNCTIONAL tests that verify the application actually works.

=== CRITICAL: UNDERSTAND THE SITE'S PURPOSE ===
First, identify what this application DOES:
- Is it a project management tool? → Test creating/editing/deleting projects
- Is it an e-commerce site? → Test adding to cart, checkout flow
- Is it a content site? → Test search, filtering, content display
- Is it a task/ticket system? → Test creating tickets, changing status, assignments

YOUR PRIMARY GOAL: Test the CORE FUNCTIONALITY of what this site does.

=== TEST PRIORITY (FOLLOW THIS ORDER) ===

**PRIORITY 1 - CRUD OPERATIONS (Must have these!):**
If you see "New", "Add", "Create" buttons → Generate tests that:
1. Click the create button
2. Fill in the form fields with test data (use descriptive names like "Test Project - Automation")
3. Submit/Save the form
4. VERIFY the created item appears in a list, table, or board

If you see lists/tables with items → Generate tests that:
1. Interact with an item (edit, delete, view details)
2. VERIFY the change is reflected (item updated, item removed, etc.)

**PRIORITY 2 - WORKFLOWS:**
Test realistic user journeys that span multiple steps:
- Create something → Find it → Modify it → Delete it
- Fill a form → Submit → Verify success state
- Search/filter → Verify results match

**PRIORITY 3 - FORMS & VALIDATION:**
For each form you find:
- Test successful submission (happy path)
- Test required field validation (leave fields empty)

**LOWEST PRIORITY - Navigation/Visibility:**
Simple "click link, verify page loads" tests are LOW VALUE.
Only include a few navigation tests, not as the main test suite.

=== WHAT MAKES A GOOD TEST ===

✅ GOOD TEST (functional):
1. Navigate to /projects
2. Click "New Project" button
3. Type "Test Project - {{timestamp}}" in title field
4. Type "Automated test project" in description field
5. Click "Save" or "Create" button
6. Verify "Test Project" appears in the projects list

❌ BAD TEST (just visibility):
1. Navigate to /projects
2. Verify "New Project" button is visible
3. Verify page title is correct
(This doesn't test if anything actually WORKS!)

=== HOW TO VERIFY CRUD OPERATIONS ===

After CREATE: Look for the item in a list/table/board
After UPDATE: Verify the changed data is displayed
After DELETE: Verify the item is no longer in the list
After SEARCH: Verify results contain/exclude expected items

=== FORM SUBMISSION PATTERNS ===

Look for submit buttons with text like:
- "Save", "Create", "Submit", "Add", "Update", "Done"
- Or icons/buttons at the bottom of forms

After submission, look for:
- Success messages ("Created successfully", "Saved")
- Redirects to list views
- The new item appearing in a list/table

=== TEST DATA ===
Use descriptive test data that's easy to verify:
- Titles: "Test [Thing] - Automation" or "QA Test [Thing]"
- Descriptions: "Created by automated testing"
- This makes it easy to search for and verify

${siteContextSection}

${discoverySummary}

=== CRITICAL: USE OBSERVED ACTION FLOWS ===

The "OBSERVED ACTION FLOWS" section above shows what ACTUALLY happened during exploration when buttons/links were clicked.

**YOU MUST USE THIS INFORMATION:**
- If clicking "New Project" → NAVIGATES TO detail page (not stays on list), then your verify step should check the DETAIL page, not the list page
- If clicking "Add Item" → OPENS MODAL, then your test must interact with the modal form, not expect an inline form
- If an action → INLINE UPDATE, verify on the same page without expecting navigation

**DO NOT ASSUME navigation patterns - USE the observed flows!**

Example:
- OBSERVED: Clicked "New Project" → NAVIGATES TO /projects/abc123 (detail page)
- WRONG TEST: verify project in list on /projects page
- CORRECT TEST: verify project title on /projects/abc123 detail page

=== RULES - DO NOT VIOLATE ===

**NEVER generate placeholder or "coverage gap" tests.**
- If you cannot test something because elements aren't available, simply DO NOT generate that test.
- NEVER create a test that says "intentionally performs no interactions" or "documents that X cannot be tested".
- Every test MUST perform the actions it claims to test. If it claims to test filters, it must actually click filters.

**Limit navigation-only tests to MAX 3.**
- Do not create multiple tests that just click nav links and verify URL change.
- One navigation test covering the main links is sufficient.

**No duplicate tests.**
- Two tests that click different nav links and verify the page loaded are essentially the same test.
- Combine them or pick the most important one.

=== GENERATE TESTS ===

Based on what you discovered about this site, generate tests that:
1. At least 50% should be CRUD/functional tests (create, update, delete operations)
2. Include workflow tests that chain multiple operations
3. Minimize simple navigation/visibility tests (MAX 3)
4. **MATCH the observed navigation patterns exactly** (if create→detail page, verify on detail page)
5. **Every test must perform real actions** - no placeholders, no gap documentation

Return valid JSON only:
{
  "testCases": [{
    "name": "descriptive test name",
    "description": "what this verifies functionally",
    "priority": "high|medium|low",
    "category": "crud|workflow|forms|validation|navigation",
    "steps": [
      {"action": "navigate", "description": "go to page", "target": "http://example.com/page"},
      {"action": "click", "description": "click create button", "target": "button:New Project"},
      {"action": "type", "description": "enter title", "target": "input:Title", "value": "Test Project - Automation"},
      {"action": "click", "description": "save the form", "target": "button:Save"},
      {"action": "verify", "description": "verify item appears in list", "target": "Test Project - Automation", "verifyType": "element_text"}
    ],
    "expectedResult": "The created item appears in the list/table/board",
    "pageUrl": "starting URL"
  }]
}`;

    try {
      // Use OpenAI client directly for text generation
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: this.config.openaiApiKey });
      
      const response = await client.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are a QA test case generator. Return ONLY valid JSON with testCases array. No markdown, no examples, no explanations.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 16000,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const finishReason = response.choices[0]?.finish_reason;
      
      console.log(`🔍 AI Response length: ${content.length} chars, finish_reason: ${finishReason}`);
      console.log(`🔍 AI Response preview: ${content.substring(0, 500)}...`);
      
      // Log reasoning if visionService has logging capability
      console.log(`🔍 Checking visionService: ${!!this.visionService}, has logReasoning: ${typeof this.visionService?.logReasoning === 'function'}`);
      if (this.visionService && typeof this.visionService.logReasoning === 'function') {
        console.log(`🔍 Calling logReasoning for operation: generateTestCases`);
        await this.visionService.logReasoning({
          timestamp: new Date().toISOString(),
          operation: 'generateTestCases',
          model: this.config.openaiModel,
          prompt: prompt, // Store full prompt
          response: content, // Store full response
          tokenUsage: response.usage ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          } : undefined,
          finishReason: finishReason,
          metadata: {
            pagesCount: pageInfo.length,
            startUrl,
            discoveredElementsCount: pageInfo.reduce((sum, p) => 
              sum + (p.discoveredElements?.links?.length || 0) + 
              (p.discoveredElements?.buttons?.length || 0) +
              (p.discoveredElements?.forms?.length || 0), 0
            ),
          },
        });
      }
      
      if (finishReason === 'length') {
        console.warn('⚠️  AI response was truncated! Consider increasing max_completion_tokens.');
      }
      
      // Clean content - remove any markdown code blocks if present
      let cleanedContent = content.trim();
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      const parsed = JSON.parse(cleanedContent);
      
      console.log(`🔍 Parsed JSON keys: ${Object.keys(parsed).join(', ')}`);
      
      // Handle both {testCases: [...]} and [...] formats
      const testCasesArray = Array.isArray(parsed) ? parsed : (parsed.testCases || []);
      
      console.log(`🔍 Found ${testCasesArray.length} test cases in AI response`);
      console.log(`🔍 Test case names: ${testCasesArray.map((tc: any) => tc.name || 'unnamed').join(', ')}`);
      
      if (testCasesArray.length === 0) {
        console.warn('⚠️  AI returned empty testCases array!');
        console.warn(`⚠️  Parsed object: ${JSON.stringify(parsed, null, 2).substring(0, 500)}`);
      }
      
      if (testCasesArray.length === 1) {
        console.warn('⚠️  AI only generated 1 test case! This might indicate the prompt needs adjustment.');
      }
      
      // Validate and filter test cases
      const validTestCases = testCasesArray
        .map((tc: any, index: number) => {
          // Strict validation - reject if missing critical fields
          if (!tc.name || typeof tc.name !== 'string' || tc.name.trim().length === 0) {
            return null;
          }
          
          if (!tc.steps || !Array.isArray(tc.steps) || tc.steps.length === 0) {
            return null;
          }
          
          // Filter out test cases that are clearly formatting examples or templates
          const name = String(tc.name || '').trim().toLowerCase();
          const description = String(tc.description || '').trim();
          
          // Reject if name looks like markdown formatting
          if (name.startsWith('#') || name.startsWith('##') || name.startsWith('###')) {
            return null;
          }
          
          // Reject if name is too generic or looks like a template
          const genericNames = ['test case', 'test cases', 'test', '##', '###'];
          if (genericNames.some(g => name === g || name.startsWith(g + ' '))) {
            return null;
          }
          
          // Reject if description contains markdown formatting instructions
          if (description.includes('##') || description.includes('###') || description.includes('**ID:**')) {
            return null;
          }
          
          // Filter and validate steps
          const validSteps = (tc.steps || [])
            .filter((s: any) => {
              if (!s || typeof s !== 'object') return false;
              if (!s.description || typeof s.description !== 'string') return false;
              const stepDesc = String(s.description).trim();
              return stepDesc.length > 0 && !stepDesc.startsWith('#');
            })
            .map((s: any) => ({
              action: String(s.action || 'verify').toLowerCase(),
              description: String(s.description).trim(),
              target: s.target ? String(s.target).trim() : undefined,
              value: s.value ? String(s.value).trim() : undefined,
            }));
          
          // Reject if no valid steps after filtering
          if (validSteps.length === 0) {
            return null;
          }
          
          return {
            id: `TC-${String(index + 1).padStart(3, '0')}`,
            name: String(tc.name).trim(),
            description: String(tc.description || '').trim(),
            priority: (tc.priority === 'high' || tc.priority === 'medium' || tc.priority === 'low') 
              ? tc.priority 
              : 'medium',
            category: String(tc.category || 'general').trim(),
            steps: validSteps,
            expectedResult: String(tc.expectedResult || 'Test should complete successfully').trim(),
            pageUrl: tc.pageUrl ? String(tc.pageUrl).trim() : undefined,
          };
        })
        .filter((tc: any) => tc !== null && tc.steps && tc.steps.length > 0);
      
      if (validTestCases.length === 0) {
        console.warn('No valid test cases generated by AI, using fallback');
        return this.generateFallbackTestCases(pageInfo, startUrl);
      }
      
      return validTestCases;
    } catch (error) {
      console.error('Error generating test cases with AI:', error);
      // Fallback: generate basic test cases from exploration data
      return this.generateFallbackTestCases(pageInfo, startUrl);
    }
  }

  /**
   * Generate fallback test cases if AI generation fails
   */
  private generateFallbackTestCases(
    pageInfo: Array<{ 
      url: string; 
      title: string; 
      actions: string[]; 
      features: string[];
      discoveredElements: import('./types.js').DiscoveredElements;
    }>,
    startUrl: string
  ): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];
    let testId = 1;

    // Basic page load test
    testCases.push({
      id: `TC-${String(testId++).padStart(3, '0')}`,
      name: 'Homepage Loads Correctly',
      description: 'Verify the homepage loads and displays correctly',
      priority: 'high',
      category: 'page-loading',
      steps: [
        { action: 'navigate', description: 'Navigate to homepage', target: startUrl },
        { action: 'verify', description: 'Verify page loads within reasonable time' },
        { action: 'verify', description: 'Verify page title is present' },
      ],
      expectedResult: 'Page loads successfully, title is displayed',
      pageUrl: startUrl,
    });

    // Navigation tests - use ACTUAL discovered links
    const firstPage = pageInfo[0];
    if (firstPage && firstPage.discoveredElements) {
      const links = firstPage.discoveredElements.links.slice(0, 5); // Test first 5 links
      for (const link of links) {
        testCases.push({
          id: `TC-${String(testId++).padStart(3, '0')}`,
          name: `Navigation to ${link.text}`,
          description: `Verify navigation to ${link.text} link works`,
          priority: 'high',
          category: 'navigation',
          steps: [
            { action: 'navigate', description: 'Navigate to homepage' },
            { action: 'click', description: `Click on "${link.text}" link`, target: link.text },
            { action: 'verify', description: 'Verify page loads correctly' },
          ],
          expectedResult: `${link.text} page loads successfully`,
          pageUrl: link.href,
        });
      }
    }

    // Button tests - use ACTUAL discovered buttons
    if (firstPage && firstPage.discoveredElements) {
      const buttons = firstPage.discoveredElements.buttons.slice(0, 3); // Test first 3 buttons
      for (const button of buttons) {
        testCases.push({
          id: `TC-${String(testId++).padStart(3, '0')}`,
          name: `Button "${button.text}" Functionality`,
          description: `Verify "${button.text}" button works correctly`,
          priority: 'medium',
          category: 'functionality',
          steps: [
            { action: 'navigate', description: 'Navigate to homepage' },
            { action: 'click', description: `Click on "${button.text}" button`, target: button.text },
            { action: 'verify', description: 'Verify button action completed' },
          ],
          expectedResult: `"${button.text}" button functions correctly`,
        });
      }
    }

    // Form tests - use ACTUAL discovered forms
    if (firstPage && firstPage.discoveredElements && firstPage.discoveredElements.forms.length > 0) {
      const form = firstPage.discoveredElements.forms[0];
      testCases.push({
        id: `TC-${String(testId++).padStart(3, '0')}`,
        name: 'Form Input and Submission',
        description: 'Verify form accepts input and can be submitted',
        priority: 'high',
        category: 'forms',
        steps: [
          { action: 'navigate', description: 'Navigate to page with form' },
          ...form.fields.slice(0, 3).map(field => ({
            action: 'type' as const,
            description: `Enter test data in ${field.type} field${field.placeholder ? ` (${field.placeholder})` : ''}`,
            value: field.type === 'email' ? 'test@example.com' : 'test value',
          })),
          { action: 'click', description: 'Click submit button', target: 'Submit' },
          { action: 'verify', description: 'Verify form submission response' },
        ],
        expectedResult: 'Form accepts input and submits successfully',
      });
    }

    return testCases;
  }

  /**
   * Generate intent-based test cases for AI-driven execution
   * These describe WHAT to test, not HOW - the AI executor figures out the steps
   */
  async generateIntentTestCases(
    pages: PageState[],
    startUrl: string,
    siteContext?: SiteContext
  ): Promise<import('./types.js').IntentTestCase[]> {
    console.log('🎯 Generating intent-based test cases for AI-driven execution...');

    // Build discovery summary
    const pageInfo = pages.map(p => ({
      url: p.url,
      title: p.title,
      actions: p.actions.map(a => a.description),
      features: this.extractFeatures(p),
      discoveredElements: p.discoveredElements || {
        links: [],
        buttons: [],
        forms: [],
        headings: [],
        navigationItems: [],
      },
      visionAnalysis: p.visionAnalysis,
    }));

    // FLOW-AWARE: Include observed action flows in discovery summary
    const discoverySummary = this.buildDiscoverySummary(pageInfo, pages);
    const aggregatedContext = this.aggregateSiteCharacteristics(pages, siteContext);

    // Build context about authentication
    const hasAuth = aggregatedContext.contextFile?.authentication?.required ||
                    aggregatedContext.contextFile?.authentication?.credentials ||
                    aggregatedContext.contextFile?.credentials;
    const authNote = hasAuth
      ? 'This site requires authentication. Tests that need logged-in access should list "authenticated" as a precondition.'
      : '';

    const prompt = `You are an expert QA engineer creating intent-based test cases. These tests describe WHAT to verify, not HOW to do it step-by-step. An AI executor will figure out the specific steps.

=== SITE DISCOVERY ===
${discoverySummary}

=== IMPORTANT: OBSERVED ACTION FLOWS ===
The discovery above includes "OBSERVED ACTION FLOWS" showing what ACTUALLY happens when actions are performed.
Use this to understand the actual navigation patterns (e.g., create→detail page vs create→list page).

=== SITE CONTEXT ===
${aggregatedContext.sitePurpose ? `Purpose: ${aggregatedContext.sitePurpose}` : ''}
${aggregatedContext.contentNature ? `Content: ${aggregatedContext.contentNature}` : ''}
${authNote}

=== INTENT-BASED TEST FORMAT ===
Each test should have:
- A clear INTENT (what to accomplish)
- SUCCESS CRITERIA (how to verify it worked)
- PRECONDITIONS if needed (e.g., "authenticated")

=== EXAMPLES ===
Good intent: "Create a new project named 'Test Project' and verify it appears in the projects list"
Good criteria: ["Project form is accessible", "Can enter project name", "Project appears in list after creation"]

Bad intent: "Click the Projects link, then click New Project button, then type 'Test' in the name field..."
(Too prescriptive - should describe WHAT, not HOW)

=== YOUR TASK ===
Generate 8-15 intent-based tests covering:
- Core user workflows (high priority)
- Navigation between sections (medium priority)
- Form interactions and validations (high priority)
- Error states and edge cases (low priority)

Return JSON:
{
  "testCases": [
    {
      "name": "Short descriptive name",
      "description": "What this test verifies",
      "intent": "Clear statement of what to accomplish",
      "successCriteria": ["Criterion 1", "Criterion 2"],
      "preconditions": ["authenticated"],
      "startingPoint": "/dashboard",
      "priority": "high|medium|low",
      "category": "authentication|navigation|forms|workflow|validation"
    }
  ]
}`;

    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: this.config.openaiApiKey });

      const response = await client.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are a QA test case generator. Return ONLY valid JSON. Generate intent-based tests that describe WHAT to verify, not step-by-step HOW.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 8000,
      });

      const content = response.choices[0]?.message?.content || '{}';
      console.log(`📄 AI generated ${content.length} chars of intent tests`);

      const parsed = JSON.parse(content);
      const testCasesArray = Array.isArray(parsed) ? parsed : (parsed.testCases || []);

      // Validate and format
      const intentTestCases: import('./types.js').IntentTestCase[] = testCasesArray
        .map((tc: any, index: number) => {
          if (!tc.name || !tc.intent || !tc.successCriteria) {
            return null;
          }

          return {
            id: `IT-${String(index + 1).padStart(3, '0')}`,
            name: String(tc.name).trim(),
            description: String(tc.description || tc.intent).trim(),
            intent: String(tc.intent).trim(),
            successCriteria: Array.isArray(tc.successCriteria)
              ? tc.successCriteria.map((c: any) => String(c).trim())
              : [String(tc.successCriteria).trim()],
            preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
            startingPoint: tc.startingPoint || '/',
            priority: ['high', 'medium', 'low'].includes(tc.priority) ? tc.priority : 'medium',
            category: String(tc.category || 'general').trim(),
            tags: tc.tags || [],
          };
        })
        .filter((tc: any) => tc !== null);

      console.log(`✅ Generated ${intentTestCases.length} intent-based test cases`);
      return intentTestCases;

    } catch (error) {
      console.error('Error generating intent test cases:', error);
      // Return minimal fallback
      return [{
        id: 'IT-001',
        name: 'Basic Site Navigation',
        description: 'Verify the site loads and basic navigation works',
        intent: 'Load the homepage and verify it displays correctly',
        successCriteria: ['Homepage loads', 'Main content is visible'],
        preconditions: [],
        startingPoint: '/',
        priority: 'high',
        category: 'navigation',
      }];
    }
  }

  /**
   * Format intent test cases as markdown
   */
  formatIntentTestCases(testCases: import('./types.js').IntentTestCase[]): string {
    let content = '# Intent-Based Test Cases (AI-Driven Execution)\n\n';
    content += `Total test cases: ${testCases.length}\n\n`;
    content += '> These tests describe WHAT to verify. The AI executor determines HOW.\n\n';
    content += '---\n\n';

    for (const tc of testCases) {
      content += `## ${tc.id}: ${tc.name}\n\n`;
      content += `**Priority:** ${tc.priority.toUpperCase()}\n\n`;
      content += `**Category:** ${tc.category}\n\n`;
      content += `**Intent:** ${tc.intent}\n\n`;

      if (tc.preconditions && tc.preconditions.length > 0) {
        content += `**Preconditions:** ${tc.preconditions.join(', ')}\n\n`;
      }

      content += `**Starting Point:** ${tc.startingPoint}\n\n`;

      content += `**Success Criteria:**\n`;
      tc.successCriteria.forEach((criterion, idx) => {
        content += `${idx + 1}. ${criterion}\n`;
      });

      content += '\n---\n\n';
    }

    return content;
  }

  /**
   * Format executed intent test results into nice readable test cases
   * This shows WHAT the AI actually did during execution
   */
  formatExecutedTestCases(results: import('./types.js').IntentTestResult[]): string {
    let content = '# Generated Test Cases (AI-Executed)\n\n';
    content += `Total test cases: ${results.length}\n\n`;
    content += '> These test cases were dynamically generated and executed by AI.\n';
    content += '> Steps shown are what the AI actually performed during testing.\n\n';
    content += '---\n\n';

    for (const result of results) {
      const tc = result.testCase;
      const statusIcon = result.status === 'passed' ? '✅' : '❌';

      content += `## ${tc.id}: ${tc.name}\n\n`;
      content += `**Status:** ${statusIcon} ${result.status.toUpperCase()}\n\n`;
      content += `**Priority:** ${tc.priority.toUpperCase()}\n\n`;
      content += `**Category:** ${tc.category}\n\n`;
      content += `**Intent:** ${tc.intent}\n\n`;

      if (tc.preconditions && tc.preconditions.length > 0) {
        content += `**Preconditions:** ${tc.preconditions.join(', ')}\n\n`;
      }

      content += `**Starting Point:** ${tc.startingPoint}\n\n`;

      // Show the actual steps the AI took
      if (result.executionLog && result.executionLog.length > 0) {
        content += `**Steps Executed:**\n`;
        for (const step of result.executionLog) {
          const stepIcon = step.success ? '✅' : '❌';
          let stepDesc = `${step.stepNumber}. ${stepIcon} **${step.action}**`;
          if (step.target) {
            stepDesc += ` on \`${step.target}\``;
          }
          if (step.value) {
            stepDesc += ` with value "${step.value}"`;
          }
          stepDesc += `\n   - ${step.reasoning}`;
          if (step.error) {
            stepDesc += `\n   - Error: ${step.error}`;
          }
          content += stepDesc + '\n';
        }
        content += '\n';
      }

      // Show success criteria and verification results
      content += `**Success Criteria:**\n`;
      for (let i = 0; i < tc.successCriteria.length; i++) {
        const criterion = tc.successCriteria[i];
        const verification = result.verifications?.[i];
        const icon = verification?.passed ? '✅' : '❌';
        content += `${i + 1}. ${icon} ${criterion}\n`;
        if (verification?.evidence) {
          content += `   - Evidence: ${verification.evidence}\n`;
        }
      }
      content += '\n';

      // Add failure reason if failed
      if (result.failureReason) {
        content += `**Failure Reason:** ${result.failureReason}\n\n`;
      }

      content += `**Duration:** ${result.duration}ms\n\n`;
      content += '---\n\n';
    }

    return content;
  }

  /**
   * Generate hybrid test cases with MCP refs for scripted execution
   * These combine AI intelligence with deterministic element targeting
   */
  async generateHybridTestCases(
    pages: PageState[],
    startUrl: string,
    siteContext?: SiteContext,
    mcpClient?: MCPClient
  ): Promise<HybridTestCase[]> {
    console.log('🔧 Generating hybrid test cases with MCP refs...');

    // Build element lookup map from accessibility trees
    const elementMap = this.buildElementMap(pages, mcpClient);
    console.log(`📊 Built element map with ${elementMap.size} elements`);

    // Build discovery summary with refs
    const pageInfo = pages.map(p => ({
      url: p.url,
      title: p.title,
      actions: p.actions.map(a => a.description),
      features: this.extractFeatures(p),
      discoveredElements: p.discoveredElements || {
        links: [],
        buttons: [],
        forms: [],
        headings: [],
        navigationItems: [],
      },
      visionAnalysis: p.visionAnalysis,
      accessibilityTree: p.accessibilityTree,
    }));

    const aggregatedContext = this.aggregateSiteCharacteristics(pages, siteContext);
    const siteContextSection = this.buildSiteContextSection(aggregatedContext);

    // Build rich discovery summary (includes AI's understanding of each page + observed flows)
    const discoverySummary = this.buildDiscoverySummary(pageInfo, pages);

    // Build element reference section for AI
    const elementRefSection = this.buildElementRefSection(elementMap);

    const prompt = `You are an expert QA engineer creating test cases for automated execution.

=== CRITICAL CONSTRAINT: ONLY USE DISCOVERED ELEMENTS ===

**YOU CAN ONLY TARGET ELEMENTS THAT APPEAR IN THE ELEMENT MAP BELOW.**

This is a HARD RULE:
- If an element is NOT in the ELEMENT MAP, you CANNOT click it, type into it, or verify it
- Do NOT invent button names like "Create Project" if no such button is in the map
- Do NOT assume elements exist - only use what was ACTUALLY discovered
- If you want to test a feature but the button isn't in the map, SKIP that test

WHY: Tests fail when they target elements that don't exist. The element map contains
ONLY the elements that were found during exploration. Using invented element names
causes "Could not resolve element" failures.

${siteContextSection}

=== DISCOVERED PAGES AND FEATURES ===
${discoverySummary}

=== ELEMENT MAP (ONLY these elements can be targeted) ===
${elementRefSection}

**REMINDER: If an element is not listed above, you CANNOT test it.**
Look at the element map carefully. Only generate tests for buttons/links/inputs that ARE listed.

=== CRITICAL: USE OBSERVED ACTION FLOWS ===
The "OBSERVED ACTION FLOWS" section above shows what ACTUALLY happened during exploration.
- If clicking a button → NAVIGATES TO a detail page, verify on that page (not the list)
- If clicking → OPENS MODAL, interact with the modal (not inline form)
- If clicking → INLINE UPDATE, verify on the same page
**DO NOT ASSUME patterns - USE the observed flows!**

=== YOUR TASK ===
Generate COMPREHENSIVE, FUNCTIONAL test cases that verify REAL application behavior.

**CRITICAL: COMPLETE THE ACTION**
Every test must COMPLETE its intended action and VERIFY the outcome:
- Form tests: Fill fields → Click Submit/Create/Save → Verify success message OR new item in list
- CRUD tests: Create item → Verify it appears → Edit/Delete → Verify change
- Search tests: Enter query → Verify results change/filter
- DO NOT just fill a form and stop - you must submit it and verify the result

**QUANTITY GUIDANCE:**
- Generate **15-40 tests** depending on site complexity
- **Maximum 5 simple navigation tests** (clicking links and verifying URL) - these are LOW value
- **At least 70% should be functional tests** that verify actual behavior

**TEST PRIORITY (generate in this order):**
1. **CRUD Operations** (HIGHEST) - Create, Read, Update, Delete workflows
   - Example: Click "New Project" → Fill form → Click "Create" → Verify project appears in list
   - Example: Edit an item → Save → Verify changes persisted

2. **Form Submissions** (HIGH) - Complete the form workflow
   - Fill ALL required fields → Submit → Verify success/error feedback
   - Test validation: Leave required field empty → Submit → Verify error shown

3. **User Workflows** (HIGH) - Multi-step journeys
   - Navigate → Interact → Complete action → Verify outcome

4. **Search/Filter** (MEDIUM) - Test data manipulation
   - Enter search term → Verify results filtered OR "no results" message

5. **Navigation** (LOW - max 5 tests) - Only test critical paths
   - Main menu items, breadcrumbs - but VERIFY you reached the right page with element_text

**VERIFICATION REQUIREMENTS:**
- DO NOT rely only on URL checks - URLs don't prove the feature worked
- Use "element_text" or "text_on_page" to verify:
  - Success messages appear ("Created successfully", "Saved", etc.)
  - Created items appear in lists
  - Error messages show for validation
- Use "element_visible" to verify UI element exists
- Use "element_not_visible" when something should NOT be there (loading spinners, error messages that should be gone)
- Use "text_not_on_page" to verify page is NOT in a loading/error state
- Use "url_contains" only as SECONDARY verification, not primary

**LOADING STATE VERIFICATION (IMPORTANT):**
- WRONG: {"verifyType": "element_text", "expected": "Loading"} - this FAILS if Loading is gone (not what you want!)
- RIGHT: {"verifyType": "text_not_on_page", "expected": "Loading"} - this PASSES if Loading is gone (correct!)

**BAD TEST (don't do this):**
- Name: "Navigate to Projects"
- Steps: Click Projects link
- Verification: URL contains "/projects"
- WHY BAD: Proves nothing - the page could be broken and still have the right URL

**GOOD TEST (do this instead):**
- Name: "Create a new project and verify it appears"
- Steps: Click Projects → Click "New Project" → Fill title "Test Project" → Click Create
- Verification: element_text contains "Test Project" in project list
- WHY GOOD: Verifies the feature actually works end-to-end

**AVOID:**
- Tests that only check URL changed (use element_text to verify content instead)
- Tests that fill forms but don't submit them
- Tests for external authentication domains (assume login works, test post-login)
- Redundant navigation tests (one test per major section is enough)

**MULTI-STEP FLOW GUIDANCE:**
- If testing a feature requires navigation, include ALL steps from a known starting point
- Example: To test "create ticket", start from dashboard, navigate to tickets, click new, fill form, submit, verify

=== RESPONSE FORMAT ===
Return JSON with this exact structure:
{
  "testCases": [
    {
      "name": "Test name",
      "description": "What this tests",
      "startUrl": "http://...",
      "priority": "high|medium|low",
      "category": "authentication|navigation|forms|workflow",
      "requiresAuth": false,
      "steps": [
        {
          "action": "navigate|click|type|wait|verify",
          "description": "What this step does",
          "target": {
            "mcpRef": "e42",
            "text": "Button text",
            "elementType": "button|link|input|heading",
            "description": "Human description of element"
          },
          "value": "for type actions",
          "url": "for navigate actions",
          "verifyType": "url_contains|url_equals|element_visible|element_not_visible|element_text|text_on_page|text_not_on_page|page_title",
          "expected": "expected value (for verify actions)"
        }
      ],
      "expectedResult": "Expected outcome"
    }
  ]
}

**IMPORTANT: Verify steps are regular steps!**
Every test MUST end with one or more "verify" steps. If the verify step fails, the test fails.

STEP EXAMPLES:
- Click: {"action": "click", "target": {"mcpRef": "e42", "text": "Submit"}, "description": "Click submit button"}
- Type: {"action": "type", "target": {"mcpRef": "e15", "text": "Email"}, "value": "test@example.com", "description": "Enter email"}
- Verify URL: {"action": "verify", "verifyType": "url_contains", "expected": "/dashboard", "description": "Verify navigated to dashboard"}
- Verify Text: {"action": "verify", "verifyType": "element_text", "expected": "Success", "description": "Verify success message appears"}
- Verify Element: {"action": "verify", "verifyType": "element_visible", "target": {"text": "Welcome"}, "description": "Verify welcome message visible"}

CRITICAL RULES:
1. **COMPLETE actions** - Don't just fill forms, SUBMIT them and add verify steps for the result
2. **End with verify steps** - Every test MUST have verify steps at the end to confirm the outcome
3. **Verify steps can fail** - If verify fails, the test fails and shows which step failed
4. **Use mcpRef** - For click/type actions, include target with mcpRef from element map
5. **Meaningful verifications** - Use "element_text" or "text_on_page" to verify content, not just URL changes
6. **Limit navigation tests** - Maximum 5 simple "click link, verify URL" tests

**VERIFY TYPE GUIDE (critical for correct test behavior):**

| verifyType | Use When | Not Found = |
|------------|----------|-------------|
| element_visible | Element MUST be on page | FAIL |
| element_not_visible | Element should NOT be there (loading spinners, errors) | PASS |
| element_text | Text MUST exist on page | FAIL |
| text_on_page | Text MUST exist anywhere on page (flexible) | FAIL |
| text_not_on_page | Text should NOT be on page (error gone, loading done) | PASS |

**IMPORTANT FOR LOADING STATES:**
- To verify "page is NOT stuck loading", use: {"verifyType": "text_not_on_page", "expected": "Loading"}
- This PASSES when "Loading" is not found (correct behavior)
- Do NOT use element_visible/element_text for "not loading" checks - they FAIL when element is not found

VERIFY STEP EXAMPLES:
- GOOD: {"action": "verify", "verifyType": "element_text", "expected": "Project created", "description": "Verify success message"}
- GOOD: {"action": "verify", "verifyType": "text_on_page", "expected": "My New Project", "description": "Verify project appears in list"}
- GOOD: {"action": "verify", "verifyType": "element_visible", "target": {"text": "Error"}, "description": "Verify error shown"}
- GOOD: {"action": "verify", "verifyType": "text_not_on_page", "expected": "Loading", "description": "Verify page finished loading"}
- GOOD: {"action": "verify", "verifyType": "element_not_visible", "target": {"text": "Spinner"}, "description": "Verify loading spinner gone"}
- WEAK: {"action": "verify", "verifyType": "url_contains", "expected": "/projects", "description": "Verify URL"} - only proves navigation`;

    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: this.config.openaiApiKey });

      const response = await client.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are a QA test case generator focused on FUNCTIONAL testing. Generate tests that verify real application behavior, not just navigation. Return ONLY valid JSON. Use element refs when available.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 32000,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const finishReason = response.choices[0]?.finish_reason;
      console.log(`📄 AI generated ${content.length} chars of hybrid tests (finish_reason: ${finishReason})`);

      if (finishReason === 'length') {
        console.warn('⚠️ AI response was truncated - may have more tests to generate');
      }

      const parsed = JSON.parse(content);
      const testCasesArray = Array.isArray(parsed) ? parsed : (parsed.testCases || []);

      // Validate and convert to HybridTestCase format
      const hybridTestCases: HybridTestCase[] = testCasesArray
        .map((tc: any, index: number) => {
          if (!tc.name || !tc.steps || !Array.isArray(tc.steps)) {
            return null;
          }

          const steps: HybridTestStep[] = tc.steps
            .map((s: any, stepIdx: number) => {
              const step: HybridTestStep = {
                stepNumber: stepIdx + 1,
                action: s.action || 'click',
                description: s.description || '',
              };

              if (s.target) {
                step.target = {
                  mcpRef: s.target.mcpRef,
                  text: s.target.text,
                  elementType: s.target.elementType,
                  description: s.target.description || s.description,
                };
              }

              if (s.value) step.value = s.value;
              if (s.url) step.url = s.url;
              if (s.expectedOutcome) step.expectedOutcome = s.expectedOutcome;

              // Handle verify step fields
              if (s.verifyType) step.verifyType = s.verifyType;
              if (s.expected) step.expected = s.expected;

              return step;
            })
            .filter((s: HybridTestStep) => s.description);

          // Check if there are any verify steps - if not, add a default one
          const hasVerifyStep = steps.some(s => s.action === 'verify');
          if (!hasVerifyStep) {
            steps.push({
              stepNumber: steps.length + 1,
              action: 'verify',
              description: 'Verify page loaded correctly',
              verifyType: 'url_contains',
              expected: new URL(tc.startUrl || startUrl).hostname,
            });
          }

          // Empty verifications array - all verifications are now steps
          const verifications: HybridVerification[] = [];

          return {
            id: `TC-${String(index + 1).padStart(3, '0')}`,
            name: tc.name,
            description: tc.description || '',
            startUrl: tc.startUrl || startUrl,
            steps,
            verifications,
            expectedResult: tc.expectedResult || 'Test completes successfully',
            priority: ['high', 'medium', 'low'].includes(tc.priority) ? tc.priority : 'medium',
            category: tc.category,
            requiresAuth: tc.requiresAuth || false,
          } as HybridTestCase;
        })
        .filter((tc: HybridTestCase | null): tc is HybridTestCase => tc !== null && tc.steps.length > 0);

      console.log(`✅ Generated ${hybridTestCases.length} hybrid test cases`);

      // Validate generated tests against discovered elements
      const validatedTests = this.validateTestsAgainstElementMap(hybridTestCases, elementMap);

      return validatedTests;

    } catch (error) {
      console.error('Error generating hybrid test cases:', error);
      return this.generateFallbackHybridTestCases(pages, startUrl, elementMap);
    }
  }

  /**
   * Validate generated tests against the element map
   * Warns about tests targeting unknown elements and filters out tests with too many unknown targets
   */
  private validateTestsAgainstElementMap(
    tests: HybridTestCase[],
    elementMap: Map<string, { ref: string; text: string; type: string; url: string }>
  ): HybridTestCase[] {
    // Build a set of all known element texts (lowercase for matching)
    const knownElementTexts = new Set<string>();
    const knownElementRefs = new Set<string>();

    for (const [, el] of elementMap) {
      knownElementTexts.add(el.text.toLowerCase().trim());
      knownElementRefs.add(el.ref);
    }

    console.log(`\n🔍 Validating ${tests.length} tests against ${elementMap.size} discovered elements...`);

    const validatedTests: HybridTestCase[] = [];
    let totalWarnings = 0;

    for (const test of tests) {
      let unknownTargets = 0;
      const warnings: string[] = [];

      for (const step of test.steps) {
        // Skip steps without targets (navigate, wait, verify with expected text only)
        if (!step.target) continue;

        // Check if target has a known mcpRef
        if (step.target.mcpRef && knownElementRefs.has(step.target.mcpRef)) {
          continue; // Good - known ref
        }

        // Check if target text matches any known element
        const targetText = (step.target.text || step.target.description || '').toLowerCase().trim();
        if (targetText && knownElementTexts.has(targetText)) {
          continue; // Good - known text
        }

        // Check for partial matches (target text contained in known element or vice versa)
        let foundPartialMatch = false;
        for (const knownText of knownElementTexts) {
          if (targetText && (knownText.includes(targetText) || targetText.includes(knownText))) {
            foundPartialMatch = true;
            break;
          }
        }

        if (foundPartialMatch) {
          continue; // Acceptable - partial match
        }

        // Unknown target
        unknownTargets++;
        const targetDesc = step.target.text || step.target.description || 'unknown';
        warnings.push(`Step ${step.stepNumber}: "${targetDesc}" not found in element map`);
      }

      // Decide whether to keep the test
      const actionSteps = test.steps.filter(s => s.action === 'click' || s.action === 'type');
      const unknownRatio = actionSteps.length > 0 ? unknownTargets / actionSteps.length : 0;

      if (unknownTargets > 0) {
        totalWarnings += warnings.length;

        if (unknownRatio > 0.5) {
          // More than half of action targets are unknown - likely to fail
          console.warn(`  ⚠️  ${test.id}: ${test.name} - FILTERED OUT (${unknownTargets}/${actionSteps.length} unknown targets)`);
          warnings.forEach(w => console.warn(`      - ${w}`));
          continue; // Skip this test
        } else {
          // Some unknown targets but may still work
          console.warn(`  ⚠️  ${test.id}: ${test.name} - ${unknownTargets} unknown target(s), may fail`);
          warnings.forEach(w => console.warn(`      - ${w}`));
        }
      }

      validatedTests.push(test);
    }

    const filtered = tests.length - validatedTests.length;
    if (filtered > 0) {
      console.log(`\n📊 Validation complete: ${validatedTests.length} tests kept, ${filtered} filtered out due to unknown elements`);
    } else if (totalWarnings > 0) {
      console.log(`\n📊 Validation complete: ${validatedTests.length} tests (${totalWarnings} warnings about unknown elements)`);
    } else {
      console.log(`\n✅ Validation complete: All ${validatedTests.length} tests use discovered elements`);
    }

    return validatedTests;
  }

  /**
   * Build element map from accessibility trees
   */
  private buildElementMap(pages: PageState[], mcpClient?: MCPClient): Map<string, { ref: string; text: string; type: string; url: string }> {
    const map = new Map<string, { ref: string; text: string; type: string; url: string }>();

    for (const page of pages) {
      if (!page.accessibilityTree) continue;

      // Parse elements from accessibility tree
      const elements = mcpClient?.parseElements(page.accessibilityTree) || [];

      for (const el of elements) {
        if (el.ref && el.text) {
          const key = `${el.type}:${el.text.toLowerCase().substring(0, 50)}`;
          map.set(key, {
            ref: el.ref,
            text: el.text,
            type: el.type,
            url: page.url,
          });
        }
      }

      // Also add from discovered elements
      if (page.discoveredElements) {
        for (const link of page.discoveredElements.links) {
          if (link.mcpRef) {
            const key = `link:${link.text.toLowerCase().substring(0, 50)}`;
            map.set(key, {
              ref: link.mcpRef,
              text: link.text,
              type: 'link',
              url: page.url,
            });
          }
        }
        for (const button of page.discoveredElements.buttons) {
          if (button.mcpRef) {
            const key = `button:${button.text.toLowerCase().substring(0, 50)}`;
            map.set(key, {
              ref: button.mcpRef,
              text: button.text,
              type: 'button',
              url: page.url,
            });
          }
        }
      }
    }

    return map;
  }

  /**
   * Build element reference section for AI prompt
   */
  private buildElementRefSection(elementMap: Map<string, { ref: string; text: string; type: string; url: string }>): string {
    if (elementMap.size === 0) {
      return 'No element refs available - use text-based targeting';
    }

    let section = '';
    const byPage = new Map<string, string[]>();

    for (const [key, el] of elementMap) {
      if (!byPage.has(el.url)) {
        byPage.set(el.url, []);
      }
      byPage.get(el.url)!.push(`  ${el.ref}: [${el.type}] "${el.text}"`);
    }

    for (const [url, elements] of byPage) {
      section += `\nPage: ${url}\n`;
      section += elements.join('\n'); // Include all elements - AI needs full picture
      section += '\n';
      section += '\n';
    }

    return section;
  }

  /**
   * Fallback hybrid test case generation
   */
  private generateFallbackHybridTestCases(
    pages: PageState[],
    startUrl: string,
    elementMap: Map<string, { ref: string; text: string; type: string; url: string }>
  ): HybridTestCase[] {
    const testCases: HybridTestCase[] = [];

    // Basic page load test
    testCases.push({
      id: 'TC-001',
      name: 'Homepage loads correctly',
      description: 'Verify the homepage loads and displays correctly',
      startUrl,
      steps: [
        {
          stepNumber: 1,
          action: 'navigate',
          url: startUrl,
          description: 'Navigate to homepage',
        },
        {
          stepNumber: 2,
          action: 'wait',
          value: '1000',
          description: 'Wait for page to load',
        },
      ],
      verifications: [
        {
          type: 'url_contains',
          expected: new URL(startUrl).hostname,
          description: 'Verify URL is correct',
        },
      ],
      expectedResult: 'Homepage loads successfully',
      priority: 'high',
    });

    // Add navigation tests for discovered links
    let testId = 2;
    for (const [key, el] of elementMap) {
      if (el.type === 'link' && testCases.length < 6) {
        testCases.push({
          id: `TC-${String(testId++).padStart(3, '0')}`,
          name: `Navigate to ${el.text}`,
          description: `Verify ${el.text} link works`,
          startUrl: el.url,
          steps: [
            {
              stepNumber: 1,
              action: 'navigate',
              url: el.url,
              description: 'Navigate to starting page',
            },
            {
              stepNumber: 2,
              action: 'click',
              target: {
                mcpRef: el.ref,
                text: el.text,
                elementType: 'link',
                description: `${el.text} link`,
              },
              description: `Click ${el.text} link`,
            },
          ],
          verifications: [
            {
              type: 'page_title',
              expected: el.text,
              description: 'Verify navigation succeeded',
            },
          ],
          expectedResult: `Successfully navigate to ${el.text}`,
          priority: 'medium',
        });
      }
    }

    return testCases;
  }

  /**
   * Format hybrid test cases as markdown
   */
  formatHybridTestCases(testCases: HybridTestCase[]): string {
    let content = '# Generated Test Cases (Hybrid Execution)\n\n';
    content += `Total test cases: ${testCases.length}\n\n`;
    content += '> These test cases use MCP refs for deterministic element targeting.\n';
    content += '> Self-healing fallbacks: ref → text search → AI rescue\n\n';
    content += '---\n\n';

    for (const tc of testCases) {
      content += `## ${tc.id}: ${tc.name}\n\n`;
      content += `**Priority:** ${tc.priority.toUpperCase()}\n\n`;
      if (tc.category) content += `**Category:** ${tc.category}\n\n`;
      content += `**Description:** ${tc.description}\n\n`;
      content += `**Start URL:** ${tc.startUrl}\n\n`;
      if (tc.requiresAuth) content += `**Requires Auth:** Yes\n\n`;

      content += `**Steps:**\n`;
      for (const step of tc.steps) {
        content += `${step.stepNumber}. **${step.action}**: ${step.description}`;
        if (step.target) {
          content += `\n   - Target: ${step.target.description || step.target.text || 'unknown'}`;
          if (step.target.mcpRef) content += ` (ref: ${step.target.mcpRef})`;
        }
        if (step.value) content += `\n   - Value: "${step.value}"`;
        if (step.url) content += `\n   - URL: ${step.url}`;
        // Show verify details for verify steps
        if (step.action === 'verify') {
          if (step.verifyType) content += `\n   - Verify Type: ${step.verifyType}`;
          if (step.expected) content += `\n   - Expected: "${step.expected}"`;
        }
        content += '\n';
      }

      content += `\n**Verifications:**\n`;
      for (const v of tc.verifications) {
        content += `- [${v.type}] ${v.description}: expects "${v.expected}"\n`;
      }

      content += `\n**Expected Result:** ${tc.expectedResult}\n\n`;
      content += '---\n\n';
    }

    return content;
  }

  /**
   * Format test cases as markdown
   */
  formatTestCases(testCases: GeneratedTestCase[]): string {
    let content = '# Generated Test Cases\n\n';
    content += `Total test cases: ${testCases.length}\n\n`;
    content += '---\n\n';

    for (const tc of testCases) {
      content += `## ${tc.id}: ${tc.name}\n\n`;
      content += `**Priority:** ${tc.priority.toUpperCase()}\n\n`;
      content += `**Category:** ${tc.category}\n\n`;
      content += `**Description:** ${tc.description}\n\n`;
      
      if (tc.pageUrl) {
        content += `**Page:** ${tc.pageUrl}\n\n`;
      }

      content += `**Steps:**\n`;
      tc.steps.forEach((step, idx) => {
        content += `${idx + 1}. ${step.description}`;
        if (step.target) {
          content += ` (target: ${step.target})`;
        }
        if (step.value) {
          content += ` (value: ${step.value})`;
        }
        content += '\n';
      });

      content += `\n**Expected Result:** ${tc.expectedResult}\n\n`;
      content += '---\n\n';
    }

    return content;
  }
}

