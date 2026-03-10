/**
 * MCP Executor Test Script
 *
 * Tests the AI-driven test execution with intent-based tests.
 *
 * Usage: npx tsx src/mcp-executor-test.ts
 */

import { MCPTestExecutor } from './mcp-test-executor.js';
import { loadConfig } from './config.js';
import { IntentTestCase } from './types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

async function loadContextFile(): Promise<any> {
  const contextPath = join(process.cwd(), 'context', 'localhost-4002.json');
  if (existsSync(contextPath)) {
    const content = await readFile(contextPath, 'utf-8');
    return JSON.parse(content);
  }
  return null;
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           MCP Test Executor - Proof of Concept             ║
╠════════════════════════════════════════════════════════════╣
║  AI-driven test execution with intent-based tests          ║
╚════════════════════════════════════════════════════════════╝
`);

  const config = loadConfig();
  const contextFile = await loadContextFile();

  // Create output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(process.cwd(), 'output', `mcp-exec-test-${timestamp}`);

  // Create executor
  const executor = new MCPTestExecutor(config, {
    headless: false,
    screenshotDir: join(outputDir, 'screenshots'),
    evidenceDir: join(outputDir, 'evidence'),
    contextFile,
  });

  // Define some intent-based tests
  const testCases: IntentTestCase[] = [
    {
      id: 'TC-001',
      name: 'User can log in and reach dashboard',
      description: 'Verify the login flow works end-to-end',
      intent: 'Log in with valid credentials and verify the dashboard is displayed',
      successCriteria: [
        'User is on the dashboard page',
        'URL contains /dashboard',
        'Dashboard content is visible',
      ],
      preconditions: [],
      startingPoint: '/',
      priority: 'high',
      category: 'authentication',
    },
    {
      id: 'TC-002',
      name: 'User can navigate to Ideas section',
      description: 'Verify navigation to Ideas from dashboard',
      intent: 'From the dashboard, navigate to the Ideas section',
      successCriteria: [
        'User is on the Ideas page',
        'URL contains /ideas',
        'Ideas inbox is visible',
      ],
      preconditions: ['authenticated'],
      startingPoint: '/dashboard',
      priority: 'high',
      category: 'navigation',
    },
    {
      id: 'TC-003',
      name: 'User can create a new project',
      description: 'Verify project creation flow',
      intent: 'Navigate to Projects, create a new project named "Test Project", and verify it was created',
      successCriteria: [
        'Project creation form is accessible',
        'Can enter project name',
        'Project is saved or form validation works correctly',
      ],
      preconditions: ['authenticated'],
      startingPoint: '/dashboard',
      priority: 'high',
      category: 'core-functionality',
    },
  ];

  try {
    await executor.initialize();

    // Run only the first test for now as a proof of concept
    console.log('\n🧪 Running proof-of-concept with first test...\n');
    const result = await executor.executeTest(testCases[0]);

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULT');
    console.log('='.repeat(60));
    console.log(`Test: ${result.testCase.name}`);
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Steps executed: ${result.executionLog.length}`);
    console.log(`\nExecution Log:`);
    for (const step of result.executionLog) {
      console.log(`  ${step.stepNumber}. ${step.action} ${step.target || ''} - ${step.success ? '✅' : '❌'}`);
    }
    console.log(`\nVerifications:`);
    for (const v of result.verifications) {
      console.log(`  ${v.passed ? '✅' : '❌'} ${v.criterion}`);
      console.log(`     Evidence: ${v.evidence}`);
    }
    console.log(`\nAI Assessment: ${result.aiAssessment}`);

    const tokens = executor.getTokenUsage();
    console.log(`\nToken Usage: ${tokens.input} input, ${tokens.output} output`);
    console.log(`Estimated Cost: $${((tokens.input * 2.5 + tokens.output * 10) / 1000000).toFixed(4)}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await executor.close();
  }
}

main().catch(console.error);
