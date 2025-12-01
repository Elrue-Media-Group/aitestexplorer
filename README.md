# QA Tool - AI-Powered Website Automation

An intelligent, out-of-process UI automation tool that uses AI vision to navigate and test websites without requiring pre-written test cases. The tool automatically explores websites, analyzes pages using AI vision, and generates comprehensive reports including test cases, architecture guides, suggestions, and risk assessments.

## Features

- 🤖 **AI Vision Analysis**: Uses OpenAI's vision models to understand page content and structure
- 🎯 **Smart Navigation**: Automatically discovers and navigates through websites
- 📸 **Screenshot-Based**: Uses screenshots to understand pages visually
- 📊 **Comprehensive Reports**: Generates test cases, architecture guides, suggestions, and risk assessments
- ⚙️ **Configurable Limits**: Control exploration depth with page and action limits
- 🎭 **Playwright Integration**: Built on Playwright for reliable browser automation

## Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenAI API key (for vision capabilities)

## Quick Start

For a complete setup guide, see [SETUP.md](./SETUP.md)

**Quick setup:**
```bash
# Install everything (dependencies + Playwright browsers)
npm run setup

# Create .env file from template
cp env.template .env

# Edit .env and add your OpenAI API key
# Then run a trial:
npm run dev -- --url https://example.com --max-pages 2 --max-actions 5
```

## Installation

1. **Install dependencies and Playwright browsers:**
```bash
npm run setup
```
Or manually:
```bash
npm install
npx playwright install chromium
```

2. **Set up environment variables:**
```bash
cp env.template .env
```

3. **Edit `.env` and add your OpenAI API key:**
```
OPENAI_API_KEY=sk-your-actual-api-key-here
```

Get your API key from: https://platform.openai.com/api-keys

## Usage

### Basic Usage

Run the tool with a target URL:

```bash
npm run dev -- --url https://example.com
```

### With Custom Limits

```bash
npm run dev -- --url https://example.com --max-pages 5 --max-actions 30
```

### Headless Mode

```bash
npm run dev -- --url https://example.com --headless
```

### Command Line Options

- `--url` / `-u`: Target URL to analyze (required)
- `--max-pages`: Maximum number of pages to visit (default: 10)
- `--max-actions`: Maximum number of actions to perform (default: 50)
- `--headless`: Run browser in headless mode (default: false)
- `--estimate`: Show cost estimate only without running (default: false)
- `--skip-estimate`: Skip cost estimate display (default: false)

## How It Works

1. **Initialization**: Launches a browser instance using Playwright
2. **Navigation**: Starts from the provided URL and discovers links on the page
3. **Screenshot Capture**: Takes full-page screenshots of each visited page
4. **AI Analysis**: Sends screenshots to OpenAI's vision API for analysis
5. **Action Execution**: Based on AI suggestions, performs interactions (clicks, form fills, etc.)
6. **Report Generation**: Compiles all findings into structured reports

## Output

The tool generates several output files in the `./output` directory:

- **test-cases-{timestamp}.md**: Generated test cases based on actual interactions
- **architecture-{timestamp}.md**: Site structure, navigation patterns, and technology insights
- **suggestions-{timestamp}.md**: Improvement suggestions categorized by type
- **risks-{timestamp}.md**: Identified risks and security concerns
- **full-report-{timestamp}.md**: Complete analysis report
- **report-{timestamp}.json**: Machine-readable JSON report

## Configuration

You can configure the tool via environment variables in `.env`:

- `OPENAI_API_KEY`: Your OpenAI API key (required)
- `OPENAI_MODEL`: Model to use (default: `gpt-4o`)
- `MAX_PAGES`: Default maximum pages (default: 10)
- `MAX_ACTIONS`: Default maximum actions (default: 50)
- `SCREENSHOT_DIR`: Directory for screenshots (default: `./screenshots`)
- `OUTPUT_DIR`: Directory for output files (default: `./output`)

## Architecture

```
src/
├── index.ts              # Main entry point and CLI
├── config.ts             # Configuration management
├── types.ts              # TypeScript type definitions
├── automation-engine.ts  # Core automation logic with Playwright
├── ai-vision.ts          # AI vision service integration
└── output-generator.ts   # Report generation
```

## Cost Estimation

The tool includes a built-in cost estimator based on OpenAI's pricing:

- **Input tokens**: $10.00 per 1 million tokens
- **Output tokens**: $30.00 per 1 million tokens
- **Image tokens**: Based on resolution (high detail ~$0.00255 per 512x512 tile)

### View Cost Estimates

**Before running:**
```bash
npm run dev -- --url https://example.com --estimate
```

**Standalone calculator:**
```bash
npm run cost -- --pages 10 --actions 50
```

**Quick estimates:**
```bash
npm run cost -- --quick
```

**Example costs** (approximate):
- 1 page, 5 actions: ~$0.01-0.02
- 5 pages, 20 actions: ~$0.05-0.10
- 10 pages, 50 actions: ~$0.10-0.20
- 20 pages, 100 actions: ~$0.20-0.40

*Note: Actual costs vary based on screenshot dimensions, response length, and current OpenAI pricing.*

## Limitations

- Requires OpenAI API access (paid service)
- AI vision analysis may have rate limits
- Complex dynamic sites may require more sophisticated interaction logic
- Some sites may block automated browsers

## Future Enhancements

- Support for multiple AI providers
- More sophisticated action selection algorithms
- Better element detection and interaction
- Support for authentication flows
- Integration with test frameworks
- Real-time progress visualization

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

