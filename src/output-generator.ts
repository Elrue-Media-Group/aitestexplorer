import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { AnalysisReport, PageState, TestCase, ArchitectureGuide, Suggestion, Risk, Action } from './types.js';
import { AIVisionService } from './ai-vision.js';
import { Config } from './types.js';
import chalk from 'chalk';

export class OutputGenerator {
  private config: Config;
  private visionService: AIVisionService;
  private runFolder: string = '';

  constructor(config: Config, visionService: AIVisionService) {
    this.config = config;
    this.visionService = visionService;
  }

  /**
   * Get the reasoning log path for this run
   */
  getReasoningLogPath(): string {
    return join(this.runFolder, 'ai-reasoning-log.json');
  }

  /**
   * Create a timestamped folder for this run
   */
  async createRunFolder(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runFolder = join(this.config.outputDir, `run-${timestamp}`);
    
    if (!existsSync(runFolder)) {
      await mkdir(runFolder, { recursive: true });
    }
    
    this.runFolder = runFolder;
    return runFolder;
  }

  getRunFolder(): string {
    return this.runFolder;
  }

  async generateReport(pages: PageState[], startUrl: string, testResults: any[] = []): Promise<AnalysisReport> {
    // Ensure run folder exists (should already be created, but check)
    if (!this.runFolder) {
      await this.createRunFolder();
    }
    
    const startTime = pages[0]?.timestamp || new Date();
    const endTime = new Date();

    // Extract data for AI report generation
    const urls = pages.map((p) => p.url);
    const actions = pages.flatMap((p) => p.actions.map((a) => a.description));
    const issues = pages.flatMap((p) => 
      p.actions.filter((a) => !a.success).map((a) => a.error || 'Unknown error')
    );

    // Generate AI-powered insights
    const aiReport = await this.visionService.generateReport(urls, actions, issues);

    // Generate structured outputs
    // Note: Test cases are now generated separately by TestCaseGenerator, not here
    // This is just for the report structure - use empty array or existing test cases
    const testCases: TestCase[] = [];
    const architecture = this.generateArchitectureGuide(pages, '');
    const suggestions = this.generateSuggestions(pages, aiReport.suggestions);
    const risks = this.generateRisks(pages, '');

    const report: AnalysisReport = {
      url: startUrl,
      startTime,
      endTime,
      pagesVisited: pages,
      testCases,
      architecture,
      suggestions,
      risks,
    };

    // Write outputs to files
    await this.writeOutputs(report, aiReport);

    return report;
  }

  private generateTestCases(pages: PageState[], aiContent: string): TestCase[] {
    const testCases: TestCase[] = [];
    let testId = 1;

    // Generate test cases from actual actions taken
    for (const page of pages) {
      if (page.actions.length === 0) continue;

      const testCase: TestCase = {
        id: `TC-${testId++}`,
        name: `Test: ${page.title}`,
        description: `Automated test for ${page.url}`,
        steps: page.actions
          .filter((a) => a.success)
          .map((a) => ({
            action: a.type,
            target: a.target || 'page',
            value: a.value,
          })),
        expectedResult: 'Page should load and interactions should work correctly',
        priority: this.determinePriority(page.actions),
      };

      testCases.push(testCase);
    }

    // Add test cases from AI analysis
    const aiTestCases = this.parseAITestCases(aiContent);
    testCases.push(...aiTestCases);

    return testCases;
  }

  private parseAITestCases(content: string): TestCase[] {
    const testCases: TestCase[] = [];
    const lines = content.split('\n');
    let currentTestCase: Partial<TestCase> | null = null;
    let testId = 100;

    for (const line of lines) {
      if (line.match(/test\s+case|tc-?\d+/i)) {
        if (currentTestCase) {
          testCases.push(currentTestCase as TestCase);
        }
        currentTestCase = {
          id: `TC-${testId++}`,
          name: line.trim(),
          description: '',
          steps: [],
          expectedResult: '',
          priority: 'medium',
        };
      } else if (currentTestCase) {
        if (line.toLowerCase().includes('step')) {
          // Extract step
        } else if (line.trim()) {
          currentTestCase.description += line.trim() + ' ';
        }
      }
    }

    if (currentTestCase) {
      testCases.push(currentTestCase as TestCase);
    }

    return testCases;
  }

