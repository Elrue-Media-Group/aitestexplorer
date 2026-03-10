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
  accessibilityTree?: string;  // MCP accessibility snapshot for element refs
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
  mcpRef?: string;  // MCP element reference for deterministic targeting
}

export interface DiscoveredButton {
  text: string;
  type: string;
  selector?: string;
  visible: boolean;
  mcpRef?: string;  // MCP element reference for deterministic targeting
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
  mcpRef?: string;  // MCP element reference for deterministic targeting
}

export interface DiscoveredHeading {
  level: number;
  text: string;
  selector?: string;
  mcpRef?: string;  // MCP element reference for deterministic targeting
}

/**
 * Outcome of an action - what actually happened after performing it
 * This captures observed behavior rather than assumed behavior
 */
export interface ActionOutcome {
  /** URL before the action was performed */
  urlBefore: string;
  /** URL after the action completed */
  urlAfter: string;
  /** Whether a navigation occurred (URL changed) */
  navigationOccurred: boolean;
  /** Modal/dialog detection */
  modalAppeared?: {
    detected: boolean;
    title?: string;
    type?: 'dialog' | 'dropdown' | 'popover' | 'toast';
  };
  /** Whether content updated inline (without navigation) */
  inlineUpdateDetected?: boolean;
  /** AI interpretation of what happened (e.g., "Navigated to project detail page") */
  aiInterpretation?: string;
  /** Content hash before (for detecting inline changes) */
  contentHashBefore?: string;
  /** Content hash after */
  contentHashAfter?: string;
}

export interface Action {
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'wait' | 'select';
  target?: string;
  value?: string;
  description: string;
  timestamp: Date;
  success: boolean;
  error?: string;
  /** Observed outcome of this action - what actually happened */
  outcome?: ActionOutcome;
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

// ============================================================================
// Intent-Based Test Cases (for AI-driven test execution)
// ============================================================================

/**
 * An intent-based test case describes WHAT to test, not HOW.
 * The AI executor figures out the steps dynamically.
 */
export interface IntentTestCase {
  id: string;
  name: string;
  description: string;

  /** High-level intent: what should be accomplished */
  intent: string;

  /** What conditions must be true for this test to pass */
  successCriteria: string[];

  /** Prerequisites like 'authenticated', 'on_dashboard', etc. */
  preconditions?: string[];

  /** Starting point - URL or page description */
  startingPoint?: string;

  /** Priority for execution order */
  priority: 'high' | 'medium' | 'low';

  /** Category for grouping */
  category?: string;

  /** Tags for filtering */
  tags?: string[];
}

/**
 * Result from AI-driven test execution
 */
export interface IntentTestResult {
  testCase: IntentTestCase;
  status: 'passed' | 'failed' | 'blocked';

  /** What the AI actually did */
  executionLog: ExecutionStep[];

  /** Verification results for each success criterion */
  verifications: VerificationResult[];

  /** Overall AI assessment */
  aiAssessment: string;

  /** Screenshots captured during execution */
  screenshots: string[];

  /** If failed, why */
  failureReason?: string;

  /** Execution time in ms */
  duration: number;

