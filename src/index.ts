#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { join } from 'path';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { loadConfig } from './config.js';
import { AutomationEngine } from './automation-engine.js';
import { MCPExplorer } from './mcp-explorer.js';
import { OutputGenerator } from './output-generator.js';
import { AIVisionService } from './ai-vision.js';
import { CostEstimator } from './cost-estimator.js';
import { TestCaseGenerator, SiteContext } from './test-case-generator.js';
import { TestExecutor } from './test-executor.js';
import { TestResultsFormatter } from './test-results-formatter.js';
import { ContextFileConfig, PageState } from './types.js';
import chalk from 'chalk';

type ExplorationMode = 'vision' | 'mcp';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'URL to analyze',
      demandOption: true,
    })
    .option('max-pages', {
      type: 'number',
      description: 'Maximum number of pages to visit',
      default: 10,
    })
    .option('max-actions', {
      type: 'number',
      description: 'Maximum number of actions to perform',
      default: 50,
    })
    .option('headless', {
      type: 'boolean',
      description: 'Run browser in headless mode',
      default: false,
    })
    .option('estimate', {
      type: 'boolean',
      description: 'Show cost estimate only (do not run)',
      default: false,
    })
    .option('skip-estimate', {
      type: 'boolean',
      description: 'Skip cost estimate display',
      default: false,
    })
    .option('exploration-mode', {
      type: 'string',
      description: 'Exploration mode: "vision" (screenshot-based) or "mcp" (MCP + vision hybrid)',
      choices: ['vision', 'mcp'],
      default: 'vision',
    })
    .help()
    .parse();

  const url = argv.url as string;
  const maxPages = argv['max-pages'] as number;
  const maxActions = argv['max-actions'] as number;
  const estimateOnly = argv.estimate as boolean;
  const skipEstimate = argv['skip-estimate'] as boolean;
  const explorationMode = argv['exploration-mode'] as ExplorationMode;

  console.log(chalk.blue.bold('\n🤖 AI-Powered Website Automation Tool\n'));
  console.log(chalk.gray(`Target URL: ${url}`));
  console.log(chalk.gray(`Max Pages: ${maxPages}`));
  console.log(chalk.gray(`Max Actions: ${maxActions}`));
  console.log(chalk.gray(`Exploration Mode: ${explorationMode}\n`));

  // Calculate and display cost estimate
  const costEstimator = new CostEstimator();
  const costEstimate = costEstimator.estimateCost(maxPages, maxActions);
  
  if (!skipEstimate) {
    console.log(chalk.yellow(costEstimator.formatEstimate(costEstimate)));
    
    if (estimateOnly) {
      console.log(chalk.cyan('\n💡 Use without --estimate flag to run the analysis\n'));
      process.exit(0);
    }
    
    // Ask for confirmation (in a real scenario, you might want to add a prompt)
    console.log(chalk.gray('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n'));
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
    // Load configuration
    const config = loadConfig();
    config.maxPages = maxPages;
    config.maxActions = maxActions;
    config.headless = argv.headless as boolean;

    // Initialize output generator first to create run folder
    const outputGenerator = new OutputGenerator(config, null as any); // Will be set after run folder creation
    const runFolder = await outputGenerator.createRunFolder();
    const screenshotsDir = join(runFolder, 'screenshots');
    
    // Initialize vision service with reasoning log path
    const reasoningLogPath = outputGenerator.getReasoningLogPath();
    const visionService = new AIVisionService(config, reasoningLogPath);
    // Update output generator with vision service
    (outputGenerator as any).visionService = visionService;

    // Load context file early if available (needed for MCP mode)
    const contextFile = await loadContextFile(url);
    if (contextFile) {
      console.log(chalk.cyan(`📋 Loaded context file for enhanced test generation\n`));
    }

    // Initialize automation engine with run-specific screenshot directory
    const engine = new AutomationEngine(config);
    let pages: PageState[];
    let actionCount: number;

    if (explorationMode === 'mcp') {
      // MCP + Vision hybrid exploration
      console.log(chalk.yellow('🚀 Starting MCP exploration (AI Vision + MCP hybrid)...\n'));

      const mcpExplorer = new MCPExplorer(config, {
        maxPages,
        maxActions,
        headless: argv.headless as boolean,
        screenshotDir: screenshotsDir,
        contextFile: contextFile || undefined,
      });

      pages = await mcpExplorer.explore(url);
      actionCount = pages.reduce((sum, p) => sum + p.actions.length, 0);

      // We still need to initialize engine for test execution later
      await engine.initialize(screenshotsDir);
    } else {
      // Vision-based exploration (original)
      await engine.initialize(screenshotsDir);
      console.log(chalk.green('✅ Engine initialized\n'));
      console.log(chalk.yellow('🚀 Starting website exploration...\n'));
      pages = await engine.exploreWebsite(url);
      actionCount = engine.getActionCount();
    }

    console.log(chalk.green(`\n✅ Explored ${pages.length} pages`));
    console.log(chalk.green(`✅ Performed ${actionCount} actions\n`));

    // Generate comprehensive reports first (to get full site understanding)
    console.log(chalk.yellow('📊 Generating comprehensive reports for site understanding...\n'));
    
    // Generate architecture, risks, and full report to build site understanding
    const initialReport = await outputGenerator.generateReport(pages, url, []); // Empty test results for now
    
    // Extract site context from reports
    const siteContext: SiteContext = {
      architecture: initialReport.architecture,
      risks: initialReport.risks,
      fullReport: await readFullReport(runFolder),
    };

    // Merge context file data into siteContext (already loaded above)
    if (contextFile) {
      if (contextFile.sitePurpose) siteContext.sitePurpose = contextFile.sitePurpose;
      if (contextFile.contentNature) siteContext.contentNature = contextFile.contentNature;
      if (contextFile.contentPatterns) siteContext.contentPatterns = contextFile.contentPatterns;
      if (contextFile.updateFrequency) siteContext.updateFrequency = contextFile.updateFrequency;
      // Handle both testingGuidance formats (string or object)
      if (typeof contextFile.testingGuidance === 'string') {
        siteContext.testingGuidance = contextFile.testingGuidance;
      } else if (contextFile.testingNotes) {
        siteContext.testingGuidance = contextFile.testingNotes;
      }
      // Store full context file for reference
      siteContext.contextFile = contextFile;
    }

    // Generate test cases from exploration with site context
    console.log(chalk.yellow('📝 Generating test cases from exploration...\n'));
    const testCaseGenerator = new TestCaseGenerator(config, visionService);
    const generatedTestCases = await testCaseGenerator.generateTestCases(pages, url, siteContext);
    
    console.log(chalk.green(`✅ Generated ${generatedTestCases.length} test cases\n`));

    // Save test cases to file
    const testCasesContent = testCaseGenerator.formatTestCases(generatedTestCases);
    const testCasesPath = join(runFolder, 'test-cases.md');
    await writeFile(testCasesPath, testCasesContent);
    console.log(chalk.cyan(`📄 Test cases saved to: ${testCasesPath}\n`));

    // Execute test cases
    console.log(chalk.yellow('▶️  Executing test cases...\n'));
    const evidenceDir = join(runFolder, 'evidence');
    const testExecutor = new TestExecutor(engine.getPage()!, evidenceDir);
    const testResults = await testExecutor.executeAllTestCases(generatedTestCases);

    // Format and save test results
    console.log(chalk.yellow('\n📊 Formatting test results...\n'));
    const resultsFormatter = new TestResultsFormatter(runFolder);
    const resultsPath = await resultsFormatter.saveResults(testResults);
    const summary = resultsFormatter.formatSummary(testResults);
    console.log(chalk.cyan(summary));
    console.log(chalk.cyan(`📄 Detailed results saved to: ${resultsPath}\n`));

    // Update reports with test results
    console.log(chalk.yellow('📊 Updating comprehensive reports with test results...\n'));
    const finalReport = await outputGenerator.generateReport(pages, url, testResults);

    console.log(chalk.green('\n✅ Analysis complete!\n'));
    console.log(chalk.cyan('📄 Generated Reports:'));
    const passedCount = testResults.filter(r => r.status === 'passed').length;
    const failedCount = testResults.filter(r => r.status === 'failed').length;
    console.log(chalk.gray(`  - Test Cases: ${generatedTestCases.length} (${passedCount} passed, ${failedCount} failed)`));
    console.log(chalk.gray(`  - Suggestions: ${finalReport.suggestions.length}`));
    console.log(chalk.gray(`  - Risks: ${finalReport.risks.length}`));
    console.log(chalk.gray(`  - Architecture guide generated\n`));
    console.log(chalk.cyan(`📁 Output directory: ${outputGenerator.getRunFolder()}\n`));
    
    // Show final cost estimate
    const finalEstimate = costEstimator.estimateCost(pages.length, actionCount);
    console.log(chalk.yellow(`💰 Estimated cost for this run: $${finalEstimate.totalCost.toFixed(4)}\n`));

    // Cleanup
    await engine.cleanup();
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error);
    process.exit(1);
  }
}

