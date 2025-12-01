# Quick Start - Trial Run

## 3-Step Setup

```bash
# 1. Install everything
npm run setup

# 2. Create .env file
cp env.template .env

# 3. Add your OpenAI API key to .env
# Edit .env and replace: OPENAI_API_KEY=sk-your-api-key-here
```

## Get OpenAI API Key

1. Go to: https://platform.openai.com/api-keys
2. Sign up (free trial credits available)
3. Create new secret key
4. Copy key (starts with `sk-`)
5. Paste into `.env` file

## Run Your First Test

```bash
# See cost estimate first
npm run dev -- --url https://example.com --estimate

# Run a small trial (costs ~$0.02-0.04)
npm run dev -- --url https://example.com --max-pages 2 --max-actions 5
```

## What You Need

✅ Node.js 18+ installed  
✅ OpenAI API key  
✅ Internet connection  

That's it! The setup script installs everything else.

## Troubleshooting

**"OPENAI_API_KEY required"**  
→ Make sure `.env` file exists and has your key

**"Browser not found"**  
→ Run: `npx playwright install chromium`

**"Module not found"**  
→ Run: `npm install`

## Next Steps

- Try different websites
- Increase limits: `--max-pages 5 --max-actions 20`
- Check reports in `./output/`
- See full guide in [SETUP.md](./SETUP.md)