  /** Token usage for this test */
  tokenUsage?: {
    input: number;
    output: number;
  };
}

/**
 * A single step taken during AI-driven execution
 */
export interface ExecutionStep {
  stepNumber: number;
  action: string;
  target?: string;
  value?: string;
  reasoning: string;
  success: boolean;
  error?: string;
  screenshot?: string;
  timestamp: Date;
}

/**
 * Result of verifying a success criterion
 */
export interface VerificationResult {
  criterion: string;
  passed: boolean;
  method: 'structured' | 'ai_vision';
  evidence: string;
  details?: string;
}

// ============================================================================
// Hybrid Test Cases (MCP refs + Scripted execution with self-healing)
// ============================================================================

/**
 * Multi-strategy element targeting for self-healing tests
 * Tries strategies in order: mcpRef → selector → text → AI rescue
 */
export interface ElementTarget {
  /** MCP element ref from exploration (primary strategy) */
  mcpRef?: string;
  /** CSS selector (fallback) */
  selector?: string;
  /** Text content to search for */
  text?: string;
  /** Element type hint for text search */
  elementType?: 'button' | 'link' | 'input' | 'heading' | 'text';
  /** Human description for AI rescue */
  description: string;
}

/**
 * A single step in a hybrid test
 */
export interface HybridTestStep {
  /** Step number for ordering */
  stepNumber: number;
  /** Action type */
  action: 'click' | 'type' | 'navigate' | 'wait' | 'verify' | 'select';
  /** Target element (multi-strategy) */
  target?: ElementTarget;
  /** Value for type/select actions */
  value?: string;
  /** For navigate - the URL to go to */
  url?: string;
  /** Human-readable description */
  description: string;
  /** Expected outcome (for verification) */
  expectedOutcome?: string;
  /** For verify action - the type of verification */
  verifyType?:
    | 'url_contains'        // URL contains expected string
    | 'url_equals'          // URL exactly matches
    | 'element_visible'     // Element MUST exist/be visible
    | 'element_not_visible' // Element must NOT exist (for loading states) - not found = PASS
    | 'element_text'        // Element contains specific text
    | 'text_on_page'        // Text exists anywhere on page (flexible)
    | 'text_not_on_page'    // Text should NOT be on page - not found = PASS
    | 'page_title';         // Page title contains expected
  /** For verify action - the expected value */
  expected?: string;
}

/**
 * Verification criteria for a test
 */
export interface HybridVerification {
  /** What to verify */
  type:
    | 'url_contains'
    | 'url_equals'
    | 'element_visible'
    | 'element_not_visible'  // Element must NOT exist - not found = PASS
    | 'element_text'
    | 'text_on_page'
    | 'text_not_on_page'     // Text must NOT exist - not found = PASS
    | 'page_title'
    | 'custom';
  /** Expected value */
  expected: string;
  /** Element target (for element verifications) */
  target?: ElementTarget;
  /** Human description */
  description: string;
}

/**
 * A hybrid test case - AI-generated but executed with refs
 */
export interface HybridTestCase {
  /** Test ID (TC-001 format) */
  id: string;
  /** Test name */
  name: string;
  /** Test description */
  description: string;
  /** Page URL where test starts */
  startUrl: string;
  /** Ordered steps to execute */
  steps: HybridTestStep[];
  /** Verifications to run after steps */
  verifications: HybridVerification[];
  /** Expected end result */
  expectedResult: string;
  /** Priority for ordering */
  priority: 'high' | 'medium' | 'low';
  /** Category for grouping */
  category?: string;
  /** Whether test requires authentication */
  requiresAuth?: boolean;
}

/**
 * Result of executing a single step
 */
export interface HybridStepResult {
  step: HybridTestStep;
  status: 'passed' | 'failed' | 'skipped';
  /** Which targeting strategy succeeded */
  resolvedBy?: 'mcpRef' | 'selector' | 'text' | 'ai_rescue' | 'none';
  /** Actual element ref used */
  actualRef?: string;
  /** Duration in ms */
  duration: number;
  /** Error message if failed */
  error?: string;
  /** Screenshot path (on failure) */
  screenshot?: string;
  /** Evidence from verification (for verify steps) */
  evidence?: string;
  /** Expected value (for verify steps) */
  expected?: string;
  /** Actual value found (for verify steps) */
  actual?: string;
}

/**
 * Result of a verification check
 */
export interface HybridVerificationResult {
  verification: HybridVerification;
  passed: boolean;
  actual?: string;
  evidence: string;
}

/**
 * Result of executing a hybrid test
 */
export interface HybridTestResult {
  testCase: HybridTestCase;
  status: 'passed' | 'failed' | 'skipped';
  /** Results for each step */
  stepResults: HybridStepResult[];
  /** Verification results */
  verificationResults: HybridVerificationResult[];
  /** Total duration in ms */
  duration: number;
  /** Failure reason if failed */
  failureReason?: string;
  /** Screenshots captured */
  screenshots: string[];
  /** Whether AI rescue was used */
  usedAIRescue: boolean;
  /** Timestamp */
  executedAt: Date;
}