/**
 * Read site analysis report for site context
 */
async function readFullReport(runFolder: string): Promise<string | undefined> {
  try {
    const siteAnalysisPath = join(runFolder, 'site-analysis.md');
    return await readFile(siteAnalysisPath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Load context file for a given URL if it exists
 * Returns the parsed context file or null if not found
 */
async function loadContextFile(url: string): Promise<ContextFileConfig | null> {
  try {
    // Extract domain from URL
    const urlObj = new URL(url);
    let domain = urlObj.hostname;

    // Remove www. prefix if present
    if (domain.startsWith('www.')) {
      domain = domain.substring(4);
    }

    // Check for context file: context/{domain}.json
    const contextPath = join(process.cwd(), 'context', `${domain}.json`);

    if (!existsSync(contextPath)) {
      return null; // No context file found - this is fine, continue normally
    }

    // Load and parse context file
    const contextContent = await readFile(contextPath, 'utf-8');
    const contextData: ContextFileConfig = JSON.parse(contextContent);

    return contextData;
  } catch (error) {
    // If there's an error (file not found, invalid JSON, etc.), just return null
    // Don't throw - context file is optional
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return null; // File doesn't exist - this is expected for most sites
    }
    console.warn(chalk.yellow(`⚠️  Warning: Could not load context file: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});

