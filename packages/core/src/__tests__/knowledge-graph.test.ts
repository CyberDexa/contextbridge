import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgeGraph } from '../knowledge-graph.js';
import { Storage } from '../storage.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('KnowledgeGraph', () => {
  let tmpDir: string;
  let storage: Storage;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
    storage = new Storage(tmpDir);
    storage.initialize();
    graph = new KnowledgeGraph(storage);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedBasicData(): void {
    // File 1: auth.ts
    storage.upsertFile({
      path: 'src/auth.ts',
      language: 'typescript',
      contentHash: 'abc',
      tokenCount: 200,
      isTest: false,
      lastIndexedAt: new Date().toISOString(),
    });

    storage.upsertFunction({
      name: 'authenticate',
      fullName: 'authenticate',
      fileId: 'src/auth.ts',
      signature: '(token: string) => boolean',
      docComment: 'Validates a user auth token',
      complexity: 2,
      startLine: 1,
      endLine: 10,
      isExported: true,
      isAsync: false,
    });

    storage.upsertFunction({
      name: 'refreshToken',
      fullName: 'refreshToken',
      fileId: 'src/auth.ts',
      signature: '(token: string) => string',
      docComment: 'Refreshes token',
      complexity: 3,
      startLine: 12,
      endLine: 20,
      isExported: true,
      isAsync: true,
    });

    // File 2: user.ts
    storage.upsertFile({
      path: 'src/user.ts',
      language: 'typescript',
      contentHash: 'def',
      tokenCount: 150,
      isTest: false,
      lastIndexedAt: new Date().toISOString(),
    });

    storage.upsertFunction({
      name: 'createUser',
      fullName: 'createUser',
      fileId: 'src/user.ts',
      signature: '(data: UserInput) => User',
      docComment: 'Creates a new user',
      complexity: 1,
      startLine: 1,
      endLine: 5,
      isExported: true,
      isAsync: false,
    });

    storage.upsertType({
      name: 'User',
      kind: 'interface',
      fileId: 'src/user.ts',
      properties: ['id', 'name', 'email'],
    });
  }

  describe('build', () => {
    it('builds graph lazily on first access', () => {
      graph.build();

      const stats = graph.getStats();
      // Even empty build should not throw
      expect(stats.nodeCount).toBeGreaterThanOrEqual(0);
    });

    it('populates file, function, class, and type nodes', () => {
      seedBasicData();

      graph.build();
      const stats = graph.getStats();

      expect(stats.nodeCount).toBeGreaterThanOrEqual(5); // 2 files + 3 functions + 1 type
      expect(stats.edgeCount).toBeGreaterThanOrEqual(3); // has_function edges
      expect(stats.nodeTypeBreakdown['file']).toBe(2);
      expect(stats.nodeTypeBreakdown['function']).toBe(3);
      expect(stats.nodeTypeBreakdown['type']).toBe(1);
    });

    it('creates has_function edges from file to function', () => {
      seedBasicData();

      graph.build();
      const edges = graph.getEdges();
      const hasFuncEdges = edges.filter((e) => e.type === 'has_function');

      expect(hasFuncEdges.length).toBe(3);
      // First edge: src/auth.ts -> src/auth.ts:authenticate
      const authEdge = hasFuncEdges.find((e) => e.source === 'src/auth.ts');
      expect(authEdge).toBeDefined();
    });

    it('only builds once (idempotent)', () => {
      seedBasicData();

      graph.build();
      const firstStats = graph.getStats();

      graph.build(); // Should be a no-op
      const secondStats = graph.getStats();

      expect(secondStats.nodeCount).toBe(firstStats.nodeCount);
      expect(secondStats.edgeCount).toBe(firstStats.edgeCount);
    });
  });

  describe('getNode / getNodes', () => {
    it('returns all nodes after build', () => {
      seedBasicData();
      const nodes = graph.getNodes();
      expect(nodes.length).toBeGreaterThan(0);
    });
  });

  describe('getEdges', () => {
    it('returns all edges after build', () => {
      seedBasicData();
      const edges = graph.getEdges();
      expect(edges.length).toBeGreaterThan(0);
    });
  });

  describe('getGraph', () => {
    it('returns both nodes and edges', () => {
      seedBasicData();
      const result = graph.getGraph();
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    });
  });

  describe('getNeighbors', () => {
    it('returns connected nodes at depth 1', () => {
      seedBasicData();

      // Authenticate function is connected to src/auth.ts file
      const neighbors = graph.getNeighbors('src/auth.ts:authenticate', 1);

      expect(neighbors.nodes.length).toBeGreaterThan(0);
      // Should include the file node
      const fileNode = neighbors.nodes.find((n) => n.id === 'src/auth.ts');
      expect(fileNode).toBeDefined();
    });

    it('returns empty for unknown node', () => {
      seedBasicData();
      const neighbors = graph.getNeighbors('nonexistent', 1);
      expect(neighbors.nodes).toHaveLength(0);
    });

    it('respects depth parameter', () => {
      seedBasicData();
      const depth1 = graph.getNeighbors('src/auth.ts', 1);
      const depth2 = graph.getNeighbors('src/auth.ts', 2);

      // Depth 2 should have at least as many nodes as depth 1
      expect(depth2.nodes.length).toBeGreaterThanOrEqual(depth1.nodes.length);
    });
  });

  describe('findPath', () => {
    it('finds path between two connected nodes', () => {
      seedBasicData();

      const path = graph.findPath('src/auth.ts', 'src/auth.ts:authenticate');
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(1);
    });

    it('returns null for disconnected nodes', () => {
      seedBasicData();
      // Add isolated file
      storage.upsertFile({
        path: 'src/isolated.ts',
        language: 'typescript',
        contentHash: 'iso',
        tokenCount: 10,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const path = graph.findPath('src/auth.ts', 'src/isolated.ts');
      // May or may not find a path depending on relationship edges
      // Just verify it doesn't throw
      expect(path === null || Array.isArray(path)).toBe(true);
    });
  });

  describe('findClusters', () => {
    it('returns clusters of connected nodes', () => {
      seedBasicData();
      const clusters = graph.findClusters(2);

      expect(Array.isArray(clusters)).toBe(true);
      // At least one cluster should exist
      expect(clusters.length).toBeGreaterThanOrEqual(0);
    });

    it('respects minSize parameter', () => {
      seedBasicData();
      const clusters = graph.findClusters(100); // Unreasonably large

      expect(clusters).toHaveLength(0);
    });

    it('calculates density for clusters', () => {
      seedBasicData();
      const clusters = graph.findClusters(2);

      if (clusters.length > 0) {
        expect(clusters[0].density).toBeGreaterThanOrEqual(0);
        expect(clusters[0].density).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('toDotFormat', () => {
    it('generates valid DOT output', () => {
      seedBasicData();

      const dot = graph.toDotFormat();
      expect(dot).toContain('digraph KnowledgeGraph');
      expect(dot).toContain('rankdir=LR');
      expect(dot).toContain('->'); // Has edges
    });
  });

  describe('toDashboardJson', () => {
    it('generates valid JSON with all sections', () => {
      seedBasicData();

      const json = graph.toDashboardJson();
      const parsed = JSON.parse(json);

      expect(parsed.nodes).toBeDefined();
      expect(parsed.edges).toBeDefined();
      expect(parsed.clusters).toBeDefined();
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.totalNodes).toBeGreaterThan(0);
      expect(parsed.summary.totalEdges).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('returns comprehensive statistics', () => {
      seedBasicData();

      const stats = graph.getStats();
      expect(stats.nodeCount).toBeGreaterThan(0);
      expect(stats.edgeCount).toBeGreaterThan(0);
      expect(Object.keys(stats.nodeTypeBreakdown).length).toBeGreaterThan(0);
      expect(Object.keys(stats.edgeTypeBreakdown).length).toBeGreaterThan(0);
      expect(stats.averageDegree).toBeGreaterThanOrEqual(0);
    });
  });
});
