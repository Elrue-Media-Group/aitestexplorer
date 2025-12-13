export interface Config {
  maxPages: number;
  maxActions: number;
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

