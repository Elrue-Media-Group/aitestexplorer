export interface Config {
  maxPages: number;
  maxActions: number;
  maxTestsToExecute: number; // 0 = run all tests, N = run first N tests (sorted by priority)
  openaiApiKey: string;
  openaiModel: string;
  screenshotDir: string;
  outputDir: string;
  headless?: boolean;
}

export interface PageState {
  url: string;
  title: string;
  screenshot: string;
  timestamp: Date;
  actions: Action[];
  discoveredElements?: DiscoveredElements;
  visionAnalysis?: VisionAnalysis;
}

export interface DiscoveredElements {
  links: DiscoveredLink[];
  buttons: DiscoveredButton[];
  forms: DiscoveredForm[];
  headings: DiscoveredHeading[];
  navigationItems: string[];
}

export interface DiscoveredLink {
  text: string;
  href: string;
  isExternal: boolean;
  selector?: string;
}

export interface DiscoveredButton {
  text: string;
  type: string;
  selector?: string;
  visible: boolean;
}

export interface DiscoveredForm {
  fields: DiscoveredFormField[];
  action?: string;
  method?: string;
}

export interface DiscoveredFormField {
  type: string;
  name?: string;
  placeholder?: string;
  label?: string;
  required?: boolean;
}

export interface DiscoveredHeading {
  level: number;
  text: string;
  selector?: string;
}

export interface Action {
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'wait' | 'select';
  target?: string;
  value?: string;
  description: string;
  timestamp: Date;
  success: boolean;
  error?: string;
}

export interface VisionAnalysis {
  description: string;
  interactiveElements: InteractiveElement[];
  suggestedActions: SuggestedAction[];
  pageType: string;
  risks: string[];
  architecture: ArchitectureInfo;
  siteCharacteristics?: SiteCharacteristics;
  loginInfo?: LoginInfo;
}

export interface LoginInfo {
  isLoginPage: boolean;
  credentialsVisible?: boolean;
  username?: string;
  password?: string;
  shouldLogin?: boolean;
  postLoginStrategy?: string;
}

export interface SiteCharacteristics {
  sitePurpose?: string;
  contentNature?: 'static' | 'dynamic' | 'mixed';
  contentPatterns?: string[];
  testingGuidance?: string;
  updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
}

export interface InteractiveElement {
  type: 'button' | 'link' | 'input' | 'form' | 'dropdown' | 'checkbox' | 'radio';
  description: string;
  location: string;
  purpose: string;
  selector?: string;
  // Functional Understanding - AI's understanding of what the element does
  behavior?: string;  // What it does functionally (e.g., "takes input text and displays it back")
  workflow?: string;  // How it works in context (e.g., "User enters text → Clicks Update Name → Display panel updates")
  relatedElements?: string[];  // What it interacts with (e.g., ["name input field", "name display panel"])
  expectedOutcome?: string;  // What should happen when used (e.g., "Display panel updates with entered name")
}

export interface SuggestedAction {
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  target?: string;
}

export interface ArchitectureInfo {
  layout: string;
  navigation: string[];
  forms: string[];
  keyFeatures: string[];
  technology: string[];
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  expectedResult: string;
  priority: 'high' | 'medium' | 'low';
}

export interface TestStep {
  action: string;
  target: string;
  value?: string;
}

export interface AnalysisReport {
  url: string;
  startTime: Date;
  endTime: Date;
  pagesVisited: PageState[];
  testCases: TestCase[];
  architecture: ArchitectureGuide;
  suggestions: Suggestion[];
  risks: Risk[];
}

export interface ArchitectureGuide {
  siteStructure: string;
  navigationPatterns: string[];
  formPatterns: string[];
  technologyStack: string[];
  keyPages: string[];
  userFlows: string[];
}

export interface Suggestion {
  category: 'accessibility' | 'performance' | 'security' | 'ux' | 'seo' | 'other';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  page?: string;
}

export interface Risk {
  category: 'security' | 'functionality' | 'accessibility' | 'performance' | 'compatibility';
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  page?: string;
  recommendation: string;
}

/**
 * Credentials for authentication
 */
export interface ContextCredentials {
  username?: string;
  email?: string;
  password: string;
}

/**
 * Login selectors for authentication
 */
export interface LoginSelectors {
  emailField?: string;
  passwordField?: string;
  submitButton?: string;
}

/**
 * Authentication configuration
 */
export interface AuthenticationConfig {
  required?: boolean;
  type?: string; // e.g., 'cognito', 'auth0', 'basic'
  credentials?: ContextCredentials;
  loginPage?: string;
  loginSelectors?: LoginSelectors;
}

/**
 * Important test definition from context file
 */
export interface ImportantTest {
  name: string;
  description: string;
  page?: string;
  priority?: 'high' | 'medium' | 'low';
}

/**
 * Key page definition
 */
export interface KeyPage {
  path: string;
  description?: string;
  purpose?: string;
}

/**
 * Testing guidance configuration
 */
export interface TestingGuidance {
  testThese?: string[];
  dontTestThese?: string[];
  priority?: string;
  specialNotes?: string[];
}

/**
 * Filter behavior configuration
 */
export interface FilterBehavior {
  contentTypeFilters?: Record<string, string>;
  topicFilters?: string[];
}

/**
 * Context file configuration schema
 * This interface defines all valid fields for context/{domain}.json files
 */
export interface ContextFileConfig {
  // Site identification
  siteName?: string;
  domain?: string;

  // Site description (supports both field names for backward compatibility)
  siteDescription?: string;
  description?: string;

  // Site purpose and nature
  sitePurpose?: string;
  primaryPurpose?: string;
  contentNature?: 'static' | 'dynamic' | 'mixed';
  contentPatterns?: string[];
  updateFrequency?: 'real-time' | 'frequent' | 'periodic' | 'rare';
  updateSchedule?: string | Record<string, string>;
  technology?: string[];

  // Domain and element control
  allowedDomains?: string[];
  excludeElements?: string[];

  // Authentication
  authentication?: AuthenticationConfig;
  credentials?: ContextCredentials;
  demoCredentials?: ContextCredentials;

  // Test configuration
  importantTests?: ImportantTest[];
  customTestCases?: ImportantTest[]; // Alias for importantTests
  keyPages?: (string | KeyPage)[];

  // Testing guidance (supports both formats)
  testingNotes?: string;
  testingGuidance?: string | TestingGuidance;

  // Filter configuration
  filterBehavior?: FilterBehavior;

  // Documentation (not used in code, for human reference)
  _notes?: Record<string, string>;
}

/**
 * AI Page Analysis Response (structured JSON format)
 * Used for consistent AI response parsing
 */
export interface AIPageAnalysisResponse {
  pageClassification: {
    type: 'auth_gate' | 'public_marketing' | 'app_core' | 'settings' | 'error' | 'unknown';
    purpose: string;
  };
  pageDescription: string;
  interactiveElements: Array<{
    type: 'button' | 'link' | 'input' | 'form' | 'dropdown' | 'checkbox' | 'radio';
    text: string;
    purpose: string;
    location?: string;
  }>;
  suggestedActions: Array<{
    action: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  loginInfo?: {
    isLoginPage: boolean;
    hasCredentialFields: boolean;
  };
  notes?: string;
}

