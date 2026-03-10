# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Design Philosophy

**AI-First**: The tool should work on ANY website without hardcoding site-specific logic. AI vision analyzes pages, understands context, and makes decisions. No hardcoded selectors, loading patterns, or site-specific rules.

**Context Files are Optional Enhancement**: The tool works out of the box. Optional context files (`context/{domain}.json`) help the AI perform better on complex sites by providing credentials, testing guidance, and important test scenarios. They guide the AI - they don't replace it.

## Build and Run Commands

```bash
# Initial setup (one-time)
npm run setup                    # Install deps + Playwright chromium

# Development
npm run dev -- --url <URL>       # Run CLI in dev mode
npm run server                   # Start API server (tsx, port 3001)
npm run ui:dev                   # Start React UI (Vite, port 3004)

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

AI-powered website testing tool with a 4-phase pipeline:

```
URL → Exploration → Test Generation → Test Execution → Reporting
```

### Entry Points

Two independent entry points share the same core components:
- **CLI** (`src/index.ts`) - Command-line interface using yargs
- **Server** (`src/server.ts`) - Express API + React UI

Both use `src/test-runner.ts` as the shared orchestrator.

### Two Exploration Paths (IMPORTANT)

The tool has TWO independent exploration engines. When modifying exploration behavior, **you must update both**:

| Mode | Explorer | Executor | When Used |
|------|----------|----------|-----------|
| **Hybrid (default)** | `src/mcp-explorer.ts` | `src/hybrid-executor.ts` | Default for all runs via server/UI |
| **Traditional** | `src/automation-engine.ts` | `src/test-executor.ts` | Fallback, used when MCP is unavailable |

The `test-runner.ts` orchestrator decides which path based on the `explorationMode` config (defaults to `hybrid`).

### Core Components

| Component | File | Role |
|-----------|------|------|
| **TestRunner** | `src/test-runner.ts` | Orchestrator - coordinates all phases, selects exploration mode |
| **MCPExplorer** | `src/mcp-explorer.ts` | **Primary explorer** - MCP + AI Vision page analysis |
| **MCPClient** | `src/mcp-client.ts` | Playwright MCP server wrapper (navigate, click, snapshot, screenshot) |
| **HybridExecutor** | `src/hybrid-executor.ts` | **Primary executor** - runs test steps via MCP with AI element resolution |
| **AutomationEngine** | `src/automation-engine.ts` | Traditional explorer - direct Playwright control (fallback) |
| **AIVisionService** | `src/ai-vision.ts` | OpenAI Vision API - page analysis, loading detection, action interpretation |
| **TestCaseGenerator** | `src/test-case-generator.ts` | AI generates test cases from exploration data |
| **TestExecutor** | `src/test-executor.ts` | Traditional executor - runs test steps via Playwright (fallback) |
| **OutputGenerator** | `src/output-generator.ts` | Generates markdown reports |

### Data Flow (Hybrid Mode)

1. **Exploration** (`mcp-explorer.ts`): MCPClient navigates pages, AI Vision analyzes screenshots + accessibility trees, AI suggests and executes actions
2. **Loading Detection**: AI Vision checks if pages are fully loaded before capturing (handles SPAs with loading states)
3. **Generation** (`test-case-generator.ts`): AI generates test cases from exploration data, observed action flows, and context file guidance
4. **Execution** (`hybrid-executor.ts`): Runs test steps via MCP, resolves elements using text-based matching with AI rescue fallback
5. **Reporting**: Results saved to `output/run-{timestamp}/`

### Element Resolution Strategy (hybrid-executor.ts)

Tests don't rely on stored MCP refs (they're ephemeral). Instead, resolution is tiered:
1. **Exact text + type match** - Find element by text content and role
2. **Partial text match** - Substring matching with type preference
3. **Description keyword matching** - Extract keywords from step description
4. **Type-based search** - Find by element role only
5. **AI rescue** - Send screenshot to AI to locate element

### MCP Architecture

MCP (Model Context Protocol) provides browser automation via `@playwright/mcp`:
- **Refs are ephemeral** - MCP element refs (e.g., `e42`) are tied to a specific DOM state. They become invalid after any page change, navigation, or DOM mutation.
- **Accessibility tree** - MCP provides YAML-format accessibility snapshots with element refs, types, and text
- **Isolated mode** - Default `--isolated` flag for fresh browser sessions (no cached login state)

## Key Patterns

### Context Files

Optional JSON files in `context/{domain}.json` provide site-specific configuration:
- `authentication.credentials` - Login credentials (username/password)
- `testingGuidance` - String or object with testing focus areas
- `importantTests` - Array of test scenarios to guide (not dictate) AI generation
- `sitePurpose`, `siteDescription` - Help AI understand what to test
- `keyPages` - Important pages to prioritize

### Test Generation Rules

- Tests must perform real actions (no placeholder/gap tests)
- Max 3 navigation-only tests
- Priority: CRUD operations > Workflows > Forms > Navigation
- Test data uses descriptive names: "Test [Thing] - Automation"
- AI uses observed action flows from exploration to build accurate verification steps

### Output Structure

```
output/run-{ISO-timestamp}/
├── screenshots/      # Page exploration screenshots + failure evidence
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
- **Any change to exploration or execution must check BOTH paths** (MCP hybrid + traditional)
- AI loading detection uses `visionService.isPageLoaded()` - no hardcoded patterns
- Credentials can be at `contextFile.credentials` OR `contextFile.authentication.credentials` - code checks both
