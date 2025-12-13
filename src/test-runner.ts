import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { loadConfig } from './config.js';
import { AutomationEngine } from './automation-engine.js';
import { OutputGenerator } from './output-generator.js';
import { AIVisionService } from './ai-vision.js';
import { TestCaseGenerator } from './test-case-generator.js';
import { TestExecutor } from './test-executor.js';
import { TestResultsFormatter } from './test-results-formatter.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Test Runner
 * 
 * Orchestrates the complete test analysis workflow:
 * 1. Website exploration
 * 2. AI vision analysis
 * 3. Test case generation
 * 4. Test execution
 * 5. Results formatting
 * 
 * Can be called from both CLI and API endpoints.
 * 
 * @param url - Target website URL to analyze
 * @param maxPages - Maximum number of pages to explore
 * @param maxActions - Maximum number of interactive actions to perform
 * @param headless - Run browser in headless mode
 * @param runId - Optional run ID for tracking (auto-generated if not provided)
 * @returns Promise with runId and success status
 */
export async function runTestAnalysis(
  url: string,
  maxPages: number,
  maxActions: number,
  headless: boolean,
  runId?: string
): Promise<{ runId: string; success: boolean; error?: string }> {
  let runFolder: string = '';
  let progressPath: string = '';
  let logPath: string = '';
  
  console.log(`[TestRunner] Starting test analysis - runId: ${runId}, url: ${url}`);
  
  try {
    // Create run folder IMMEDIATELY - before anything else (synchronous check)
    if (runId) {
      runFolder = join(process.cwd(), 'output', runId);
      // Ensure output directory exists first
      const outputDir = join(process.cwd(), 'output');
      if (!existsSync(outputDir)) {
        console.log(`[TestRunner] Creating output directory: ${outputDir}`);
        await mkdir(outputDir, { recursive: true });
      }
      // Create run folder
      if (!existsSync(runFolder)) {
        console.log(`[TestRunner] Creating run folder: ${runFolder}`);
        await mkdir(runFolder, { recursive: true });
      } else {
        console.log(`[TestRunner] Run folder already exists: ${runFolder}`);
      }
    } else {
      // Generate runId if not provided
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      runId = `run-${timestamp}`;
      runFolder = join(process.cwd(), 'output', runId);
      const outputDir = join(process.cwd(), 'output');
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }
      await mkdir(runFolder, { recursive: true });
    }
    
    console.log(`[TestRunner] Run folder created: ${runFolder}`);
    
    // Set up paths
    progressPath = join(runFolder, 'progress.json');
    logPath = join(runFolder, 'run.log');
    const evidenceDir = join(runFolder, 'evidence');
    if (!existsSync(evidenceDir)) {
      await mkdir(evidenceDir, { recursive: true });
    }
    
    // Create updateProgress function
    const updateProgress = async (stage: string, message: string, details?: any) => {
      const progress = {
        stage,
        message,
        timestamp: new Date().toISOString(),
        ...details
      };
      console.log(`[TestRunner] Progress update [${stage}]: ${message}`);
      await writeFile(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
      
      // Also append to log file
      const logEntry = `[${new Date().toISOString()}] [${stage.toUpperCase()}] ${message}\n`;
      try {
        await writeFile(logPath, logEntry, { flag: 'a' });
      } catch {
        // Ignore log write errors
      }
    };
    
    // Initial progress update - this MUST happen immediately
    await updateProgress('initializing', 'Starting test analysis...', { url, maxPages, maxActions });
    console.log(`[TestRunner] Initial progress written to: ${progressPath}`);
    
    // Load configuration AFTER folder is created
    const config = loadConfig();
    config.maxPages = maxPages;
    config.maxActions = maxActions;
    config.headless = headless;
    
    // Initialize output generator FIRST to get reasoning log path
    const outputGenerator = new OutputGenerator(config, null as any);
    (outputGenerator as any).runFolder = runFolder;
    
    // Initialize vision service with reasoning log path
    const reasoningLogPath = outputGenerator.getReasoningLogPath();
    const visionService = new AIVisionService(config, reasoningLogPath);
    
    // Update output generator with vision service
    (outputGenerator as any).visionService = visionService;

    // Initialize automation engine with screenshot directory
    const screenshotsDir = join(runFolder, 'screenshots');
    if (!existsSync(screenshotsDir)) {
      await mkdir(screenshotsDir, { recursive: true });
    }
    
    const engine = new AutomationEngine(config);
    await engine.initialize(screenshotsDir);

    // Capture console output from automation engine
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    
    const logToFile = async (level: string, ...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      const logEntry = `[${new Date().toISOString()}] [${level}] ${message}\n`;
      try {
        await writeFile(logPath, logEntry, { flag: 'a' });
      } catch {
        // Ignore log write errors
      }
      // Also output to console
      if (level === 'ERROR') {
        originalConsoleError(...args);
      } else if (level === 'WARN') {
        originalConsoleWarn(...args);
      } else {
        originalConsoleLog(...args);
      }
    };
    
    // Override console methods to capture automation engine logs
    console.log = (...args: any[]) => {
      logToFile('LOG', ...args);
    };
    console.error = (...args: any[]) => {
      logToFile('ERROR', ...args);
    };
    console.warn = (...args: any[]) => {
      logToFile('WARN', ...args);
    };

    await updateProgress('exploring', 'Exploring website...', { pagesVisited: 0 });

    // Explore website
    const pages = await engine.exploreWebsite(url);
    await updateProgress('exploring', `Explored ${pages.length} page(s)`, { pagesVisited: pages.length });
    
    // Restore original console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    await updateProgress('analyzing', 'Analyzing pages with AI vision...', { pagesToAnalyze: pages.length });

    // Generate comprehensive reports first (to get full site understanding)
    // This is critical - it builds the site context that test generation needs
    const initialReport = await outputGenerator.generateReport(pages, url, []);
    
    await updateProgress('analyzing', 'Site analysis complete');

    // Extract site context from reports (like the CLI does)
    const siteAnalysisPath = join(runFolder, 'site-analysis.md');
    let fullReportContent = '';
    if (existsSync(siteAnalysisPath)) {
      try {
        fullReportContent = await readFile(siteAnalysisPath, 'utf-8');
      } catch {
        // Ignore read errors
      }
    }
    
    const siteContext: any = {
      architecture: initialReport.architecture,
      risks: initialReport.risks,
      fullReport: fullReportContent,
    };

    // Load context file if available (optional enhancement)
    const domain = new URL(url).hostname.replace('www.', '');
    const contextPath = join(process.cwd(), 'context', `${domain}.json`);
    
    if (existsSync(contextPath)) {
      try {
        const contextContent = await readFile(contextPath, 'utf-8');
        const contextFile = JSON.parse(contextContent);
        
        // Merge context file data into siteContext (like CLI does)
        if (contextFile.sitePurpose) siteContext.sitePurpose = contextFile.sitePurpose;
        if (contextFile.contentNature) siteContext.contentNature = contextFile.contentNature;
        if (contextFile.contentPatterns) siteContext.contentPatterns = contextFile.contentPatterns;
        if (contextFile.updateFrequency) siteContext.updateFrequency = contextFile.updateFrequency;
        if (contextFile.testingGuidance) siteContext.testingGuidance = contextFile.testingGuidance;
        // Store full context file for reference
        siteContext.contextFile = contextFile;
        console.log('✅ [TestRunner] Context file loaded and stored in siteContext');
        console.log('🔍 [TestRunner] siteContext.contextFile exists?', !!siteContext.contextFile);
        console.log('🔍 [TestRunner] siteContext.contextFile.credentials?', !!siteContext.contextFile?.credentials);
      } catch (error) {
        console.error('[TestRunner] Failed to load context file:', error);
      }
    } else {
      console.log('ℹ️  [TestRunner] No context file found at:', contextPath);
    }

    // Debug: Log what we're about to pass to test generator
    console.log('🔍 [TestRunner] About to pass siteContext with keys:', Object.keys(siteContext));
    console.log('🔍 [TestRunner] siteContext.contextFile before passing?', !!siteContext.contextFile);

    await updateProgress('generating_tests', 'Generating test cases with AI...');

    // Generate test cases with full site context
    const testCaseGenerator = new TestCaseGenerator(config, visionService);
    const testCases = await testCaseGenerator.generateTestCases(pages, url, siteContext);
    
    // Ensure reasoning log is written (formatReasoningLog is called in outputGenerator.generateReport)
    // But we need to make sure it happens

    // Save test cases
    const testCasesContent = testCaseGenerator.formatTestCases(testCases);
    const testCasesPath = join(runFolder, 'test-cases.md');
    await writeFile(testCasesPath, testCasesContent, 'utf-8');
    await updateProgress('generating_tests', `Generated ${testCases.length} test cases`, { testCaseCount: testCases.length });

    await updateProgress('executing', `Executing ${testCases.length} test cases...`, { 
      totalTests: testCases.length,
      completedTests: 0,
      passedTests: 0,
      failedTests: 0
    });

    // Execute test cases
    const page = engine.getPage();
    if (!page) {
      throw new Error('Page not initialized');
    }
    
    const executor = new TestExecutor(page, evidenceDir);
    
    // Execute tests with progress updates
    const results: any[] = [];
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      await updateProgress('executing', `Executing test ${i + 1}/${testCases.length}: ${testCase.name}`, {
        totalTests: testCases.length,
        completedTests: i,
        currentTest: testCase.name,
        passedTests: results.filter(r => r.status === 'passed').length,
        failedTests: results.filter(r => r.status === 'failed').length
      });
      
      const result = await executor.executeTestCase(testCase);
      results.push(result);
      
      await updateProgress('executing', `Completed test ${i + 1}/${testCases.length}`, {
        totalTests: testCases.length,
        completedTests: i + 1,
        passedTests: results.filter(r => r.status === 'passed').length,
        failedTests: results.filter(r => r.status === 'failed').length
      });
    }

    // Format and save results
    const resultsFormatter = new TestResultsFormatter(runFolder);
    await resultsFormatter.saveResults(results);

    // Generate final report with test results (this also formats the reasoning log)
    await outputGenerator.generateReport(pages, url, results);

    // Update progress - completed
    const passCount = results.filter((r: any) => r.status === 'passed').length;
    const failCount = results.filter((r: any) => r.status === 'failed').length;
    await updateProgress('completed', `Test run completed: ${passCount} passed, ${failCount} failed`, {
      testCount: results.length,
      passCount,
      failCount,
      success: failCount === 0
    });

    // Cleanup
    await engine.cleanup();

    const finalRunId = runId || runFolder.split('/').pop() || 'unknown';
    
    return {
      runId: finalRunId,
      success: true
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Test analysis failed:', errorMessage);
    
    // Try to update progress with error if we have the function
    try {
      const runFolder = runId ? join(process.cwd(), 'output', runId) : '';
      if (runFolder && existsSync(runFolder)) {
        const progressPath = join(runFolder, 'progress.json');
        const logPath = join(runFolder, 'run.log');
        const errorProgress = {
          stage: 'error',
          message: `Test run failed: ${errorMessage}`,
          timestamp: new Date().toISOString(),
          error: errorMessage
        };
        await writeFile(progressPath, JSON.stringify(errorProgress, null, 2), 'utf-8');
        const logEntry = `[${new Date().toISOString()}] [ERROR] Test run failed: ${errorMessage}\n`;
        await writeFile(logPath, logEntry, { flag: 'a' });
      }
    } catch {
      // Ignore error update failures
    }
    
    return {
      runId: runId || 'unknown',
      success: false,
      error: errorMessage
    };
  }
}