  private generateArchitectureGuide(pages: PageState[], aiContent: string): ArchitectureGuide {
    const urls = pages.map((p) => p.url);
    const navigationPatterns: string[] = [];
    const formPatterns: string[] = [];
    const technologyStack: string[] = [];
    const keyPages: string[] = [];
    const userFlows: string[] = [];

    // Analyze pages
    for (const page of pages) {
      keyPages.push(page.url);
      
      // Extract navigation patterns
      const links = page.actions.filter((a) => a.type === 'navigate');
      if (links.length > 0) {
        navigationPatterns.push(`${page.url} has ${links.length} navigation links`);
      }

      // Extract form patterns
      const forms = page.actions.filter((a) => a.type === 'type');
      if (forms.length > 0) {
        formPatterns.push(`${page.url} contains ${forms.length} form fields`);
      }
    }

    // Parse AI content for additional insights
    if (aiContent.toLowerCase().includes('react') || aiContent.toLowerCase().includes('vue')) {
      technologyStack.push('JavaScript Framework detected');
    }
    if (aiContent.toLowerCase().includes('api') || aiContent.toLowerCase().includes('ajax')) {
      technologyStack.push('API-driven architecture');
    }

    return {
      siteStructure: this.buildSiteStructure(pages),
      navigationPatterns: navigationPatterns.length > 0 ? navigationPatterns : ['Standard navigation'],
      formPatterns: formPatterns.length > 0 ? formPatterns : ['No forms detected'],
      technologyStack: technologyStack.length > 0 ? technologyStack : ['Standard web technologies'],
      keyPages: keyPages,
      userFlows: this.identifyUserFlows(pages),
    };
  }

  private buildSiteStructure(pages: PageState[]): string {
    const structure: string[] = [];
    structure.push(`Total pages analyzed: ${pages.length}`);
    structure.push(`\nPage hierarchy:`);
    
    for (const page of pages) {
      const depth = (page.url.match(/\//g) || []).length - 2;
      const indent = '  '.repeat(Math.max(0, depth));
      structure.push(`${indent}- ${page.title} (${page.url})`);
    }

    return structure.join('\n');
  }

  private identifyUserFlows(pages: PageState[]): string[] {
    const flows: string[] = [];
    
    if (pages.length > 0) {
      flows.push(`Entry point: ${pages[0].url}`);
    }

    // Identify common flows
    const hasLogin = pages.some((p) => p.url.toLowerCase().includes('login') || p.actions.some((a) => a.target?.toLowerCase().includes('login')));
    if (hasLogin) {
      flows.push('Login flow detected');
    }

    const hasForms = pages.some((p) => p.actions.some((a) => a.type === 'type'));
    if (hasForms) {
      flows.push('Form submission flow detected');
    }

    return flows.length > 0 ? flows : ['Standard navigation flow'];
  }

  private generateSuggestions(pages: PageState[], aiContent: string): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // Analyze pages for suggestions
    for (const page of pages) {
      // Check for accessibility issues
      if (page.actions.some((a) => !a.success)) {
        suggestions.push({
          category: 'accessibility',
          title: 'Interaction failures detected',
          description: `Some interactions failed on ${page.url}`,
          priority: 'high',
          page: page.url,
        });
      }

      // Check for performance
      if (page.actions.length > 10) {
        suggestions.push({
          category: 'performance',
          title: 'Complex page interactions',
          description: `Page has many interactive elements which may impact performance`,
          priority: 'medium',
          page: page.url,
        });
      }
    }

    // Parse AI suggestions
    const aiSuggestions = this.parseAISuggestions(aiContent);
    suggestions.push(...aiSuggestions);

    return suggestions;
  }

  private parseAISuggestions(content: string): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (line.trim().length < 10) continue;

      const lower = line.toLowerCase();
      let category: Suggestion['category'] = 'other';
      let priority: Suggestion['priority'] = 'medium';

      if (lower.includes('accessibility') || lower.includes('a11y')) category = 'accessibility';
      else if (lower.includes('performance') || lower.includes('speed')) category = 'performance';
      else if (lower.includes('security')) category = 'security';
      else if (lower.includes('ux') || lower.includes('user experience')) category = 'ux';
      else if (lower.includes('seo')) category = 'seo';

      if (lower.includes('high') || lower.includes('critical') || lower.includes('important')) priority = 'high';
      else if (lower.includes('low') || lower.includes('minor')) priority = 'low';

      suggestions.push({
        category,
        title: line.substring(0, 100),
        description: line,
        priority,
      });
    }

