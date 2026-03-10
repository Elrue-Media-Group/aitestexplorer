import { TestResult, StepResult } from './test-executor.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Extended result type for MCP execution
interface MCPTestResult extends Partial<TestResult> {
  testCaseId: string;
  testCaseName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  steps?: any[];
  verifications?: Array<{
    criterion: string;
    passed: boolean;
    method: 'structured' | 'ai_vision';
    evidence: string;
  }>;
  aiAssessment?: string;
  executedAt?: Date;
}

export class TestResultsFormatter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Format test results as markdown report
   * Handles both traditional and MCP execution results
   */
  formatResults(results: (TestResult | MCPTestResult)[]): string {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const total = results.length;

    let content = '# Test Execution Results\n\n';
    content += `**Execution Date:** ${new Date().toISOString()}\n\n`;
    content += `## Summary\n\n`;
    content += `| Metric | Count |\n`;
    content += `|--------|-------|\n`;
    content += `| Total Tests | ${total} |\n`;
    content += `| ✅ Passed | ${passed} |\n`;
    content += `| ❌ Failed | ${failed} |\n`;
    content += `| ⏭️  Skipped | ${skipped} |\n`;
    content += `| Pass Rate | ${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}% |\n\n`;
    content += `---\n\n`;

    content += `## Detailed Results\n\n`;

    for (const result of results) {
      const icon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
      content += `### ${icon} ${result.testCaseId}: ${result.testCaseName}\n\n`;
      
      if (result.testCaseDescription) {
        content += `**Description:** ${result.testCaseDescription}\n\n`;
      }
      
      content += `**Status:** ${result.status.toUpperCase()}\n\n`;
      content += `**Duration:** ${result.duration}ms\n\n`;
      content += `**Executed At:** ${result.executedAt?.toISOString() || new Date().toISOString()}\n\n`;

      if (result.expectedResult) {
        content += `**Expected Result:** ${result.expectedResult}\n\n`;
      }

      // Always show failure reason prominently for failed tests
      if (result.status === 'failed') {
        if (result.error) {
          content += `**❌ FAILURE REASON:** ${result.error}\n\n`;
        } else {
          content += `**❌ FAILURE REASON:** Unknown (no error message captured)\n\n`;
        }
      }

      // Verification details
      if (result.verificationDetails && result.verificationDetails.length > 0) {
        content += `**Verification Details:**\n\n`;
        for (const detail of result.verificationDetails) {
          const matchIcon = detail.match ? '✅' : '❌';
          content += `${matchIcon} **${detail.what}**\n`;
          content += `   - Expected: ${detail.expected}\n`;
          content += `   - Actual: ${detail.actual}\n`;
          
          // Add detailed information if available
          if (detail.details) {
            if (detail.details.title) {
              content += `   - Page Title: "${detail.details.title}"\n`;
            }
            if (detail.details.headings && detail.details.headings.length > 0) {
              content += `   - Main Headings: ${detail.details.headings.slice(0, 3).map(h => `"${h}"`).join(', ')}\n`;
            }
            if (detail.details.linksCount !== undefined) {
              content += `   - Links Found: ${detail.details.linksCount}\n`;
            }
            if (detail.details.buttonsCount !== undefined) {
              content += `   - Buttons Found: ${detail.details.buttonsCount}\n`;
            }
            if (detail.details.formsCount !== undefined && detail.details.formsCount > 0) {
              content += `   - Forms Found: ${detail.details.formsCount}\n`;
            }
            if (detail.details.contentPreview) {
              content += `   - Content Preview: "${detail.details.contentPreview}"\n`;
            }
            if (detail.details.contentLength) {
              content += `   - Content Length: ${detail.details.contentLength.toLocaleString()} characters\n`;
            }
            if (detail.details.elementInfo) {
              const el = detail.details.elementInfo;
              content += `   - Element: ${el.tagName || 'unknown'}`;
              if (el.text) content += ` "${el.text}"`;
              if (el.selector) content += ` (${el.selector})`;
              if (el.visible !== undefined) content += ` - Visible: ${el.visible}`;
              if (el.enabled !== undefined) content += `, Enabled: ${el.enabled}`;
              content += '\n';
            }
            if (detail.details.navigationInfo) {
              const nav = detail.details.navigationInfo;
              if (nav.targetUrl) content += `   - Target URL: ${nav.targetUrl}\n`;
              if (nav.finalUrl) content += `   - Final URL: ${nav.finalUrl}\n`;
              if (nav.statusCode) content += `   - HTTP Status: ${nav.statusCode}\n`;
              if (nav.loadTime) content += `   - Load Time: ${nav.loadTime}ms\n`;
            }
            if (detail.details.formInfo) {
              const form = detail.details.formInfo;
              if (form.fieldType) content += `   - Field Type: ${form.fieldType}\n`;
              if (form.placeholder) content += `   - Placeholder: "${form.placeholder}"\n`;
              if (form.fieldName) content += `   - Field Name: ${form.fieldName}\n`;
              if (form.valueEntered) content += `   - Value Entered: "${form.valueEntered}"\n`;
              if (form.valueConfirmed) content += `   - Value Confirmed: "${form.valueConfirmed}"\n`;
              if (form.visible !== undefined) content += `   - Visible: ${form.visible}\n`;
              if (form.enabled !== undefined) content += `   - Enabled: ${form.enabled}\n`;
            }
          }
          
          content += `   - Match: ${detail.match ? 'Yes' : 'No'}\n\n`;
        }
      }

      content += `**Steps:**\n\n`;
      const steps = result.steps || [];
      for (const step of steps) {
        const stepIcon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : '⏭️';
        content += `${stepIcon} Step ${step.stepNumber}: ${step.description}\n`;

        if (step.expected && step.actual) {
          content += `   - Expected: ${step.expected}\n`;
          content += `   - Actual: ${step.actual}\n`;

          // Add detailed information if available
          if (step.details) {
            if (step.details.title) {
              content += `   - Page Title: "${step.details.title}"\n`;
            }
            if (step.details.headings && step.details.headings.length > 0) {
              content += `   - Headings: ${step.details.headings.slice(0, 2).map((h: string) => `"${h}"`).join(', ')}\n`;
            }
            if (step.details.linksCount !== undefined) {
              content += `   - Links: ${step.details.linksCount}\n`;
            }
            if (step.details.buttonsCount !== undefined) {
              content += `   - Buttons: ${step.details.buttonsCount}\n`;
            }
            if (step.details.contentPreview) {
              content += `   - Preview: "${step.details.contentPreview}"\n`;
            }
            if (step.details.elementInfo) {
              const el = step.details.elementInfo;
              content += `   - Element: ${el.tagName || 'unknown'}`;
              if (el.text) content += ` "${el.text}"`;
              if (el.selector) content += ` (${el.selector})`;
              content += '\n';
            }
            if (step.details.navigationInfo) {
              const nav = step.details.navigationInfo;
              if (nav.statusCode) content += `   - Status: ${nav.statusCode}\n`;
              if (nav.loadTime) content += `   - Load Time: ${nav.loadTime}ms\n`;
            }
            if (step.details.formInfo) {
              const form = step.details.formInfo;
              if (form.fieldType) content += `   - Field: ${form.fieldType}`;
              if (form.placeholder) content += ` (${form.placeholder})`;
              if (form.valueEntered) content += ` = "${form.valueEntered}"`;
              content += '\n';
            }
          }
          
          content += `   - Verified: ${step.verified ? '✅ Yes' : '❌ No'}\n`;
        }
        
        if (step.status === 'failed') {
          content += `   - Error: ${step.error || 'Unknown error'}\n`;
          if (step.screenshot) {
            const relativePath = step.screenshot.replace(this.outputDir + '/', '');
            content += `   - Evidence: [Screenshot](${relativePath})\n`;
          }
        }
        content += '\n';
      }

      if (result.evidence && result.evidence.length > 0) {
        content += `**Evidence:**\n`;
        for (const evidence of result.evidence) {
          const relativePath = evidence.replace(this.outputDir + '/', '');
          content += `- [${relativePath}](${relativePath})\n`;
        }
        content += '\n';
      }

      // Add MCP-specific verifications if present
      const mcpResult = result as MCPTestResult;
      if (mcpResult.verifications && mcpResult.verifications.length > 0) {
        content += `**Verifications:**\n\n`;
        for (const v of mcpResult.verifications) {
          const vIcon = v.passed ? '✅' : '❌';
          content += `${vIcon} ${v.criterion}\n`;
          content += `   - Method: ${v.method}\n`;
          content += `   - Evidence: ${v.evidence}\n\n`;
        }
      }

      // Add AI assessment if present
      if (mcpResult.aiAssessment) {
        content += `**AI Assessment:** ${mcpResult.aiAssessment}\n\n`;
      }

      content += `---\n\n`;
    }

    return content;
  }

  /**
   * Format summary for console output
   */
  formatSummary(results: TestResult[]): string {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const total = results.length;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

    return `
📊 Test Results Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Tests: ${total}
✅ Passed: ${passed}
❌ Failed: ${failed}
⏭️  Skipped: ${skipped}
📈 Pass Rate: ${passRate}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Save results to file
   */
  async saveResults(results: (TestResult | MCPTestResult)[]): Promise<string> {
    const content = this.formatResults(results);
    const filePath = join(this.outputDir, 'test-results.md');
    await writeFile(filePath, content);
    return filePath;
  }
}

