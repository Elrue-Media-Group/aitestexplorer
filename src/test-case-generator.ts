/**
 * Test Case Generator
 * 
 * Generates test cases from website exploration data using AI.
 * Combines:
 * - AI-generated test cases based on discovered elements
 * - Custom test cases from context files
 * - Validation against actual page elements
 */

import { PageState, TestCase } from './types.js';
import { AIVisionService } from './ai-vision.js';
import { Config } from './types.js';

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
    siteContext?: {
      architecture?: any;
      risks?: any[];
      fullReport?: string;
    }
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
    const aiTestCases = await this.generateWithAI(pageInfo, startUrl, aggregatedSiteContext);
    
    // Check for custom test cases from context file
    // Support both old 'customTestCases' and new 'importantTests' fields
    const contextFile = (siteContext as any)?.contextFile;
    let customTestCases: GeneratedTestCase[] = [];
    const testCasesFromFile = contextFile?.importantTests || contextFile?.customTestCases;
    if (testCasesFromFile && Array.isArray(testCasesFromFile)) {
      console.log(`📋 Found ${testCasesFromFile.length} custom test case(s) in context file`);
      customTestCases = await this.convertCustomTestCases(
        testCasesFromFile,
        pageInfo,
        startUrl
      );
    }
    
    // Combine AI-generated and custom test cases
    const allTestCases = [...aiTestCases, ...customTestCases];
    
    // Validate test cases against discovered elements
    const validatedTestCases = this.validateTestCases(allTestCases, pageInfo);
    
    return validatedTestCases;
  }

  /**
   * Aggregate site characteristics from vision analyses and full report
   */
  private aggregateSiteCharacteristics(
    pages: PageState[],
    siteContext?: {
      architecture?: any;
      risks?: any[];
      fullReport?: string;
      sitePurpose?: string;
      contentNature?: 'static' | 'dynamic' | 'mixed';
      contentPatterns?: string[];
      testingGuidance?: string;
      updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
      contextFile?: any;
    }
  ): {
    sitePurpose?: string;
    contentNature?: 'static' | 'dynamic' | 'mixed';
    contentPatterns?: string[];
    testingGuidance?: string;
    updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
    architecture?: any;
    risks?: any[];
    fullReport?: string;
    contextFile?: any;
  } {
    const characteristics: {
      sitePurpose?: string;
      contentNature?: 'static' | 'dynamic' | 'mixed';
      contentPatterns?: string[];
      testingGuidance?: string;
      updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
      architecture?: any;
      risks?: any[];
      fullReport?: string;
      contextFile?: any;
    } = {};

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
    }>
  ): string {
    let summary = 'ACTUAL DISCOVERY FROM EXPLORATION:\n\n';
    summary += 'CRITICAL: Each element was found on a SPECIFIC page. Test elements ONLY on the page where they were discovered.\n\n';
    
    for (let i = 0; i < pageInfo.length; i++) {
      const p = pageInfo[i];
      summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `Page ${i + 1}: ${p.title}\n`;
      summary += `  URL: ${p.url}\n`;
      summary += `  Page Type: ${this.inferPageType(p.url, p.title)}\n`;
      
      const elements = p.discoveredElements;
      
      // Links
      if (elements.links.length > 0) {
        const linkTexts = elements.links.map(l => `"${l.text}"`).join(', ');
        summary += `  Links Found (${elements.links.length}): [${linkTexts}]\n`;
      } else {
        summary += `  Links Found: NONE\n`;
      }
      
      // Navigation items
      if (elements.navigationItems.length > 0) {
        const navTexts = elements.navigationItems.map(n => `"${n}"`).join(', ');
        summary += `  Navigation Items: [${navTexts}]\n`;
      }
      
      // Buttons
      if (elements.buttons.length > 0) {
        const buttonTexts = elements.buttons.map(b => `"${b.text}"`).join(', ');
        summary += `  Buttons Found (${elements.buttons.length}): [${buttonTexts}]\n`;
      } else {
        summary += `  Buttons Found: NONE\n`;
      }
      
      // Forms
      if (elements.forms.length > 0) {
        summary += `  Forms Found (${elements.forms.length}):\n`;
        elements.forms.forEach((form, idx) => {
          const fieldTypes = form.fields.map(f => f.type).join(', ');
          summary += `    Form ${idx + 1}: Fields [${fieldTypes}]\n`;
        });
      } else {
        summary += `  Forms Found: NONE\n`;
      }
      
      // Headings
      if (elements.headings.length > 0) {
        const headingTexts = elements.headings.slice(0, 5).map(h => `"${h.text}"`).join(', ');
        summary += `  Main Headings: [${headingTexts}${elements.headings.length > 5 ? '...' : ''}]\n`;
      }
      
      summary += '\n';
    }
    
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `CRITICAL TESTING RULES:\n\n`;
    summary += `1. ELEMENT-PAGE ASSOCIATION:\n`;
    summary += `   - Each element (link, button, form) was found on a SPECIFIC page\n`;
    summary += `   - Test elements ONLY on the page where they were discovered\n`;
    summary += `   - If testing an element from Page 1, you MUST navigate to Page 1 first\n`;
    summary += `   - If testing an element from Page 2, you MUST navigate to Page 2 first\n`;
    summary += `   - Do NOT test elements on pages where they don't exist\n\n`;
    
    summary += `2. TEST CASE STRUCTURE:\n`;
    summary += `   - If element is on Page 1, start with: "Navigate to Page 1 URL"\n`;
    summary += `   - If element is on Page 2, start with: "Navigate to Page 2 URL"\n`;
    summary += `   - Then perform the action on that specific page\n`;
    summary += `   - Example: To test "News" button from Page 1, steps should be:\n`;
    summary += `     Step 1: Navigate to Page 1 URL\n`;
    summary += `     Step 2: Click on "News" button\n\n`;
    
    summary += `3. ELEMENT DISCOVERY:\n`;
    summary += `   - The site does NOT have pages/elements unless they appear in the discovery above\n`;
    summary += `   - Only test links/buttons that were ACTUALLY FOUND\n`;
    summary += `   - Use exact text from discovery list (e.g., if link says "Interview Tips", use "Interview Tips")\n`;
    summary += `   - Do NOT assume standard pages like "About Us" or "Contact" exist unless found\n\n`;
    
    summary += `4. EXPLORATORY TESTING APPROACH:\n`;
    summary += `   - Act like an exploratory tester: test what you SEE, not what you EXPECT\n`;
    summary += `   - Test elements in the context where they were discovered\n`;
    summary += `   - If a button is on the homepage, test it on the homepage, not on other pages\n\n`;
    
    return summary;
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
      // Support both old testingGuidance object and new testingNotes field
      if (contextFile.testingNotes) {
        context += `\n📝 Testing Notes from Context File:\n`;
        context += `  ${contextFile.testingNotes}\n`;
      } else if (contextFile.testingGuidance) {
        context += `\n📝 Testing Guidance from Context File:\n`;
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
    }
  ): Promise<GeneratedTestCase[]> {
    // Build discovery summary
    const discoverySummary = this.buildDiscoverySummary(pageInfo);
    
    // Build site context section
    const siteContextSection = this.buildSiteContextSection(siteContext);
    
    const prompt = `You are a QA test case generator doing EXPLORATORY TESTING.

CRITICAL RULES:
1. Test ONLY what was ACTUALLY DISCOVERED during exploration
2. Do NOT assume standard pages exist (About, Contact, etc.) unless they were found
3. Use the EXACT link text/button text from the discovery list below
4. If a navigation link was found, test it. If not, don't test it.
5. Act like an exploratory tester - test what you SEE, not what you EXPECT

CRITICAL: Return ONLY valid JSON. No markdown, no examples, no explanations. Just the JSON object.

${siteContextSection}

${discoverySummary}

CRITICAL: You MUST generate MULTIPLE test cases (aim for 10-15, minimum 5) even from limited exploration.
Even if only 1 page was explored, generate multiple test cases by:
- Creating separate test cases for EACH navigation link found
- Creating separate test cases for EACH button found  
- Creating separate test cases for EACH form/input found
- Creating test cases for page load, content visibility, headings, etc.
- Breaking down the page into focused test areas (navigation, content, functionality, etc.)

DO NOT generate just 1 test case. Generate 10-15 test cases covering all discovered elements and page aspects.

Generate test cases based on the ACTUAL elements discovered above. Each test case MUST have:
- name: Clear descriptive name
- description: What this test verifies
- priority: "high", "medium", or "low"
- category: One word category (navigation, forms, functionality, content, etc.)
- steps: Array of step objects, each with "action" and "description" (and optionally "target" or "value")
- expectedResult: What should happen when test passes
- pageUrl: The URL of the page where the element was discovered (REQUIRED)

CRITICAL RULES FOR TEST STEPS:
1. ELEMENT-PAGE ASSOCIATION: Each element belongs to a specific page
   - If testing an element from Page 1, FIRST step must be: "Navigate to [Page 1 URL]"
   - If testing an element from Page 2, FIRST step must be: "Navigate to [Page 2 URL]"
   - Then perform the action on that page
   - Example: To test "News" button found on Page 1:
     Step 1: {"action": "navigate", "description": "Navigate to [Page 1 URL]"}
     Step 2: {"action": "click", "description": "Click on 'News' button", "target": "News"}

2. ELEMENT REFERENCE:
   - ONLY reference elements that were ACTUALLY FOUND in the discovery above
   - Use exact text from discovery (e.g., if link says "Interview Tips", use "Interview Tips" not "About Us")
   - Do NOT create test cases for pages/elements that don't exist
   - Test what IS there, not what SHOULD be there

3. PAGE CONTEXT:
   - Always include navigation to the correct page as the first step
   - Test elements in the context where they were discovered
   - Do NOT test elements on pages where they don't exist

Return a JSON object with this EXACT structure. YOU MUST GENERATE 10-15 TEST CASES (minimum 5).
The example below shows the structure - create multiple test cases like this for ALL discovered elements:

{
  "testCases": [
    {
      "name": "Homepage Loads Correctly",
      "description": "Verify the homepage loads and displays correctly",
      "priority": "high",
      "category": "page-loading",
      "steps": [
        {"action": "navigate", "description": "Navigate to homepage"},
        {"action": "verify", "description": "Verify page loads within 3 seconds"},
        {"action": "verify", "description": "Verify page title is present"}
      ],
      "expectedResult": "Page loads successfully, title is displayed",
      "pageUrl": "${startUrl}"
    },
    {
      "name": "Navigation Link - [Link Name]",
      "description": "Verify [link name] navigation link works",
      "priority": "high",
      "category": "navigation",
      "steps": [
        {"action": "navigate", "description": "Navigate to homepage"},
        {"action": "click", "description": "Click on '[Link Name]' link", "target": "[Link Name]"},
        {"action": "verify", "description": "Verify navigation occurs"}
      ],
      "expectedResult": "Navigation link works correctly",
      "pageUrl": "${startUrl}"
    }
  ]
}

REMEMBER: Generate 10-15 test cases total. Create separate test cases for:
- Each navigation link found
- Each button found  
- Each form found
- Page load verification
- Content visibility checks
- Heading verification
- Any other discovered elements`;

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
        max_completion_tokens: 8000,
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
   * Convert custom test cases from context file (plain English) to structured test cases
   */
  private async convertCustomTestCases(
    customTestCases: Array<{
      name: string;
      description: string;
      page?: string;
      priority?: 'high' | 'medium' | 'low';
    }>,
    pageInfo: Array<{ 
      url: string; 
      title: string; 
      actions: string[]; 
      features: string[];
      discoveredElements: import('./types.js').DiscoveredElements;
    }>,
    startUrl: string
  ): Promise<GeneratedTestCase[]> {
    const converted: GeneratedTestCase[] = [];
    
    for (let i = 0; i < customTestCases.length; i++) {
      const custom = customTestCases[i];
      
      try {
        // Use AI to convert plain English description to structured test steps
        const structured = await this.parseCustomTestCase(custom, pageInfo, startUrl);
        
        if (structured && structured.steps && structured.steps.length > 0) {
          // Assign ID that won't conflict with AI-generated ones (start from TC-100)
          converted.push({
            id: `TC-${String(100 + i).padStart(3, '0')}`,
            name: custom.name,
            description: custom.description,
            priority: custom.priority || 'high',
            category: 'custom',
            steps: structured.steps,
            expectedResult: structured.expectedResult || 'Test should complete successfully',
            pageUrl: structured.pageUrl,
          });
        }
      } catch (error) {
        console.warn(`⚠️  Could not convert custom test case "${custom.name}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return converted;
  }

  /**
   * Parse a custom test case description (plain English) into structured test steps using AI
   */
  private async parseCustomTestCase(
    custom: {
      name: string;
      description: string;
      page?: string;
      priority?: 'high' | 'medium' | 'low';
    },
    pageInfo: Array<{ 
      url: string; 
      title: string; 
      actions: string[]; 
      features: string[];
      discoveredElements: import('./types.js').DiscoveredElements;
    }>,
    startUrl: string
  ): Promise<{
    steps: TestStep[];
    expectedResult: string;
    pageUrl?: string;
  } | null> {
    // Build discovery summary for context
    const discoverySummary = this.buildDiscoverySummary(pageInfo);
    
    // Find the target page URL
    let targetPageUrl = startUrl;
    if (custom.page) {
      // Try to find matching page
      const matchingPage = pageInfo.find(p => 
        p.url.includes(custom.page!) || 
        p.url.endsWith(custom.page!) ||
        custom.page!.includes(p.url)
      );
      if (matchingPage) {
        targetPageUrl = matchingPage.url;
      } else {
        // Try to construct URL from startUrl
        try {
          const baseUrl = new URL(startUrl);
          targetPageUrl = new URL(custom.page, baseUrl.origin).href;
        } catch {
          // If that fails, use startUrl
          targetPageUrl = startUrl;
        }
      }
    }
    
    const prompt = `You are a QA test case parser. Convert a plain English test case description into structured test steps that can handle DYNAMIC and EXPLORATORY testing.

CUSTOM TEST CASE TO PARSE:
Name: ${custom.name}
Description: ${custom.description}
Target Page: ${custom.page || 'Not specified'}

${discoverySummary}

CRITICAL RULES FOR DYNAMIC/EXPLORATORY TESTING:
1. Parse the plain English description into specific, actionable test steps
2. Each step should have an "action" (navigate, click, verify, type, extract, count, etc.) and a clear "description"
3. When the description mentions PATTERNS (like "any filter", "a filter", "the first filter", "a company filter"):
   - DO NOT use exact text matches
   - Instead, describe WHERE to find the element (e.g., "in the Top Companies Mentioned section")
   - Describe WHAT to look for (e.g., "a clickable filter", "an element showing a count")
   - The test executor will find elements dynamically based on context
4. When the description mentions EXTRACTING VALUES (like "extract the count", "get the number"):
   - Create an "extract" or "verify" step that describes extracting the value from the element text
   - Use descriptive language like "Extract the mention count from the filter text"
5. When the description mentions COMPARING VALUES (like "count should match", "verify the number"):
   - Create a "verify" step that describes counting and comparing
   - Use language like "Count the displayed articles and verify the count matches the extracted count"
6. Always start with navigation to the target page if specified
7. For EXPLORATORY tests (testing patterns, not specific elements):
   - Use descriptive targets that describe location/context, not exact text
   - Example: Instead of target: "Apple 8 mentions", use description: "Find and click the first filter in the Top Companies Mentioned section"
   - The description should guide the test executor to find elements dynamically

Return ONLY valid JSON with this structure:
{
  "steps": [
    {"action": "navigate", "description": "Navigate to [page URL]"},
    {"action": "extract", "description": "Extract [value] from [element/location]", "target": "[contextual description]"},
    {"action": "click", "description": "Click on [element description with location context]", "target": "[contextual description or section]"},
    {"action": "count", "description": "Count [what to count]"},
    {"action": "verify", "description": "Verify [comparison or check]"}
  ],
  "expectedResult": "What should happen when this test passes",
  "pageUrl": "${targetPageUrl}"
}

EXAMPLES:

Example 1 - Specific element: "Click on 'News' button"
  Step: {"action": "click", "description": "Click on 'News' button", "target": "News"}

Example 2 - Dynamic pattern: "Click on any filter in Top Companies section"
  Step: {"action": "click", "description": "Find and click the first filter in the Top Companies Mentioned section", "target": "Top Companies Mentioned section"}

Example 3 - Extract and verify: "Extract count from filter and verify articles match"
  Steps: [
    {"action": "extract", "description": "Find the first filter in the Top Companies Mentioned section and extract the mention count from its text", "target": "Top Companies Mentioned section"},
    {"action": "click", "description": "Click on the filter from which the count was extracted", "target": "Top Companies Mentioned section"},
    {"action": "count", "description": "Count the number of articles displayed after clicking the filter"},
    {"action": "verify", "description": "Verify that the article count matches the extracted mention count"}
  ]

For the current test case, generate steps that:
- Find elements dynamically based on their location/context (not exact text)
- Extract values (like counts) from element text
- Compare extracted values with actual results
- Use descriptive language that guides exploratory testing

Return ONLY the JSON object, no markdown, no explanations.`;

    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: this.config.openaiApiKey });
      
      const response = await client.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are a QA test case parser. Return ONLY valid JSON with steps array, expectedResult, and pageUrl. No markdown, no explanations.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || '{}';
      
      // Log reasoning
      if (this.visionService && typeof this.visionService.logReasoning === 'function') {
        await this.visionService.logReasoning({
          timestamp: new Date().toISOString(),
          operation: 'parseCustomTestCase',
          model: this.config.openaiModel,
          prompt: prompt.substring(0, 2000) + (prompt.length > 2000 ? '...' : ''),
          response: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''),
          tokenUsage: response.usage ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          } : undefined,
          metadata: {
            customTestCaseName: custom.name,
          },
        });
      }
      
      // Clean and parse
      let cleanedContent = content.trim();
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      const parsed = JSON.parse(cleanedContent);
      
      // Validate and return
      if (parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        const validSteps = parsed.steps
          .filter((s: any) => s && s.action && s.description)
          .map((s: any) => ({
            action: String(s.action).toLowerCase(),
            description: String(s.description).trim(),
            target: s.target ? String(s.target).trim() : undefined,
            value: s.value ? String(s.value).trim() : undefined,
          }));
        
        if (validSteps.length > 0) {
          return {
            steps: validSteps,
            expectedResult: String(parsed.expectedResult || 'Test should complete successfully').trim(),
            pageUrl: parsed.pageUrl ? String(parsed.pageUrl).trim() : targetPageUrl,
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error parsing custom test case "${custom.name}":`, error);
      return null;
    }
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

