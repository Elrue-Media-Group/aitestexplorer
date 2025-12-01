# Setup Guide for Trial Run

Follow these steps to get the tool running for a trial:

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Install Playwright Browsers

Playwright needs to download browser binaries. Run:

```bash
npx playwright install chromium
```

Or install all browsers:
```bash
npx playwright install
```

## Step 3: Set Up Environment Variables

1. Copy the template file:
```bash
cp env.template .env
```

2. Edit `.env` and add your OpenAI API key:
```env
OPENAI_API_KEY=sk-your-actual-api-key-here
```

### Getting an OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Sign up or log in to your account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Paste it into your `.env` file

**Note**: New OpenAI accounts often get free trial credits ($5-18 worth) that you can use for testing.

## Step 4: Verify Setup

Test the cost calculator (doesn't require API key):
```bash
npm run cost -- --quick
```

## Step 5: Run a Trial

Start with a small test to minimize costs:

```bash
# Estimate cost first
npm run dev -- --url https://example.com --estimate

# Run with minimal limits for trial
npm run dev -- --url https://example.com --max-pages 2 --max-actions 5
```

## Recommended Trial Settings

For your first trial run, use conservative limits:

```bash
npm run dev -- --url https://example.com --max-pages 2 --max-actions 5 --headless
```

This will:
- Visit only 2 pages
- Perform only 5 actions
- Run in headless mode (faster)
- Cost approximately **$0.02-0.04**

## Troubleshooting

### "OPENAI_API_KEY environment variable is required"
- Make sure you created `.env` file (not `.env.example`)
- Check that your API key is on a single line without quotes
- Restart your terminal after creating `.env`

### "Browser not found" or Playwright errors
- Run: `npx playwright install chromium`
- Make sure you have internet connection for first run

### "Module not found" errors
- Run: `npm install`
- Make sure you're in the project directory

### API Rate Limits
- OpenAI has rate limits on new accounts
- Start with small limits (2-3 pages)
- Wait a few seconds between runs if needed

## Next Steps

Once your trial works:
1. Increase limits gradually: `--max-pages 5 --max-actions 20`
2. Try different websites
3. Review the generated reports in `./output/`
4. Check screenshots in `./screenshots/`

## Cost Management

- Always use `--estimate` flag first to see costs
- Start with small `--max-pages` values
- Monitor your OpenAI usage at https://platform.openai.com/usage
- Set up billing alerts in OpenAI dashboard

