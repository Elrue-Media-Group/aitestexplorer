# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
# Initial setup (one-time)
npm run setup                    # Install deps + Playwright chromium

# Development
npm run dev -- --url <URL>       # Run CLI in dev mode
npm run server                   # Start API server (tsx, port 3001)
npm run ui:dev                   # Start React UI (Vite, port 5173)

# Production
npm run build                    # Compile TypeScript to dist/
npm run start -- --url <URL>     # Run compiled CLI
npm run server:prod              # Run compiled server
npm run ui:build                 # Build React UI to ui/dist/

# Utilities
npm run cost                     # Run cost estimator standalone
```

**CLI Options:** `--url`, `--max-pages`, `--max-actions`, `--headless`

## Architecture Overview

This is an AI-powered website testing tool with a 4-phase pipeline:

```
URL → Exploration → Test Generation → Test Execution → Reporting
```

### Entry Points

Two independent entry points share the same core components:
- **CLI** (`src/index.ts`) - Command-line interface using yargs
- **Server** (`src/server.ts`) - Express API + React UI

Both use `src/test-runner.ts` as the shared orchestrator.

### Core Components

| Component | File | Role |
|-----------|------|------|
| AutomationEngine | `src/automation-engine.ts` | Playwright browser control, page exploration, screenshots |
| AIVisionService | `src/ai-vision.ts` | Claude Vision API integration for page analysis |
| TestCaseGenerator | `src/test-case-generator.ts` | Converts exploration data to executable test cases |
| TestExecutor | `src/test-executor.ts` | Runs test steps with self-healing element resolution |
| OutputGenerator | `src/output-generator.ts` | Generates markdown reports |

### Data Flow

1. **Exploration**: AutomationEngine visits pages, takes screenshots, AIVisionService analyzes each page
2. **Generation**: TestCaseGenerator sends all screenshots to Claude to create test cases
3. **Execution**: TestExecutor runs each test case step using Playwright
4. **Reporting**: Results saved to `output/run-{timestamp}/` as markdown files

### Element Type Hint System

Test steps use prefixes to guide element resolution:
- `button:Sign In` - Prioritize button elements
- `link:Home` - Prioritize anchor elements
- `input:username` - Prioritize input fields

The executor tries multiple selector strategies as fallback.

## Key Patterns

### Context Files

Optional JSON files in `context/{domain}.json` provide site-specific configuration:
- Credentials for login
- Testing guidance for the AI
- `importantTests` array to guide test case generation

### Output Structure

```
output/run-{ISO-timestamp}/
├── screenshots/      # Page exploration screenshots
├── evidence/         # Failure screenshots
├── test-cases.md     # Generated test cases (TC-001, TC-002...)
├── test-results.md   # Execution results
├── site-analysis.md  # Architecture analysis
├── progress.json     # Real-time progress (for UI polling)
└── run.log          # Execution log
```

### API Endpoints

- `POST /api/run-test` - Start async test run, returns `{ runId }`
- `GET /api/runs/:runId/status` - Poll for progress
- `GET /api/runs/:runId` - Get complete results
- `GET /api/runs` - List all runs

## Configuration

Required: `OPENAI_API_KEY` in `.env`

Optional env vars: `OPENAI_MODEL` (default: gpt-4o), `MAX_PAGES` (10), `MAX_ACTIONS` (50), `MAX_TESTS_TO_EXECUTE` (0=all), `HEADLESS` (false)

## Important Implementation Notes

- Server runs test analysis asynchronously - returns runId immediately, polls via `/status`
- The tool uses ES modules (`"type": "module"` in package.json)
- UI is a separate npm project in `ui/` with its own package.json
- Test case numbering: TC-001, TC-002, etc.
- Run IDs: `run-{ISO-timestamp-with-dashes}`
