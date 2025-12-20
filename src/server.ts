#!/usr/bin/env node

/**
 * Express API Server
 * 
 * Provides REST API endpoints for:
 * - Running test analyses
 * - Viewing test results
 * - Managing context files
 * - Serving the React UI
 * 
 * Runs on port 3000 by default (configurable via PORT env var)
 */

import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { runTestAnalysis } from './test-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve UI static files (after build)
const uiDistPath = join(__dirname, '../ui/dist');
if (existsSync(uiDistPath)) {
  app.use(express.static(uiDistPath));
} else {
  // In development, serve from ui directory
  app.use(express.static(join(__dirname, '../ui')));
}

// API Routes

// Health check
app.get('/api/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Run test analysis
app.post('/api/run-test', async (req: express.Request, res: express.Response) => {
  try {
    const { url, maxPages = 10, maxActions = 50, headless = false } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Run test asynchronously
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    
    console.log(`[API] Starting test run: ${runId} for URL: ${url}`);
    
    // Start test run in background
    runTestAnalysis(url, maxPages, maxActions, headless, runId)
      .then((result) => {
        console.log(`[API] Test run ${runId} completed:`, result);
      })
      .catch((error) => {
        console.error(`[API] Test run ${runId} failed:`, error);
        console.error(`[API] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
      });

    res.json({ 
      success: true, 
      runId,
      message: 'Test analysis started',
      status: 'running'
    });
  } catch (error) {
    console.error('Error starting test:', error);
    res.status(500).json({ 
      error: 'Failed to start test analysis',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get test run status and progress
app.get('/api/runs/:runId/status', async (req: express.Request, res: express.Response) => {
  try {
    const { runId } = req.params;
    const outputDir = join(__dirname, '../output', runId);
    
    if (!existsSync(outputDir)) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Check if test-results.md exists (test completed)
    const resultsPath = join(outputDir, 'test-results.md');
    const isComplete = existsSync(resultsPath);
    
    // Read progress if available
    let progress = null;
    const progressPath = join(outputDir, 'progress.json');
    if (existsSync(progressPath)) {
      try {
        const progressData = await readFile(progressPath, 'utf-8');
        progress = JSON.parse(progressData);
      } catch {
        // Ignore parse errors
      }
    }

    // Read log file if available
    let logs = '';
    const logPath = join(outputDir, 'run.log');
    if (existsSync(logPath)) {
      try {
        logs = await readFile(logPath, 'utf-8');
      } catch {
        // Ignore read errors
      }
    }

    res.json({
      runId,
      status: isComplete ? 'completed' : (progress?.stage === 'completed' ? 'completed' : 'running'),
      progress,
      logs: logs.split('\n').filter(line => line.trim().length > 0)
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get run status',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// List all test runs
app.get('/api/runs', async (req: express.Request, res: express.Response) => {
  try {
    const outputDir = join(__dirname, '../output');
    
    if (!existsSync(outputDir)) {
      return res.json([]);
    }

    const runs = await readdir(outputDir, { withFileTypes: true });
    const runList = await Promise.all(
      runs
        .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('run-'))
        .map(async (dirent) => {
          const runId = dirent.name;
          const runDir = join(outputDir, runId);
          const resultsPath = join(runDir, 'test-results.md');
          const isComplete = existsSync(resultsPath);
          
          // Try to read basic info
          let testCount = 0;
          let passCount = 0;
          let failCount = 0;
          
          if (isComplete) {
            try {
              const resultsContent = await readFile(resultsPath, 'utf-8');
              const totalMatch = resultsContent.match(/Total Tests.*?(\d+)/);
              const passedMatch = resultsContent.match(/✅ Passed.*?(\d+)/);
              const failedMatch = resultsContent.match(/❌ Failed.*?(\d+)/);
              
              testCount = totalMatch ? parseInt(totalMatch[1]) : 0;
              passCount = passedMatch ? parseInt(passedMatch[1]) : 0;
              failCount = failedMatch ? parseInt(failedMatch[1]) : 0;
            } catch {
              // Ignore errors
            }
          }

          return {
            runId,
            status: isComplete ? 'completed' : 'running',
            createdAt: runId.replace('run-', '').replace(/-/g, ':').slice(0, -1),
            testCount,
            passCount,
            failCount
          };
        })
    );

    // Sort by creation time (newest first)
    runList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json(runList);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to list runs',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get test run results
app.get('/api/runs/:runId', async (req: express.Request, res: express.Response) => {
  try {
    const { runId } = req.params;
    const outputDir = join(__dirname, '../output', runId);
    
    if (!existsSync(outputDir)) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Read all result files
    const results: Record<string, string> = {};
    
    const files = ['test-cases.md', 'test-results.md', 'site-analysis.md', 'ai-reasoning.md'];
    for (const file of files) {
      const filePath = join(outputDir, file);
      if (existsSync(filePath)) {
        try {
          results[file] = await readFile(filePath, 'utf-8');
        } catch {
          // Ignore read errors
        }
      }
    }

    // List screenshots
    const screenshotsDir = join(outputDir, 'screenshots');
    let screenshots: string[] = [];
    if (existsSync(screenshotsDir)) {
      try {
        const files = await readdir(screenshotsDir);
        screenshots = files.filter(f => f.endsWith('.png')).map(f => `/api/runs/${runId}/screenshots/${f}`);
      } catch {
        // Ignore errors
      }
    }

    res.json({
      runId,
      results,
      screenshots
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get run results',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Serve screenshots
app.get('/api/runs/:runId/screenshots/:filename', async (req: express.Request, res: express.Response) => {
  try {
    const { runId, filename } = req.params;
    const screenshotPath = join(__dirname, '../output', runId, 'screenshots', filename);

    if (!existsSync(screenshotPath)) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    res.sendFile(screenshotPath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

// Serve evidence files (failure screenshots, etc.)
app.get('/api/runs/:runId/evidence/:filename', async (req: express.Request, res: express.Response) => {
  try {
    const { runId, filename } = req.params;
    const evidencePath = join(__dirname, '../output', runId, 'evidence', filename);

    if (!existsSync(evidencePath)) {
      return res.status(404).json({ error: 'Evidence file not found' });
    }

    res.sendFile(evidencePath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve evidence file' });
  }
});

// List context files
app.get('/api/context', async (req: express.Request, res: express.Response) => {
  try {
    const contextDir = join(__dirname, '../context');
    
    if (!existsSync(contextDir)) {
      return res.json([]);
    }

    const files = await readdir(contextDir);
    const contextFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        domain: f.replace('.json', ''),
        filename: f
      }));

    res.json(contextFiles);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to list context files',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get context file
app.get('/api/context/:domain', async (req: express.Request, res: express.Response) => {
  try {
    const { domain } = req.params;
    const contextPath = join(__dirname, '../context', `${domain}.json`);
    
    if (!existsSync(contextPath)) {
      return res.status(404).json({ error: 'Context file not found' });
    }

    const content = await readFile(contextPath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to read context file',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Save context file
app.put('/api/context/:domain', async (req: express.Request, res: express.Response) => {
  try {
    const { domain } = req.params;
    const contextDir = join(__dirname, '../context');
    const contextPath = join(contextDir, `${domain}.json`);

    // Ensure context directory exists
    if (!existsSync(contextDir)) {
      await mkdir(contextDir, { recursive: true });
    }

    // Validate JSON
    const content = JSON.stringify(req.body, null, 2);
    
    await writeFile(contextPath, content, 'utf-8');
    
    res.json({ success: true, message: 'Context file saved' });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to save context file',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Delete context file
app.delete('/api/context/:domain', async (req: express.Request, res: express.Response) => {
  try {
    const { domain } = req.params;
    const contextPath = join(__dirname, '../context', `${domain}.json`);
    
    if (!existsSync(contextPath)) {
      return res.status(404).json({ error: 'Context file not found' });
    }

    const { unlink } = await import('fs/promises');
    await unlink(contextPath);
    
    res.json({ success: true, message: 'Context file deleted' });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to delete context file',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
});

