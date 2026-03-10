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
import { Config, PageState, Action, ActionOutcome, VisionAnalysis, SuggestedAction } from './types.js';
import { AIVisionService } from './ai-vision.js';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync, unlinkSync } from 'fs';
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
  private allowedDomains: string[] = [];
  private excludeElements: string[] = [];
  private hasCompletedLogin: boolean = false;  // Track if we've successfully logged in this session
  private siteContext: { siteDescription?: string; importantTests?: any[]; loginInstructions?: string } = {};  // Context from context file for AI
  private failedActions: Map<string, number> = new Map();  // Track failed/timed-out actions to prevent loops

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
    this.hasCompletedLogin = false;  // Reset login state for fresh exploration
    this.failedActions.clear();  // Reset failed actions tracking

    // Version marker for debugging - increment when making changes
    console.log(`🔧 AutomationEngine v2.4 - AI action matching (no random clicks)`);

    // Store the starting domain to filter external links
    try {
      this.startDomain = new URL(startUrl).hostname;
      console.log(`🌐 Starting domain set to: ${this.startDomain}`);
    } catch {
      throw new Error(`Invalid start URL: ${startUrl}`);
    }

    // Load allowed domains from context file (for OAuth/SSO flows like Cognito)
    await this.loadAllowedDomains(startUrl);

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
        // Use isDomainAllowed which checks both start domain and allowedDomains list
        if (this.isDomainAllowed(url)) {
          await route.continue();
        } else {
          // Block external domain navigations
          console.log(`🚫 Blocked external navigation to: ${url}`);
          await route.abort();
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

        // Use isDomainAllowed which checks both start domain and allowedDomains list
        if (!this.isDomainAllowed(currentUrl)) {
          const currentDomain = new URL(currentUrl).hostname;
          console.log(`🚫 Detected navigation to external domain: ${currentDomain}, navigating back...`);
          this.navigationGuardActive = true;
          this.lastNavigationTime = now;

          try {
            // Navigate back to the last visited allowed-domain URL
            const allowedUrls = Array.from(this.visitedUrls).filter(url => this.isDomainAllowed(url));

            if (allowedUrls.length > 0) {
              await this.page!.goto(allowedUrls[allowedUrls.length - 1], {
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
        
        this.navigationGuardActive = false; // Re-enable navigation guard
        // Note: dynamic content wait is handled inside analyzeAndInteract() via waitForDynamicContent()

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

            // AI-DRIVEN: Clear pre-login URLs from queue - we're now in authenticated state
            // This allows the AI to discover fresh links from the authenticated page
            const preLoginQueueSize = urlsToVisit.length;
            if (preLoginQueueSize > 0) {
              console.log(`🔄 LOGIN TRANSITION: Clearing ${preLoginQueueSize} pre-login URLs from queue`);
              console.log(`   (These were discovered before login - let AI discover authenticated links instead)`);
              urlsToVisit.length = 0; // Clear the queue
            }

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

              // AI-DRIVEN: Clear pre-login URLs from queue when login completes
              const preLoginQueueSize = urlsToVisit.length;
              if (preLoginQueueSize > 0) {
                console.log(`🔄 LOGIN TRANSITION: Clearing ${preLoginQueueSize} pre-login URLs from queue`);
                console.log(`   (These were discovered before login - let AI discover authenticated links instead)`);
                urlsToVisit.length = 0; // Clear the queue
              }

              // CRITICAL: Analyze the post-login page IMMEDIATELY while authenticated
              // Don't just add it to the queue - analyze it now before session expires
              try {
                // Wait for page to stabilize after login
                await this.page.waitForTimeout(2000);

                // Analyze the post-login page
                const postLoginPageState = await this.analyzeAndInteract(urlAfterAnalysis, true);
                // Mark as post-login for AI context
                (postLoginPageState as any).isPostLogin = true;
                (postLoginPageState as any).postLoginState = true;
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
          // CRITICAL: If we just logged in, use the CURRENT browser URL (where we landed after login)
          // Don't navigate back to the pre-login URL!
          const actualCurrentUrl = this.page.url();
          let pageToExtractFrom: string;

          if (this.hasCompletedLogin && actualCurrentUrl !== currentUrl) {
            // Login completed and browser is on a different URL - use that URL for link extraction
            console.log(`🔓 Login completed - extracting links from authenticated page: ${actualCurrentUrl}`);
            pageToExtractFrom = actualCurrentUrl;
            // Also mark this authenticated URL as visited so we don't navigate back to it
            this.visitedUrls.add(this.normalizeUrl(actualCurrentUrl));
          } else if (postLoginUrl) {
            // Post-login URL was explicitly set by the analysis branches above
            pageToExtractFrom = postLoginUrl;
          } else {
            // Normal case - use the URL we intended to analyze
            pageToExtractFrom = currentUrl;
          }

          // Only navigate if we're not already on the target page
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

    // Wait for dynamic content to finish loading before capturing page state
    await this.waitForDynamicContent();

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
    // ONLY use explicit flags - NOT action text matching (unreliable)
    // Action text "Sign In" just means we clicked the login button, not that login succeeded
    const justLoggedIn = isPostLoginAnalysis || this.hasCompletedLogin;
    
    // Build context for AI - explicitly tell it this is post-login if flag is set
    let contextActions: string[];
    if (isPostLoginAnalysis) {
      // Explicit post-login context - be very clear with the AI
      contextActions = [
        '=== POST-LOGIN AUTHENTICATED STATE ===',
        'You have SUCCESSFULLY LOGGED IN. This is the authenticated app.',
        'The URL may be the same as the login page, but the page CONTENT is now the authenticated dashboard/home.',
        '',
        'YOUR MISSION NOW: Explore the authenticated application thoroughly.',
        '1. Look for navigation menus, sidebar links, dashboard buttons',
        '2. Generate SPECIFIC click actions for each visible link/button (e.g., ACTION: Click "Dashboard")',
        '3. DO NOT suggest login actions - you are already logged in',
        '4. Prioritize exploring: Dashboard, Settings, Profile, Data views, Action buttons',
        '',
        'REMEMBER: Generate actions like:',
        '  ACTION: Click "Dashboard"',
        '  ACTION: Click "Settings"',
        '  ACTION: Click "View Reports"',
        'NOT generic actions like "Explore navigation"',
        ...previousActions
      ];
    } else if (justLoggedIn) {
      contextActions = [
        '=== AUTHENTICATED STATE - POST LOGIN ===',
        'Login completed successfully. You are now in the authenticated area.',
        'Focus on discovering and clicking all navigation links, buttons, and features.',
        'Generate SPECIFIC click actions for visible elements.',
        ...previousActions
      ];
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
    const analysis = await this.visionService.analyzePage(screenshotPath, url, contextActions, this.siteContext);

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

      // Check if this action targets an excluded element
      if (this.isElementExcluded(suggestion.action)) {
        console.log(`🚫 Skipping excluded element: ${suggestion.action}`);
        continue;
      }

      // LOOP DETECTION: Check if this action has failed/timed out before
      // Normalize action text for comparison (lowercase, trim, remove extra whitespace)
      const normalizedAction = suggestion.action.toLowerCase().trim().replace(/\s+/g, ' ');
      const failCount = this.failedActions.get(normalizedAction) || 0;
      if (failCount >= 2) {
        console.log(`🔄 Skipping action that failed ${failCount} times: ${suggestion.action}`);
        continue;
      }

      try {
        const action = await this.performAction(suggestion, analysis);
        if (action && action.type !== 'wait') {
          // Only count non-wait actions (clicks, types, scrolls, etc.)
          // Wait actions are placeholders and shouldn't count toward maxActions
          actions.push(action);
          this.actionCount++;
          console.log(`✅ Performed action ${this.actionCount}/${this.config.maxActions}: ${action.description}`);

          // Clear failure count on success
          this.failedActions.delete(normalizedAction);

          // Wait a bit between actions
          await this.page!.waitForTimeout(1000);
        } else if (action && action.type === 'wait') {
          // Log wait actions but don't count them
          // Wait actions often indicate timeouts - track them for loop detection
          actions.push(action);
          console.log(`⏸️  Wait action (not counted): ${action.description}`);

          // Track this as a failed/timeout action
          this.failedActions.set(normalizedAction, failCount + 1);
          console.log(`📊 Action failure count: ${normalizedAction} = ${failCount + 1}`);
        } else {
          console.log(`⚠️  Could not perform action: ${suggestion.action} (no matching elements found)`);
          // Track null results as failures too
          this.failedActions.set(normalizedAction, failCount + 1);
        }
      } catch (error) {
        console.error(`Error performing action: ${suggestion.action}`, error);
        // Track errors as failures
        this.failedActions.set(normalizedAction, failCount + 1);
        console.log(`📊 Action failure count (error): ${normalizedAction} = ${failCount + 1}`);
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
    // BUT skip if this is a post-login analysis (we already logged in successfully)
    // OR if AI-driven actions already handled credentials

    // Check if AI-driven credential actions were performed
    const aiFilledCredentials = actions.some(a =>
      a.description?.includes('Filled username field') ||
      a.description?.includes('Filled password field')
    );

    if (aiFilledCredentials) {
      console.log(`🤖 AI-driven credential actions detected - skipping performLogin fallback`);
    }

    // Strategy 1: Use AI detection if available
    let shouldAttemptLogin = false;
    let credentials: { username?: string; password?: string } = {};

    // Skip login attempts if we're analyzing a post-login page OR we've already logged in this session
    // OR if AI already filled credentials
    if (isPostLoginAnalysis || justLoggedIn || this.hasCompletedLogin || aiFilledCredentials) {
      console.log(`⏭️  Skipping login check - already logged in or AI handled it (isPostLoginAnalysis=${isPostLoginAnalysis}, justLoggedIn=${justLoggedIn}, hasCompletedLogin=${this.hasCompletedLogin}, aiFilledCredentials=${aiFilledCredentials})`);
    } else if (analysis.loginInfo && analysis.loginInfo.isLoginPage) {
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
        this.hasCompletedLogin = true;  // Mark session as logged in - prevents re-login attempts on other pages
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
   * Get credentials for login - only use context file (AI extraction is disabled)
   */
  private async getCredentialsForLogin(url: string, _loginInfo: import('./types.js').LoginInfo): Promise<{ username?: string; password?: string }> {
    // AI-extracted credentials are disabled - they were extracting garbage from markdown
    // (e.g., "Password:" label text being treated as username)
    // Context file is now the only source of credentials

    // Get credentials from context file
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      const port = urlObj.port;

      // Try port-specific context first (e.g., localhost-4002.json), then fall back to domain-only
      let contextPath = port
        ? join(process.cwd(), 'context', `${domain}-${port}.json`)
        : join(process.cwd(), 'context', `${domain}.json`);

      // If port-specific doesn't exist, try domain-only as fallback
      if (port && !existsSync(contextPath)) {
        console.log(`📂 Port-specific context not found, trying domain-only`);
        contextPath = join(process.cwd(), 'context', `${domain}.json`);
      }

      console.log(`📂 Checking for context file: ${contextPath}`);
      
      if (existsSync(contextPath)) {
        console.log(`✅ Found context file: ${contextPath}`);
        const contextContent = await readFile(contextPath, 'utf-8');
        const contextFile = JSON.parse(contextContent);

        // Check authentication.credentials (for Cognito/OAuth flows)
        if (contextFile.authentication?.credentials) {
          const creds = contextFile.authentication.credentials;
          console.log(`✅ Found authentication.credentials in context file`);
          return {
            username: creds.email || creds.username,
            password: creds.password,
          };
        }
        // Check top-level credentials
        if (contextFile.credentials) {
          console.log(`✅ Found credentials in context file`);
          return {
            username: contextFile.credentials.email || contextFile.credentials.username,
            password: contextFile.credentials.password,
          };
        }
        // Check demoCredentials
        if (contextFile.demoCredentials) {
          console.log(`✅ Found demoCredentials in context file`);
          return {
            username: contextFile.demoCredentials.email || contextFile.demoCredentials.username,
            password: contextFile.demoCredentials.password,
          };
        }
        console.log(`⚠️  Context file exists but no credentials found (checked 'authentication.credentials', 'credentials', and 'demoCredentials' fields)`);
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
   * Helper to find a button by matching text content
   */
  private async findButtonByText(textMatches: string[]): Promise<import('playwright').ElementHandle<Element> | null> {
    if (!this.page) return null;

    const allButtons = await this.page.$$('button, input[type="submit"]');
    for (const btn of allButtons) {
      const btnText = await btn.textContent();
      const textLower = (btnText || '').toLowerCase().trim();
      for (const match of textMatches) {
        if (textLower.includes(match)) {
          return btn;
        }
      }
    }
    return null;
  }

  /**
   * Find input field dynamically by type (username or password)
   * AI-driven approach: looks at DOM attributes to find the right field
   */
  private async findInputFieldByType(fieldType: 'username' | 'password'): Promise<import('playwright').ElementHandle<Element> | null> {
    if (!this.page) return null;

    if (fieldType === 'password') {
      // Password fields are easy - look for type="password"
      const passwordField = await this.page.$('input[type="password"]');
      if (passwordField) {
        console.log(`🔍 Found password field by type="password"`);
        return passwordField;
      }
      // Fallback: look for name/id containing "password"
      const passwordByName = await this.page.$('input[name*="password" i], input[id*="password" i]');
      if (passwordByName) {
        console.log(`🔍 Found password field by name/id containing "password"`);
        return passwordByName;
      }
    } else {
      // Username/email field detection - try multiple strategies
      // Strategy 1: type="email" is most reliable
      const emailField = await this.page.$('input[type="email"]');
      if (emailField) {
        console.log(`🔍 Found username field by type="email"`);
        return emailField;
      }

      // Strategy 2: name/id containing common patterns
      const usernameByName = await this.page.$('input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i]');
      if (usernameByName) {
        console.log(`🔍 Found username field by name/id pattern`);
        return usernameByName;
      }

      // Strategy 3: placeholder containing username/email
      const allTextInputs = await this.page.$$('input[type="text"], input:not([type])');
      for (const input of allTextInputs) {
        const placeholder = await input.getAttribute('placeholder');
        const ariaLabel = await input.getAttribute('aria-label');
        const combined = `${placeholder || ''} ${ariaLabel || ''}`.toLowerCase();
        if (combined.includes('user') || combined.includes('email') || combined.includes('login')) {
          console.log(`🔍 Found username field by placeholder/aria-label: "${placeholder || ariaLabel}"`);
          return input;
        }
      }

      // Strategy 4: First visible text input that's not password
      const firstTextInput = await this.page.$('input[type="text"]:visible, input:not([type]):visible');
      if (firstTextInput) {
        console.log(`🔍 Found username field as first visible text input`);
        return firstTextInput;
      }
    }

    return null;
  }

  /**
   * Handle Cognito session continuation page ("Sign in as [email]" button)
   * This appears when user has an existing Cognito session
   * Returns: 'success' if login completed, 'not_found' if no session continue button, 'clicked' if button clicked but need more handling
   */
  private async handleCognitoSessionContinuation(originalAppUrl: string): Promise<'success' | 'not_found' | 'clicked'> {
    if (!this.page) return 'not_found';

    console.log(`🔍 Checking for Cognito session continuation button...`);

    // Look for "Sign in as [email]" button - Cognito session continuation
    const buttons = await this.page.$$('button');
    let sessionContinueButton: import('playwright').ElementHandle<Element> | null = null;

    for (const btn of buttons) {
      const btnText = await btn.textContent();
      const textLower = (btnText || '').toLowerCase().trim();
      // Match patterns like "sign in as email@example.com" or "continue as email@example.com"
      if (textLower.includes('sign in as') || textLower.includes('continue as')) {
        sessionContinueButton = btn;
        console.log(`🔑 Found Cognito session continuation button: "${btnText?.trim()}"`);
        break;
      }
    }

    if (!sessionContinueButton) {
      // Also check for submit buttons with value containing "sign in as"
      const submitButtons = await this.page.$$('input[type="submit"]');
      for (const btn of submitButtons) {
        const value = await btn.getAttribute('value');
        const valueLower = (value || '').toLowerCase();
        if (valueLower.includes('sign in as') || valueLower.includes('continue as')) {
          sessionContinueButton = btn;
          console.log(`🔑 Found Cognito session continuation submit button: "${value}"`);
          break;
        }
      }
    }

    if (!sessionContinueButton) {
      console.log(`⚠️  No session continuation button found`);
      return 'not_found';
    }

    // Click the session continuation button
    console.log(`🔘 Clicking session continuation button...`);
    await sessionContinueButton.click();

    // Wait for redirect back to app
    try {
      await this.page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' });
    } catch {
      await this.page.waitForTimeout(3000);
    }

    const newUrl = this.page.url();
    console.log(`🔗 After session continuation, URL: ${newUrl}`);

    // Check if we're back on the original app domain (login succeeded)
    try {
      const originalHost = new URL(originalAppUrl).hostname;
      const currentHost = new URL(newUrl).hostname;

      if (currentHost === originalHost || (originalHost === 'localhost' && currentHost === 'localhost')) {
        console.log(`✅ Session continuation successful - redirected back to app`);
        return 'success';
      }
    } catch {
      // URL parsing failed, continue
    }

    // Still on OAuth provider - might need credential entry
    console.log(`📍 Still on OAuth provider after session continue click`);
    return 'clicked';
  }

  /**
   * Perform login using provided credentials - simplified version that uses AI guidance
   */
  private async performLogin(credentials: { username: string; password: string }): Promise<{ success: boolean; newUrl?: string } | null> {
    if (!this.page) return null;

    const currentUrl = this.page.url();

    try {
      // Find username/email field
      let usernameInputs = await this.page.$$('input[type="text"], input[type="email"]');
      let passwordInputs = await this.page.$$('input[type="password"]');

      // OAUTH/COGNITO FLOW: If no input fields, look for a Sign In button to click first
      // This handles redirect-based auth (Cognito, Auth0, Okta, etc.)
      if (usernameInputs.length === 0 || passwordInputs.length === 0) {
        console.log(`🔄 No credential fields found - checking for OAuth/redirect login flow...`);

        // Look for a Sign In button that triggers OAuth redirect
        let oauthButton = await this.page.$('button[type="submit"], input[type="submit"]');

        if (!oauthButton) {
          const allButtons = await this.page.$$('button');
          for (const btn of allButtons) {
            const btnText = await btn.textContent();
            const textLower = (btnText || '').toLowerCase().trim();
            // Match "Sign In", "Login", "Log in", "Continue with...", etc.
            if (textLower === 'sign in' || textLower === 'login' || textLower === 'log in' ||
                textLower.includes('sign in') || textLower.includes('continue')) {
              oauthButton = btn;
              console.log(`🔗 Found OAuth trigger button: "${btnText?.trim()}"`);
              break;
            }
          }
        }

        // Also check for links styled as buttons
        if (!oauthButton) {
          const allLinks = await this.page.$$('a');
          for (const link of allLinks) {
            const linkText = await link.textContent();
            const textLower = (linkText || '').toLowerCase().trim();
            if (textLower === 'sign in' || textLower === 'login' || textLower === 'log in') {
              oauthButton = link;
              console.log(`🔗 Found OAuth trigger link: "${linkText?.trim()}"`);
              break;
            }
          }
        }

        if (oauthButton) {
          console.log(`🔗 Clicking OAuth button to trigger redirect...`);
          await oauthButton.click();

          // Wait for navigation to OAuth provider
          try {
            await this.page.waitForNavigation({ timeout: 10000, waitUntil: 'domcontentloaded' });
          } catch {
            // Navigation might have already happened or be slow
            await this.page.waitForTimeout(3000);
          }

          const oauthUrl = this.page.url();
          console.log(`🔗 Redirected to: ${oauthUrl}`);

          // Now look for credential fields on the OAuth provider page
          // Wait a moment for the page to fully load
          await this.page.waitForTimeout(1000);

          // Re-check for credential fields on OAuth page
          usernameInputs = await this.page.$$('input[type="text"], input[type="email"]');
          passwordInputs = await this.page.$$('input[type="password"]');

          // Cognito has specific selectors - try those too
          if (usernameInputs.length === 0) {
            const cognitoUsername = await this.page.$('input[name="username"], input[name="signInFormUsername"], #signInFormUsername');
            if (cognitoUsername) {
              usernameInputs = [cognitoUsername];
              console.log(`🔑 Found Cognito username field`);
            }
          }
          if (passwordInputs.length === 0) {
            const cognitoPassword = await this.page.$('input[name="password"], input[name="signInFormPassword"], #signInFormPassword');
            if (cognitoPassword) {
              passwordInputs = [cognitoPassword];
              console.log(`🔑 Found Cognito password field`);
            }
          }

          if (usernameInputs.length === 0) {
            // Check if we're on an intermediate login page (same app domain) that needs another click
            const currentHost = new URL(this.page.url()).hostname;
            const originalHost = new URL(currentUrl).hostname;

            if (currentHost === originalHost || currentHost === 'localhost') {
              console.log(`📍 Redirected to intermediate login page on same domain: ${oauthUrl}`);
              console.log(`🔍 Looking for another Sign In button to trigger OAuth...`);

              // Look for another OAuth trigger button on this intermediate page
              let secondOauthButton: import('playwright').ElementHandle<Element> | null = null;

              const buttons = await this.page.$$('button');
              for (const btn of buttons) {
                const btnText = await btn.textContent();
                const textLower = (btnText || '').toLowerCase().trim();
                if (textLower === 'sign in' || textLower === 'login' || textLower === 'log in') {
                  secondOauthButton = btn;
                  console.log(`🔗 Found second OAuth trigger button: "${btnText?.trim()}"`);
                  break;
                }
              }

              // Also check links
              if (!secondOauthButton) {
                const links = await this.page.$$('a');
                for (const link of links) {
                  const linkText = await link.textContent();
                  const textLower = (linkText || '').toLowerCase().trim();
                  if (textLower === 'sign in' || textLower === 'login' || textLower === 'log in') {
                    secondOauthButton = link;
                    console.log(`🔗 Found second OAuth trigger link: "${linkText?.trim()}"`);
                    break;
                  }
                }
              }

              if (secondOauthButton) {
                console.log(`🔗 Clicking second OAuth button...`);
                await secondOauthButton.click();

                // Wait for navigation to actual OAuth provider
                try {
                  await this.page.waitForNavigation({ timeout: 10000, waitUntil: 'domcontentloaded' });
                } catch {
                  await this.page.waitForTimeout(3000);
                }

                const finalOauthUrl = this.page.url();
                console.log(`🔗 Final redirect to: ${finalOauthUrl}`);

                // Wait for page to load and re-check for credential fields
                await this.page.waitForTimeout(1000);

                usernameInputs = await this.page.$$('input[type="text"], input[type="email"]');
                passwordInputs = await this.page.$$('input[type="password"]');

                // Try Cognito-specific selectors
                if (usernameInputs.length === 0) {
                  const cognitoUsername = await this.page.$('input[name="username"], input[name="signInFormUsername"], #signInFormUsername');
                  if (cognitoUsername) {
                    usernameInputs = [cognitoUsername];
                    console.log(`🔑 Found Cognito username field after second redirect`);
                  }
                }
                if (passwordInputs.length === 0) {
                  const cognitoPassword = await this.page.$('input[name="password"], input[name="signInFormPassword"], #signInFormPassword');
                  if (cognitoPassword) {
                    passwordInputs = [cognitoPassword];
                    console.log(`🔑 Found Cognito password field after second redirect`);
                  }
                }

                if (usernameInputs.length === 0) {
                  console.log(`⚠️  Still no username field found after second redirect on ${finalOauthUrl}`);
                  return null;
                }
              } else {
                // Check for Cognito session continuation page ("Sign in as [email]" button)
                const sessionContinueResult = await this.handleCognitoSessionContinuation(currentUrl);
                if (sessionContinueResult === 'success') {
                  return { success: true, newUrl: this.page.url() };
                } else if (sessionContinueResult === 'not_found') {
                  console.log(`⚠️  OAuth redirect occurred but no username field or second OAuth button found on ${oauthUrl}`);
                  return null;
                }
                // If 'clicked', continue - we may need to handle credential fields after
              }
            } else {
              // Check for Cognito session continuation page ("Sign in as [email]" button)
              const sessionContinueResult = await this.handleCognitoSessionContinuation(currentUrl);
              if (sessionContinueResult === 'success') {
                return { success: true, newUrl: this.page.url() };
              } else if (sessionContinueResult === 'not_found') {
                console.log(`⚠️  OAuth redirect occurred but no username field found on ${oauthUrl}`);
                return null;
              }
              // If 'clicked', continue - we may need to handle credential fields after
            }
          }

          // Note: passwordInputs may be empty for multi-step flows (Cognito shows password after username)
          if (passwordInputs.length === 0) {
            console.log(`📝 Found username field but no password field - likely multi-step login flow`);
          } else {
            console.log(`✅ Found credential fields on OAuth page`);
          }
        } else {
          console.log(`⚠️  Could not find username/password fields or OAuth button`);
          return null;
        }
      }

      // Fill in credentials - handle multi-step flows (like Cognito) or single-page flows
      console.log(`📝 Filling credentials...`);

      // Check if this is a multi-step flow (username only, no password visible yet)
      const isMultiStepFlow = usernameInputs.length > 0 && passwordInputs.length === 0;

      if (isMultiStepFlow) {
        console.log(`🔄 Detected multi-step login flow (username first)`);

        // Step 1: Fill username
        await usernameInputs[0].fill(credentials.username);
        await this.page.waitForTimeout(500);

        // Find "Next" or "Continue" button for step 1
        // Try generic selectors first (AI-friendly approach), then specific fallbacks
        let nextButton: import('playwright').ElementHandle<Element> | null = await this.findButtonByText(['next', 'continue', 'submit', 'sign in']);
        if (!nextButton) {
          nextButton = await this.page.$('button[type="submit"], input[type="submit"]');
        }
        // Cognito-specific fallback only if generic selectors fail
        if (!nextButton) {
          nextButton = await this.page.$('input[name="signInSubmitButton"]');
        }

        if (nextButton) {
          const btnText = await nextButton.textContent() || await nextButton.getAttribute('value') || 'unknown';
          console.log(`🔘 Found submit button: "${btnText.trim()}"`);
          console.log(`🔘 Clicking Next button...`);
          await nextButton.click();

          // Wait for password field to appear using waitForSelector (more reliable than fixed timeout)
          console.log(`⏳ Waiting for password field to appear...`);
          let passwordInput: import('playwright').ElementHandle<Element> | null = null;

          try {
            // Wait for any password field to appear
            await this.page.waitForSelector(
              'input[type="password"], input[name="password"], #signInFormPassword',
              { timeout: 8000 }
            );
            console.log(`✅ Password field appeared`);
          } catch {
            console.log(`⚠️  Timeout waiting for password field`);
            // Log current URL to help debug
            console.log(`📍 Current URL after clicking Next: ${this.page.url()}`);
            // Check for error messages
            const errorEl = await this.page.$('.error, .alert-error, [role="alert"], .cognito-asf-error');
            if (errorEl) {
              const errorText = await errorEl.textContent();
              console.log(`❌ Error message on page: ${errorText?.trim()}`);
            }
          }

          // Look for password field with generic selectors first
          passwordInput = await this.page.$('input[type="password"]');
          if (!passwordInput) {
            passwordInput = await this.page.$('input[name="password"]');
          }
          // Site-specific fallbacks only if generic selectors fail
          if (!passwordInput) {
            passwordInput = await this.page.$('#signInFormPassword, input[name="signInFormPassword"]');
          }

          if (passwordInput) {
            console.log(`🔑 Found password field in step 2`);
            await passwordInput.fill(credentials.password);
            await this.page.waitForTimeout(500);

            // Find submit button for step 2
            let submitButton = await this.findButtonByText(['continue', 'sign in', 'login', 'log in', 'submit']);
            if (!submitButton) {
              submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
            }

            if (submitButton) {
              console.log(`🔘 Clicking submit button...`);
              await submitButton.click();
            } else {
              console.log(`⚠️  Could not find submit button in step 2`);
              return null;
            }
          } else {
            console.log(`⚠️  Password field not found after clicking Next`);
            // Take screenshot for debugging
            console.log(`📍 Current URL: ${this.page.url()}`);
            return null;
          }
        } else {
          console.log(`⚠️  Could not find Next button for multi-step flow`);
          return null;
        }
      } else {
        // Single-page login flow - fill both fields together
        console.log(`📝 Single-page login flow`);
        await usernameInputs[0].fill(credentials.username);
        await this.page.waitForTimeout(500);
        await passwordInputs[0].fill(credentials.password);
        await this.page.waitForTimeout(500);

        // Find and click submit button
        let submitButton = await this.findButtonByText(['sign in', 'login', 'log in', 'submit']);
        if (!submitButton) {
          submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
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

        console.log(`🔘 Clicking submit button...`);
        await submitButton.click();
      }

      // Wait for navigation back to app (OAuth callback)
      try {
        await this.page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' });
      } catch {
        // Navigation might have already happened
        await this.page.waitForTimeout(3000);
      }

      let newUrl = this.page.url();
      console.log(`📍 Post-login URL (initial): ${newUrl}`);

      // CRITICAL: After OAuth callback, the app may do internal redirects (e.g., /?code=... -> /dashboard)
      // We need to wait for these to complete to capture the final authenticated URL
      // Wait for URL to stabilize (stop changing) with a max timeout
      const maxWaitTime = 8000;  // 8 seconds max wait
      const checkInterval = 500;
      let waitedTime = 0;
      let lastUrl = newUrl;

      console.log(`⏳ Waiting for app internal redirects to complete...`);
      while (waitedTime < maxWaitTime) {
        await this.page.waitForTimeout(checkInterval);
        waitedTime += checkInterval;
        const currentUrl = this.page.url();

        if (currentUrl !== lastUrl) {
          console.log(`   🔄 URL changed: ${lastUrl} → ${currentUrl}`);
          lastUrl = currentUrl;
          // Reset wait timer when URL changes - give more time for next potential redirect
          waitedTime = Math.max(0, waitedTime - 2000);
        } else if (waitedTime >= 2000) {
          // URL hasn't changed for 2 seconds, consider it stable
          console.log(`   ✅ URL stable for ${checkInterval * 4}ms: ${currentUrl}`);
          break;
        }
      }

      newUrl = this.page.url();
      console.log(`📍 Post-login URL (final): ${newUrl}`);

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
   * Wait for dynamic content to finish loading before capturing page state.
   * AI-first approach: short buffer wait, then AI vision check if page looks loaded.
   */
  private async waitForDynamicContent(): Promise<void> {
    if (!this.page) return;

    // Short buffer wait - catches most timing issues without AI cost
    await this.page.waitForTimeout(2000);

    // Take a quick screenshot for AI to evaluate
    const screenshotDir = this.runScreenshotDir || this.config.screenshotDir;
    const tempScreenshot = join(screenshotDir, `loading-check-${Date.now()}.png`);

    try {
      await this.page.screenshot({ path: tempScreenshot, fullPage: false });
      const result = await this.visionService.isPageLoaded(tempScreenshot);

      if (result.loaded) {
        console.log(`✅ Page loaded: ${result.reason}`);
        // Clean up temp screenshot
        try { unlinkSync(tempScreenshot); } catch {}
        return;
      }

      // AI says still loading - wait and re-check (up to 2 more times)
      console.log(`⏳ Page still loading: ${result.reason}`);
      const maxRetries = 2;
      for (let i = 0; i < maxRetries; i++) {
        await this.page.waitForTimeout(5000); // Wait 5 seconds between checks

        await this.page.screenshot({ path: tempScreenshot, fullPage: false });
        const recheck = await this.visionService.isPageLoaded(tempScreenshot);

        if (recheck.loaded) {
          console.log(`✅ Page loaded after extra wait: ${recheck.reason}`);
          try { unlinkSync(tempScreenshot); } catch {}
          return;
        }
        console.log(`⏳ Still loading (check ${i + 2}): ${recheck.reason}`);
      }

      console.log('⚠️  Page may still be loading after max wait - proceeding with current state');
      try { unlinkSync(tempScreenshot); } catch {}
    } catch (error) {
      console.warn(`⚠️  Loading check failed, proceeding: ${error}`);
      try { unlinkSync(tempScreenshot); } catch {}
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

    // FLOW-AWARE: Capture page state BEFORE the action
    const stateBefore = await this.capturePageState();

    try {
      // Try to find and interact with elements
      if (actionLower.includes('click') || actionLower.includes('button') || actionLower.includes('link')) {
        // Find clickable elements, but filter to only same-domain links
        const allButtons = await this.page.$$('button, a[href], [role="button"]');
        const sameDomainButtons = [];
        
        for (const button of allButtons) {
          const tagName = await button.evaluate((el) => el.tagName.toLowerCase());
          const text = await button.textContent();

          // Check if this element should be excluded based on text
          if (text && this.isElementExcluded(text)) {
            console.log(`🚫 Skipping excluded element: ${text.trim().substring(0, 50)}`);
            continue;
          }

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
          // CRITICAL: Match the AI's suggested action to actual element text
          // Extract what the AI wants to click from the action string
          let targetText = '';

          // Parse AI action: "Click Sign In", "Click the Sign In button", "Click on \"Sign In\"", etc.
          const clickMatch = suggestion.action.match(/click\s+(?:the\s+)?(?:on\s+)?["']?([^"']+?)["']?(?:\s+button|\s+link)?$/i);
          if (clickMatch) {
            targetText = clickMatch[1].trim();
          } else {
            // Fallback: use the whole action minus common prefixes
            targetText = suggestion.action.replace(/^(click|press|select|tap)\s+(the\s+)?(on\s+)?/i, '').trim();
          }

          console.log(`🎯 AI wants to click: "${targetText}"`);

          // Find the best matching button
          let selectedButton = null;
          let bestMatchScore = 0;

          for (const button of sameDomainButtons) {
            const text = await button.textContent();
            const btnText = (text || '').trim().toLowerCase();
            const targetLower = targetText.toLowerCase();

            // Exact match (highest priority)
            if (btnText === targetLower) {
              selectedButton = button;
              bestMatchScore = 100;
              console.log(`✅ Exact match found: "${text?.trim()}"`);
              break;
            }

            // Contains match
            if (btnText.includes(targetLower) || targetLower.includes(btnText)) {
              const score = Math.min(btnText.length, targetLower.length) / Math.max(btnText.length, targetLower.length) * 80;
              if (score > bestMatchScore) {
                selectedButton = button;
                bestMatchScore = score;
                console.log(`🔍 Partial match: "${text?.trim()}" (score: ${score.toFixed(0)})`);
              }
            }

            // Word overlap match
            const targetWords = targetLower.split(/\s+/);
            const btnWords = btnText.split(/\s+/);
            const overlap = targetWords.filter(w => btnWords.includes(w)).length;
            if (overlap > 0) {
              const score = (overlap / Math.max(targetWords.length, btnWords.length)) * 60;
              if (score > bestMatchScore) {
                selectedButton = button;
                bestMatchScore = score;
                console.log(`🔍 Word overlap match: "${text?.trim()}" (score: ${score.toFixed(0)})`);
              }
            }
          }

          // If no good match found, don't click randomly - return null
          if (!selectedButton || bestMatchScore < 30) {
            console.log(`⚠️  No matching element found for "${targetText}" (best score: ${bestMatchScore.toFixed(0)})`);
            return null;
          }

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

          console.log(`🖱️  Clicking: "${text?.trim()}"`);
          await selectedButton.click();

          // FLOW-AWARE: Wait for state to stabilize and capture outcome
          await this.waitForStateStabilization(2000);
          const stateAfter = await this.capturePageState();
          const outcome = this.detectActionOutcome(stateBefore, stateAfter);

          // Log what we observed
          if (outcome.navigationOccurred) {
            console.log(`   📍 OBSERVED: Navigation to ${outcome.urlAfter}`);
          }
          if (outcome.modalAppeared?.detected) {
            console.log(`   📍 OBSERVED: Modal appeared (${outcome.modalAppeared.type}${outcome.modalAppeared.title ? `: ${outcome.modalAppeared.title}` : ''})`);
          }
          if (outcome.inlineUpdateDetected) {
            console.log(`   📍 OBSERVED: Inline content update (no navigation)`);
          }

          return {
            type: 'click',
            target: text || 'unknown',
            description: `Clicked: ${text || suggestion.action}`,
            timestamp,
            success: true,
            outcome,
          };
        }
      } else if (actionLower.includes('fill') && actionLower.includes('credentials')) {
        // AI-driven credential filling: "Fill username field with credentials" or "Fill password field with credentials"

        // CRITICAL: Don't fill credentials if we're already logged in!
        // The AI sometimes confuses regular form fields (like "Project Name") with login fields
        if (this.hasCompletedLogin) {
          console.log(`⏭️  Skipping credential fill - already logged in (hasCompletedLogin=true)`);
          return null;
        }

        const isPasswordField = actionLower.includes('password');
        const isUsernameField = actionLower.includes('username') || actionLower.includes('email');

        // Get credentials from context file
        const currentUrl = this.page.url();
        const credentials = await this.getCredentialsForLogin(currentUrl, { isLoginPage: true, credentialsVisible: false, shouldLogin: true });

        if (!credentials.username || !credentials.password) {
          console.log(`⚠️  No credentials available in context file for credential fill action`);
          return null;
        }

        if (isPasswordField) {
          // Find password field dynamically
          const passwordField = await this.findInputFieldByType('password');
          if (passwordField) {
            console.log(`🔑 AI-driven: Filling password field with credentials`);
            await passwordField.fill(credentials.password);
            this.hasCompletedLogin = false; // Will be set to true after successful navigation

            // FLOW-AWARE: Capture state after filling
            await this.page.waitForTimeout(300);
            const stateAfter = await this.capturePageState();
            const outcome = this.detectActionOutcome(stateBefore, stateAfter);

            return {
              type: 'type',
              target: 'password field',
              value: '********',
              description: `Filled password field with credentials`,
              timestamp,
              success: true,
              outcome,
            };
          } else {
            console.log(`⚠️  Could not find password field on page`);
            return null;
          }
        } else if (isUsernameField) {
          // Find username/email field dynamically
          const usernameField = await this.findInputFieldByType('username');
          if (usernameField) {
            console.log(`🔑 AI-driven: Filling username field with credentials: ${credentials.username}`);
            await usernameField.fill(credentials.username);

            // FLOW-AWARE: Capture state after filling
            await this.page.waitForTimeout(300);
            const stateAfter = await this.capturePageState();
            const outcome = this.detectActionOutcome(stateBefore, stateAfter);

            return {
              type: 'type',
              target: 'username field',
              value: credentials.username,
              description: `Filled username field with credentials`,
              timestamp,
              success: true,
              outcome,
            };
          } else {
            console.log(`⚠️  Could not find username field on page`);
            return null;
          }
        } else {
          console.log(`⚠️  Credential fill action but couldn't determine field type: ${suggestion.action}`);
          return null;
        }
      } else if (actionLower.includes('type') || actionLower.includes('input') || actionLower.includes('form')) {
        // Find input fields
        const inputs = await this.page.$$('input[type="text"], input[type="email"], textarea');
        if (inputs.length > 0) {
          const input = inputs[0];
          const placeholder = await input.getAttribute('placeholder') || 'field';
          const testValue = this.generateTestValue(placeholder);

          await input.fill(testValue);

          // FLOW-AWARE: Capture state after typing
          await this.page.waitForTimeout(500);
          const stateAfter = await this.capturePageState();
          const outcome = this.detectActionOutcome(stateBefore, stateAfter);

          if (outcome.inlineUpdateDetected) {
            console.log(`   📍 OBSERVED: Content update after typing`);
          }

          return {
            type: 'type',
            target: placeholder,
            value: testValue,
            description: `Typed "${testValue}" into ${placeholder}`,
            timestamp,
            success: true,
            outcome,
          };
        }
      } else if (actionLower.includes('scroll')) {
        await this.page.evaluate(() => window.scrollBy(0, 500));

        // FLOW-AWARE: Capture state after scrolling (might trigger lazy loading)
        await this.page.waitForTimeout(500);
        const stateAfter = await this.capturePageState();
        const outcome = this.detectActionOutcome(stateBefore, stateAfter);

        if (outcome.inlineUpdateDetected) {
          console.log(`   📍 OBSERVED: Content loaded after scrolling`);
        }

        return {
          type: 'scroll',
          description: 'Scrolled down the page',
          timestamp,
          success: true,
          outcome,
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

          // FLOW-AWARE: Wait for state to stabilize and capture outcome
          await this.waitForStateStabilization(2000);
          const stateAfter = await this.capturePageState();
          const outcome = this.detectActionOutcome(stateBefore, stateAfter);

          if (outcome.navigationOccurred) {
            console.log(`   📍 OBSERVED: Navigation to ${outcome.urlAfter}`);
          }

          return {
            type: 'click',
            target: text || 'navigation link',
            description: `Clicked navigation link: ${text || 'link'}`,
            timestamp,
            success: true,
            outcome,
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

  /**
   * Check if a domain is allowed (either the start domain or in allowedDomains list)
   */
  private isDomainAllowed(url: string): boolean {
    try {
      const urlDomain = new URL(url).hostname.replace(/^www\./, '');
      const normalizedStartDomain = this.startDomain.replace(/^www\./, '');

      // Check if it's the start domain
      if (urlDomain === normalizedStartDomain) {
        return true;
      }

      // Check if it's in the allowed domains list (supports partial matching for subdomains)
      for (const allowed of this.allowedDomains) {
        const normalizedAllowed = allowed.replace(/^www\./, '');
        // Check exact match or subdomain match (e.g., "amazoncognito.com" matches "us-east-1xxx.auth.us-east-1.amazoncognito.com")
        if (urlDomain === normalizedAllowed || urlDomain.endsWith('.' + normalizedAllowed)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Load allowed domains from context file for the given URL
   */
  private async loadAllowedDomains(url: string): Promise<void> {
    this.allowedDomains = [];

    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      const port = urlObj.port;

      console.log(`📂 [loadAllowedDomains] Looking for context file for ${domain}${port ? `:${port}` : ''}`);

      // Try port-specific context first (e.g., localhost-4002.json)
      let contextPath = port
        ? join(process.cwd(), 'context', `${domain}-${port}.json`)
        : join(process.cwd(), 'context', `${domain}.json`);

      console.log(`📂 [loadAllowedDomains] Trying: ${contextPath}`);

      // If port-specific doesn't exist, try domain-only
      if (port && !existsSync(contextPath)) {
        console.log(`📂 [loadAllowedDomains] Port-specific not found, trying domain-only`);
        contextPath = join(process.cwd(), 'context', `${domain}.json`);
      }

      if (existsSync(contextPath)) {
        console.log(`✅ [loadAllowedDomains] Found context file: ${contextPath}`);
        const contextContent = await readFile(contextPath, 'utf-8');
        const contextFile = JSON.parse(contextContent);

        if (contextFile.allowedDomains && Array.isArray(contextFile.allowedDomains)) {
          this.allowedDomains = contextFile.allowedDomains;
          console.log(`🌐 Loaded allowed domains from context: ${this.allowedDomains.join(', ')}`);
        } else {
          console.log(`ℹ️  [loadAllowedDomains] No allowedDomains array in context file`);
        }

        // Also load excludeElements
        if (contextFile.excludeElements && Array.isArray(contextFile.excludeElements)) {
          this.excludeElements = contextFile.excludeElements;
          console.log(`🚫 Loaded excluded elements from context: ${this.excludeElements.join(', ')}`);
        }

        // Load site context for AI vision (siteDescription, importantTests, login instructions)
        if (contextFile.siteDescription) {
          this.siteContext.siteDescription = contextFile.siteDescription;
          console.log(`📝 Loaded site description for AI context`);
        }
        if (contextFile.importantTests && Array.isArray(contextFile.importantTests)) {
          this.siteContext.importantTests = contextFile.importantTests;
          console.log(`📋 Loaded ${contextFile.importantTests.length} important tests for AI context`);
          // Extract login instructions from importantTests if present
          const loginTest = contextFile.importantTests.find((t: any) =>
            t.name?.toLowerCase().includes('login') || t.description?.toLowerCase().includes('login')
          );
          if (loginTest?.description) {
            this.siteContext.loginInstructions = loginTest.description;
            console.log(`🔑 Extracted login instructions from importantTests`);
          }
        }
      } else {
        console.log(`⚠️  [loadAllowedDomains] Context file not found: ${contextPath}`);
      }
    } catch (error) {
      console.error(`⚠️  Error loading allowed domains: ${error}`);
    }
  }

  /**
   * Check if an element text should be excluded from interaction
   */
  private isElementExcluded(elementText: string): boolean {
    if (!elementText || this.excludeElements.length === 0) {
      return false;
    }
    const lowerText = elementText.toLowerCase();
    return this.excludeElements.some(pattern =>
      lowerText.includes(pattern.toLowerCase())
    );
  }

  // ============================================================================
  // Flow-Aware Testing: State Capture and Outcome Detection
  // ============================================================================

  /**
   * Capture current page state for before/after comparison
   */
  private async capturePageState(): Promise<{
    url: string;
    contentHash: string;
    visibleModals: Array<{ type: string; title?: string }>;
  }> {
    if (!this.page) {
      return { url: '', contentHash: '', visibleModals: [] };
    }

    const url = this.page.url();

    // Compute a simple content hash based on visible text
    const contentHash = await this.page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      // Get visible text content and hash it
      const text = body.innerText || '';
      // Simple hash: use length + first/last chars + some sample chars
      const sample = text.substring(0, 100) + text.substring(text.length - 100);
      return `${text.length}:${sample.replace(/\s+/g, '').substring(0, 50)}`;
    }).catch(() => '');

    const visibleModals = await this.detectVisibleModals();

    return { url, contentHash, visibleModals };
  }

  /**
   * Detect visible modals, dialogs, dropdowns, and toasts on the page
   */
  private async detectVisibleModals(): Promise<Array<{ type: 'dialog' | 'dropdown' | 'popover' | 'toast'; title?: string }>> {
    if (!this.page) return [];

    try {
      return await this.page.evaluate(() => {
        const modals: Array<{ type: 'dialog' | 'dropdown' | 'popover' | 'toast'; title?: string }> = [];

        // Check for dialogs (role="dialog" or common modal classes)
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, .dialog, [class*="modal"], [class*="dialog"]'));
        for (const dialog of dialogs) {
          const element = dialog as HTMLElement;
          if (element.offsetParent !== null || getComputedStyle(element).display !== 'none') {
            const title = dialog.querySelector('[role="heading"], h1, h2, h3, .modal-title, .dialog-title')?.textContent?.trim();
            modals.push({ type: 'dialog', title });
          }
        }

        // Check for dropdowns (visible dropdown menus)
        const dropdowns = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], .dropdown-menu:not(.hidden), [class*="dropdown"][class*="open"], [class*="dropdown"][class*="visible"]'));
        for (const dropdown of dropdowns) {
          const element = dropdown as HTMLElement;
          if (element.offsetParent !== null || getComputedStyle(element).display !== 'none') {
            modals.push({ type: 'dropdown' });
          }
        }

        // Check for toasts/notifications
        const toasts = Array.from(document.querySelectorAll('[role="alert"], .toast, .notification, [class*="toast"], [class*="snackbar"]'));
        for (const toast of toasts) {
          const element = toast as HTMLElement;
          if (element.offsetParent !== null || getComputedStyle(element).display !== 'none') {
            const title = toast.textContent?.trim()?.substring(0, 100);
            modals.push({ type: 'toast', title });
          }
        }

        // Check for popovers
        const popovers = Array.from(document.querySelectorAll('[role="tooltip"], .popover, [class*="popover"]'));
        for (const popover of popovers) {
          const element = popover as HTMLElement;
          if (element.offsetParent !== null || getComputedStyle(element).display !== 'none') {
            modals.push({ type: 'popover' });
          }
        }

        return modals;
      });
    } catch {
      return [];
    }
  }

  /**
   * Detect what happened after an action by comparing before/after states
   */
  private detectActionOutcome(
    stateBefore: { url: string; contentHash: string; visibleModals: Array<{ type: string; title?: string }> },
    stateAfter: { url: string; contentHash: string; visibleModals: Array<{ type: string; title?: string }> }
  ): ActionOutcome {
    const outcome: ActionOutcome = {
      urlBefore: stateBefore.url,
      urlAfter: stateAfter.url,
      navigationOccurred: stateBefore.url !== stateAfter.url,
      contentHashBefore: stateBefore.contentHash,
      contentHashAfter: stateAfter.contentHash,
    };

    // Check for new modals
    const modalsBefore = stateBefore.visibleModals.length;
    const modalsAfter = stateAfter.visibleModals.length;

    if (modalsAfter > modalsBefore) {
      const newModal = stateAfter.visibleModals[stateAfter.visibleModals.length - 1];
      outcome.modalAppeared = {
        detected: true,
        title: newModal?.title,
        type: newModal?.type as 'dialog' | 'dropdown' | 'popover' | 'toast',
      };
    }

    // Check for inline content updates (content changed but URL didn't)
    if (!outcome.navigationOccurred && stateBefore.contentHash !== stateAfter.contentHash) {
      outcome.inlineUpdateDetected = true;
    }

    return outcome;
  }

  /**
   * Wait for page state to stabilize after an action
   * Similar to the login flow stabilization pattern
   */
  private async waitForStateStabilization(maxWaitMs: number = 3000): Promise<void> {
    if (!this.page) return;

    const checkInterval = 300;
    let waitedTime = 0;
    let lastUrl = this.page.url();
    let lastHash = await this.page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);

    while (waitedTime < maxWaitMs) {
      await this.page.waitForTimeout(checkInterval);
      waitedTime += checkInterval;

      const currentUrl = this.page.url();
      const currentHash = await this.page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);

      // Check if state has stabilized
      if (currentUrl === lastUrl && currentHash === lastHash) {
        // State hasn't changed for this interval, consider it stable
        if (waitedTime >= checkInterval * 2) {
          break;
        }
      } else {
        // State changed, reset stability counter
        lastUrl = currentUrl;
        lastHash = currentHash;
      }
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
