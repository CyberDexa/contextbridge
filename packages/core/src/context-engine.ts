import crypto from 'node:crypto';
import { Storage } from './storage.js';
import type { SemanticEmbedder } from './semantic-embedder.js';
import type {
  ContextQuery,
  ContextResult,
  ContextSection,
  IndexedFunction,
  IndexedFile,
  IndexedClass,
  IndexedType,
} from './types.js';

export class ContextEngine {
  constructor(private storage: Storage, private embedder?: SemanticEmbedder) {}

  /**
   * Retrieve context for a given query.
   * When query.semantic is true (and embeddings exist), uses hybrid keyword + vector scoring.
   */
  async getContext(query: ContextQuery): Promise<ContextResult> {
    const startTime = performance.now();
    const sections: ContextSection[] = [];
    const entitiesFound: string[] = [];

    // Normalize query
    const queryStr = this.normalizeQuery(query.query);
    // Expand natural-language terms to coding-specific synonyms, then re-join
    const expandedQueryStr = this.expandQueryTerms(queryStr);
    const maxTokens = query.maxTokens || 4000;
    let totalTokens = 0;

    // Decide whether to augment with semantic results
    const useSemantic =
      query.semantic !== false &&
      this.embedder?.isAvailable &&
      this.storage.hasEmbeddings();

    // 1. Keyword search for functions (use expanded query for better NL coverage)
    let functions = this.storage.searchFunctions(expandedQueryStr, useSemantic ? 8 : 10);

    // 1b. Semantic search — embed the query and find nearest neighbours by cosine similarity
    if (useSemantic && this.embedder) {
      const semanticFunctions = await this.semanticSearchFunctions(query.query, 8);
      // Merge: union by id, deduplicate, prefer entries that appear in both lists
      const merged = this.mergeFunctionResults(functions, semanticFunctions);
      functions = merged.slice(0, 10);
    }

    if (functions.length > 0) {
      entitiesFound.push(...functions.map((f) => f.fullName));
      const section = this.buildFunctionSection(functions, expandedQueryStr);
      totalTokens += this.estimateTokens(section.content);
      if (totalTokens <= maxTokens) sections.push(section);
    }

    // 2. Search for matching files (use expanded query for better NL coverage)
    const files = this.storage.searchFiles(expandedQueryStr, 10);
    if (files.length > 0) {
      entitiesFound.push(...files.map((f) => f.path));
      const section = this.buildFileSection(files);
      totalTokens += this.estimateTokens(section.content);
      if (totalTokens <= maxTokens) sections.push(section);
    }

    // 3. Get related entities for found functions
    if (functions.length > 0) {
      const fileIds = [...new Set(functions.map((f) => f.fileId))];
      const relatedClasses: IndexedClass[] = [];
      const relatedTypes: IndexedType[] = [];

      for (const fileId of fileIds) {
        relatedClasses.push(...this.storage.getClassesByFile(fileId));
        relatedTypes.push(...this.storage.getTypesByFile(fileId));
      }

      if (relatedClasses.length > 0) {
        const section = this.buildClassSection(relatedClasses);
        totalTokens += this.estimateTokens(section.content);
        if (totalTokens <= maxTokens) sections.push(section);
      }

      if (relatedTypes.length > 0) {
        const section = this.buildTypeSection(relatedTypes);
        totalTokens += this.estimateTokens(section.content);
        if (totalTokens <= maxTokens) sections.push(section);
      }
    }

    // 4. Build summary
    const summary = this.buildSummary(query.query, sections, functions);

    const contextId = crypto.randomUUID();

    return {
      id: contextId,
      summary,
      sections,
      tokenCost: totalTokens,
      queryMetadata: {
        interpretedIntent: this.interpretIntent(query.query),
        entitiesFound: [...new Set(entitiesFound)],
        confidence: sections.length > 0 ? Math.min(sections.length / 3, 1) : 0,
      },
    };
  }

