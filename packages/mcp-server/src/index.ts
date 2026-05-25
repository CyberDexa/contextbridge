#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ContextBridge } from '@contextbridge/sdk';

const repoDir = process.cwd();
const bridge = new ContextBridge({ repoDir });
bridge.initialize();

const server = new Server(
  {
    name: 'contextbridge',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ─── List Available Tools ──────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_context',
        description: 'Get context about the codebase for a given query. Use this to understand architecture, find relevant code, or prepare for refactoring tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What do you want context on? (e.g., "How does the payment flow work?")',
            },
            max_tokens: {
              type: 'number',
              description: 'Maximum token count for the context package',
              default: 4000,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_file_context',
        description: 'Get detailed context about a specific file in the codebase.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file (relative to repo root)',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'get_recent_changes',
        description: 'Get context about recent changes in the codebase.',
        inputSchema: {
          type: 'object',
          properties: {
            days: {
              type: 'number',
              description: 'Number of days to look back',
              default: 7,
            },
          },
        },
      },
      {
        name: 'find_related',
        description: 'Find files and functions related to a given file or concept.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'File path or concept to find related entities for',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'index_repo',
        description: 'Index or re-index the current repository.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'detect_conventions',
        description: 'Detect coding conventions in the codebase (naming, file structure, testing, exports).',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Optional: filter by category (naming, file-structure, testing, exports, directory)',
              enum: ['naming', 'file-structure', 'testing', 'exports', 'imports', 'directory'],
            },
          },
        },
      },
      {
        name: 'analyze_architecture',
        description: 'Analyze module boundaries, detect architectural patterns and layers in the codebase.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              description: 'Analysis mode: full, modules-only, concepts-only',
              enum: ['full', 'modules', 'concepts'],
            },
          },
        },
      },
      {
        name: 'get_graph',
        description: 'Retrieve the knowledge graph structure — nodes, edges, clusters, and statistics.',
        inputSchema: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              description: 'Output format: summary, json, dot',
              enum: ['summary', 'json', 'dot'],
            },
          },
        },
      },
    ],
  };
});

// ─── Handle Tool Calls ─────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'get_context': {
      const query = String(args?.query || '');
      const maxTokens = Number(args?.max_tokens) || 4000;

      const result = bridge.getContext({
        query,
        maxTokens,
        format: 'prompt',
      });

      return {
        content: [
          {
            type: 'text',
            text: result.summary + '\n\n' + result.sections.map((s) => s.content).join('\n'),
          },
        ],
      };
    }

    case 'get_file_context': {
      const filePath = String(args?.file_path || '');
      const result = bridge.getFileContext(filePath);

      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: `File "${filePath}" not found in the index. Try running \`index_repo\` first.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: result.sections[0]?.content || 'No context available.',
          },
        ],
      };
    }

    case 'get_recent_changes': {
      const days = Number(args?.days) || 7;
      // MVP: Return stats + ask user to run cb what-changed
      const stats = bridge.getStats();

      return {
        content: [
          {
            type: 'text',
            text: `## Recent Changes (last ${days} days)\n\n` +
              `Current index stats:\n` +
              `- ${stats.fileCount} files\n` +
              `- ${stats.functionCount} functions\n` +
              `- ${stats.classCount} classes\n` +
              `- ${stats.typeCount} types\n\n` +
              `For detailed git changes, run \`git log --since="${days}.days.ago"\` in your terminal.`,
          },
        ],
      };
    }

    case 'find_related': {
      const query = String(args?.query || '');
      const result = bridge.getContext({ query, format: 'prompt' });

      if (result.sections.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No related entities found for "${query}".`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: result.sections.map((s) => s.content).join('\n'),
          },
        ],
      };
    }

    case 'index_repo': {
      const progress = bridge.index();
      return {
        content: [
          {
            type: 'text',
            text: `Indexing complete! ${progress.indexed} files indexed, ${progress.skipped} skipped, ${progress.errors} errors.`,
          },
        ],
      };
    }

    case 'detect_conventions': {
      const category = args?.category as string | undefined;
      let result;

      if (category) {
        const conventions = bridge.getConventionsByCategory(
          category as import('@contextbridge/core').ConventionCategory,
        );
        result = { conventions, summary: `Filtered by ${category}`, fileCounts: {} };
      } else {
        result = bridge.detectConventions();
      }

      let text = result.summary + '\n\n';
      for (const c of result.conventions) {
        text += `## ${c.name} (${Math.round(c.confidence * 100)}%)\n`;
        text += `${c.description}\n`;
        if (c.suggestion) text += `💡 ${c.suggestion}\n`;
        if (c.examples.length > 0) {
          text += `Examples: ${c.examples.slice(0, 3).join(', ')}\n`;
        }
        text += '\n';
      }

      return {
        content: [{ type: 'text', text }],
      };
    }

    case 'analyze_architecture': {
      const mode = (args?.mode as string) || 'full';
      const arch = bridge.analyzeArchitecture();

      let text = '';
      if (mode !== 'concepts') {
        text += `## Module Boundaries (${arch.modules.length})\n\n`;
        for (const mod of arch.modules.slice(0, 15)) {
          text += `### ${mod.name}\n`;
          text += `- Path: ${mod.rootPath}\n`;
          text += `- Files: ${mod.files.length}\n`;
          text += `- Cohesion: ${Math.round(mod.cohesion * 100)}%\n`;
          text += `- Coupling: ${Math.round(mod.coupling * 100)}%\n`;
          text += `- Exports: ${mod.exports.length}\n`;
          if (mod.subModules.length > 0) text += `- Sub-modules: ${mod.subModules.join(', ')}\n`;
          text += '\n';
        }
      }

      if (mode !== 'modules' && arch.concepts.length > 0) {
        text += `## Architectural Concepts (${arch.concepts.length})\n\n`;
        for (const c of arch.concepts) {
          text += `### ${c.name} (${c.type}, ${Math.round(c.confidence * 100)}%)\n`;
          text += `${c.description}\n`;
          if (c.evidence.length > 0) text += `Evidence: ${c.evidence.slice(0, 3).join(', ')}\n`;
          text += '\n';
        }
      }

      return { content: [{ type: 'text', text }] };
    }

    case 'get_graph': {
      const format = (args?.format as string) || 'summary';

      if (format === 'json') {
        const graph = bridge.getKnowledgeGraph();
        return {
          content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }],
        };
      } else if (format === 'dot') {
        const dot = bridge.exportGraphDot();
        return {
          content: [{ type: 'text', text: dot }],
        };
      } else {
        const graph = bridge.getKnowledgeGraph();
        let text = `## Knowledge Graph Summary\n\n`;
        text += `- Nodes: ${graph.stats.nodeCount}\n`;
        text += `- Edges: ${graph.stats.edgeCount}\n`;
        text += `- Clusters: ${graph.clusters.length}\n`;
        text += `- Avg Degree: ${graph.stats.averageDegree}\n\n`;

        text += `### Node Types\n`;
        for (const [type, count] of Object.entries(graph.stats.nodeTypeBreakdown)) {
          text += `- ${type}: ${count}\n`;
        }

        text += `\n### Top Clusters\n`;
        for (const cluster of graph.clusters.slice(0, 8)) {
          text += `- **${cluster.name}**: ${cluster.nodes.length} nodes, density ${cluster.density}\n`;
        }

        return { content: [{ type: 'text', text }] };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ─── Start Server ──────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ContextBridge MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
