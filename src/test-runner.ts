import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { loadConfig } from './config.js';
import { AutomationEngine } from './automation-engine.js';
import { OutputGenerator } from './output-generator.js';
import { AIVisionService } from './ai-vision.js';
import { TestCaseGenerator, SiteContext } from './test-case-generator.js';
import { TestExecutor } from './test-executor.js';
import { MCPTestExecutor } from './mcp-test-executor.js';
import { HybridTestExecutor } from './hybrid-executor.js';
import { TestResultsFormatter } from './test-results-formatter.js';
import { ContextFileConfig, PageState, IntentTestCase, IntentTestResult, HybridTestResult } from './types.js';
import { MCPExplorer } from './mcp-explorer.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export type ExplorationMode = 'vision' | 'mcp' | 'hybrid';

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
 * @param maxTestsToExecute - Maximum number of tests to execute (0 = all, N = first N by priority)
 * @param explorationMode - Exploration mode: 'vision' (default) or 'mcp'
 * @param executeTests - Whether to execute generated tests (default true). When false, only exploration and test generation run.
 * @returns Promise with runId and success status
 */
export async function runTestAnalysis(
  url: string,
  maxPages: number,
  maxActions: number,
  headless: boolean,
  runId?: string,
  maxTestsToExecute: number = 0,
  explorationMode: ExplorationMode = 'vision',
  executeTests: boolean = true
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
    config.maxTestsToExecute = maxTestsToExecute;
    config.headless = headless;
    
    // Initialize output generator FIRST to get reasoning log path
    const outputGenerator = new OutputGenerator(config, null as any);
    (outputGenerator as any).runFolder = runFolder;
    
    // Initialize vision service with reasoning log path
    const reasoningLogPath = outputGenerator.getReasoningLogPath();
    const visionService = new AIVisionService(config, reasoningLogPath);
    
    // Update output generator with vision service
    (outputGenerator as any).visionService = visionService;

    // Initialize screenshot directory
    const screenshotsDir = join(runFolder, 'screenshots');
    if (!existsSync(screenshotsDir)) {
      await mkdir(screenshotsDir, { recursive: true });
    }

    // Initialize automation engine (needed for both modes - MCP for exploration, Vision for execution)
    let engine: AutomationEngine | null = null;
    let mcpExplorer: MCPExplorer | null = null;

    if (explorationMode === 'mcp' || explorationMode === 'hybrid') {
      console.log(`[TestRunner] Using ${explorationMode.toUpperCase()} exploration mode`);
    } else {
      console.log('[TestRunner] Using Vision exploration mode');
      engine = new AutomationEngine(config);
      await engine.initialize(screenshotsDir);
    }

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

    await updateProgress('exploring', `Exploring website (${explorationMode} mode)...`, { pagesVisited: 0, explorationMode });

    // Explore website using selected mode
    let pages: PageState[];

    if (explorationMode === 'mcp' || explorationMode === 'hybrid') {
      // Load context file for MCP explorer
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      const port = urlObj.port;
      let contextFile: ContextFileConfig | undefined;

      let contextPath = port
        ? join(process.cwd(), 'context', `${domain}-${port}.json`)
        : join(process.cwd(), 'context', `${domain}.json`);

      if (port && !existsSync(contextPath)) {
        contextPath = join(process.cwd(), 'context', `${domain}.json`);
      }

      if (existsSync(contextPath)) {
        try {
          const contextContent = await readFile(contextPath, 'utf-8');
          contextFile = JSON.parse(contextContent);
          console.log(`[TestRunner] Loaded context file for MCP: ${contextPath}`);
        } catch (error) {
          console.warn('[TestRunner] Could not load context file:', error);
        }
      }

      // Use MCP Explorer - keep browser alive for hybrid mode
      mcpExplorer = new MCPExplorer(config, {
        maxPages,
        maxActions,
        headless,
        screenshotDir: screenshotsDir,
        contextFile,
        keepBrowserAlive: explorationMode === 'hybrid',
      });

      pages = await mcpExplorer.explore(url);
    } else {
      // Use traditional Vision-based exploration
      if (!engine) {
        throw new Error('AutomationEngine not initialized');
      }
      pages = await engine.exploreWebsite(url);
    }

    await updateProgress('exploring', `Explored ${pages.length} page(s)`, { pagesVisited: pages.length, explorationMode });

    // NOTE: Keep console capture active through test execution so hybrid executor logs are captured
    // Console will be restored after all tests complete

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
    
    const siteContext: SiteContext = {
      architecture: initialReport.architecture,
      risks: initialReport.risks,
      fullReport: fullReportContent,
    };

    // Load context file if available (optional enhancement)
    // Try port-specific context first (e.g., localhost-3000.json), then fall back to domain-only (e.g., localhost.json)
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    const port = urlObj.port;

    // Try port-specific context first (for localhost development)
    let contextPath = port
      ? join(process.cwd(), 'context', `${domain}-${port}.json`)
      : join(process.cwd(), 'context', `${domain}.json`);

    // If port-specific doesn't exist, try domain-only
    if (port && !existsSync(contextPath)) {
      const domainOnlyPath = join(process.cwd(), 'context', `${domain}.json`);
      if (existsSync(domainOnlyPath)) {
        contextPath = domainOnlyPath;
        console.log(`ℹ️  [TestRunner] Port-specific context not found, using domain context: ${domainOnlyPath}`);
      }
    }

    if (existsSync(contextPath)) {
      try {
        const contextContent = await readFile(contextPath, 'utf-8');
        const contextFile: ContextFileConfig = JSON.parse(contextContent);

        // Merge context file data into siteContext (like CLI does)
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
        console.log(`✅ [TestRunner] Context file loaded: ${contextPath}`);
        // Log credentials location for debugging
        const credsLocation = contextFile.credentials ? 'credentials' :
                              contextFile.authentication?.credentials ? 'authentication.credentials' :
                              contextFile.demoCredentials ? 'demoCredentials' : 'none';
        console.log(`🔍 [TestRunner] Credentials found at: ${credsLocation}`);
      } catch (error) {
        console.error('[TestRunner] Failed to load context file:', error);
      }
    } else {
      console.log(`ℹ️  [TestRunner] No context file found. Tried: ${contextPath}${port ? ` and context/${domain}.json` : ''}`);
    }

    // Detect if exploration successfully authenticated
    // If we have pages beyond login/signin pages, exploration likely logged in
    const loginPagePatterns = ['/login', '/signin', '/sign-in', '/auth', 'cognito'];
    const authenticatedPages = pages.filter(p => {
      const urlLower = p.url.toLowerCase();
      return !loginPagePatterns.some(pattern => urlLower.includes(pattern));
    });
    const explorationAuthenticated = authenticatedPages.length > 1; // More than just the landing page

    if (explorationAuthenticated) {
      console.log(`✅ [TestRunner] Exploration authenticated - ${authenticatedPages.length} authenticated pages found`);
      siteContext.explorationAuthenticated = true;
    } else {
      console.log(`ℹ️ [TestRunner] Exploration did not authenticate or only visited public pages`);
      siteContext.explorationAuthenticated = false;
    }

    // Debug: Log what we're about to pass to test generator
    console.log('🔍 [TestRunner] About to pass siteContext with keys:', Object.keys(siteContext));
    console.log('🔍 [TestRunner] siteContext.contextFile before passing?', !!siteContext.contextFile);

    await updateProgress('generating_tests', 'Generating test cases with AI...');

    // Generate test cases with full site context
    const testCaseGenerator = new TestCaseGenerator(config, visionService);

    let results: any[] = [];
    let passCount = 0;
    let failCount = 0;

    if (explorationMode === 'hybrid') {
      // ========================================
      // HYBRID MODE: MCP exploration + Scripted execution with refs
      // Fast, cheap, self-healing with AI rescue
      // ========================================
      console.log('[TestRunner] Using HYBRID mode: MCP exploration + scripted execution');

      // Generate hybrid test cases with MCP refs
      const hybridTestCases = await testCaseGenerator.generateHybridTestCases(
        pages,
        url,
        siteContext,
        mcpExplorer?.getMCPClient()
      );

      // Save the test cases
      const testCasesContent = testCaseGenerator.formatHybridTestCases(hybridTestCases);
      const testCasesPath = join(runFolder, 'test-cases.md');
      await writeFile(testCasesPath, testCasesContent, 'utf-8');
      await updateProgress('generating_tests', `Generated ${hybridTestCases.length} hybrid test cases${!executeTests ? ' (execution skipped)' : ''}`, { testCaseCount: hybridTestCases.length });

      if (executeTests) {
        // Sort by priority and apply limit
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const sortedTests = [...hybridTestCases].sort((a, b) => {
          const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
          const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
          return aPriority - bPriority;
        });

        const testsToExecute = maxTestsToExecute > 0
          ? sortedTests.slice(0, maxTestsToExecute)
          : sortedTests;

        await updateProgress('executing', `Executing ${testsToExecute.length} tests with hybrid executor...`, {
          totalTests: testsToExecute.length,
          completedTests: 0,
          passedTests: 0,
          failedTests: 0
        });

        // Use Hybrid Executor - reuses MCP client from exploration
        const hybridExecutor = new HybridTestExecutor(
          config,
          {
            outputDir: runFolder,
            screenshotDir: screenshotsDir,
            headless,
            contextFile: siteContext.contextFile,
            enableAIRescue: true,
          },
          mcpExplorer?.getMCPClient()  // Reuse the MCP client (keeps auth session)
        );

        try {
          const hybridResults = await hybridExecutor.executeAll(testsToExecute);

          // Convert HybridTestResult to result format
          for (const result of hybridResults) {
            results.push({
              testCaseId: result.testCase.id,
              testCaseName: result.testCase.name,
              testCaseDescription: result.testCase.description,
              status: result.status,
              duration: result.duration,
              error: result.failureReason,
              steps: result.stepResults.map(sr => ({
                stepNumber: sr.step.stepNumber,
                description: sr.step.description,
                action: sr.step.action,
                status: sr.status,
                error: sr.error,
                resolvedBy: sr.resolvedBy,
                screenshot: sr.screenshot,
              })),
              verificationDetails: result.verificationResults.map(vr => ({
                what: vr.verification.description || `Verify ${vr.verification.type}: ${vr.verification.expected}`,
                expected: vr.verification.expected,
                actual: vr.actual || 'N/A',
                match: vr.passed,
                details: {
                  // Include evidence from hybrid executor for better debugging
                  contentPreview: vr.evidence,
                },
              })),
              usedAIRescue: result.usedAIRescue,
              executedAt: result.executedAt,
              evidence: result.screenshots,
            });
          }

          // Update progress with final counts
          await updateProgress('executing', `Completed ${testsToExecute.length} tests`, {
            totalTests: testsToExecute.length,
            completedTests: testsToExecute.length,
            passedTests: results.filter(r => r.status === 'passed').length,
            failedTests: results.filter(r => r.status === 'failed').length
          });

          console.log(`[TestRunner] Hybrid execution complete. AI Rescue used: ${hybridResults.filter(r => r.usedAIRescue).length} tests`);

        } finally {
          // MCP client cleanup will be handled when mcpExplorer is done
        }
      }

    } else if (explorationMode === 'mcp') {
      // ========================================
      // MCP MODE: AI-driven intent-based testing
      // ========================================
      console.log('[TestRunner] Using MCP mode: generating intent-based tests for AI-driven execution');

      // Generate intent-based test cases (planning phase - what to test)
      const intentTestCases = await testCaseGenerator.generateIntentTestCases(pages, url, siteContext);

      // Save the test plan (intents only - before execution)
      const testPlanContent = testCaseGenerator.formatIntentTestCases(intentTestCases);
      const testPlanPath = join(runFolder, 'test-plan.md');
      await writeFile(testPlanPath, testPlanContent, 'utf-8');
      await updateProgress('generating_tests', `Generated ${intentTestCases.length} intent-based test cases${!executeTests ? ' (execution skipped)' : ''}`, { testCaseCount: intentTestCases.length });

      if (executeTests) {
        // Sort by priority and apply limit
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const sortedTests = [...intentTestCases].sort((a, b) => {
          const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
          const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
          return aPriority - bPriority;
        });

        const testsToExecute = maxTestsToExecute > 0
          ? sortedTests.slice(0, maxTestsToExecute)
          : sortedTests;

        await updateProgress('executing', `Executing ${testsToExecute.length} tests with AI-driven MCP executor...`, {
          totalTests: testsToExecute.length,
          completedTests: 0,
          passedTests: 0,
          failedTests: 0
        });

        // Use MCP Test Executor for AI-driven execution
        const mcpExecutor = new MCPTestExecutor(config, {
          headless,
          screenshotDir: screenshotsDir,
          evidenceDir,
          contextFile: siteContext.contextFile,
        });

        try {
          await mcpExecutor.initialize();

          for (let i = 0; i < testsToExecute.length; i++) {
            const testCase = testsToExecute[i];
            await updateProgress('executing', `Executing test ${i + 1}/${testsToExecute.length}: ${testCase.name}`, {
              totalTests: testsToExecute.length,
              completedTests: i,
              currentTest: testCase.name,
              passedTests: results.filter(r => r.status === 'passed').length,
              failedTests: results.filter(r => r.status === 'failed').length
            });

            const result = await mcpExecutor.executeTest(testCase);

            // Convert IntentTestResult to a format compatible with existing result handling
            results.push({
              testCaseId: result.testCase.id,
              testCaseName: result.testCase.name,
              status: result.status,
              duration: result.duration,
              error: result.failureReason,
              steps: result.executionLog.map(step => ({
                stepNumber: step.stepNumber,
                description: `${step.action} ${step.target || ''} - ${step.reasoning}`,
                action: step.action,
                status: step.success ? 'passed' : 'failed',
                error: step.error,
              })),
              verifications: result.verifications,
              aiAssessment: result.aiAssessment,
              executedAt: new Date(),
            });

            await updateProgress('executing', `Completed test ${i + 1}/${testsToExecute.length}`, {
              totalTests: testsToExecute.length,
              completedTests: i + 1,
              passedTests: results.filter(r => r.status === 'passed').length,
              failedTests: results.filter(r => r.status === 'failed').length
            });
          }

          const tokenUsage = mcpExecutor.getTokenUsage();
          console.log(`[TestRunner] MCP Executor token usage: ${tokenUsage.input} input, ${tokenUsage.output} output`);

          // Generate nicely formatted test cases from execution results (post-run)
          // This shows what the AI actually did during testing
          const executedResults: IntentTestResult[] = results.map(r => ({
            testCase: intentTestCases.find(tc => tc.id === r.testCaseId) || {
              id: r.testCaseId,
              name: r.testCaseName,
              description: '',
              intent: '',
              successCriteria: [],
              priority: 'medium' as const,
              category: 'general',
            },
            status: r.status as 'passed' | 'failed' | 'blocked',
            executionLog: r.steps?.map((s: any) => ({
              stepNumber: s.stepNumber,
              action: s.action || 'unknown',
              target: s.target,
              value: s.value,
              reasoning: s.description || s.reasoning || '',
              success: s.status === 'passed',
              error: s.error,
              timestamp: new Date(),
            })) || [],
            verifications: r.verifications || [],
            aiAssessment: r.aiAssessment || '',
            screenshots: [],
            failureReason: r.error,
            duration: r.duration || 0,
          }));

          // Save the nicely formatted test cases (showing what AI actually did)
          const testCasesContent = testCaseGenerator.formatExecutedTestCases(executedResults);
          const testCasesPath = join(runFolder, 'test-cases.md');
          await writeFile(testCasesPath, testCasesContent, 'utf-8');
          console.log(`[TestRunner] Saved executed test cases to ${testCasesPath}`);

        } finally {
          await mcpExecutor.close();
        }
      }

    } else {
      // ========================================
      // VISION MODE: Traditional scripted testing
      // ========================================
      const testCases = await testCaseGenerator.generateTestCases(pages, url, siteContext);

      // Save test cases
      const testCasesContent = testCaseGenerator.formatTestCases(testCases);
      const testCasesPath = join(runFolder, 'test-cases.md');
      await writeFile(testCasesPath, testCasesContent, 'utf-8');
      await updateProgress('generating_tests', `Generated ${testCases.length} test cases${!executeTests ? ' (execution skipped)' : ''}`, { testCaseCount: testCases.length });

      if (executeTests) {
        await updateProgress('executing', `Executing ${testCases.length} test cases...`, {
          totalTests: testCases.length,
          completedTests: 0,
          passedTests: 0,
          failedTests: 0
        });

        // For test execution, we need a Playwright page
        if (!engine) {
          console.log('[TestRunner] Initializing AutomationEngine for test execution...');
          engine = new AutomationEngine(config);
          await engine.initialize(screenshotsDir);
          await engine.getPage()?.goto(url);
        }

        const page = engine?.getPage();
        if (!page) {
          throw new Error('Page not initialized');
        }

        const executor = new TestExecutor(page, evidenceDir);

        // Sort tests by priority and apply execution limit
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const sortedTests = [...testCases].sort((a, b) => {
          const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
          const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
          return aPriority - bPriority;
        });

        const testsToExecute = maxTestsToExecute > 0
          ? sortedTests.slice(0, maxTestsToExecute)
          : sortedTests;

        if (maxTestsToExecute > 0 && testCases.length > maxTestsToExecute) {
          console.log(`🎯 Executing ${testsToExecute.length}/${testCases.length} tests (limited by maxTestsToExecute=${maxTestsToExecute}, sorted by priority)`);
        }

        const totalGenerated = testCases.length;
        const totalToExecute = testsToExecute.length;

        for (let i = 0; i < testsToExecute.length; i++) {
          const testCase = testsToExecute[i];
          await updateProgress('executing', `Executing test ${i + 1}/${totalToExecute}: ${testCase.name}`, {
            totalTests: totalToExecute,
            totalGenerated: totalGenerated,
            completedTests: i,
            currentTest: testCase.name,
            passedTests: results.filter(r => r.status === 'passed').length,
            failedTests: results.filter(r => r.status === 'failed').length
          });

          const result = await executor.executeTestCase(testCase);
          results.push(result);

          await updateProgress('executing', `Completed test ${i + 1}/${totalToExecute}`, {
            totalTests: totalToExecute,
            totalGenerated: totalGenerated,
            completedTests: i + 1,
            passedTests: results.filter(r => r.status === 'passed').length,
            failedTests: results.filter(r => r.status === 'failed').length
          });
        }
      }
    }

    // Restore original console methods now that execution is complete
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    if (executeTests) {
      // Format and save results
      const resultsFormatter = new TestResultsFormatter(runFolder);
      await resultsFormatter.saveResults(results);

      // Generate final report with test results (this also formats the reasoning log)
      await outputGenerator.generateReport(pages, url, results);

      // Update progress - completed
      passCount = results.filter((r: any) => r.status === 'passed').length;
      failCount = results.filter((r: any) => r.status === 'failed').length;
      await updateProgress('completed', `Test run completed: ${passCount} passed, ${failCount} failed`, {
        testCount: results.length,
        passCount,
        failCount,
        success: failCount === 0
      });
    } else {
      // Generate final report without test results
      await outputGenerator.generateReport(pages, url, []);

      await updateProgress('completed', 'Exploration and test generation completed (execution skipped)', {
        testCount: 0,
        passCount: 0,
        failCount: 0,
        executionSkipped: true,
        success: true
      });
    }

    // Cleanup
    if (engine) {
      await engine.cleanup();
    }
    if (mcpExplorer && explorationMode === 'hybrid') {
      // Close MCP client that was kept alive for hybrid execution
      const mcpClient = mcpExplorer.getMCPClient();
      if (mcpClient) {
        await mcpClient.close();
        await mcpClient.disconnect();
      }
    }

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
