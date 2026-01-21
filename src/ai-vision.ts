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

  async analyzePage(
    screenshotPath: string,
    url: string,
    previousActions: string[],
    siteContext?: { siteDescription?: string; loginInstructions?: string }
  ): Promise<VisionAnalysis> {
    const imageBuffer = readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    const contextPrompt = previousActions.length > 0
      ? `Previous actions taken: ${previousActions.join(', ')}. `
      : '';

    // Build site context section if available
    let siteContextPrompt = '';
    if (siteContext?.siteDescription || siteContext?.loginInstructions) {
      siteContextPrompt = `\n\n**SITE CONTEXT (from configuration):**\n`;
      if (siteContext.siteDescription) {
        siteContextPrompt += `Site Description: ${siteContext.siteDescription}\n`;
      }
      if (siteContext.loginInstructions) {
        siteContextPrompt += `Login Instructions: ${siteContext.loginInstructions}\n`;
      }
      siteContextPrompt += `\nUse this context to understand the site and perform the appropriate actions. Follow the login instructions exactly when you encounter a login page or authentication flow.\n\n`;
    }

    const prompt = `${contextPrompt}${siteContextPrompt}You are an autonomous exploratory QA agent. Your PRIMARY MISSION is to explore and test the full authenticated product experience.

**CURRENT URL:** ${url}

=== GLOBAL PRIORITY ===
1. Reach and explore the CORE PRODUCT (authenticated areas) as quickly as possible
2. Only spend minimal effort on "gateway" pages (login, signup) - they are gates, not destinations
3. Always maintain FORWARD PROGRESS: if you can proceed deeper into the app, do it

=== RECOGNIZING POST-LOGIN STATE ===
After successful login, you are now in the AUTHENTICATED CORE APPLICATION. Recognize this state if:
- You see a user menu, profile icon, or "Sign Out"/"Logout" button
- You see dashboard content, account info, or personalized data
- URL changed from /login or auth provider back to the main app
- Navigation shows app-specific sections (Dashboard, Settings, Profile, etc.)
- Previous context mentions "completed login" or "POST-LOGIN"

WHEN YOU ARE IN AUTHENTICATED STATE:
1. Your mission is NOW to explore all features of the authenticated app
2. Look for and click on: Dashboard links, navigation menu items, settings, data views, action buttons
3. Generate SPECIFIC actions to click on actual visible links and buttons - not generic "explore"
4. DO NOT suggest going back to login or marketing pages
5. Prioritize buttons and links that lead to app functionality (views, forms, data, actions)

=== AUTHENTICATION GATE RULE ===
Many pages require authentication. If this page appears to be a login/auth gateway, treat it as a GATE to pass through, not a destination to deeply test.

Recognize a login/auth gateway if ANY of these are true:
- URL contains: /login, /signin, /auth, /sso
- Visible UI includes: "Sign in", "Log in", "Welcome back", password fields, email/username inputs
- Primary CTA implies identity verification or redirect to identity provider (AWS Cognito, Auth0, etc.)
- Page says "Click to sign in" or similar redirect-to-auth language

WHEN YOU DETECT A LOGIN/AUTH GATE:
1. Quick sanity check only (CTA exists, page not broken)
2. Immediately attempt to pass the gate:
   - If you see a "Sign In" button but NO form fields: Click it to reach the actual login form
   - If you see a username/email field: Fill it with credentials, then click Next/Continue/Submit
   - If you see a password field: Fill it with credentials, then click Sign In/Submit
3. After each action, I will show you the next page - keep progressing through the auth flow
4. Once logged in (URL changes, user menu appears, protected content visible): resume full exploration

=== RESPONSE FORMAT ===

Provide your analysis in these sections:

**1. PAGE CLASSIFICATION**
Type: [Auth Gate | Public Marketing | App Core | Settings | Error | Unknown]
Purpose: [One sentence describing what this page is for]

**2. PAGE DESCRIPTION**
[2-4 sentences describing what you see on the page - layout, content, key elements]

**3. INTERACTIVE ELEMENTS**
List each clickable/fillable element:
ELEMENT: [type] "[visible text]" - [what it does]

Examples:
ELEMENT: button "Sign In" - redirects to authentication provider
ELEMENT: input "Email" - text field for email/username
ELEMENT: link "Dashboard" - navigates to main dashboard

**4. NEXT ACTIONS**
List 1-3 actions. STRICT FORMAT REQUIRED - each action MUST start with "ACTION:" on its own line:

ACTION: Click "Sign In"
ACTION: Fill username field with credentials
ACTION: Fill password field with credentials

VALID ACTION FORMATS (use these EXACTLY):
- ACTION: Click "Exact Button Text"
- ACTION: Fill username field with credentials
- ACTION: Fill password field with credentials

DO NOT write prose, explanations, goals, or bullet points. ONLY write ACTION: lines.
DO NOT write "- Goal:" or "### Priority" or any other text.
WRONG: "- Click the sign in button to proceed"
RIGHT: ACTION: Click "Sign In"

**5. BRIEF NOTES** (optional, 1-2 sentences max)
[Any critical bugs or blockers only]`;

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

    // FIRST PASS: Extract ACTION: lines directly (new format)
    for (const line of lines) {
      const trimmedLine = line.trim();
      // Match "ACTION: Click "Button Text"" or "ACTION: Fill username field with credentials"
      if (trimmedLine.toUpperCase().startsWith('ACTION:')) {
        const actionText = trimmedLine.substring(7).trim(); // Remove "ACTION:" prefix
        if (actionText.length > 0) {
          // Filter out section headers that accidentally start with "ACTION:" pattern
          // e.g., "**5. BRIEF NOTES**" sometimes gets parsed as an action
          const lowerAction = actionText.toLowerCase();
          if (lowerAction.includes('brief notes') ||
              lowerAction.includes('notes**') ||
              lowerAction.startsWith('**') ||
              /^\*?\*?\d+\./.test(actionText)) {  // Matches "**5." or "*5." or "5."
            console.log(`⏭️  Skipping non-action line: ${actionText}`);
            continue;
          }

          // Determine priority based on action type
          let priority: SuggestedAction['priority'] = 'high';
          if (lowerAction.includes('fill') && lowerAction.includes('credentials')) {
            priority = 'high'; // Credential actions are high priority
          } else if (lowerAction.includes('click')) {
            priority = 'high'; // Click actions are high priority
          }
          suggestedActions.push({
            action: actionText,
            reason: 'AI suggested action',
            priority,
          });
          console.log(`📌 Parsed ACTION: ${actionText}`);
        }
      }
    }

    let currentSection = '';
    for (const line of lines) {
      const lowerLine = line.toLowerCase().trim();

      if (lowerLine.includes('description') || lowerLine.includes('page shows') || lowerLine.includes('page description')) {
        currentSection = 'description';
        description += line + ' ';
      } else if (lowerLine.includes('interactive') || lowerLine.includes('element') || lowerLine.startsWith('element:')) {
        currentSection = 'elements';
        // Also try to extract element immediately if it's in ELEMENT: format
        if (lowerLine.startsWith('element:')) {
          const element = this.extractElement(line, lines, lines.indexOf(line));
          if (element) interactiveElements.push(element);
        }
      } else if (lowerLine.includes('next actions') || lowerLine.includes('suggested actions')) {
        currentSection = 'actions';
      } else if (lowerLine.includes('page classification') || lowerLine.startsWith('type:')) {
        currentSection = 'pageType';
        // Parse new format: "Type: Auth Gate" or "Type: [Auth Gate | App Core | ...]"
        const typeMatch = line.match(/type[:\s]+\[?([^\]\n,|]+)/i);
        if (typeMatch) {
          const parsedType = typeMatch[1].trim().toLowerCase();
          if (parsedType.includes('auth') || parsedType.includes('gate') || parsedType.includes('login')) {
            pageType = 'login';
            loginInfo.isLoginPage = true;
            loginInfo.shouldLogin = true;
            console.log(`✅ Detected Auth Gate page type from classification`);
          } else if (parsedType.includes('app core') || parsedType.includes('dashboard')) {
            pageType = 'dashboard';
          } else {
            pageType = parsedType;
          }
        }
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
    
    // DISABLED: Credential extraction from AI response text
    // This was extracting garbage from markdown formatting (e.g., "**UI**" becoming username="UI")
    // Credentials should ONLY come from:
    // 1. Context file (authoritative) - handled by automation-engine.ts extractCredentials()
    // 2. Page content extraction (fallback) - also in automation-engine.ts
    // The AI vision module should only detect if it's a login page, not extract credentials
    console.log(`🔍 AI vision: credential extraction disabled (use context file instead)`);

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

