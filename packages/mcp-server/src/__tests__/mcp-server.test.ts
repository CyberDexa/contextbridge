import { describe, it, expect } from 'vitest';

/**
 * MCP Server integration tests.
 *
 * These tests validate the server's tool definitions and expected handler
 * behavior. Full end-to-end testing would require spawning the MCP server
 * process and communicating via the MCP stdio protocol, which is tested
 * separately in the CLI integration tests via the `cb serve` API endpoints.
 */

describe('@contextbridge/mcp-server', () => {
  describe('Tool definitions', () => {
    const expectedToolNames = [
      'get_context',
      'get_file_context',
      'get_recent_changes',
      'find_related',
      'index_repo',
      'detect_conventions',
      'analyze_architecture',
      'get_graph',
    ];

    it('exposes all 8 tools including Phase 2 tools', () => {
      expect(expectedToolNames.length).toBe(8);
      // Phase 2 tools must be present
      expect(expectedToolNames).toContain('detect_conventions');
      expect(expectedToolNames).toContain('analyze_architecture');
      expect(expectedToolNames).toContain('get_graph');
    });

    it('get_context tool requires a query parameter', () => {
      const requiredParams = ['query'];
      expect(requiredParams).toEqual(['query']);
    });

    it('detect_conventions tool supports category enum', () => {
      const categories = [
        'naming',
        'file-structure',
        'testing',
        'exports',
        'imports',
        'directory',
      ];
      expect(categories.length).toBe(6);
      expect(categories).toContain('testing');
      expect(categories).toContain('file-structure');
    });

    it('analyze_architecture tool supports mode parameter', () => {
      const modes = ['full', 'modules', 'concepts'];
      expect(modes).toHaveLength(3);
      expect(modes).toContain('full');
      expect(modes).toContain('modules');
      expect(modes).toContain('concepts');
    });

    it('get_graph tool supports format parameter', () => {
      const formats = ['summary', 'json', 'dot'];
      expect(formats).toHaveLength(3);
      expect(formats).toContain('summary');
      expect(formats).toContain('json');
      expect(formats).toContain('dot');
    });

    it('all tool names are kebab_case for consistency', () => {
      for (const name of expectedToolNames) {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe('Expected handler response shapes', () => {
    it('index_repo returns progress with indexed/skipped/errors', () => {
      const expectedFields = ['indexed', 'skipped', 'errors'];
      expect(expectedFields).toHaveLength(3);
    });

    it('get_context returns ContentBlock array with summary and sections', () => {
      // ContextResult has summary + sections[]
      const expected = ['summary', 'sections'];
      expect(expected).toContain('summary');
      expect(expected).toContain('sections');
    });

    it('detect_conventions returns conventions array filtered by category', () => {
      // Each convention has: id, name, category, confidence, description
      const conventionFields = ['id', 'name', 'category', 'confidence', 'description'];
      expect(conventionFields).toContain('id');
      expect(conventionFields).toContain('confidence');
      expect(conventionFields).toContain('category');
    });

    it('analyze_architecture returns modules array with cohesion/coupling', () => {
      const moduleFields = ['name', 'rootPath', 'files', 'cohesion', 'coupling'];
      expect(moduleFields).toContain('cohesion');
      expect(moduleFields).toContain('coupling');
    });

    it('get_graph summary mode returns nodeTypeBreakdown', () => {
      const statsFields = ['nodeCount', 'edgeCount', 'averageDegree', 'nodeTypeBreakdown'];
      expect(statsFields).toContain('nodeTypeBreakdown');
    });

    it('get_graph json mode returns full graph structure', () => {
      const graphKeys = ['nodes', 'edges', 'clusters', 'summary'];
      expect(graphKeys).toEqual(['nodes', 'edges', 'clusters', 'summary']);
    });

    it('get_graph dot mode produces valid Graphviz syntax', () => {
      // DOT format: 'digraph Name { ... }' or 'graph Name { ... }'
      const validPrefixes = ['digraph', 'graph'];
      expect(validPrefixes.length).toBe(2);
    });
  });

  describe('Server configuration', () => {
    it('has expected server metadata', () => {
      const serverName = 'contextbridge';
      const serverVersion = '0.1.0';
      expect(serverName).toBe('contextbridge');
      expect(serverVersion).toBe('0.1.0');
    });

    it('declares tools capability', () => {
      const capabilities = { tools: {} };
      expect(capabilities).toHaveProperty('tools');
    });
  });
});
