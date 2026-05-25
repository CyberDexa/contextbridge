import { Storage } from './storage.js';
import type { IndexedFile, IndexedFunction, IndexedClass, IndexedType, Relationship } from './types.js';

/**
 * Graph node representing an entity in the knowledge graph.
 */
export interface GraphNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'type';
  label: string;
  properties: Record<string, unknown>;
}

/**
 * Graph edge representing a relationship between entities.
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
}

/**
 * A subgraph of closely related nodes.
 */
export interface GraphCluster {
  id: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  density: number;
}

/**
 * Knowledge graph layer that sits on top of SQLite storage.
 * Provides graph traversal, clustering, and export capabilities.
 */
export class KnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private built = false;

  constructor(private storage: Storage) {}

  /**
   * Build the full knowledge graph from indexed data.
   */
  build(): void {
    if (this.built) return;

    // Build file nodes
    const files = this.storage.getAllFiles();
    for (const file of files) {
      this.addFileNode(file);
    }

    // Build function nodes
    const functions = this.storage.getAllFunctions();
    for (const fn of functions) {
      this.addFunctionNode(fn);
      // has_function edge: file -> function
      this.edges.push({
        id: `edge:${fn.fileId}:has_function:${fn.id}`,
        source: fn.fileId,
        target: fn.id,
        type: 'has_function',
        label: 'contains',
      });
    }

    // Build class nodes (iterate files, not functions, to ensure complete coverage)
    for (const file of files) {
      const fileClasses = this.storage.getClassesByFile(file.id);
      for (const cls of fileClasses) {
        this.addClassNode(cls);
        // has_class edge: file -> class
        this.edges.push({
          id: `edge:${file.id}:has_class:${cls.id}`,
          source: file.id,
          target: cls.id,
          type: 'has_class',
          label: 'contains',
        });

        // method edges: class -> function
        for (const methodId of cls.methods) {
          if (this.nodes.has(methodId)) {
            this.edges.push({
              id: `edge:${cls.id}:has_method:${methodId}`,
              source: cls.id,
              target: methodId,
              type: 'has_method',
              label: 'method',
            });
          }
        }

        // extends edge
        if (cls.extendsId && this.nodes.has(cls.extendsId)) {
          this.edges.push({
            id: `edge:${cls.id}:extends:${cls.extendsId}`,
            source: cls.id,
            target: cls.extendsId,
            type: 'extends',
            label: 'extends',
          });
        }
      }
    }

    // Build type nodes (iterate files for complete coverage)
    for (const file of files) {
      const fileTypes = this.storage.getTypesByFile(file.id);
      for (const t of fileTypes) {
        this.addTypeNode(t);
        // has_type edge: file -> type
        this.edges.push({
          id: `edge:${file.id}:has_type:${t.id}`,
          source: file.id,
          target: t.id,
          type: 'has_type',
          label: 'contains',
        });
      }
    }

    // Build relationship edges from the relationships table
    for (const file of files) {
      const rels = this.storage.getRelationshipsForFile(file.id);
      for (const rel of rels) {
        if (this.nodes.has(rel.sourceId) && this.nodes.has(rel.targetId)) {
          this.edges.push({
            id: rel.id,
            source: rel.sourceId,
            target: rel.targetId,
            type: rel.relationType,
            label: rel.relationType,
          });
        }
      }
    }

    this.built = true;
  }

  /**
   * Get all nodes in the graph.
   */
  getNodes(): GraphNode[] {
    this.build();
    return [...this.nodes.values()];
  }

  /**
   * Get all edges in the graph.
   */
  getEdges(): GraphEdge[] {
    this.build();
    return this.edges;
  }

  /**
   * Get the full graph as a JSON-serializable object.
   */
  getGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this.build();
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }

  /**
   * Find neighbors (directly connected nodes) of a given node.
   */
  getNeighbors(nodeId: string, depth = 1): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this.build();

    const visited = new Set<string>();
    const resultNodes: GraphNode[] = [];
    const resultEdges: GraphEdge[] = [];

    let frontier = [nodeId];
    visited.add(nodeId);

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];

      for (const currentId of frontier) {
        for (const edge of this.edges) {
          if (edge.source === currentId && !visited.has(edge.target)) {
            nextFrontier.push(edge.target);
            visited.add(edge.target);
            resultEdges.push(edge);
            const node = this.nodes.get(edge.target);
            if (node) resultNodes.push(node);
          } else if (edge.target === currentId && !visited.has(edge.source)) {
            nextFrontier.push(edge.source);
            visited.add(edge.source);
            resultEdges.push(edge);
            const node = this.nodes.get(edge.source);
            if (node) resultNodes.push(node);
          }
        }
      }

      frontier = nextFrontier;
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Find shortest path between two nodes (BFS).
   */
  findPath(sourceId: string, targetId: string): GraphEdge[] | null {
    this.build();

    const visited = new Set<string>();
    const queue: { nodeId: string; path: GraphEdge[] }[] = [{ nodeId: sourceId, path: [] }];
    visited.add(sourceId);

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      if (nodeId === targetId) return path;

      for (const edge of this.edges) {
        let nextNode: string | null = null;

        if (edge.source === nodeId && !visited.has(edge.target)) {
          nextNode = edge.target;
        } else if (edge.target === nodeId && !visited.has(edge.source)) {
          nextNode = edge.source;
        }

        if (nextNode) {
          visited.add(nextNode);
          queue.push({ nodeId: nextNode, path: [...path, edge] });
        }
      }
    }

    return null;
  }

  /**
   * Find clusters of tightly-coupled nodes using connected components.
   */
  findClusters(minSize = 3): GraphCluster[] {
    this.build();

    const visited = new Set<string>();
    const clusters: GraphCluster[] = [];

    for (const nodeId of this.nodes.keys()) {
      if (visited.has(nodeId)) continue;

      // BFS to find connected component
      const componentNodes = new Set<string>();
      const queue = [nodeId];
      componentNodes.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        for (const edge of this.edges) {
          if (edge.source === current && !componentNodes.has(edge.target)) {
            componentNodes.add(edge.target);
            queue.push(edge.target);
          } else if (edge.target === current && !componentNodes.has(edge.source)) {
            componentNodes.add(edge.source);
            queue.push(edge.source);
          }
        }
      }

      if (componentNodes.size >= minSize) {
        const clusterNodes = [...componentNodes].map((id) => this.nodes.get(id)!).filter(Boolean);
        const clusterEdges = this.edges.filter(
          (e) => componentNodes.has(e.source) && componentNodes.has(e.target),
        );

        // Calculate density: actual edges / max possible edges
        const n = clusterNodes.length;
        const maxEdges = n * (n - 1) / 2;
        const density = maxEdges > 0 ? clusterEdges.length / maxEdges : 0;

        clusters.push({
          id: `cluster-${clusters.length}`,
          name: this.inferClusterName(clusterNodes),
          nodes: clusterNodes,
          edges: clusterEdges,
          density: Math.round(density * 100) / 100,
        });
      }
    }

    return clusters.sort((a, b) => b.nodes.length - a.nodes.length);
  }

  /**
   * Export the graph in DOT format (for Graphviz).
   */
  toDotFormat(): string {
    this.build();

    let dot = 'digraph KnowledgeGraph {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box, style=filled, fillcolor=lightblue];\n\n';

    for (const node of this.nodes.values()) {
      const color = this.getNodeColor(node.type);
      dot += `  "${node.id}" [label="${node.label}", fillcolor="${color}"];\n`;
    }

    dot += '\n';

    for (const edge of this.edges) {
      dot += `  "${edge.source}" -> "${edge.target}" [label="${edge.type}"];\n`;
    }

    dot += '}\n';
    return dot;
  }

  /**
   * Export the graph for the web dashboard (JSON format).
   */
  toDashboardJson(): string {
    this.build();
    const data = {
      nodes: [...this.nodes.values()],
      edges: this.edges,
      clusters: this.findClusters(),
      summary: {
        totalNodes: this.nodes.size,
        totalEdges: this.edges.length,
        totalClusters: this.findClusters().length,
      },
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get graph statistics.
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    nodeTypeBreakdown: Record<string, number>;
    edgeTypeBreakdown: Record<string, number>;
    averageDegree: number;
  } {
    this.build();

    const nodeTypeBreakdown: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      nodeTypeBreakdown[node.type] = (nodeTypeBreakdown[node.type] || 0) + 1;
    }

    const edgeTypeBreakdown: Record<string, number> = {};
    for (const edge of this.edges) {
      edgeTypeBreakdown[edge.type] = (edgeTypeBreakdown[edge.type] || 0) + 1;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      nodeTypeBreakdown,
      edgeTypeBreakdown,
      averageDegree: this.nodes.size > 0
        ? Math.round((this.edges.length * 2 / this.nodes.size) * 100) / 100
        : 0,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────

  private addFileNode(file: IndexedFile): void {
    this.nodes.set(file.id, {
      id: file.id,
      type: 'file',
      label: file.path.split('/').pop() || file.path,
      properties: {
        path: file.path,
        language: file.language,
        tokenCount: file.tokenCount,
        isTest: file.isTest,
      },
    });
  }

  private addFunctionNode(fn: IndexedFunction): void {
    this.nodes.set(fn.id, {
      id: fn.id,
      type: 'function',
      label: fn.fullName,
      properties: {
        name: fn.name,
        signature: fn.signature,
        isExported: fn.isExported,
        isAsync: fn.isAsync,
        complexity: fn.complexity,
      },
    });
  }

  private addClassNode(cls: IndexedClass): void {
    this.nodes.set(cls.id, {
      id: cls.id,
      type: 'class',
      label: cls.name,
      properties: {
        methods: cls.methods.length,
        properties: cls.properties.length,
        isExported: cls.isExported,
      },
    });
  }

  private addTypeNode(t: IndexedType): void {
    this.nodes.set(t.id, {
      id: t.id,
      type: 'type',
      label: t.name,
      properties: {
        kind: t.kind,
        memberCount: t.properties.length,
      },
    });
  }

  private getNodeColor(type: string): string {
    switch (type) {
      case 'file':
        return 'lightblue';
      case 'function':
        return 'lightgreen';
      case 'class':
        return 'lightsalmon';
      case 'type':
        return 'lightyellow';
      default:
        return 'lightgray';
    }
  }

  private inferClusterName(nodes: GraphNode[]): string {
    // Find the most common directory prefix
    const fileNodes = nodes.filter((n) => n.type === 'file');
    if (fileNodes.length === 0) return `Cluster-${nodes.length}-nodes`;

    const paths = fileNodes.map((n) => (n.properties.path as string).split('/'));
    if (paths.length === 0) return `Cluster-${nodes.length}-nodes`;

    let commonPrefix = paths[0].slice(0, -1); // Remove filename
    for (const p of paths.slice(1)) {
      const dirParts = p.slice(0, -1);
      for (let i = 0; i < commonPrefix.length; i++) {
        if (i >= dirParts.length || commonPrefix[i] !== dirParts[i]) {
          commonPrefix = commonPrefix.slice(0, i);
          break;
        }
      }
    }

    if (commonPrefix.length > 0) {
      return commonPrefix.join('/');
    }

    return `Cluster-${nodes.length}-nodes`;
  }
}