    return suggestions.slice(0, 20); // Limit to 20 suggestions
  }

  private generateRisks(pages: PageState[], aiContent: string): Risk[] {
    const risks: Risk[] = [];

    // Analyze pages for risks
    for (const page of pages) {
      // Security risks
      if (page.url.includes('http://')) {
        risks.push({
          category: 'security',
          title: 'Insecure connection',
          description: `Page uses HTTP instead of HTTPS: ${page.url}`,
          severity: 'high',
          page: page.url,
          recommendation: 'Migrate to HTTPS',
        });
      }

      // Functionality risks
      const failedActions = page.actions.filter((a) => !a.success);
      if (failedActions.length > 0) {
        risks.push({
          category: 'functionality',
          title: 'Broken interactions',
          description: `${failedActions.length} interactions failed on ${page.url}`,
          severity: 'high',
          page: page.url,
          recommendation: 'Review and fix broken interactions',
        });
      }
    }

    // Parse AI risks
    const aiRisks = this.parseAIRisks(aiContent);
    risks.push(...aiRisks);

    return risks;
  }

  private parseAIRisks(content: string): Risk[] {
    const risks: Risk[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (line.trim().length < 10) continue;

      const lower = line.toLowerCase();
      let category: Risk['category'] = 'functionality';
      let severity: Risk['severity'] = 'medium';

      if (lower.includes('security')) category = 'security';
      else if (lower.includes('accessibility')) category = 'accessibility';
      else if (lower.includes('performance')) category = 'performance';
      else if (lower.includes('compatibility')) category = 'compatibility';

      if (lower.includes('critical') || lower.includes('severe')) severity = 'critical';
      else if (lower.includes('high')) severity = 'high';
      else if (lower.includes('low') || lower.includes('minor')) severity = 'low';

      risks.push({
        category,
        title: line.substring(0, 100),
        description: line,
        severity,
        recommendation: 'Review and address the issue',
      });
    }

    return risks.slice(0, 20); // Limit to 20 risks
  }

  private determinePriority(actions: Action[]): 'high' | 'medium' | 'low' {
    const failedCount = actions.filter((a) => !a.success).length;
    if (failedCount > 0) return 'high';
    if (actions.length > 5) return 'high';
    return 'medium';
  }

  private async writeOutputs(report: AnalysisReport, aiReport: any): Promise<void> {
    const basePath = this.runFolder || this.config.outputDir;

    // Note: Test cases are written separately by TestCaseGenerator in index.ts
    // We don't write test-cases.md here to avoid overwriting the generated test cases

    // Write consolidated site analysis report
    const siteAnalysisContent = this.formatSiteAnalysis(report, aiReport);
    await writeFile(join(basePath, 'site-analysis.md'), siteAnalysisContent);

    // Write JSON report (for programmatic access)
    await writeFile(join(basePath, 'report.json'), JSON.stringify(report, null, 2));

    // Format and write reasoning log if it exists
    const reasoningLogPath = this.getReasoningLogPath();
    try {
      const reasoningContent = await fs.readFile(reasoningLogPath, 'utf-8');
      const reasoningLogs = JSON.parse(reasoningContent);
      const formattedReasoning = this.formatReasoningLog(reasoningLogs);
      await writeFile(join(basePath, 'ai-reasoning.md'), formattedReasoning);
      console.log(chalk.cyan(`📋 AI reasoning log saved to: ${join(basePath, 'ai-reasoning.md')}\n`));
    } catch {
      // Reasoning log doesn't exist or couldn't be read - that's okay
    }

    console.log(`\n✅ Reports generated in ${basePath}/`);
  }

  private formatTestCases(testCases: TestCase[]): string {
    let content = '# Test Cases\n\n';
    for (const tc of testCases) {
      content += `## ${tc.id}: ${tc.name}\n\n`;
      content += `**Description:** ${tc.description}\n\n`;
      content += `**Priority:** ${tc.priority}\n\n`;
      content += `**Steps:**\n`;
      tc.steps.forEach((step, idx) => {
        content += `${idx + 1}. ${step.action} on "${step.target}"`;
        if (step.value) content += ` with value "${step.value}"`;
        content += '\n';
      });
      content += `\n**Expected Result:** ${tc.expectedResult}\n\n---\n\n`;
    }
    return content;
  }

  private formatArchitecture(arch: ArchitectureGuide): string {
    let content = '# Architecture Guide\n\n';
    content += `## Site Structure\n\n${arch.siteStructure}\n\n`;
    content += `## Navigation Patterns\n\n${arch.navigationPatterns.map((p) => `- ${p}`).join('\n')}\n\n`;
    content += `## Form Patterns\n\n${arch.formPatterns.map((p) => `- ${p}`).join('\n')}\n\n`;
    content += `## Technology Stack\n\n${arch.technologyStack.map((t) => `- ${t}`).join('\n')}\n\n`;
    content += `## Key Pages\n\n${arch.keyPages.map((p) => `- ${p}`).join('\n')}\n\n`;
    content += `## User Flows\n\n${arch.userFlows.map((f) => `- ${f}`).join('\n')}\n\n`;
    return content;
  }

  private formatSuggestions(suggestions: Suggestion[]): string {
    let content = '# Suggestions for Improvement\n\n';
    const byCategory = new Map<string, Suggestion[]>();
    
    for (const s of suggestions) {
      if (!byCategory.has(s.category)) {
        byCategory.set(s.category, []);
      }
      byCategory.get(s.category)!.push(s);
    }

    for (const [category, items] of byCategory) {
      content += `## ${category.toUpperCase()}\n\n`;
      for (const s of items) {
        content += `### ${s.title}\n\n`;
        content += `**Priority:** ${s.priority}\n\n`;
        content += `${s.description}\n\n`;
        if (s.page) content += `**Page:** ${s.page}\n\n`;
        content += '---\n\n';
      }
    }
    return content;
  }

  private formatRisks(risks: Risk[]): string {
    let content = '# Risks and Issues\n\n';
    const byCategory = new Map<string, Risk[]>();
    
    for (const r of risks) {
      if (!byCategory.has(r.category)) {
        byCategory.set(r.category, []);
      }
      byCategory.get(r.category)!.push(r);
    }

    for (const [category, items] of byCategory) {
      content += `## ${category.toUpperCase()}\n\n`;
      for (const r of items) {
        content += `### ${r.title}\n\n`;
        content += `**Severity:** ${r.severity}\n\n`;
        content += `${r.description}\n\n`;
        if (r.page) content += `**Page:** ${r.page}\n\n`;
        content += `**Recommendation:** ${r.recommendation}\n\n`;
        content += '---\n\n';
      }
    }
    return content;
  }

  private formatSiteAnalysis(report: AnalysisReport, aiReport: any): string {
    let content = `# Site Analysis Report\n\n`;
    content += `**URL:** ${report.url}\n\n`;
    content += `**Analysis Date:** ${report.startTime.toLocaleString()}\n\n`;
    content += `**Pages Analyzed:** ${report.pagesVisited.length}\n\n`;
    content += `---\n\n`;
    
    // Site Description from AI
    content += `## Site Description\n\n`;
    if (aiReport?.siteDescription) {
      // Clean up the section header if present
      let description = aiReport.siteDescription;
      // Remove "## 1. Site Description" or similar headers
      description = description.replace(/^#+\s*\d+\.?\s*Site\s+Description\s*/i, '').trim();
      // Remove "## Site Description" if it appears
      description = description.replace(/^#+\s*Site\s+Description\s*/i, '').trim();
      content += `${description}\n\n`;
    } else {
      content += `*Site description not available.*\n\n`;
    }
    
    content += `---\n\n`;
    
    // Tester Suggestions from AI
    content += `## Tester Suggestions\n\n`;
    if (aiReport?.suggestions) {
      // Clean up the section header if present
      let suggestions = aiReport.suggestions;
      // Remove "## 2. Tester Suggestions" or similar headers
      suggestions = suggestions.replace(/^#+\s*\d+\.?\s*Tester\s+Suggestions\s*/i, '').trim();
      // Remove "## Tester Suggestions" if it appears
      suggestions = suggestions.replace(/^#+\s*Tester\s+Suggestions\s*/i, '').trim();
      content += `${suggestions}\n\n`;
    } else {
      // Fallback to parsed suggestions if AI format not available
      if (report.suggestions.length > 0) {
        content += this.formatSuggestions(report.suggestions);
      } else {
        content += `*No suggestions available.*\n\n`;
      }
    }
    
    return content;
  }

  /**
   * Format reasoning log into human-readable markdown
   */
  private formatReasoningLog(logs: any[]): string {
    let content = `# AI Reasoning Log\n\n`;
    content += `This log captures the AI's "thinking" process - the prompts sent, responses received, and token usage for each AI operation.\n\n`;
    content += `**Total AI Operations:** ${logs.length}\n\n`;
    content += `---\n\n`;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      content += `## Operation ${i + 1}: ${log.operation}\n\n`;
      content += `**Timestamp:** ${new Date(log.timestamp).toLocaleString()}\n\n`;
      content += `**Model:** ${log.model}\n\n`;
      
      if (log.tokenUsage) {
        content += `**Token Usage:**\n`;
        content += `- Prompt Tokens: ${log.tokenUsage.prompt_tokens.toLocaleString()}\n`;
        content += `- Completion Tokens: ${log.tokenUsage.completion_tokens.toLocaleString()}\n`;
        content += `- Total Tokens: ${log.tokenUsage.total_tokens.toLocaleString()}\n\n`;
      }

      if (log.metadata) {
        content += `**Context:**\n`;
        for (const [key, value] of Object.entries(log.metadata)) {
          content += `- ${key}: ${value}\n`;
        }
        content += `\n`;
      }

      content += `### Prompt Sent to AI\n\n`;
      content += `\`\`\`\n${log.prompt}\n\`\`\`\n\n`;

      content += `### AI Response\n\n`;
      content += `\`\`\`\n${log.response}\n\`\`\`\n\n`;

      content += `---\n\n`;
    }

    return content;
  }
}