  /**
   * Embed the query and return the most similar functions by cosine similarity.
   */
  private async semanticSearchFunctions(query: string, limit: number): Promise<IndexedFunction[]> {
    if (!this.embedder) return [];
    let queryVec: Float32Array;
    try {
      queryVec = await this.embedder.embed(query);
    } catch {
      return [];
    }

    const allEmbeddings = this.storage.getAllEmbeddings();
    const fnEmbeddings = allEmbeddings.filter((e) => e.entityType === 'function');

    // Compute cosine similarity scores
    const { SemanticEmbedder } = await import('./semantic-embedder.js');
    const scored = fnEmbeddings.map((e) => ({
      entityId: e.entityId,
      score: SemanticEmbedder.cosineSimilarity(queryVec, e.embedding),
    }));

    // Sort descending, take top-N
    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit).map((s) => s.entityId);

    // Fetch the actual function objects
    return topIds
      .map((id) => this.storage.getFunctionById(id))
      .filter((fn): fn is IndexedFunction => fn !== null);
  }

  /**
   * Merge keyword results and semantic results, deduplicating by id.
   * Entities present in both lists are ranked first.
   */
  private mergeFunctionResults(
    keyword: IndexedFunction[],
    semantic: IndexedFunction[],
  ): IndexedFunction[] {
    const seen = new Set<string>();
    const both: IndexedFunction[] = [];
    const keywordOnly: IndexedFunction[] = [];
    const semanticOnly: IndexedFunction[] = [];

    const semanticIds = new Set(semantic.map((f) => f.id));
    const keywordIds = new Set(keyword.map((f) => f.id));

    for (const fn of keyword) {
      if (seen.has(fn.id)) continue;
      seen.add(fn.id);
      if (semanticIds.has(fn.id)) both.push(fn);
      else keywordOnly.push(fn);
    }
    for (const fn of semantic) {
      if (seen.has(fn.id)) continue;
      seen.add(fn.id);
      if (!keywordIds.has(fn.id)) semanticOnly.push(fn);
    }

    return [...both, ...keywordOnly, ...semanticOnly];
  }

  /**
   * Get context for a specific file.
   */
  getFileContext(filePath: string): ContextSection | null {
    const file = this.storage.getFileByPath(filePath);
    if (!file) return null;

    const functions = this.storage.getFunctionsByFile(file.id);
    const classes = this.storage.getClassesByFile(file.id);
    const types = this.storage.getTypesByFile(file.id);

    let content = `## File: ${file.path}\n\n`;
    content += `Language: ${file.language}\n`;
    content += `Token count: ${file.tokenCount}\n`;
    content += `Is test: ${file.isTest}\n\n`;

    if (classes.length > 0) {
      content += `### Classes\n\n`;
      for (const cls of classes) {
        content += `- ${cls.name}${cls.extendsId ? ` extends ${cls.extendsId.split(':').pop()}` : ''}\n`;
        if (cls.methods.length > 0) {
          content += `  - Methods: ${cls.methods.map((m) => m.split(':').pop()).join(', ')}\n`;
        }
      }
      content += '\n';
    }

    if (functions.length > 0) {
      content += `### Functions\n\n`;
      for (const fn of functions) {
        content += `- ${fn.fullName}: ${fn.signature}\n`;
        if (fn.docComment) {
          content += `  - ${fn.docComment.split('\n')[0]}\n`;
        }
      }
      content += '\n';
    }

    if (types.length > 0) {
      content += `### Types\n\n`;
      for (const t of types) {
        content += `- ${t.name} (${t.kind})\n`;
      }
      content += '\n';
    }

    return {
      title: `File: ${file.path}`,
      content,
      sourceFiles: [file.path],
      relevanceScore: 1.0,
    };
  }

  /**
   * Record feedback for a context result.
   */
  recordFeedback(
    contextId: string,
    query: string,
    rating: 1 | 2 | 3 | 4 | 5,
    accepted: string[] = [],
    rejected: string[] = [],
  ): void {
    this.storage.insertFeedback({
      query,
      contextId,
      rating,
      acceptedItems: accepted,
      rejectedItems: rejected,
    });
  }

  private buildFunctionSection(functions: IndexedFunction[], query: string): ContextSection {
    let content = `## Relevant Functions\n\n`;
    let relevanceScore = 0;

    for (const fn of functions.slice(0, 8)) {
      const matchScore = this.calculateMatchScore(fn, query);
      relevanceScore += matchScore;
      content += `### ${fn.fullName}\n`;
      content += `- **Location:** ${fn.fileId}:${fn.startLine}-${fn.endLine}\n`;
      content += `- **Signature:** \`${fn.signature}\`\n`;
      if (fn.docComment) {
        content += `- **Doc:** ${fn.docComment.slice(0, 200)}\n`;
      }
      content += `- **Exported:** ${fn.isExported ? 'Yes' : 'No'}\n`;
      content += `- **Complexity:** ${fn.complexity}\n\n`;
    }

    return {
      title: 'Relevant Functions',
      content,
      sourceFiles: [...new Set(functions.map((f) => f.fileId))],
      relevanceScore: relevanceScore / functions.length,
    };
  }

  private buildFileSection(files: IndexedFile[]): ContextSection {
    let content = `## Related Files\n\n`;

    for (const file of files.slice(0, 8)) {
      content += `- **${file.path}** — ${file.language}, ${file.tokenCount} tokens${file.isTest ? ' (test)' : ''}\n`;
    }

    return {
      title: 'Related Files',
      content,
      sourceFiles: files.map((f) => f.path),
      relevanceScore: 0.5,
    };
  }

  private buildClassSection(classes: IndexedClass[]): ContextSection {
    let content = `## Related Classes\n\n`;

    for (const cls of classes.slice(0, 5)) {
      content += `### ${cls.name}\n`;
      if (cls.extendsId) {
        content += `- **Extends:** ${cls.extendsId.split(':').pop()}\n`;
      }
      if (cls.methods.length > 0) {
        content += `- **Methods:** ${cls.methods.map((m) => m.split(':').pop()).join(', ')}\n`;
      }
      content += '\n';
    }

    return {
      title: 'Related Classes',
      content,
      sourceFiles: [...new Set(classes.map((c) => c.fileId))],
      relevanceScore: 0.6,
    };
  }

  private buildTypeSection(types: IndexedType[]): ContextSection {
    let content = `## Related Types\n\n`;

    for (const t of types.slice(0, 5)) {
      content += `- **${t.name}** (${t.kind})\n`;
      if (t.properties.length > 0) {
        content += `  - Properties: ${t.properties.join(', ')}\n`;
      }
    }

    return {
      title: 'Related Types',
      content,
      sourceFiles: [...new Set(types.map((t) => t.fileId))],
      relevanceScore: 0.4,
    };
  }

  private buildSummary(query: string, sections: ContextSection[], functions: IndexedFunction[]): string {
    if (sections.length === 0) {
      return `No context found for "${query}". Try rephrasing your query or running \`cb init\` to index the repository first.`;
    }

    const topFunctions = functions.slice(0, 3);
    let summary = `## Context Summary for: "${query}"\n\n`;
    summary += `Found ${sections.length} relevant sections across ${new Set(sections.flatMap((s) => s.sourceFiles)).size} files.\n\n`;

    if (topFunctions.length > 0) {
      summary += `**Key functions:** ${topFunctions.map((f) => f.fullName).join(', ')}\n`;
    }

    return summary;
  }

  private interpretIntent(query: string): string {
    const lowercase = query.toLowerCase();

    if (lowercase.includes('how') && (lowercase.includes('work') || lowercase.includes('flow'))) {
      return 'Understanding how something works';
    }
    if (lowercase.includes('refactor') || lowercase.includes('change') || lowercase.includes('modify')) {
      return 'Planning a change or refactor';
    }
    if (lowercase.includes('find') || lowercase.includes('search') || lowercase.includes('where')) {
      return 'Locating code or functionality';
    }
    if (lowercase.includes('what') || lowercase.includes('explain') || lowercase.includes('describe')) {
      return 'Getting an explanation or overview';
    }
    return 'General context retrieval';
  }

  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Expand natural-language query terms to coding-specific synonyms.
   * e.g. "authentication" → "authentication auth login session jwt token"
   * The expanded string is still space-separated and passed to searchFunctions/searchFiles,
   * which split on whitespace and run OR LIKE for each token.
   */
  private expandQueryTerms(query: string): string {
    // Map of natural-language words → code-level synonyms to append
    const EXPANSIONS: Record<string, string[]> = {
      authentication: ['auth', 'login', 'session', 'jwt', 'token', 'credential', 'signin', 'signout'],
      authorize:      ['auth', 'permission', 'role', 'access', 'policy', 'guard', 'acl'],
      authorization:  ['auth', 'permission', 'role', 'access', 'policy', 'guard', 'acl'],
      database:       ['db', 'query', 'storage', 'sql', 'schema', 'drizzle', 'prisma', 'orm', 'repository'],
      payment:        ['payment', 'billing', 'stripe', 'invoice', 'checkout', 'subscription', 'charge'],
      transaction:    ['transaction', 'tx', 'payment', 'transfer', 'ledger'],
      configuration:  ['config', 'settings', 'env', 'environment', 'options'],
      validation:     ['validate', 'schema', 'zod', 'yup', 'check', 'guard'],
      error:          ['error', 'exception', 'catch', 'throw', 'fail', 'handler'],
      testing:        ['test', 'spec', 'mock', 'fixture', 'describe', 'it'],
      routing:        ['route', 'router', 'path', 'handler', 'endpoint', 'controller'],
      middleware:     ['middleware', 'interceptor', 'handler', 'guard', 'pipe'],
      notification:   ['notify', 'notification', 'alert', 'email', 'push', 'webhook'],
      upload:         ['upload', 'file', 'storage', 'blob', 'multipart', 'stream'],
      caching:        ['cache', 'redis', 'memo', 'memoize', 'ttl', 'store'],
      logging:        ['log', 'logger', 'console', 'trace', 'debug', 'audit'],
      scheduling:     ['schedule', 'cron', 'job', 'task', 'queue', 'worker'],
      search:         ['search', 'query', 'filter', 'find', 'index', 'fts'],
    };

    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const extra: string[] = [];
    for (const word of words) {
      const expansions = EXPANSIONS[word];
      if (expansions) {
        // Only add synonyms not already present in the query
        for (const syn of expansions) {
          if (!query.includes(syn)) extra.push(syn);
        }
      }
    }
    return extra.length > 0 ? `${query} ${extra.join(' ')}` : query;
  }

  private calculateMatchScore(fn: IndexedFunction, query: string): number {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'what', 'which', 'who']);

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 1 && !stopWords.has(k));

    if (keywords.length === 0) return 0.1;

    const fnName = fn.name.toLowerCase();
    const fnFullName = fn.fullName.toLowerCase();
    const fnDoc = fn.docComment.toLowerCase();
    const fnSig = fn.signature.toLowerCase();

    let matchedKeywords = 0;

    for (const keyword of keywords) {
      // Name match is strongest
      if (fnName.includes(keyword)) matchedKeywords += 3;
      else if (fnFullName.includes(keyword)) matchedKeywords += 2;

      // Doc comment match
      if (fnDoc.includes(keyword)) matchedKeywords += 1;

      // Signature match
      if (fnSig.includes(keyword)) matchedKeywords += 0.5;
    }

    // Normalize: max possible is keywords.length * 3 (all keywords match name)
    const maxScore = keywords.length * 3;
    const score = matchedKeywords / maxScore;

    // Boost exported functions
    const exportBonus = fn.isExported ? 0.1 : 0;

    return Math.min(score + exportBonus, 1);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
