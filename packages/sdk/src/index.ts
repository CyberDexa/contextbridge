import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ContextEngine, Indexer, Storage, AstParser, ConventionDetector, ArchitectureAnalyzer, KnowledgeGraph } from '@contextbridge/core';
import type {
  ContextQuery,
  ContextResult,
  ContextBridgeConfig,
  ConventionReport,
  DetectedConvention,
  ConventionCategory,
  ModuleBoundary,
  ArchitecturalConcept,
  GraphNode,
  GraphEdge,
  GraphCluster,
} from '@contextbridge/core';

export interface ContextBridgeStats {
  fileCount: number;
  functionCount: number;
  classCount: number;
  typeCount: number;
  lastIndexedAt?: string;
}

/**
 * High-level SDK for ContextBridge.
 * Handles initialization, indexing, and context retrieval.
 */
export class ContextBridge {
  private storage: Storage;
  private indexer: Indexer;
  private engine: ContextEngine;
  private parser: AstParser;
  private config: Required<ContextBridgeConfig>;

  constructor(config: ContextBridgeConfig) {
    this.config = {
      repoDir: config.repoDir,
      dbPath: config.dbPath || '.contextbridge/contextbridge.db',
      embeddingModel: config.embeddingModel || 'local',
      openAiKey: config.openAiKey || '',
      maxContextTokens: config.maxContextTokens || 4000,
    };

    this.parser = new AstParser();
    this.storage = new Storage(this.config.repoDir);
    this.indexer = new Indexer(this.storage, this.parser);
    this.engine = new ContextEngine(this.storage);
  }

  /**
   * Initialize the storage database.
   */
  initialize(): void {
    this.storage.initialize();
  }

  /**
   * Index the current repository.
   */
  index(options?: { watch?: boolean }): { total: number; indexed: number; skipped: number; errors: number } {
    return this.indexer.indexRepo(this.config.repoDir, options);
  }

  /**
   * Get context for a query.
   */
  getContext(query: string | ContextQuery): ContextResult {
    const queryObj: ContextQuery = typeof query === 'string' ? { query } : query;
    return this.engine.getContext(queryObj);
  }

  /**
   * Get context for a specific file.
   */
  getFileContext(filePath: string): ContextResult | null {
    const section = this.engine.getFileContext(filePath);
    if (!section) return null;

    return {
      id: crypto.randomUUID(),
      summary: `Context for ${filePath}`,
      sections: [section],
      tokenCost: 0,
      queryMetadata: {
        interpretedIntent: 'File context',
        entitiesFound: [filePath],
        confidence: 1,
      },
    };
  }

  /**
   * Record feedback for a context result.
   */
  recordFeedback(
    contextId: string,
    rating: 1 | 2 | 3 | 4 | 5,
    accepted?: string[],
    rejected?: string[],
  ): void {
    this.storage.insertFeedback({
      query: '',
      contextId,
      rating,
      acceptedItems: accepted || [],
      rejectedItems: rejected || [],
    });
  }

  /**
   * Get indexing stats.
   */
  getStats(): ContextBridgeStats {
    const stats = this.storage.getStats();
    return {
      ...stats,
    };
  }

  /**
   * Detect conventions in the indexed codebase.
   */
  detectConventions(): ConventionReport {
    const detector = new ConventionDetector(this.storage);
    return detector.detectAll();
  }

  /**
   * Get conventions filtered by category.
   */
  getConventionsByCategory(category: ConventionCategory): DetectedConvention[] {
    const detector = new ConventionDetector(this.storage);
    return detector.getConventionsByCategory(category);
  }

  /**
   * Detect module boundaries and architectural patterns.
   */
  analyzeArchitecture(): {
    modules: ModuleBoundary[];
    concepts: ArchitecturalConcept[];
    report: string;
  } {
    const analyzer = new ArchitectureAnalyzer(this.storage);
    return {
      modules: analyzer.detectModules(),
      concepts: analyzer.detectArchitecturalConcepts(),
      report: analyzer.getModuleReport(),
    };
  }

  /**
   * Get the knowledge graph for visualization and analysis.
   */
  getKnowledgeGraph(): {
    nodes: GraphNode[];
    edges: GraphEdge[];
    clusters: GraphCluster[];
    stats: ReturnType<KnowledgeGraph['getStats']>;
  } {
    const graph = new KnowledgeGraph(this.storage);
    return {
      nodes: graph.getNodes(),
      edges: graph.getEdges(),
      clusters: graph.findClusters(),
      stats: graph.getStats(),
    };
  }

  /**
   * Export the knowledge graph in DOT format (Graphviz).
   */
  exportGraphDot(): string {
    const graph = new KnowledgeGraph(this.storage);
    return graph.toDotFormat();
  }

  /**
   * Export the knowledge graph as dashboard-ready JSON.
   */
  exportGraphJson(): string {
    const graph = new KnowledgeGraph(this.storage);
    return graph.toDashboardJson();
  }

  /**
   * Start an HTTP server for the dashboard and API.
   * Returns the server instance so the caller can control lifecycle.
   */
  serve(port = 4620): http.Server {
    const bridge = this;

    const server = http.createServer((req, res) => {
      // CORS headers for local development
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const pathname = url.pathname;

      try {
        // API routes
        if (pathname === '/api/graph') {
          const graph = new KnowledgeGraph(bridge.storage);
          const data = {
            nodes: graph.getNodes(),
            edges: graph.getEdges(),
            clusters: graph.findClusters(),
            summary: {
              totalNodes: graph.getStats().nodeCount,
              totalEdges: graph.getStats().edgeCount,
              totalClusters: graph.findClusters().length,
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        }

        if (pathname === '/api/stats') {
          const stats = bridge.storage.getStats();
          const graph = new KnowledgeGraph(bridge.storage);
          const graphStats = graph.getStats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...stats,
            graph: {
              nodes: graphStats.nodeCount,
              edges: graphStats.edgeCount,
              clusters: graph.findClusters().length,
              averageDegree: graphStats.averageDegree,
            },
          }));
          return;
        }

        if (pathname === '/api/architecture') {
          const arch = bridge.analyzeArchitecture();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(arch));
          return;
        }

        if (pathname === '/api/conventions') {
          const report = bridge.detectConventions();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(report));
          return;
        }

        // Health check
        if (pathname === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', repo: bridge.config.repoDir }));
          return;
        }

        // Serve the dashboard HTML for all other routes
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });

    server.listen(port, () => {
      console.log(`\n  🧠 ContextBridge Dashboard`);
      console.log(`  Server running at http://localhost:${port}`);
      console.log(`  API endpoints:`);
      console.log(`    GET /api/graph        — Knowledge graph data`);
      console.log(`    GET /api/stats        — Repository statistics`);
      console.log(`    GET /api/architecture — Architecture analysis`);
      console.log(`    GET /api/conventions  — Convention report`);
      console.log(`    GET /api/health       — Health check`);
      console.log(`\n  Drop a graph.json file on the dashboard, or point it`);
      console.log(`  to http://localhost:${port}/api/graph in your scripts.\n`);
    });

    return server;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.storage.close();
  }
}

/** Read the dashboard HTML from the file that's bundled with the SDK. */
function getDashboardHtml(): string {
  // Try to find the HTML file relative to this module.
  // When published, the dashboard.html is placed next to index.js.
  const htmlPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'dashboard.html');
  try {
    return fs.readFileSync(htmlPath, 'utf-8');
  } catch {
    // Fallback for environments where import.meta.url is not available
    return fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf-8');
  }
}
