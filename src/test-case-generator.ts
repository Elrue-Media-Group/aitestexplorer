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
    siteContext?: {
      architecture?: any;
      risks?: any[];
      fullReport?: string;
      sitePurpose?: string;
      contentNature?: 'static' | 'dynamic' | 'mixed';
      contentPatterns?: string[];
      testingGuidance?: string;
      updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
      contextFile?: any; // CRITICAL: Must be here to receive credentials!
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
    // The AI will use importantTests from context file as guidance for required coverage
    const aiTestCases = await this.generateWithAI(pageInfo, startUrl, aggregatedSiteContext);

    // Verify that required test scenarios from context file are covered
    const contextFile = (siteContext as any)?.contextFile;
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
    }>
  ): string {
    // Condensed format - AI already saw the screenshots via vision analysis
    let summary = '\nDISCOVERED PAGES & ELEMENTS:\n\n';
    
    for (let i = 0; i < pageInfo.length; i++) {
      const p = pageInfo[i];
      const elements = p.discoveredElements;

      summary += `Page ${i + 1}: ${p.url}\n`;

      // Just list what interactive elements exist - AI already saw them via vision
      const parts = [];
      if (elements.links.length > 0) {
        const linkTexts = elements.links.map(l => `"${l.text}"`).join(', ');
        parts.push(`${elements.links.length} links (${linkTexts})`);
      }
      if (elements.buttons.length > 0) {
        const btnTexts = elements.buttons.map(b => `"${b.text}"`).join(', ');
        parts.push(`${elements.buttons.length} buttons (${btnTexts})`);
      }
      if (elements.forms.length > 0) {
        const formDescs = elements.forms.map((f, idx) =>
          `form-${idx+1}: ${f.fields.map(field => field.type).join(', ')}`
        ).join('; ');
        parts.push(`${elements.forms.length} forms (${formDescs})`);
      }

      if (parts.length > 0) {
        summary += `  ${parts.join('; ')}\n`;
      } else {
        summary += `  No interactive elements found\n`;
      }

      summary += '\n';
    }

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
      // CRITICAL: Add credentials if available
      if (contextFile.credentials) {
        context += `\n🔐 LOGIN CREDENTIALS (USE THESE FOR LOGIN STEPS):\n`;
        context += `  Username: ${contextFile.credentials.username || 'NOT PROVIDED'}\n`;
        context += `  Password: ${contextFile.credentials.password || 'NOT PROVIDED'}\n`;
        context += `  ⚠️  IMPORTANT: Use these EXACT credentials in all login steps. Do NOT make up credentials.\n`;
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
    }
  ): Promise<GeneratedTestCase[]> {
    // Debug: Log what siteContext contains
    console.log('🔍 [TestCaseGenerator] siteContext keys:', Object.keys(siteContext || {}));
    console.log('🔍 [TestCaseGenerator] Has contextFile?', !!siteContext?.contextFile);
    if (siteContext?.contextFile?.credentials) {
      console.log('🔍 [TestCaseGenerator] Credentials found in contextFile:', {
        username: siteContext.contextFile.credentials.username,
        hasPassword: !!siteContext.contextFile.credentials.password
      });
    }

    // Build discovery summary
    const discoverySummary = this.buildDiscoverySummary(pageInfo);

    // Build site context section
    const siteContextSection = this.buildSiteContextSection(siteContext);

    // Debug: Log if credentials made it to the context section
    if (siteContextSection.includes('LOGIN CREDENTIALS')) {
      console.log('✅ [TestCaseGenerator] Credentials section IS in prompt');
    } else {
      console.log('❌ [TestCaseGenerator] Credentials section NOT in prompt');
      console.log('🔍 [TestCaseGenerator] Context section preview:', siteContextSection.substring(0, 500));
    }
    
    const prompt = `You are an expert exploratory tester with AI vision capabilities. You've analyzed screenshots of this website and understand its structure, purpose, and interactive elements.

YOUR GOAL: Generate comprehensive test cases that thoroughly test all discovered functionality.

GUIDELINES:
• Test only what you actually discovered (don't assume standard pages exist)
• Use exact element text/labels from the discovery data
• Create self-contained tests - if a page requires login, include login steps at the beginning
• Use credentials you observed on the pages or from the context below
• Focus on complete user workflows, not just isolated clicks
• For targets: prefix with element type since you saw them via vision (e.g., "button:Sign In", "link:Home", "input:username")

${siteContextSection}

${discoverySummary}

Return valid JSON only (no markdown, no explanations):
{
  "testCases": [{
    "name": "descriptive test name",
    "description": "what this verifies",
    "priority": "high|medium|low",
    "category": "navigation|forms|functionality|content|etc",
    "steps": [
      {"action": "navigate", "description": "navigate to page", "target": "http://example.com/page"},
      {"action": "type", "description": "enter text", "target": "input:Username", "value": "text to type"},
      {"action": "click", "description": "click element", "target": "button:Submit"},
      {"action": "verify", "description": "verify state", "target": "element text to verify"}
    ],
    "expectedResult": "success criteria",
    "pageUrl": "URL where primary element was found"
  }]
}

Generate comprehensive coverage - create test cases for all discovered interactive elements across all pages.`;

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

