/**
 * Automation Engine
 * 
 * Handles website exploration using Playwright, including:
 * - Navigation and page discovery
 * - Screenshot capture
 * - AI-powered page analysis
 * - Interactive element discovery
 * - Action execution (clicks, form fills, etc.)
 */

import { Browser, Page, chromium } from 'playwright';
import { Config, PageState, Action, VisionAnalysis } from './types.js';
import { AIVisionService } from './ai-vision.js';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export class AutomationEngine {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: Config;
  private visionService: AIVisionService;
  private pagesVisited: Map<string, PageState> = new Map();
  private actionCount = 0;
  private visitedUrls = new Set<string>();
  private startDomain: string = '';
  private runScreenshotDir: string = '';
  private navigationGuardActive = false;
  private lastNavigationTime = 0;

  constructor(config: Config) {
    this.config = config;
    this.visionService = new AIVisionService(config);
  }

  /**
   * Set the run-specific screenshot directory
   */
  setRunScreenshotDir(dir: string): void {
    this.runScreenshotDir = dir;
  }

  async initialize(runScreenshotDir?: string): Promise<void> {
    // Use run-specific screenshot dir if provided, otherwise use default
    const screenshotDir = runScreenshotDir || this.config.screenshotDir;
    this.runScreenshotDir = screenshotDir;
    
    // Ensure directories exist
    if (!existsSync(screenshotDir)) {
      await mkdir(screenshotDir, { recursive: true });
    }
    if (!existsSync(this.config.outputDir)) {
      await mkdir(this.config.outputDir, { recursive: true });
    }

    this.browser = await chromium.launch({
      headless: this.config.headless ?? false,
    });
    this.page = await this.browser.newPage();
    
    // Set a reasonable viewport
    await this.page.setViewportSize({ width: 1920, height: 1080 });
  }

  async exploreWebsite(startUrl: string): Promise<PageState[]> {
    if (!this.page) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }

    // Reset state for new exploration (CRITICAL: ensures clean state for each run)
    console.log(`🔄 Resetting exploration state: actionCount=${this.actionCount} -> 0, visitedUrls=${this.visitedUrls.size} -> 0`);
    this.actionCount = 0;
    this.visitedUrls.clear();
    this.pagesVisited.clear();
    this.navigationGuardActive = false;
    this.lastNavigationTime = 0;

    // Store the starting domain to filter external links
    try {
      this.startDomain = new URL(startUrl).hostname;
      console.log(`🌐 Starting domain set to: ${this.startDomain}`);
    } catch {
      throw new Error(`Invalid start URL: ${startUrl}`);
    }

    // Set up navigation guard to prevent leaving the domain
    // Only intercept document/navigation requests, allow all other requests
    this.page.route('**/*', async (route, request) => {
      const url = request.url();
      const resourceType = request.resourceType();
      const method = request.method();
      
      // Always allow non-GET requests (POST, PUT, etc. - usually API calls)
      if (method !== 'GET') {
        await route.continue();
        return;
      }
      
      // Always allow resource requests (images, CSS, JS, fonts, analytics, etc.)
      // This includes Google Analytics, tracking scripts, and all third-party resources
      const resourceTypes = ['image', 'stylesheet', 'script', 'font', 'media', 'websocket', 'manifest', 'xhr', 'fetch', 'other'];
      if (resourceTypes.includes(resourceType)) {
        await route.continue();
        return;
      }
      
      // Only block document/navigation requests to external domains
      if (resourceType === 'document') {
        try {
          const requestDomain = new URL(url).hostname;
          // Normalize domains (remove www. prefix for comparison)
          const normalizedRequestDomain = requestDomain.replace(/^www\./, '');
          const normalizedStartDomain = this.startDomain.replace(/^www\./, '');
          
          if (normalizedRequestDomain === normalizedStartDomain) {
            await route.continue();
          } else {
            // Block external domain navigations
            console.log(`🚫 Blocked external navigation to: ${url}`);
            await route.abort();
          }
        } catch (error) {
          // If URL parsing fails, allow it (might be a data URL, blob, or similar)
          // Better to allow than block and break the page
          await route.continue();
        }
      } else {
        // Allow all non-document requests (API calls, analytics, etc.)
        await route.continue();
      }
    });

    // Also add a navigation event listener as a backup
    // Add guard to prevent infinite retry loops
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page!.mainFrame() && !this.navigationGuardActive) {
        const currentUrl = frame.url();
        const now = Date.now();
        
        // Prevent rapid-fire navigation attempts (rate limiting)
        if (now - this.lastNavigationTime < 1000) {
          return; // Ignore if navigation happened less than 1 second ago
        }
        
        try {
          const currentDomain = new URL(currentUrl).hostname;
          const normalizedCurrentDomain = currentDomain.replace(/^www\./, '');
          const normalizedStartDomain = this.startDomain.replace(/^www\./, '');
          
          if (normalizedCurrentDomain !== normalizedStartDomain) {
            console.log(`🚫 Detected navigation to external domain: ${currentDomain}, navigating back...`);
            this.navigationGuardActive = true;
            this.lastNavigationTime = now;
            
            try {
              // Navigate back to the last visited same-domain URL
              const sameDomainUrls = Array.from(this.visitedUrls).filter(url => {
                try {
                  const urlDomain = new URL(url).hostname.replace(/^www\./, '');
                  return urlDomain === normalizedStartDomain;
                } catch {
                  return false;
                }
              });
              
              if (sameDomainUrls.length > 0) {
                await this.page!.goto(sameDomainUrls[sameDomainUrls.length - 1], { 
                  waitUntil: 'domcontentloaded', 
                  timeout: 10000 
                });
              } else {
                await this.page!.goto(startUrl, { 
                  waitUntil: 'domcontentloaded', 
                  timeout: 10000 
                });
              }
            } catch (navError) {
              console.error(`⚠️  Failed to navigate back: ${navError instanceof Error ? navError.message : String(navError)}`);
              // Don't retry - break the loop
            } finally {
              // Reset guard after a delay to allow navigation to complete
              setTimeout(() => {
                this.navigationGuardActive = false;
              }, 2000);
            }
          }
        } catch {
          // If URL parsing fails, ignore - don't trigger navigation
        }
      }
    });

    const pages: PageState[] = [];
    const urlsToVisit = [startUrl];
    this.visitedUrls.add(this.normalizeUrl(startUrl));

    console.log(`\n🔍 Starting exploration: maxPages=${this.config.maxPages}, maxActions=${this.config.maxActions}`);
    // Note: maxActions limits actions per page, not total exploration
    // Continue exploring pages until maxPages is reached, but limit actions per page to maxActions
    while (urlsToVisit.length > 0 && pages.length < this.config.maxPages) {
      console.log(`\n🔍 Loop iteration: urlsToVisit=${urlsToVisit.length}, pages=${pages.length}, actionCount=${this.actionCount}`);
      const currentUrl = urlsToVisit.shift()!;
      
      try {
        console.log(`\n🌐 Navigating to: ${currentUrl}`);
        this.navigationGuardActive = true; // Prevent framenavigated listener from interfering
        
        let navigationSuccess = false;
        // Use 'load' instead of 'networkidle' to avoid issues with analytics scripts
        // 'load' waits for the load event, which is sufficient for most pages
        try {
          await this.page.goto(currentUrl, { waitUntil: 'load', timeout: 60000 });
          navigationSuccess = true;
        } catch (loadError) {
          // If 'load' times out, try 'domcontentloaded' which is more lenient
          console.log(`⚠️  Load event timeout, trying domcontentloaded...`);
          try {
            await this.page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            navigationSuccess = true;
          } catch (domError) {
            // Last resort: just wait for navigation
            console.log(`⚠️  Using commit navigation strategy...`);
            try {
              await this.page.goto(currentUrl, { waitUntil: 'commit', timeout: 30000 });
              navigationSuccess = true;
            } catch (commitError) {
              // If all navigation strategies fail, skip this URL
              console.error(`❌ Failed to load ${currentUrl} after all retry strategies`);
              console.error(`   Error: ${commitError instanceof Error ? commitError.message : String(commitError)}`);
              this.navigationGuardActive = false;
              continue; // Skip to next URL instead of retrying
            }
          }
        }
        
        if (!navigationSuccess) {
          this.navigationGuardActive = false;
          continue; // Skip this URL
        }
        
        // Give a bit more time for dynamic content and analytics to initialize
        await this.page.waitForTimeout(3000);
        this.navigationGuardActive = false; // Re-enable navigation guard

        try {
          const urlBeforeAnalysis = this.page.url();
          const pageState = await this.analyzeAndInteract(currentUrl);
          pages.push(pageState);
          console.log(`✅ Successfully analyzed page: ${currentUrl} (${pages.length} total pages)`);

          // Check if URL changed after analysis (e.g., successful login)
          const urlAfterAnalysis = this.page.url();
          let postLoginUrl: string | null = null;
          
          // Check if login succeeded but URL didn't change (SPA behavior)
          const lastPageState = pages[pages.length - 1];
          const loginSucceeded = (lastPageState as any)?.loginSucceeded === true;
          const isPostLogin = (lastPageState as any)?.isPostLogin === true;
          
          if (loginSucceeded && isPostLogin && urlAfterAnalysis === currentUrl) {
            // Login succeeded but URL didn't change - we need to analyze the post-login content
            console.log(`🆕 Login succeeded but URL unchanged (SPA) - analyzing post-login content...`);
            console.log(`   Current URL: ${urlAfterAnalysis}`);
            console.log(`   Immediately analyzing post-login page content...`);
            
            try {
              // Wait for page to stabilize after login
              await this.page.waitForTimeout(2000);
              
              // Create a unique identifier for the post-login state (same URL but different content)
              // Use a special prefix that won't be normalized away
              const postLoginUrlIdentifier = `POST_LOGIN:${urlAfterAnalysis}`;
              
              // Check if we've already analyzed this post-login state
              // Use the identifier directly (not normalized) to preserve uniqueness
              if (!this.visitedUrls.has(postLoginUrlIdentifier)) {
                console.log(`   Analyzing post-login page (identifier: ${postLoginUrlIdentifier})...`);
                console.log(`   🔓 Passing explicit post-login flag to AI analysis`);
                
                // Analyze the post-login page with explicit post-login flag
                const postLoginPageState = await this.analyzeAndInteract(urlAfterAnalysis, true);
                // Mark it as post-login
                (postLoginPageState as any).isPostLogin = true;
                (postLoginPageState as any).postLoginState = true;
                // Use the post-login identifier as the URL to distinguish it from the login page
                postLoginPageState.url = postLoginUrlIdentifier;
                
                pages.push(postLoginPageState);
                console.log(`✅ Successfully analyzed post-login page: ${postLoginUrlIdentifier} (${pages.length} total pages)`);
                
                // Mark as visited so we don't re-analyze it (use identifier directly, not normalized)
                this.visitedUrls.add(postLoginUrlIdentifier);
                postLoginUrl = urlAfterAnalysis; // Use actual URL for link extraction
              } else {
                console.log(`⏭️  Post-login state already analyzed, skipping`);
              }
            } catch (postLoginError) {
              console.error(`Error analyzing post-login page: ${postLoginError}`);
            }
          } else if (urlAfterAnalysis !== urlBeforeAnalysis && urlAfterAnalysis !== currentUrl) {
            // URL changed (traditional navigation)
            const normalizedNewUrl = this.normalizeUrl(urlAfterAnalysis);
            if (!this.visitedUrls.has(normalizedNewUrl) && this.isSameDomain(urlAfterAnalysis, startUrl)) {
              console.log(`🆕 URL changed after analysis (likely login): ${urlAfterAnalysis}`);
              console.log(`   Immediately analyzing post-login page...`);
              
              // CRITICAL: Analyze the post-login page IMMEDIATELY while authenticated
              // Don't just add it to the queue - analyze it now before session expires
              try {
                // Wait for page to stabilize after login
                await this.page.waitForTimeout(2000);
                
                // Analyze the post-login page
                const postLoginPageState = await this.analyzeAndInteract(urlAfterAnalysis);
                pages.push(postLoginPageState);
                console.log(`✅ Successfully analyzed post-login page: ${urlAfterAnalysis} (${pages.length} total pages)`);
                
                // Mark as visited so we don't re-analyze it
                this.visitedUrls.add(normalizedNewUrl);
                postLoginUrl = urlAfterAnalysis;
                
                // Make sure we're still on the post-login page for link extraction
                if (this.page.url() !== urlAfterAnalysis) {
                  // If we navigated away, go back to the post-login page
                  await this.page.goto(urlAfterAnalysis, { waitUntil: 'load', timeout: 30000 });
                  await this.page.waitForTimeout(1000);
                }
              } catch (postLoginError) {
                console.error(`Error analyzing post-login page: ${postLoginError}`);
                // If analysis fails, still add URL to queue as fallback
                urlsToVisit.push(urlAfterAnalysis);
                this.visitedUrls.add(normalizedNewUrl);
                postLoginUrl = urlAfterAnalysis;
              }
            }
          }

          // Extract new URLs from the current page
          // After login, this will extract from the post-login page (where we are now)
          // Otherwise, it extracts from the page we just analyzed
          // CRITICAL: Make sure we're on the right page (post-login if login happened)
          const pageToExtractFrom = postLoginUrl || currentUrl;
          if (this.page.url() !== pageToExtractFrom) {
            console.log(`🔄 Navigating to correct page for link extraction: ${pageToExtractFrom}`);
            await this.page.goto(pageToExtractFrom, { waitUntil: 'load', timeout: 30000 });
            await this.page.waitForTimeout(1000);
          }
          
          const links = await this.page.$$eval('a[href]', (anchors) =>
            anchors.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)
          );

          console.log(`🔍 Found ${links.length} total links on page`);
          console.log(`🔍 Current state: pages.length=${pages.length}, maxPages=${this.config.maxPages}, actionCount=${this.actionCount}, maxActions=${this.config.maxActions}`);
          console.log(`🔍 urlsToVisit.length=${urlsToVisit.length}, visitedUrls.size=${this.visitedUrls.size}`);
          console.log(`🔍 Current page URL: ${this.page.url()}`);

          let linksAdded = 0;
          for (const link of links) {
            const normalized = this.normalizeUrl(link);
            const isSameDomain = this.isSameDomain(link, startUrl);
            const isVisited = this.visitedUrls.has(normalized);
            // CRITICAL FIX: Don't count pages.length when checking wouldExceedMax - we want to explore discovered links
            // The loop condition already checks pages.length < maxPages, so we should allow links to be added
            // as long as we haven't exceeded maxPages total
            const wouldExceedMax = pages.length >= this.config.maxPages;
            
            if (!isVisited && isSameDomain && !wouldExceedMax) {
              urlsToVisit.push(link);
              this.visitedUrls.add(normalized);
              linksAdded++;
              console.log(`   ➕ Added link to queue: ${link}`);
            } else {
              if (isVisited) {
                console.log(`   ⏭️  Skipping already visited: ${link}`);
              } else if (!isSameDomain) {
                console.log(`   🚫 Skipping external link: ${link}`);
              } else if (wouldExceedMax) {
                console.log(`   ⚠️  Skipping link (would exceed maxPages): ${link}`);
              }
            }
          }
          console.log(`🔍 Added ${linksAdded} new links to visit queue`);
          console.log(`🔍 Queue now has ${urlsToVisit.length} URLs to visit`);
          console.log(`🔍 Loop will continue: urlsToVisit.length > 0 = ${urlsToVisit.length > 0}, pages.length < maxPages = ${pages.length < this.config.maxPages}`);
        } catch (analyzeError) {
            console.error(`Error analyzing page ${currentUrl}:`, analyzeError);
            // Even if analysis fails, add a basic page state so we don't lose the page
            pages.push({
              url: currentUrl,
              title: await this.page.title().catch(() => 'Unknown'),
              timestamp: new Date(),
              screenshot: '',
              actions: [],
              discoveredElements: {
                links: [],
                buttons: [],
                forms: [],
                headings: [],
                navigationItems: []
              }
            });
          }
        } catch (error) {
          console.error(`Error processing ${currentUrl}:`, error);
          // Try to add a basic page state even on error
          try {
            pages.push({
              url: currentUrl,
              title: await this.page?.title().catch(() => 'Unknown') || 'Unknown',
              timestamp: new Date(),
              screenshot: '',
              actions: [],
              discoveredElements: {
                links: [],
                buttons: [],
                forms: [],
                headings: [],
                navigationItems: []
              }
            });
          } catch {
            // If we can't even add a basic page state, skip it
          }
        }
      }

    return pages;
  }

  private async analyzeAndInteract(url: string, isPostLoginAnalysis: boolean = false): Promise<PageState> {
    if (!this.page) throw new Error('Page not initialized');

    const title = await this.page.title();
    const timestamp = new Date();
    
    // Take screenshot
    const screenshotPath = join(
      this.runScreenshotDir || this.config.screenshotDir,
      `screenshot-${Date.now()}.png`
    );
    await this.page.screenshot({ path: screenshotPath, fullPage: true });

    // Extract discovered elements BEFORE AI analysis
    // Use the current page URL, not the passed URL (in case page changed, e.g., after login)
    const currentPageUrl = this.page.url();
    const discoveredElements = await this.extractDiscoveredElements(currentPageUrl);

    // Get previous actions for context - include login status
    const previousActions = Array.from(this.pagesVisited.values())
      .flatMap((p) => p.actions)
      .map((a) => a.description)
      .slice(-5); // Last 5 actions for context
    
    // Check if we just logged in - add context for post-login exploration
    // Use explicit flag OR check previous actions
    const justLoggedIn = isPostLoginAnalysis || previousActions.some(a => 
      a.toLowerCase().includes('login') || 
      a.toLowerCase().includes('sign in') ||
      a.toLowerCase().includes('authenticated')
    );
    
    // Build context for AI - explicitly tell it this is post-login if flag is set
    let contextActions: string[];
    if (isPostLoginAnalysis) {
      // Explicit post-login context - be very clear with the AI
      contextActions = [
        'CRITICAL CONTEXT: This is a POST-LOGIN page analysis.',
        'The user has successfully logged in and the page content has changed.',
        'The URL may be the same as the login page, but this is the authenticated state.',
        'Your goal is to explore and test ALL features, links, buttons, and workflows available in this authenticated area.',
        'This is where the real application functionality exists - explore thoroughly.',
        'Generate actions to click buttons, follow links, test forms, and discover all interactive elements.',
        ...previousActions
      ];
    } else if (justLoggedIn) {
      contextActions = [...previousActions, 'Just completed login - now exploring authenticated area. Focus on discovering all available features, links, and workflows on this post-login page.'];
    } else {
      contextActions = previousActions;
    }

    // Analyze with AI vision
    console.log('🤖 Analyzing page with AI vision...');
    if (isPostLoginAnalysis || justLoggedIn) {
      console.log('🔓 Post-login page detected - AI will focus on exploring authenticated area');
      if (isPostLoginAnalysis) {
        console.log('   📌 Explicit post-login analysis flag set - AI will receive strong post-login context');
      }
    }
    const analysis = await this.visionService.analyzePage(screenshotPath, url, contextActions);

    // Perform actions based on AI suggestions
    // maxActions limits the total number of actions across ALL pages
    const actions: Action[] = [];
    const maxActionsPerPage = Math.min(5, this.config.maxActions - this.actionCount);
    
    // If AI didn't suggest good actions but we have discovered elements, generate actions from them
    let actionsToTry = analysis.suggestedActions.slice(0, maxActionsPerPage);
    
    if (isPostLoginAnalysis && (actionsToTry.length === 0 || actionsToTry.every(a => a.action.toLowerCase().includes('explore navigation')))) {
      // For post-login pages, if AI didn't suggest specific actions, generate them from discovered elements
      console.log(`🔧 Post-login page: AI didn't suggest specific actions, generating from discovered elements...`);
      const generatedActions: SuggestedAction[] = [];
      
      // Generate actions from discovered buttons
      for (const button of discoveredElements.buttons.slice(0, 5)) {
        if (button.text && button.text.toLowerCase() !== 'logout') { // Don't logout during exploration
          generatedActions.push({
            action: `Click "${button.text}" button`,
            reason: `Discovered button: ${button.text}`,
            priority: 'high',
          });
        }
      }
      
      // Generate actions from discovered links
      for (const link of discoveredElements.links.slice(0, 3)) {
        generatedActions.push({
          action: `Click "${link.text}" link`,
          reason: `Discovered link: ${link.text}`,
          priority: 'high',
        });
      }
      
      if (generatedActions.length > 0) {
        console.log(`✅ Generated ${generatedActions.length} actions from discovered elements`);
        actionsToTry = generatedActions.slice(0, maxActionsPerPage);
      }
    }
    
    for (const suggestion of actionsToTry) {
      if (this.actionCount >= this.config.maxActions) {
        console.log(`⚠️  Reached maxActions limit (${this.config.maxActions}), stopping action execution on this page`);
        break;
      }

      try {
        const action = await this.performAction(suggestion, analysis);
        if (action && action.type !== 'wait') {
          // Only count non-wait actions (clicks, types, scrolls, etc.)
          // Wait actions are placeholders and shouldn't count toward maxActions
          actions.push(action);
          this.actionCount++;
          console.log(`✅ Performed action ${this.actionCount}/${this.config.maxActions}: ${action.description}`);
          
          // Wait a bit between actions
          await this.page!.waitForTimeout(1000);
        } else if (action && action.type === 'wait') {
          // Log wait actions but don't count them
          actions.push(action);
          console.log(`⏸️  Wait action (not counted): ${action.description}`);
        } else {
          console.log(`⚠️  Could not perform action: ${suggestion.action} (no matching elements found)`);
          // Don't count failed/null actions - they're not real interactions
        }
      } catch (error) {
        console.error(`Error performing action: ${suggestion.action}`, error);
        // Don't count failed actions as real actions - they didn't actually interact
        // Only log for debugging, but don't increment actionCount
      }
    }

    const pageState: PageState = {
      url,
      title,
      screenshot: screenshotPath,
      timestamp,
      actions,
      discoveredElements,
      visionAnalysis: analysis,
    };

    this.pagesVisited.set(url, pageState);

    // CRITICAL: Check for login page and attempt login
    // Strategy 1: Use AI detection if available
    let shouldAttemptLogin = false;
    let credentials: { username?: string; password?: string } = {};
    
    if (analysis.loginInfo && analysis.loginInfo.isLoginPage) {
      console.log(`🤖 AI detected login page: ${url}`);
      
      if (analysis.loginInfo.shouldLogin) {
        console.log(`🤖 AI recommends completing login to continue exploration`);
        shouldAttemptLogin = true;
        credentials = await this.getCredentialsForLogin(url, analysis.loginInfo);
      } else {
        console.log(`ℹ️  AI detected login page but doesn't recommend logging in`);
        // Still try to get credentials from context file as fallback
        credentials = await this.getCredentialsForLogin(url, analysis.loginInfo);
        if (credentials.username && credentials.password) {
          console.log(`💡 Found credentials in context file, attempting login anyway`);
          shouldAttemptLogin = true;
        }
      }
    } else {
      // Strategy 2: Fallback - check for login form manually if AI didn't detect it
      // This is critical because AI might miss login pages
      const hasPasswordField = await this.page.$('input[type="password"]').catch(() => null);
      const hasUsernameField = await this.page.$('input[type="text"], input[type="email"]').catch(() => null);
      
      if (hasPasswordField && hasUsernameField) {
        console.log(`🔍 Fallback: Detected login form (password + username fields found) even though AI didn't flag it`);
        // Try to get credentials from context file
        credentials = await this.getCredentialsForLogin(url, { isLoginPage: false, credentialsVisible: false, shouldLogin: false });
        if (credentials.username && credentials.password) {
          console.log(`💡 Found credentials in context file, attempting login`);
          shouldAttemptLogin = true;
        } else {
          console.log(`⚠️  Login form detected but no credentials available in context file`);
        }
      }
    }
    
    // Attempt login if we have credentials
    if (shouldAttemptLogin && credentials.username && credentials.password) {
      console.log(`🔑 Attempting login with username="${credentials.username}"`);
      const loginResult = await this.performLogin({ username: credentials.username, password: credentials.password });
      if (loginResult && loginResult.success) {
        if (loginResult.newUrl && loginResult.newUrl !== url) {
          console.log(`🔓 Login successful! URL changed from ${url} to ${loginResult.newUrl}`);
          // The post-login page will be handled by the exploreWebsite loop
          // which checks for URL changes after analyzeAndInteract returns
        } else {
          // Login succeeded but URL didn't change (SPA behavior)
          // Mark this page state as post-login so we can analyze it separately
          console.log(`🔓 Login successful! URL unchanged (SPA), but login form disappeared - post-login content detected`);
          // Store a flag in the page state to indicate this is post-login
          (pageState as any).isPostLogin = true;
          (pageState as any).loginSucceeded = true;
        }
      } else {
        console.log(`❌ Login attempt failed or did not result in navigation`);
      }
    } else if (shouldAttemptLogin) {
      console.log(`⚠️  Wanted to login but no credentials available (checked AI extraction and context file)`);
    }

    return pageState;
  }
  
  /**
   * Get credentials for login - prioritize AI-extracted, fallback to context file
   */
  private async getCredentialsForLogin(url: string, loginInfo: import('./types.js').LoginInfo): Promise<{ username?: string; password?: string }> {
    // First, use AI-extracted credentials if available
    if (loginInfo.username && loginInfo.password) {
      // Strip quotes and whitespace from AI-extracted credentials (AI sometimes includes quotes)
      const username = loginInfo.username.trim().replace(/^["']+|["']+$/g, '');
      const password = loginInfo.password.trim().replace(/^["']+|["']+$/g, '');
      return { username, password };
    }
    
    // Fallback to context file
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      
      // Try exact hostname first (e.g., localhost.json)
      let contextPath = join(process.cwd(), 'context', `${domain}.json`);
      
      // If that doesn't exist and we have a port, try with port (e.g., localhost:3000.json)
      if (!existsSync(contextPath) && urlObj.port) {
        const domainWithPort = `${domain}:${urlObj.port}`;
        contextPath = join(process.cwd(), 'context', `${domainWithPort}.json`);
      }
      
      console.log(`📂 Checking for context file: ${contextPath}`);
      
      if (existsSync(contextPath)) {
        console.log(`✅ Found context file: ${contextPath}`);
        const contextContent = await readFile(contextPath, 'utf-8');
        const contextFile = JSON.parse(contextContent);
        
        if (contextFile.credentials) {
          console.log(`✅ Found credentials in context file`);
          return {
            username: contextFile.credentials.username,
            password: contextFile.credentials.password,
          };
        }
        if (contextFile.demoCredentials) {
          console.log(`✅ Found demoCredentials in context file`);
          return {
            username: contextFile.demoCredentials.username,
            password: contextFile.demoCredentials.password,
          };
        }
        console.log(`⚠️  Context file exists but no credentials found (checked 'credentials' and 'demoCredentials' fields)`);
      } else {
        console.log(`⚠️  Context file not found: ${contextPath}`);
      }
    } catch (error) {
      console.error(`❌ Error reading context file: ${error}`);
      // Context file is optional
    }
    
    return {};
  }
  
  /**
   * Perform login using provided credentials - simplified version that uses AI guidance
   */
  private async performLogin(credentials: { username: string; password: string }): Promise<{ success: boolean; newUrl?: string } | null> {
    if (!this.page) return null;
    
    const currentUrl = this.page.url();
    
    try {
      // Find username/email field
      const usernameInputs = await this.page.$$('input[type="text"], input[type="email"]');
      const passwordInputs = await this.page.$$('input[type="password"]');
      
      if (usernameInputs.length === 0 || passwordInputs.length === 0) {
        console.log(`⚠️  Could not find username/password fields`);
        return null;
      }

      // Fill in credentials
      await usernameInputs[0].fill(credentials.username);
      await this.page.waitForTimeout(500);
      await passwordInputs[0].fill(credentials.password);
      await this.page.waitForTimeout(500);

      // Find and click submit button
      let submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
      
      if (!submitButton) {
        const allButtons = await this.page.$$('button');
        for (const btn of allButtons) {
          const btnText = await btn.textContent();
          const textLower = (btnText || '').toLowerCase();
          if (textLower.includes('sign in') || textLower.includes('login') || textLower.includes('log in')) {
            submitButton = btn;
            break;
          }
        }
      }
      
      if (!submitButton) {
        const form = await this.page.$('form');
        if (form) {
          const formButtons = await form.$$('button');
          if (formButtons.length > 0) {
            submitButton = formButtons[0];
          }
        }
      }
      
      if (!submitButton) {
        console.log(`⚠️  Could not find submit button`);
        return null;
      }
      
      await submitButton.click();
      await this.page.waitForTimeout(3000);
      
      const newUrl = this.page.url();
      if (newUrl !== currentUrl) {
        return { success: true, newUrl };
      }

      // Check if content changed
      const hasLoginFormAfter = await this.page.$('input[type="password"]').catch(() => null);
      if (!hasLoginFormAfter) {
        return { success: true, newUrl: newUrl };
      }

      return { success: false };
    } catch (error) {
      console.error(`Error performing login: ${error}`);
      return { success: false };
    }
  }

  /**
   * Extract discovered elements from the current page
   */
  private async extractDiscoveredElements(url: string): Promise<import('./types.js').DiscoveredElements> {
    if (!this.page) {
      return {
        links: [],
        buttons: [],
        forms: [],
        headings: [],
        navigationItems: [],
      };
    }

    try {
      // Extract links (same-domain only) with selectors
      const allLinks = await this.page.$$eval('a[href]', (anchors) =>
        anchors.map((a, index) => {
          const element = a as HTMLElement;
          let selector = '';
          if (element.id) {
            selector = `#${element.id}`;
          } else if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/).filter(c => c.length > 0);
            if (classes.length > 0) {
              selector = `.${classes[0]}`;
            }
          }
          if (!selector) {
            selector = `a[href="${(a as HTMLAnchorElement).href}"]`;
          }
          return {
            text: a.textContent?.trim() || '',
            href: (a as HTMLAnchorElement).href,
            selector: selector || undefined,
          };
        })
      );

      const sameDomainLinks: import('./types.js').DiscoveredLink[] = [];
      for (const link of allLinks) {
        try {
          const linkUrl = new URL(link.href);
          const pageUrl = new URL(url);
          const isExternal = linkUrl.hostname !== pageUrl.hostname;
          
          if (!isExternal && link.text.length > 0) {
            sameDomainLinks.push({
              text: link.text,
              href: link.href,
              isExternal: false,
              selector: link.selector,
            });
          }
        } catch {
          // Skip invalid URLs
        }
      }

      // Extract buttons with selectors
      const buttons = await this.page.$$eval(
        'button, [role="button"], input[type="button"], input[type="submit"]',
        (elements) =>
          elements.map((el) => {
            const element = el as HTMLElement;
            let selector = '';
            if (element.id) {
              selector = `#${element.id}`;
            } else if (element.className && typeof element.className === 'string') {
              const classes = element.className.trim().split(/\s+/).filter(c => c.length > 0);
              if (classes.length > 0) {
                selector = `.${classes[0]}`;
              }
            }
            if (!selector && element.tagName.toLowerCase() === 'button') {
              selector = 'button';
            } else if (!selector && (el as HTMLInputElement).type) {
              selector = `input[type="${(el as HTMLInputElement).type}"]`;
            }
            return {
              text: el.textContent?.trim() || (el as HTMLInputElement).value || '',
              type: (el as HTMLInputElement).type || 'button',
              visible: true, // Assume visible if found
              selector: selector || undefined,
            };
          })
      );

      const discoveredButtons: import('./types.js').DiscoveredButton[] = buttons
        .filter((b) => b.text.length > 0)
        .map((b) => ({
          text: b.text,
          type: b.type,
          visible: b.visible,
          selector: b.selector,
        }));

      // Extract forms
      const forms = await this.page.$$eval('form', (forms) =>
        forms.map((form) => ({
          action: (form as HTMLFormElement).action || undefined,
          method: (form as HTMLFormElement).method || undefined,
          fields: Array.from(form.querySelectorAll('input, textarea, select')).map((field) => {
            const input = field as HTMLInputElement;
            const labels = (input as any).labels;
            return {
              type: input.type || field.tagName.toLowerCase(),
              name: input.name || undefined,
              placeholder: input.placeholder || undefined,
              label: (labels?.[0]?.textContent?.trim()) || undefined,
              required: input.required || false,
            };
          }),
        }))
      );

      const discoveredForms: import('./types.js').DiscoveredForm[] = forms.map((f) => ({
        fields: f.fields.map((field) => ({
          type: field.type,
          name: field.name,
          placeholder: field.placeholder,
          label: field.label,
          required: field.required,
        })),
        action: f.action,
        method: f.method,
      }));

      // Extract headings with selectors
      const headings = await this.page.$$eval('h1, h2, h3, h4, h5, h6', (elements) =>
        elements.map((el) => {
          const element = el as HTMLElement;
          let selector = '';
          if (element.id) {
            selector = `#${element.id}`;
          } else if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/).filter(c => c.length > 0);
            if (classes.length > 0) {
              selector = `.${classes[0]}`;
            }
          }
          if (!selector) {
            selector = el.tagName.toLowerCase();
          }
          return {
            level: parseInt(el.tagName.charAt(1)) || 1,
            text: el.textContent?.trim() || '',
            selector: selector || undefined,
          };
        })
      );

      const discoveredHeadings: import('./types.js').DiscoveredHeading[] = headings
        .filter((h) => h.text.length > 0)
        .map((h) => ({
          level: h.level,
          text: h.text,
          selector: h.selector,
        }));

      // Extract navigation items (links in nav, header, or menu)
      const navLinks = await this.page.$$eval(
        'nav a, header a, [role="navigation"] a, .nav a, .menu a, .navigation a',
        (links) => links.map((link) => link.textContent?.trim() || '').filter(Boolean)
      );

      return {
        links: sameDomainLinks,
        buttons: discoveredButtons,
        forms: discoveredForms,
        headings: discoveredHeadings,
        navigationItems: [...new Set(navLinks)], // Remove duplicates
      };
    } catch (error) {
      console.error('Error extracting discovered elements:', error);
      return {
        links: [],
        buttons: [],
        forms: [],
        headings: [],
        navigationItems: [],
      };
    }
  }

  private async performAction(
    suggestion: { action: string; target?: string; priority: string },
    analysis: VisionAnalysis
  ): Promise<Action | null> {
    if (!this.page) return null;

    const actionLower = suggestion.action.toLowerCase();
    const timestamp = new Date();

    try {
      // Try to find and interact with elements
      if (actionLower.includes('click') || actionLower.includes('button') || actionLower.includes('link')) {
        // Find clickable elements, but filter to only same-domain links
        const allButtons = await this.page.$$('button, a[href], [role="button"]');
        const sameDomainButtons = [];
        
        for (const button of allButtons) {
          const tagName = await button.evaluate((el) => el.tagName.toLowerCase());
          
          // For links, check if they're same-domain
          if (tagName === 'a') {
            const href = await button.getAttribute('href');
            if (href) {
              try {
                // Resolve relative URLs
                const currentUrl = this.page!.url();
                const absoluteUrl = new URL(href, currentUrl).href;
                if (this.isSameDomain(absoluteUrl, currentUrl)) {
                  sameDomainButtons.push(button);
                } else {
                  console.log(`🚫 Skipping external link: ${href}`);
                }
              } catch {
                // If URL parsing fails, skip it
                continue;
              }
            }
          } else {
            // For buttons and other elements, always include them
            sameDomainButtons.push(button);
          }
        }
        
        if (sameDomainButtons.length > 0) {
          const selectedButton = sameDomainButtons[Math.floor(Math.random() * sameDomainButtons.length)];
          const text = await selectedButton.textContent();
          const tagName = await selectedButton.evaluate((el) => el.tagName.toLowerCase());
          
          // Check if clicking will navigate away
          if (tagName === 'a') {
            const href = await selectedButton.getAttribute('href');
            if (href) {
              try {
                const currentUrl = this.page!.url();
                const targetUrl = new URL(href, currentUrl).href;
                if (!this.isSameDomain(targetUrl, currentUrl)) {
                  console.log(`🚫 Blocked click on external link: ${href}`);
                  return {
                    type: 'click',
                    target: text || 'unknown',
                    description: `Skipped external link: ${text || href}`,
                    timestamp,
                    success: false,
                    error: 'External domain link blocked',
                  };
                }
              } catch {
                // If URL parsing fails, skip the click
                return null;
              }
            }
          }
          
          await selectedButton.click();
          
          return {
            type: 'click',
            target: text || 'unknown',
            description: `Clicked: ${text || suggestion.action}`,
            timestamp,
            success: true,
          };
        }
      } else if (actionLower.includes('type') || actionLower.includes('input') || actionLower.includes('form')) {
        // Find input fields
        const inputs = await this.page.$$('input[type="text"], input[type="email"], textarea');
        if (inputs.length > 0) {
          const input = inputs[0];
          const placeholder = await input.getAttribute('placeholder') || 'field';
          const testValue = this.generateTestValue(placeholder);
          
          await input.fill(testValue);
          
          return {
            type: 'type',
            target: placeholder,
            value: testValue,
            description: `Typed "${testValue}" into ${placeholder}`,
            timestamp,
            success: true,
          };
        }
      } else if (actionLower.includes('scroll')) {
        await this.page.evaluate(() => window.scrollBy(0, 500));
        
        return {
          type: 'scroll',
          description: 'Scrolled down the page',
          timestamp,
          success: true,
        };
      } else if (actionLower.includes('navigate') || actionLower.includes('explore navigation')) {
        // "Explore navigation" should actually click on navigation links
        // Find navigation links and click one
        const navLinks = await this.page.$$('nav a[href], header a[href], [role="navigation"] a[href]');
        const sameDomainNavLinks = [];
        
        for (const link of navLinks) {
          const href = await link.getAttribute('href');
          if (href) {
            try {
              const currentUrl = this.page!.url();
              const absoluteUrl = new URL(href, currentUrl).href;
              if (this.isSameDomain(absoluteUrl, currentUrl)) {
                sameDomainNavLinks.push(link);
              }
            } catch {
              continue;
            }
          }
        }
        
        if (sameDomainNavLinks.length > 0) {
          const selectedLink = sameDomainNavLinks[Math.floor(Math.random() * sameDomainNavLinks.length)];
          const text = await selectedLink.textContent();
          await selectedLink.click();
          
          return {
            type: 'click',
            target: text || 'navigation link',
            description: `Clicked navigation link: ${text || 'link'}`,
            timestamp,
            success: true,
          };
        }
        // If no navigation links found, return null (don't count as action)
        return null;
      }

      // Default: return null for unrecognized actions (don't count them)
      console.log(`⚠️  Unrecognized action type: ${suggestion.action} - skipping`);
      return null;
    } catch (error) {
      return {
        type: 'wait',
        description: suggestion.action,
        timestamp,
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Detect if current page is a login page and attempt login if credentials are available
   * Returns login result with new URL if successful
   */
  private async attemptLoginIfNeeded(currentUrl: string): Promise<{ success: boolean; newUrl?: string } | null> {
    if (!this.page) return null;

    try {
      // Check if this looks like a login page - multiple strategies
      let hasLoginForm = false;
      
      // Strategy 1: Check for form with password field
      try {
        hasLoginForm = await this.page.$eval('form', (form) => {
          const inputs = form.querySelectorAll('input[type="password"]');
          return inputs.length > 0;
        });
      } catch {
        // Form might not exist or selector failed
      }
      
      // Strategy 2: Check for password input anywhere on page (some sites don't use <form>)
      if (!hasLoginForm) {
        try {
          const passwordInputs = await this.page.$$('input[type="password"]');
          hasLoginForm = passwordInputs.length > 0;
        } catch {
          // Ignore
        }
      }
      
      // Strategy 3: Check page content for login indicators
      if (!hasLoginForm) {
        try {
          const bodyText = await this.page.textContent('body');
          if (bodyText) {
            const loginIndicators = ['login', 'sign in', 'signin', 'log in', 'password', 'username'];
            const hasLoginText = loginIndicators.some(indicator => 
              bodyText.toLowerCase().includes(indicator)
            );
            const hasPasswordField = await this.page.$('input[type="password"]').catch(() => null);
            hasLoginForm = hasLoginText && hasPasswordField !== null;
          }
        } catch {
          // Ignore
        }
      }

      if (!hasLoginForm) {
        console.log(`   ℹ️  No login form detected on ${currentUrl}`);
        return null; // Not a login page
      }

      console.log(`🔐 Login form detected on ${currentUrl}`);
      
      // Extract credentials (from page first, then context file)
      const credentials = await this.extractCredentials(currentUrl);
      
      console.log(`   📋 Credential extraction result: username=${credentials.username ? '✓' : '✗'}, password=${credentials.password ? '✓' : '✗'}`);
      
      if (!credentials.username || !credentials.password) {
        console.log(`⚠️  No credentials found for login (checked page and context file)`);
        console.log(`   💡 Tip: Add credentials to context/{domain}.json or ensure they're visible on the page`);
        return null;
      }

      console.log(`🔑 Attempting login with username: "${credentials.username}"`);

      // Find username/email field
      const usernameInputs = await this.page.$$('input[type="text"], input[type="email"]');
      const passwordInputs = await this.page.$$('input[type="password"]');
      
      if (usernameInputs.length === 0 || passwordInputs.length === 0) {
        console.log(`⚠️  Could not find username/password fields`);
        return null;
      }

      // Fill in credentials
      await usernameInputs[0].fill(credentials.username);
      await this.page.waitForTimeout(500);
      await passwordInputs[0].fill(credentials.password);
      await this.page.waitForTimeout(500);

      // Find and click submit button
      // First try explicit submit buttons
      let submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
      
      // If not found, try to find button by text (Sign In, Login, etc.)
      if (!submitButton) {
        const allButtons = await this.page.$$('button');
        for (const btn of allButtons) {
          const btnText = await btn.textContent();
          const textLower = (btnText || '').toLowerCase();
          if (textLower.includes('sign in') || textLower.includes('login') || textLower.includes('log in')) {
            submitButton = btn;
            break;
          }
        }
      }
      
      // If still not found, try any button in the form
      if (!submitButton) {
        const form = await this.page.$('form');
        if (form) {
          const formButtons = await form.$$('button');
          if (formButtons.length > 0) {
            submitButton = formButtons[0];
          }
        }
      }
      
      if (!submitButton) {
        console.log(`⚠️  Could not find submit button`);
        return null;
      }
      
      await submitButton.click();

      // Wait for navigation or content change
      await this.page.waitForTimeout(3000);
      
      // Check if URL changed (login successful)
      const newUrl = this.page.url();
      if (newUrl !== currentUrl) {
        console.log(`✅ Login successful! Navigated to: ${newUrl}`);
        return { success: true, newUrl };
      }

      // Check if content changed (login might have succeeded without URL change)
      const pageContent = await this.page.textContent('body');
      const hasLoginFormAfter = await this.page.$('input[type="password"]').catch(() => null);
      
      if (!hasLoginFormAfter && pageContent && pageContent.length > 100) {
        // Login form is gone and there's substantial content - likely successful
        console.log(`✅ Login likely successful (form disappeared, content present)`);
        return { success: true, newUrl: newUrl };
      }

      console.log(`⚠️  Login attempt completed but no clear success indicator`);
      return { success: false };
    } catch (error) {
      console.error(`Error attempting login: ${error}`);
      return { success: false };
    }
  }

  /**
   * Extract credentials from page content or context file
   * Priority: page content > context file
   */
  private async extractCredentials(url: string): Promise<{ username?: string; password?: string }> {
    const credentials: { username?: string; password?: string } = {};

    // First, try to extract from page content
    try {
      const bodyText = await this.page!.textContent('body');
      if (bodyText) {
        console.log(`   🔍 Searching for credentials on page...`);
        
        // More flexible approach: look for credential patterns anywhere in the page
        // Try multiple patterns to handle different formats
        
        // Pattern 1: "Username: value" or "User: value" or "Login: value"
        const usernamePatterns = [
          /(?:username|user\s*name|login|email)[\s:]*([^\s\n\r:]+)/i,
          /(?:username|user\s*name|login|email)[\s:]*\s*([^\s\n\r]+)/i,
        ];
        
        // Pattern 2: "Password: value" or "Pass: value"
        const passwordPatterns = [
          /(?:password|pass)[\s:]*([^\s\n\r:]+)/i,
          /(?:password|pass)[\s:]*\s*([^\s\n\r]+)/i,
        ];
        
        // Try to find credentials in sections with "demo", "test", "credential" keywords
        const credentialSections = await this.page!.$$eval('body', (body) => {
          const text = body.textContent || '';
          const sections: string[] = [];
          const keywords = ['demo', 'test', 'credential', 'login', 'sign in'];
          const lines = text.split('\n');
          
          // Collect sections around keywords (wider context)
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            if (keywords.some(kw => line.includes(kw))) {
              // Get more context (10 lines instead of 5)
              sections.push(lines.slice(Math.max(0, i - 2), Math.min(i + 10, lines.length)).join('\n'));
            }
          }
          
          // Also return the full text as a fallback
          if (sections.length === 0) {
            sections.push(text);
          }
          
          return sections;
        });

        // Try to extract from credential sections
        for (const section of credentialSections) {
          // Try multiple username patterns
          if (!credentials.username) {
            for (const pattern of usernamePatterns) {
              const match = section.match(pattern);
              if (match && match[1]) {
                const username = match[1].trim();
                // Validate: not too short, not too long, doesn't contain common separators that indicate it's part of a label
                if (username.length >= 2 && username.length < 100 && !username.includes(':')) {
                  credentials.username = username;
                  console.log(`   🔑 Extracted username from page: "${username}"`);
                  break;
                }
              }
            }
          }
          
          // Try multiple password patterns
          if (!credentials.password) {
            for (const pattern of passwordPatterns) {
              const match = section.match(pattern);
              if (match && match[1]) {
                const password = match[1].trim();
                // Validate: not too short, not too long
                if (password.length >= 2 && password.length < 100 && !password.includes(':')) {
                  credentials.password = password;
                  console.log(`   🔑 Extracted password from page: "${password}"`);
                  break;
                }
              }
            }
          }
        }
        
        // Alternative: Look for credentials in a structured format (e.g., "Username\nvalue\nPassword\nvalue")
        if (!credentials.username || !credentials.password) {
          const lines = bodyText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const lineLower = line.toLowerCase();
            
            // Check if this line indicates a username field
            if ((lineLower.includes('username') || lineLower.includes('user') || lineLower.includes('login') || lineLower.includes('email')) && 
                !lineLower.includes('password') && i + 1 < lines.length) {
              const nextLine = lines[i + 1].trim();
              if (nextLine.length >= 2 && nextLine.length < 100 && !nextLine.includes(':') && !credentials.username) {
                credentials.username = nextLine;
                console.log(`   🔑 Extracted username from structured format: "${nextLine}"`);
              }
            }
            
            // Check if this line indicates a password field
            if (lineLower.includes('password') && i + 1 < lines.length) {
              const nextLine = lines[i + 1].trim();
              if (nextLine.length >= 2 && nextLine.length < 100 && !nextLine.includes(':') && !credentials.password) {
                credentials.password = nextLine;
                console.log(`   🔑 Extracted password from structured format: "${nextLine}"`);
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not extract credentials from page: ${error}`);
    }

    // If credentials not found on page, check context file
    if (!credentials.username || !credentials.password) {
      try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname;
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
        
        const contextPath = join(process.cwd(), 'context', `${domain}.json`);
        if (existsSync(contextPath)) {
          const contextContent = await readFile(contextPath, 'utf-8');
          const contextFile = JSON.parse(contextContent);
          
          // Check for credentials in context file (could be in various formats)
          if (contextFile.credentials) {
            if (contextFile.credentials.username && !credentials.username) {
              credentials.username = contextFile.credentials.username;
              console.log(`   🔑 Using username from context file: "${credentials.username}"`);
            }
            if (contextFile.credentials.password && !credentials.password) {
              credentials.password = contextFile.credentials.password;
              console.log(`   🔑 Using password from context file`);
            }
          }
          // Also check for demo/test credentials
          if (contextFile.demoCredentials) {
            if (contextFile.demoCredentials.username && !credentials.username) {
              credentials.username = contextFile.demoCredentials.username;
              console.log(`   🔑 Using demo username from context file: "${credentials.username}"`);
            }
            if (contextFile.demoCredentials.password && !credentials.password) {
              credentials.password = contextFile.demoCredentials.password;
              console.log(`   🔑 Using demo password from context file`);
            }
          }
        }
      } catch (error) {
        // Context file is optional, ignore errors
        console.log(`   ⚠️  Could not load context file: ${error}`);
      }
    }

    return credentials;
  }

  private generateTestValue(fieldName: string): string {
    const lower = fieldName.toLowerCase();
    
    if (lower.includes('email')) {
      return 'test@example.com';
    } else if (lower.includes('phone')) {
      return '555-1234';
    } else if (lower.includes('name')) {
      return 'Test User';
    } else if (lower.includes('password')) {
      return 'Test123!';
    } else {
      return 'test value';
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  private isSameDomain(url1: string, url2: string): boolean {
    try {
      const domain1 = new URL(url1).hostname;
      const domain2 = new URL(url2).hostname;
      return domain1 === domain2;
    } catch {
      return false;
    }
  }


  async cleanup(): Promise<void> {
    // Remove route handlers (if page still exists)
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.unroute('**/*');
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
    
    if (this.browser) {
      await this.browser.close();
    }
  }

  getPagesVisited(): PageState[] {
    return Array.from(this.pagesVisited.values());
  }

  getActionCount(): number {
    return this.actionCount;
  }

  getPage(): Page | null {
    return this.page;
  }

  getBrowser(): Browser | null {
    return this.browser;
  }
}
