/**
 * AI Vision Service
 * 
 * Handles AI-powered analysis of website screenshots using OpenAI's vision models.
 * Provides:
 * - Page analysis and description
 * - Interactive element detection
 * - Suggested actions for exploration
 * - Site report generation
 * - Reasoning log for debugging and transparency
 */

import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { promises as fs } from 'fs';
import { VisionAnalysis, InteractiveElement, SuggestedAction, ArchitectureInfo } from './types.js';
import { Config } from './types.js';

interface AIReasoningLog {
  timestamp: string;
  operation: string;
  model: string;
  prompt: string;
  response: string;
  tokenUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finishReason?: string;
  metadata?: Record<string, any>;
}

export class AIVisionService {
  private client: OpenAI;
  private model: string;
  private reasoningLogPath?: string;

  constructor(config: Config, reasoningLogPath?: string) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiModel;
    this.reasoningLogPath = reasoningLogPath;
  }

  /**
   * Log AI reasoning (prompt, response, token usage)
   */
  async logReasoning(log: AIReasoningLog): Promise<void> {
    if (!this.reasoningLogPath) {
      console.warn('⚠️  Reasoning log path not set, skipping log');
      return;
    }

    try {
      // Ensure directory exists
      const { dirname } = await import('path');
      const logDir = dirname(this.reasoningLogPath);
      try {
        await fs.mkdir(logDir, { recursive: true });
      } catch {
        // Directory might already exist, that's fine
      }

      // Read existing log or create new array
      let logs: AIReasoningLog[] = [];
      try {
        const existingContent = await fs.readFile(this.reasoningLogPath, 'utf-8');
        logs = JSON.parse(existingContent);
        if (!Array.isArray(logs)) {
          logs = [];
        }
      } catch {
        // File doesn't exist yet, start with empty array
      }

      // Add new log entry
      logs.push(log);

      // Write back to file
      await fs.writeFile(this.reasoningLogPath, JSON.stringify(logs, null, 2), 'utf-8');
      console.log(`✅ Logged reasoning for ${log.operation} to ${this.reasoningLogPath}`);
    } catch (error) {
      // Don't fail the operation if logging fails
      console.warn(`⚠️  Failed to write reasoning log to ${this.reasoningLogPath}:`, error);
    }
  }

  async analyzePage(screenshotPath: string, url: string, previousActions: string[]): Promise<VisionAnalysis> {
    const imageBuffer = readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    const contextPrompt = previousActions.length > 0 
      ? `Previous actions taken: ${previousActions.join(', ')}. `
      : '';

    const prompt = `${contextPrompt}You are an expert exploratory tester. Your goal is to understand the ENTIRE application, not just individual pages. Think like a tester who needs to map out the full user journey and discover all functionality.

Analyze this webpage screenshot and provide:

1. A detailed description of what you see on the page
2. All interactive elements (buttons, links, forms, inputs, etc.) with their FUNCTIONAL UNDERSTANDING:
   For EACH interactive element, provide:
   - Element type (button, link, input, form, etc.)
   - Text/label visible on the element
   - Location/context (e.g., "Name Display Demo section", "login form", "top navigation")
   - Purpose (what it's meant to do, e.g., "updates the name display", "submits login credentials")
   - Behavior (how it works functionally, e.g., "takes input text and displays it back", "navigates to home page")
   - Workflow (how it fits into user flow, e.g., "User enters text → Clicks Update Name → Display panel updates")
   - Related elements (what it interacts with, e.g., ["name input field", "name display panel"])
   - Expected outcome (what should happen when used, e.g., "Display panel updates with entered name")
   
   Format each element as:
   ELEMENT: [Type] "[Text/Label]"
   Location: [context/section]
   Purpose: [what it does]
   Behavior: [how it works]
   Workflow: [user flow]
   Related: [related elements]
   Expected: [expected outcome]
3. EXPLORATORY TESTING MINDSET - Suggested next actions (CRITICAL):
   - Think about what comes NEXT in the user journey, not just what's on this page
   - If this is a login page, the REAL value is exploring what's BEHIND the login - what pages, features, and workflows exist after authentication
   - Prioritize actions that unlock more of the application (e.g., "Complete login to explore authenticated area" should be HIGHEST priority)
   - After login, suggest exploring ALL links, buttons, and navigation elements you see
   - Think about the full workflow: "What would a user do next? What features are available? What should I test?"
   - If you see demo/test credentials, understand this is likely a demo site - explore it thoroughly to understand all available controls and features
4. The type of page (homepage, login, product listing, form, dashboard, etc.)
5. Any potential risks or issues you notice
6. Architectural information about the site structure, navigation patterns, forms, and technology indicators
7. Site characteristics analysis:
   - What is the primary purpose of this website? (e.g., news aggregation, e-commerce, blog, social media, documentation, etc.)
   - What is the nature of the content? (static/rarely changes, dynamic/frequently updates, mixed)
   - What patterns do you observe? (feed-based content, product listings, time-sensitive elements, rotating content, etc.)
   - Are there indicators of update frequency? (timestamps, "new" badges, real-time updates, etc.)
8. LOGIN PAGE DETECTION (CRITICAL - EXPLORATORY FOCUS):
   - Is this a login page? Look for password fields, username/email inputs, "Sign In" buttons, login forms
   - If it's a login page, are there any credentials visible on the page? (e.g., "Demo Credentials: Username: test, Password: password")
   - CREDENTIAL EXTRACTION FORMAT (IMPORTANT): If credentials are visible, provide them in this exact format on a separate line:
     LOGIN_CREDENTIALS: Username: test Password: password
     - Extract the ACTUAL values only (no quotes, no extra text)
     - If page shows "Username: test", extract just: Username: test
     - If page shows "Username: 'test'", extract just: Username: test (remove quotes)
     - The values should be ready to use directly in a login form
   - EXPLORATORY TESTING PERSPECTIVE: After login, what should be explored?
     * The REAL value is discovering what pages, features, and workflows exist AFTER login
     * Suggest exploring ALL navigation links, buttons, and interactive elements on the post-login page
     * Think about what a user would do: "What features are available? What should I test?"
     * If this appears to be a demo/test site, explore it thoroughly to understand all available controls
   - If this is a login page, suggest "Complete login form" as HIGHEST priority action, followed by "Explore all links and buttons on post-login page"

9. POST-LOGIN EXPLORATION STRATEGY (if this is a post-login page):
   - What pages/features are accessible from here? List ALL navigation links, buttons, and interactive elements
   - What workflows can be tested? (e.g., "Create item", "Filter list", "View details", etc.)
   - What should be explored next? Prioritize actions that reveal more of the application
   - Think about the full user journey: "What would a real user do? What features should I test?"

Be specific and actionable. Think like an exploratory tester mapping out the entire application. If this is a login page, understand that login is a GATEWAY to more content - the real testing happens after authentication. Suggest actions that unlock and explore the full application, not just test the login page itself.`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_completion_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || '';
      
      // Log reasoning - store FULL response to capture site understanding
      await this.logReasoning({
        timestamp: new Date().toISOString(),
        operation: 'analyzePage',
        model: this.model,
        prompt: prompt, // Full prompt - contains site understanding questions
        response: content, // Full response - contains AI's understanding of the site
        tokenUsage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
        finishReason: response.choices[0]?.finish_reason,
        metadata: {
          url,
          screenshotPath,
          previousActionsCount: previousActions.length,
        },
      });
      
      return this.parseAnalysis(content, url);
    } catch (error) {
      console.error('Error analyzing page with AI vision:', error);
      throw error;
    }
  }

  private parseAnalysis(content: string, url: string): VisionAnalysis {
    // Parse the AI response - this is a simplified parser
    // In production, you might want to use structured output or better parsing
    const lines = content.split('\n');
    
    // Log the raw AI response for debugging
    console.log(`📄 AI Response (first 500 chars): ${content.substring(0, 500)}...`);
    
    const interactiveElements: InteractiveElement[] = [];
    const suggestedActions: SuggestedAction[] = [];
    const risks: string[] = [];
    let description = '';
    let pageType = 'unknown';
    const architecture: ArchitectureInfo = {
      layout: '',
      navigation: [],
      forms: [],
      keyFeatures: [],
      technology: [],
    };
    
    const siteCharacteristics: import('./types.js').SiteCharacteristics = {};
    const loginInfo: import('./types.js').LoginInfo = {
      isLoginPage: false,
      credentialsVisible: false,
      shouldLogin: false,
    };
    
    // FIRST: Check full content for login page indicators (before line-by-line parsing)
    // This catches cases where AI says "This is a simple login page" anywhere in the response
    const fullContentLower = content.toLowerCase();
    const loginPageIndicators = [
      'login page',
      'sign in page',
      'login form',
      'sign in form',
      'authentication page',
      'login required',
      'simple login',
      'login page for'
    ];
    
    for (const indicator of loginPageIndicators) {
      if (fullContentLower.includes(indicator)) {
        loginInfo.isLoginPage = true;
        console.log(`✅ Detected login page from AI response (indicator: "${indicator}")`);
        break;
      }
    }
    
    // Also check for password field mentions (strong indicator of login page)
    if (fullContentLower.includes('password field') || fullContentLower.includes('password input')) {
      loginInfo.isLoginPage = true;
      console.log(`✅ Detected login page from password field mention`);
    }

    let currentSection = '';
    for (const line of lines) {
      const lowerLine = line.toLowerCase().trim();
      
      if (lowerLine.includes('description') || lowerLine.includes('page shows')) {
        currentSection = 'description';
        description += line + ' ';
      } else if (lowerLine.includes('interactive') || lowerLine.includes('element') || lowerLine.startsWith('element:')) {
        currentSection = 'elements';
        // Also try to extract element immediately if it's in ELEMENT: format
        if (lowerLine.startsWith('element:')) {
          const element = this.extractElement(line, lines, lines.indexOf(line));
          if (element) interactiveElements.push(element);
        }
      } else if (lowerLine.includes('suggest') || lowerLine.includes('action')) {
        currentSection = 'actions';
      } else if (lowerLine.includes('type') || lowerLine.includes('page type')) {
        currentSection = 'pageType';
        const match = line.match(/type[:\s]+([^,\n]+)/i);
        if (match) pageType = match[1].trim();
      } else if (lowerLine.includes('risk') || lowerLine.includes('issue')) {
        currentSection = 'risks';
        if (line.trim() && !lowerLine.includes('risk')) {
          risks.push(line.trim());
        }
      } else if (lowerLine.includes('purpose') || lowerLine.includes('primary purpose')) {
        currentSection = 'sitePurpose';
        const match = line.match(/purpose[:\s]+([^,\n]+)/i) || line.match(/(?:is|are)[:\s]+([^,\n]+)/i);
        if (match) {
          siteCharacteristics.sitePurpose = match[1].trim();
        }
      } else if (lowerLine.includes('content nature') || lowerLine.includes('nature of content')) {
        currentSection = 'contentNature';
        if (lowerLine.includes('static')) {
          siteCharacteristics.contentNature = 'static';
        } else if (lowerLine.includes('dynamic')) {
          siteCharacteristics.contentNature = 'dynamic';
        } else if (lowerLine.includes('mixed')) {
          siteCharacteristics.contentNature = 'mixed';
        }
      } else if (lowerLine.includes('pattern') || lowerLine.includes('observe')) {
        currentSection = 'patterns';
        if (!siteCharacteristics.contentPatterns) {
          siteCharacteristics.contentPatterns = [];
        }
        const patternMatch = line.match(/pattern[:\s]+([^,\n]+)/i) || line.match(/(feed|product|time|rotat|real-time|update)/i);
        if (patternMatch) {
          siteCharacteristics.contentPatterns.push(patternMatch[1] || patternMatch[0]);
        }
      } else if (lowerLine.includes('update frequency') || lowerLine.includes('frequently') || lowerLine.includes('regularly')) {
        currentSection = 'updateFrequency';
        if (lowerLine.includes('real-time') || lowerLine.includes('real time')) {
          siteCharacteristics.updateFrequency = 'real-time';
        } else if (lowerLine.includes('frequent') || lowerLine.includes('regularly') || lowerLine.includes('often')) {
          siteCharacteristics.updateFrequency = 'frequent';
        } else if (lowerLine.includes('periodic') || lowerLine.includes('periodically')) {
          siteCharacteristics.updateFrequency = 'periodic';
        } else if (lowerLine.includes('rare') || lowerLine.includes('rarely') || lowerLine.includes('static')) {
          siteCharacteristics.updateFrequency = 'rare';
        }
      } else if (lowerLine.includes('architecture') || lowerLine.includes('structure')) {
        currentSection = 'architecture';
      } else if (lowerLine.includes('login page') || lowerLine.includes('is this a login') || (lowerLine.includes('login') && lowerLine.includes('page'))) {
        currentSection = 'login';
        // Check if it's a login page
        if (lowerLine.includes('yes') || lowerLine.includes('is a login') || lowerLine.includes('login page')) {
          loginInfo.isLoginPage = true;
        }
      } else if (lowerLine.includes('login_credentials') || (lowerLine.includes('credential') && (lowerLine.includes('username') || lowerLine.includes('password')))) {
        currentSection = 'login';
        loginInfo.credentialsVisible = true;
        
        // Look for the structured format: "LOGIN_CREDENTIALS: Username: test Password: password"
        if (lowerLine.includes('login_credentials')) {
          // Extract from structured format
          const usernameMatch = line.match(/username[:\s]+([^\s\n]+)/i);
          const passwordMatch = line.match(/password[:\s]+([^\s\n]+)/i);
          
          if (usernameMatch && usernameMatch[1]) {
            loginInfo.username = usernameMatch[1].trim().replace(/^["']+|["']+$/g, '');
          }
          if (passwordMatch && passwordMatch[1]) {
            loginInfo.password = passwordMatch[1].trim().replace(/^["']+|["']+$/g, '');
          }
        } else {
          // Fallback: try to extract from less structured format
          const usernameMatch = line.match(/(?:username|user\s*name|login)[\s:]+["']?([^"'\s,\n:]+)["']?/i);
          if (usernameMatch && usernameMatch[1] && usernameMatch[1].length > 1 && usernameMatch[1].length < 100) {
            loginInfo.username = usernameMatch[1].trim().replace(/^["']+|["']+$/g, '');
          }
          const passwordMatch = line.match(/(?:password|pass)[\s:]+["']?([^"'\s,\n:]+)["']?/i);
          if (passwordMatch && passwordMatch[1] && passwordMatch[1].length > 1 && passwordMatch[1].length < 100) {
            loginInfo.password = passwordMatch[1].trim().replace(/^["']+|["']+$/g, '');
          }
        }
      } else if (lowerLine.includes('complete login') || lowerLine.includes('should login') || lowerLine.includes('after login')) {
        currentSection = 'login';
        if (lowerLine.includes('yes') || lowerLine.includes('should') || lowerLine.includes('high priority')) {
          loginInfo.shouldLogin = true;
        }
        // Extract post-login strategy
        if (lowerLine.includes('continue') || lowerLine.includes('explore') || lowerLine.includes('authenticated')) {
          loginInfo.postLoginStrategy = 'continue exploration';
        }
      } else {
        // Try to extract structured data
        if (currentSection === 'elements' && line.trim() && !line.toLowerCase().startsWith('element:')) {
          const element = this.extractElement(line, lines, lines.indexOf(line));
          if (element) interactiveElements.push(element);
        } else if (currentSection === 'actions' && line.trim()) {
          const action = this.extractAction(line);
          if (action) suggestedActions.push(action);
        }
      }
    }

    // Fallback: if parsing didn't work well, use the raw content
    if (!description) {
      description = content.substring(0, 500);
    }
    
    // If no elements were parsed but content mentions buttons/links, try a more aggressive parse
    if (interactiveElements.length === 0) {
      console.log(`⚠️  No elements parsed from AI vision response, attempting fallback parsing...`);
      // Look for any mention of buttons, links, etc. in the content
      const buttonMatches = content.match(/(?:button|link|input|form)[\s:]+["']?([^"'\n]+)["']?/gi);
      if (buttonMatches && buttonMatches.length > 0) {
        console.log(`   Found ${buttonMatches.length} potential elements in content`);
        // Extract basic elements from matches
        for (const match of buttonMatches.slice(0, 20)) { // Limit to 20
          const element = this.extractElement(match, lines, 0);
          if (element) {
            interactiveElements.push(element);
          }
        }
      }
    }
    
    console.log(`📊 Parsed ${interactiveElements.length} interactive elements from AI vision`);
    
    // Check if pageType indicates login
    if (pageType.toLowerCase().includes('login') || pageType.toLowerCase().includes('sign in')) {
      loginInfo.isLoginPage = true;
    }
    
    // If login page detected but no explicit shouldLogin, infer from context
    if (loginInfo.isLoginPage && loginInfo.credentialsVisible && !loginInfo.shouldLogin) {
      loginInfo.shouldLogin = true; // If credentials are visible, we should login
    }
    
    // Also check description and full content for login indicators (using already-declared fullContentLower)
    if (fullContentLower.includes('login page') || fullContentLower.includes('sign in page')) {
      loginInfo.isLoginPage = true;
    }
    if (fullContentLower.includes('credential') && (fullContentLower.includes('visible') || fullContentLower.includes('shown'))) {
      loginInfo.credentialsVisible = true;
    }
    
    // Enhanced credential extraction from full content - prioritize structured format
    // Do this even if loginInfo.isLoginPage is false initially - we'll set it if we find credentials
    if (loginInfo.isLoginPage || fullContentLower.includes('credential') || fullContentLower.includes('demo')) {
      console.log(`🔍 Searching for credentials in AI response...`);
      
      // First, look for the structured LOGIN_CREDENTIALS format
      const structuredMatch = content.match(/LOGIN_CREDENTIALS[:\s]+Username[:\s]+([^\s\n]+)[\s]+Password[:\s]+([^\s\n]+)/i);
      if (structuredMatch) {
        console.log(`✅ Found structured LOGIN_CREDENTIALS format`);
        if (!loginInfo.username) {
          loginInfo.username = structuredMatch[1].trim().replace(/^["']+|["']+$/g, '');
        }
        if (!loginInfo.password) {
          loginInfo.password = structuredMatch[2].trim().replace(/^["']+|["']+$/g, '');
        }
        loginInfo.credentialsVisible = true;
        loginInfo.isLoginPage = true; // If credentials found, it's definitely a login page
      }
      
      // Pattern 1: "Demo credentials (username: test, password: password)" - handles parentheses
      if (!loginInfo.username || !loginInfo.password) {
        const demoCredsMatch = content.match(/demo\s+credentials?\s*[\(:]?\s*(?:username|user)[\s:]+([^\s,)]+)[\s,)]+password[\s:]+([^\s,)]+)/i);
        if (demoCredsMatch) {
          console.log(`✅ Found demo credentials in parentheses format`);
          if (!loginInfo.username) {
            loginInfo.username = demoCredsMatch[1].trim().replace(/^["']+|["']+$/g, '');
          }
          if (!loginInfo.password) {
            loginInfo.password = demoCredsMatch[2].trim().replace(/^["']+|["']+$/g, '');
          }
          loginInfo.credentialsVisible = true;
          loginInfo.isLoginPage = true;
        }
      }
      
      // Pattern 2: "username: test, password: password" (comma-separated)
      if (!loginInfo.username || !loginInfo.password) {
        const commaSeparatedMatch = content.match(/(?:username|user\s*name)[\s:]+([^\s,]+)[\s,]+password[\s:]+([^\s,]+)/i);
        if (commaSeparatedMatch) {
          console.log(`✅ Found credentials in comma-separated format`);
          if (!loginInfo.username) {
            loginInfo.username = commaSeparatedMatch[1].trim().replace(/^["']+|["']+$/g, '');
          }
          if (!loginInfo.password) {
            loginInfo.password = commaSeparatedMatch[2].trim().replace(/^["']+|["']+$/g, '');
          }
          loginInfo.credentialsVisible = true;
          loginInfo.isLoginPage = true;
        }
      }
      
      // Pattern 3: Separate username and password lines/mentions
      if (!loginInfo.username) {
        const usernamePatterns = [
          /(?:username|user\s*name|login)[\s:]+["']?([^"'\s,\n:\)]+)["']?/i,
          /(?:username|user\s*name|login)[\s:]+([^\s,\n:\)]+)/i,
          /username[\s:]+([a-zA-Z0-9_\-]+)/i, // Simple: "username: test"
        ];
        for (const pattern of usernamePatterns) {
          const match = content.match(pattern);
          if (match && match[1] && match[1].length > 1 && match[1].length < 100 && !match[1].includes('field')) {
            loginInfo.username = match[1].trim().replace(/^["']+|["']+$/g, '');
            console.log(`✅ Extracted username: "${loginInfo.username}"`);
            break;
          }
        }
      }
      
      if (!loginInfo.password) {
        const passwordPatterns = [
          /password[\s:]+["']?([^"'\s,\n:\)]+)["']?/i,
          /password[\s:]+([^\s,\n:\)]+)/i,
          /password[\s:]+([a-zA-Z0-9_\-]+)/i, // Simple: "password: password"
        ];
        for (const pattern of passwordPatterns) {
          const match = content.match(pattern);
          if (match && match[1] && match[1].length > 1 && match[1].length < 100 && !match[1].includes('field')) {
            loginInfo.password = match[1].trim().replace(/^["']+|["']+$/g, '');
            console.log(`✅ Extracted password: "${loginInfo.password}"`);
            break;
          }
        }
      }
      
      // If we found credentials, mark as login page and visible
      if (loginInfo.username && loginInfo.password) {
        loginInfo.credentialsVisible = true;
        loginInfo.isLoginPage = true;
        loginInfo.shouldLogin = true; // If credentials are found, we should login
        console.log(`✅ Login page detected with credentials: username="${loginInfo.username}", password="${loginInfo.password}"`);
      }
    }

    // Enhanced action extraction: Look for action-like patterns in the full content
    // This catches cases where AI formats actions differently (numbered lists, bullets, etc.)
    if (suggestedActions.length === 0) {
      // Look for common action patterns in the full content
      const actionPatterns = [
        /(?:click|press|select|interact with|test|try|explore|navigate to|open|view|check|verify|use|activate|trigger)\s+([^\n\.]+)/gi,
        /(?:should|can|could|might|recommend|suggest).*?(?:click|press|select|interact|test|try|explore|navigate|open|view|check|verify|use|activate|trigger)\s+([^\n\.]+)/gi,
        /[-•*]\s*(?:click|press|select|interact|test|try|explore|navigate|open|view|check|verify|use|activate|trigger)\s+([^\n\.]+)/gi,
        /\d+[\.\)]\s*(?:click|press|select|interact|test|try|explore|navigate|open|view|check|verify|use|activate|trigger)\s+([^\n\.]+)/gi,
      ];
      
      for (const pattern of actionPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          if (match[1]) {
            const actionText = match[1].trim();
            // Filter out very short or generic actions
            if (actionText.length >= 5 && actionText.length < 200 && 
                !actionText.toLowerCase().includes('page') && 
                !actionText.toLowerCase().includes('site')) {
              const action = this.extractAction(actionText);
              if (action && !suggestedActions.some(a => a.action.toLowerCase() === actionText.toLowerCase())) {
                suggestedActions.push(action);
                // Limit to 10 actions to avoid too many
                if (suggestedActions.length >= 10) break;
              }
            }
          }
        }
        if (suggestedActions.length >= 10) break;
      }
    }

    return {
      description: description.trim() || content.substring(0, 500),
      interactiveElements,
      suggestedActions: suggestedActions.length > 0 ? suggestedActions : [
        { action: 'Explore navigation', reason: 'Initial exploration', priority: 'high' },
      ],
      pageType: pageType || 'unknown',
      risks: risks.length > 0 ? risks : [],
      architecture,
      siteCharacteristics: Object.keys(siteCharacteristics).length > 0 ? siteCharacteristics : undefined,
      loginInfo: loginInfo.isLoginPage ? loginInfo : undefined,
    };
  }

  private extractElement(line: string, lines: string[], currentIndex: number): InteractiveElement | null {
    const lower = line.toLowerCase();
    let type: InteractiveElement['type'] = 'button';
    
    // Check if this is the start of an element block (ELEMENT: format)
    const elementMatch = line.match(/ELEMENT:\s*\[?([^\]]+)\]?\s*["']([^"']+)["']/i);
    if (elementMatch) {
      const typeStr = elementMatch[1].toLowerCase().trim();
      const text = elementMatch[2].trim();
      
      if (typeStr.includes('button')) type = 'button';
      else if (typeStr.includes('link')) type = 'link';
      else if (typeStr.includes('input')) type = 'input';
      else if (typeStr.includes('form')) type = 'form';
      else if (typeStr.includes('dropdown') || typeStr.includes('select')) type = 'dropdown';
      else if (typeStr.includes('checkbox')) type = 'checkbox';
      else if (typeStr.includes('radio')) type = 'radio';
      else return null;

      // Parse subsequent lines for functional understanding
      let location = 'unknown';
      let purpose = '';
      let behavior = '';
      let workflow = '';
      let relatedElements: string[] = [];
      let expectedOutcome = '';

      // Look ahead in lines for element metadata
      for (let i = currentIndex + 1; i < Math.min(currentIndex + 10, lines.length); i++) {
        const nextLine = lines[i].toLowerCase().trim();
        if (nextLine.startsWith('element:') || nextLine.startsWith('---')) break; // Next element or section
        
        if (nextLine.startsWith('location:')) {
          location = lines[i].replace(/^location:\s*/i, '').trim();
        } else if (nextLine.startsWith('purpose:')) {
          purpose = lines[i].replace(/^purpose:\s*/i, '').trim();
        } else if (nextLine.startsWith('behavior:')) {
          behavior = lines[i].replace(/^behavior:\s*/i, '').trim();
        } else if (nextLine.startsWith('workflow:')) {
          workflow = lines[i].replace(/^workflow:\s*/i, '').trim();
        } else if (nextLine.startsWith('related:')) {
          const relatedStr = lines[i].replace(/^related:\s*/i, '').trim();
          relatedElements = relatedStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
        } else if (nextLine.startsWith('expected:')) {
          expectedOutcome = lines[i].replace(/^expected:\s*/i, '').trim();
        }
      }

      return {
        type,
        description: text,
        location: location || 'unknown',
        purpose: purpose || text,
        behavior: behavior || undefined,
        workflow: workflow || undefined,
        relatedElements: relatedElements.length > 0 ? relatedElements : undefined,
        expectedOutcome: expectedOutcome || undefined,
      };
    }
    
    // Fallback: old format parsing
    if (lower.includes('button')) type = 'button';
    else if (lower.includes('link') || lower.includes('href')) type = 'link';
    else if (lower.includes('input') || lower.includes('text field')) type = 'input';
    else if (lower.includes('form')) type = 'form';
    else if (lower.includes('dropdown') || lower.includes('select')) type = 'dropdown';
    else if (lower.includes('checkbox')) type = 'checkbox';
    else if (lower.includes('radio')) type = 'radio';
    else return null;

    return {
      type,
      description: line.trim(),
      location: 'unknown',
      purpose: line.trim(),
    };
  }

  private extractAction(line: string): SuggestedAction | null {
    if (!line.trim() || line.trim().length < 10) return null;
    
    const lower = line.toLowerCase();
    let priority: SuggestedAction['priority'] = 'medium';
    if (lower.includes('high') || lower.includes('important') || lower.includes('critical')) {
      priority = 'high';
    } else if (lower.includes('low') || lower.includes('optional')) {
      priority = 'low';
    }

    return {
      action: line.trim(),
      reason: 'AI suggested',
      priority,
    };
  }

  async generateReport(
    pagesVisited: string[],
    actions: string[],
    issues: string[]
  ): Promise<{ siteDescription: string; suggestions: string }> {
    const prompt = `You are a QA tester analyzing a website. Based on the following exploration:
- Pages visited: ${pagesVisited.join(', ')}
- Actions taken: ${actions.join(', ')}
- Issues found: ${issues.join(', ')}

Provide a comprehensive analysis in two sections:

## 1. Site Description
Write a clear, concise description of the website from a tester's perspective. Include:
- Primary purpose and functionality
- Content nature (static/dynamic/mixed)
- Key features and patterns observed
- Technology indicators (if visible)
- User flows and navigation structure
- Content update patterns (if observable)

Write this as a narrative description, like a tester documenting their understanding of the site.

## 2. Tester Suggestions
Provide practical suggestions for improvement from a QA/testing perspective. These should be:
- Actionable recommendations (not bug reports)
- Focused on user experience, accessibility, performance, and maintainability
- Written in a constructive, helpful tone
- Organized by category (UX, Accessibility, Performance, Security, etc.)
- Include reasoning for each suggestion

Format as clear, structured text. Do not include test cases (those are generated separately).`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_completion_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content || '';
      
      // Log reasoning - store FULL response to capture site description and suggestions
      await this.logReasoning({
        timestamp: new Date().toISOString(),
        operation: 'generateReport',
        model: this.model,
        prompt: prompt, // Full prompt
        response: content, // Full response - contains site description and suggestions
        tokenUsage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
        finishReason: response.choices[0]?.finish_reason,
        metadata: {
          pagesVisited: pagesVisited.length,
          actionsCount: actions.length,
          issuesCount: issues.length,
        },
      });
      
      // Extract site description and suggestions sections
      return {
        siteDescription: this.extractSection(content, 'site description', 'tester suggestions'),
        suggestions: this.extractSection(content, 'tester suggestions', ''),
      };
    } catch (error) {
      console.error('Error generating report:', error);
      return {
        siteDescription: 'Failed to generate site description',
        suggestions: 'Failed to generate suggestions',
      };
    }
  }

  private extractSection(content: string, keyword: string, nextSection?: string): string {
    const lowerContent = content.toLowerCase();
    const keywordIndex = lowerContent.indexOf(keyword.toLowerCase());
    if (keywordIndex === -1) {
      // If keyword not found, try to find section headers
      const sectionMatch = content.match(new RegExp(`##?\\s*${keyword.replace(/\s+/g, '.*')}`, 'i'));
      if (sectionMatch) {
        const start = sectionMatch.index || 0;
        const end = nextSection 
          ? (content.toLowerCase().indexOf(nextSection.toLowerCase(), start) || content.length)
          : content.length;
        return content.substring(start, end).trim();
      }
      return content.substring(0, 1000); // Fallback
    }
    
    // Extract from keyword to next section or end
    const start = keywordIndex;
    const end = nextSection 
      ? (content.toLowerCase().indexOf(nextSection.toLowerCase(), start) || content.length)
      : content.length;
    
    return content.substring(start, end).trim();
  }
}

