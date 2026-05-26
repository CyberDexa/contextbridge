// ─── Entity Types ───────────────────────────────────────────

export interface IndexedFile {
  id: string;
  path: string;
  language: string;
  contentHash: string;
  tokenCount: number;
  isTest: boolean;
  lastIndexedAt: string;
}

export interface IndexedFunction {
  id: string;
  name: string;
  fileId: string;
  fullName: string; // Including class prefix if applicable
  signature: string;
  docComment: string;
  complexity: number;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAsync: boolean;
}

export interface IndexedClass {
  id: string;
  name: string;
  fileId: string;
  methods: string[]; // Function IDs
  properties: string[];
  extendsId: string | null;
  implementsIds: string[];
  isExported: boolean;
}

export interface IndexedType {
  id: string;
  name: string;
  kind: 'interface' | 'type' | 'enum' | 'type-alias';
  fileId: string;
  properties: string[];
}

// ─── Relationship Types ────────────────────────────────────

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: 'calls' | 'imports' | 'extends' | 'implements' | 'uses_type' | 'has_function' | 'has_test';
  metadata: Record<string, unknown>;
}

// ─── Query & Context Types ─────────────────────────────────

export interface ContextQuery {
  query: string;
  scope?: {
    files?: string[];
    directory?: string;
    gitDiff?: string;
  };
  format?: 'prompt' | 'structured' | 'minimal';
  maxTokens?: number;
  /** Use semantic (vector) search in addition to keyword search. Requires embeddings to be generated first. */
  semantic?: boolean;
}

export interface ContextSection {
  title: string;
  content: string;
  sourceFiles: string[];
  relevanceScore: number;
}

export interface ContextResult {
  id: string;
  summary: string;
  sections: ContextSection[];
  tokenCost: number;
  queryMetadata: {
    interpretedIntent: string;
    entitiesFound: string[];
    confidence: number;
  };
}

// ─── Feedback Types ────────────────────────────────────────

export interface FeedbackEntry {
  id: string;
  query: string;
  contextId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  acceptedItems: string[];
  rejectedItems: string[];
  createdAt: string;
}

// ─── Convention Types ─────────────────────────────────────

export type ConventionCategory =
  | 'naming'
  | 'file-structure'
  | 'testing'
  | 'exports'
  | 'imports'
  | 'directory'
  | 'architecture';

export interface DetectedConvention {
  id: string;
  category: ConventionCategory;
  name: string;
  pattern: string;
  confidence: number; // 0-1
  examples: string[];
  description: string;
  suggestion?: string;
}

export interface ConventionReport {
  conventions: DetectedConvention[];
  summary: string;
  fileCounts: Record<string, number>;
}

// ─── Architecture Types ───────────────────────────────────

export interface ModuleBoundary {
  id: string;
  name: string;
  rootPath: string;
  files: string[];
  exports: string[];
  imports: string[];
  subModules: string[];
  cohesion: number; // How tightly coupled internally (0-1)
  coupling: number; // How coupled to other modules (0-1)
}

export interface ArchitecturalConcept {
  id: string;
  name: string;
  type: 'module' | 'layer' | 'pattern' | 'domain';
  relatedFiles: string[];
  description: string;
  confidence: number;
  evidence: string[];
}

// ─── Multi-language Types ─────────────────────────────────

export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

export interface LanguageParser {
  language: SupportedLanguage;
  extensions: string[];
  parseFile(filePath: string, content: string): ParseResult;
  shouldParse(filePath: string): boolean;
}

// Re-export ParseResult for multi-language use
export interface ParseResult {
  file: Omit<IndexedFile, 'id'>;
  functions: Omit<IndexedFunction, 'id'>[];
  classes: Omit<IndexedClass, 'id'>[];
  types: Omit<IndexedType, 'id'>[];
  /** Raw module specifiers from import statements (relative paths and package names). */
  imports: string[];
}

// ─── Config ────────────────────────────────────────────────

export interface ContextBridgeConfig {
  repoDir: string;
  dbPath?: string;
  embeddingModel?: 'local' | 'openai';
  openAiKey?: string;
  maxContextTokens?: number;
}
