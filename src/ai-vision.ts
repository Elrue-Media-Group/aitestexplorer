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

    const prompt = `${contextPrompt}Analyze this webpage screenshot and provide:

1. A detailed description of what you see on the page
2. All interactive elements (buttons, links, forms, inputs, etc.) with their likely purpose
3. Suggested next actions to explore and test the website (prioritize by importance)
4. The type of page (homepage, login, product listing, form, etc.)
5. Any potential risks or issues you notice
6. Architectural information about the site structure, navigation patterns, forms, and technology indicators
7. Site characteristics analysis:
   - What is the primary purpose of this website? (e.g., news aggregation, e-commerce, blog, social media, documentation, etc.)
   - What is the nature of the content? (static/rarely changes, dynamic/frequently updates, mixed)
   - What patterns do you observe? (feed-based content, product listings, time-sensitive elements, rotating content, etc.)
   - Are there indicators of update frequency? (timestamps, "new" badges, real-time updates, etc.)

Be specific and actionable. For each interactive element, describe what it likely does.`;

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
      
      // Log reasoning
      await this.logReasoning({
        timestamp: new Date().toISOString(),
        operation: 'analyzePage',
        model: this.model,
        prompt: prompt.substring(0, 2000) + (prompt.length > 2000 ? '...' : ''), // Truncate for readability
        response: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''), // Truncate for readability
        tokenUsage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
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

    let currentSection = '';
    for (const line of lines) {
      const lowerLine = line.toLowerCase().trim();
      
      if (lowerLine.includes('description') || lowerLine.includes('page shows')) {
        currentSection = 'description';
        description += line + ' ';
      } else if (lowerLine.includes('interactive') || lowerLine.includes('element')) {
        currentSection = 'elements';
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
      } else {
        // Try to extract structured data
        if (currentSection === 'elements' && line.trim()) {
          const element = this.extractElement(line);
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
    };
  }

  private extractElement(line: string): InteractiveElement | null {
    const lower = line.toLowerCase();
    let type: InteractiveElement['type'] = 'button';
    
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
      
      // Log reasoning
      await this.logReasoning({
        timestamp: new Date().toISOString(),
        operation: 'generateReport',
        model: this.model,
        prompt: prompt.substring(0, 2000) + (prompt.length > 2000 ? '...' : ''), // Truncate for readability
        response: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''), // Truncate for readability
        tokenUsage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        } : undefined,
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

