import { Browser, Page, chromium } from 'playwright';
import { Config, PageState, Action, VisionAnalysis } from './types.js';
import { AIVisionService } from './ai-vision.js';
import { mkdir, writeFile } from 'fs/promises';
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
    while (urlsToVisit.length > 0 && pages.length < this.config.maxPages && this.actionCount < this.config.maxActions) {
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
          const pageState = await this.analyzeAndInteract(currentUrl);
          pages.push(pageState);
          console.log(`✅ Successfully analyzed page: ${currentUrl} (${pages.length} total pages)`);

          // Extract new URLs from the page
          const links = await this.page.$$eval('a[href]', (anchors) =>
            anchors.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)
          );

          console.log(`🔍 Found ${links.length} total links on page`);
          console.log(`🔍 Current state: pages.length=${pages.length}, maxPages=${this.config.maxPages}, actionCount=${this.actionCount}, maxActions=${this.config.maxActions}`);
          console.log(`🔍 urlsToVisit.length=${urlsToVisit.length}, visitedUrls.size=${this.visitedUrls.size}`);

          let linksAdded = 0;
          for (const link of links) {
            const normalized = this.normalizeUrl(link);
            const isSameDomain = this.isSameDomain(link, startUrl);
            const isVisited = this.visitedUrls.has(normalized);
            const wouldExceedMax = urlsToVisit.length + pages.length >= this.config.maxPages;
            
            if (!isVisited && isSameDomain && !wouldExceedMax) {
              urlsToVisit.push(link);
              this.visitedUrls.add(normalized);
              linksAdded++;
            }
          }
          console.log(`🔍 Added ${linksAdded} new links to visit queue`);
          console.log(`🔍 Queue now has ${urlsToVisit.length} URLs to visit`);
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

  private async analyzeAndInteract(url: string): Promise<PageState> {
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
    const discoveredElements = await this.extractDiscoveredElements(url);

    // Get previous actions for context
    const previousActions = Array.from(this.pagesVisited.values())
      .flatMap((p) => p.actions)
      .map((a) => a.description)
      .slice(-5); // Last 5 actions for context

    // Analyze with AI vision
    console.log('🤖 Analyzing page with AI vision...');
    const analysis = await this.visionService.analyzePage(screenshotPath, url, previousActions);

    // Perform actions based on AI suggestions
    const actions: Action[] = [];
    const maxActionsPerPage = 5;
    
    for (const suggestion of analysis.suggestedActions.slice(0, maxActionsPerPage)) {
      if (this.actionCount >= this.config.maxActions) break;

      try {
        const action = await this.performAction(suggestion, analysis);
        if (action) {
          actions.push(action);
          this.actionCount++;
          
          // Wait a bit between actions
          await this.page!.waitForTimeout(1000);
        }
      } catch (error) {
        console.error(`Error performing action: ${suggestion.action}`, error);
        actions.push({
          type: 'wait',
          description: suggestion.action,
          timestamp: new Date(),
          success: false,
          error: String(error),
        });
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
    return pageState;
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
      // Extract links (same-domain only)
      const allLinks = await this.page.$$eval('a[href]', (anchors) =>
        anchors.map((a) => ({
          text: a.textContent?.trim() || '',
          href: (a as HTMLAnchorElement).href,
        }))
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
            });
          }
        } catch {
          // Skip invalid URLs
        }
      }

      // Extract buttons
      const buttons = await this.page.$$eval(
        'button, [role="button"], input[type="button"], input[type="submit"]',
        (elements) =>
          elements.map((el) => ({
            text: el.textContent?.trim() || (el as HTMLInputElement).value || '',
            type: (el as HTMLInputElement).type || 'button',
            visible: true, // Assume visible if found
          }))
      );

      const discoveredButtons: import('./types.js').DiscoveredButton[] = buttons
        .filter((b) => b.text.length > 0)
        .map((b) => ({
          text: b.text,
          type: b.type,
          visible: b.visible,
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

      // Extract headings
      const headings = await this.page.$$eval('h1, h2, h3, h4, h5, h6', (elements) =>
        elements.map((el) => ({
          level: parseInt(el.tagName.charAt(1)) || 1,
          text: el.textContent?.trim() || '',
        }))
      );

      const discoveredHeadings: import('./types.js').DiscoveredHeading[] = headings
        .filter((h) => h.text.length > 0)
        .map((h) => ({
          level: h.level,
          text: h.text,
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
      } else if (actionLower.includes('navigate') || actionLower.includes('link')) {
        // Already handled in exploreWebsite
        return null;
      }

      // Default: wait
      await this.page.waitForTimeout(1000);
      return {
        type: 'wait',
        description: suggestion.action,
        timestamp,
        success: true,
      };
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

