# ContextBridge 🧠

**Context orchestration for AI-assisted development.**

ContextBridge sits between your codebase and any AI coding tool (Codebuff, Cursor, Copilot, Claude, Cline, etc.), intelligently curating, retrieving, and injecting the right context at the right time.

## Why?

Every AI coding tool has the same bottleneck: **context**. The quality of AI output is directly proportional to the quality of context fed into it. Developers today spend more time crafting prompts and manually gathering context than actually producing output.

ContextBridge solves this by becoming the **single source of truth for context** — a platform that indexes your codebase, understands its architecture, and delivers pinpoint-accurate context to any AI tool on demand.

## Features

- **🔍 AST-based indexing** — Parses your code into a rich knowledge graph of functions, classes, types, and their relationships (not just file embeddings)
- **🌐 Multi-language support** — TypeScript/JavaScript via the TS Compiler API, plus Python, Go, and Rust via regex-based parsers
- **🎨 Convention detection** — Auto-discovers naming, file structure, testing, and export conventions across your codebase
- **🏗️ Architecture analysis** — Detects module boundaries, infers architectural patterns (layered, hexagonal, MVC, feature-based), and measures cohesion/coupling
- **🧠 Knowledge graph** — Builds a graph of files↔functions↔classes↔types with edges for imports, calls, extends, and implements; includes community detection and centrality scoring
- **🎯 Smart context retrieval** — Given a natural language query, finds the most relevant code entities and synthesizes them into a focused context package
- **🔄 Incremental indexing** — Only re-indexes files that changed (detected via content hash)
- **🔌 MCP protocol support** — 8 MCP tools to plug into any MCP-compatible AI tool (Cursor, Codebuff, Claude Desktop, Cline)
- **📊 Web dashboard** — Interactive D3.js force-directed graph visualization (`cb serve`) with filtering, clustering, and JSON export
- **💻 Rich CLI interface** — 9 commands: `init`, `context`, `ask`, `what-changed`, `status`, `conventions`, `architecture`, `graph`, `serve`
- **📈 Feedback loops** — Rate context results to improve relevance over time
- **🏠 Local-first** — Everything runs on your machine with SQLite, no cloud dependency

## Quick Start

### Installation

```bash
# Install globally
npm install -g @contextbridge/cli

# Or run directly
npx @contextbridge/cli
```

### Index your repository

```bash
cd your-project
cb init
```

Scans your codebase, parses TypeScript/JavaScript/Python/Go/Rust files, and builds a local index in `.contextbridge/`.

```
$ cb init
🔍 ContextBridge — Indexing repository...
  Directory: /Users/you/your-project

✅ Done!
  14 files found
  14 files indexed
  0 files skipped (unchanged)

📊 Stats:
  14 files indexed
  67 functions
  5 classes
  14 types
```

### Get context for a task

```bash
cb context "How does the payment flow work?"
cb context "Explain the authentication architecture" --format prompt
```

```
$ cb context "What does the context engine do?"
📋 Context Package
──────────────────────────────────────────────────
💡 Summary: The ContextEngine class manages context retrieval and synthesis.

📄 packages/core/src/context-engine.ts
  • getContext - Main entry point for context retrieval
  • getFileContext - Get context about a specific file
  • recordFeedback - Record feedback for learning

──────────────────────────────────────────────────
Token cost: ~850 | Confidence: 87%
Intent: codebase_exploration
```

### Interactive mode

```bash
cb ask
cb> How do we handle error states?
```

### Analyze architecture

```bash
cb architecture
```

```
$ cb architecture
🏗️  Architecture Analysis
──────────────────────────────────────────────────────────

📦 Module Boundaries (4)

  packages/core
    Path:     .
    Files:    10
    Cohesion: 72% (higher = tighter)
    Coupling: 18% (lower = more independent)
    Sub:      packages/core/src, packages/core/src/__tests__

  packages/cli
    Path:     .
    Files:    3
    Cohesion: 45%
    Coupling: 35%

🧩 Architectural Patterns (2)

  HIGH Monorepo (layered)
       Packages are organized in a layered structure with clear boundaries.
       Evidence: core → sdk → cli/mcp-server

  HIGH Feature-based (feature-based)
       Directory structure groups code by feature domain.
       Evidence: packages/core/src, packages/cli/src, packages/mcp-server/src
```

### Detect conventions

```bash
cb conventions
cb conventions --category naming --verbose
```

```
$ cb conventions
🎨 Codebase Conventions
──────────────────────────────────────────────────────────

📁 Naming
  HIGH camelCase functions
       camelCase is used for function, method, and variable names
       💡 Consider PascalCase for class names and UPPER_CASE for constants
  HIGH PascalCase classes
       PascalCase is used for class and interface names

📁 File Structure
  MED  src directory pattern
       Source files are organized under a src/ directory
  MED  __tests__ co-location
       Tests are placed in __tests__ directories adjacent to source files

📁 Testing
  HIGH *.test.ts naming
       Test files follow the *.test.ts naming convention
```

### Explore the knowledge graph

```bash
cb graph --stats
cb graph --json -o graph.json
cb graph --dot -o graph.dot
```

```
$ cb graph --stats
📊 Knowledge Graph Stats

  Nodes:  89
  Edges:  156
  Clusters: 4
  Avg Degree: 3.5

  Node Types:
    file: 14
    function: 67
    class: 5
    type: 14

  Edge Types:
    defines: 86
    calls: 42
    imports: 24
    implements: 3
    extends: 1
```

### Launch the dashboard

```bash
cb serve
# Open http://localhost:4620 in your browser
```

The dashboard provides an interactive D3.js force-directed graph visualization with node filtering, radial layout, cluster highlighting, drag-drop JSON loading, and PNG export.

### Check index status

```bash
cb status
cb status --conventions
```

```
$ cb status
📊 ContextBridge Status

  Files:     14
  Functions: 67
  Classes:   5
  Types:     14
  DB Size:   108.0 KB
```

### MCP Server (for AI tool integration)

```bash
npx @contextbridge/mcp-server
```

Then configure in any MCP-compatible client:

```json
{
  "mcpServers": {
    "contextbridge": {
      "command": "npx",
      "args": ["@contextbridge/mcp-server"]
    }
  }
}
```

Available MCP tools:
- `get_context` — Get context about the codebase for any query
- `get_file_context` — Deep context for a specific file
- `get_recent_changes` — What changed recently
- `find_related` — Find related entities
- `index_repo` — Index or re-index
- `detect_conventions` — Detect coding conventions (naming, file structure, testing)
- `analyze_architecture` — Analyze module boundaries and architectural patterns
- `get_graph` — Retrieve knowledge graph (summary, JSON, or DOT format)

## SDK Usage

```typescript
import { ContextBridge } from '@contextbridge/sdk';

const bridge = new ContextBridge({ repoDir: '/path/to/repo' });
bridge.initialize();
bridge.index();

// Context retrieval
const result = bridge.getContext({
  query: 'How does the payment flow work?'
});
console.log(result.summary);
console.log(result.sections);

// Convention detection
const report = bridge.detectConventions();
console.log(report.conventions);

// Architecture analysis
const arch = bridge.analyzeArchitecture();
console.log(arch.modules, arch.concepts);

// Knowledge graph
const graph = bridge.getKnowledgeGraph();
console.log(graph.nodes, graph.edges, graph.clusters);

// Dashboard server
const server = bridge.serve(4620);
// → http://localhost:4620

bridge.close();
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CLIENTS                            │
│  CLI (terminal)  │  MCP Clients  │  API / SDKs      │
└──────────┬──────────────────────────┬──────────────┘
           │                          │
┌──────────▼──────────────────────────▼──────────────┐
│              CONTEXT API GATEWAY                    │
│  @contextbridge/sdk (ContextBridge class)           │
└──────────┬──────────────────────────┬──────────────┘
           │                          │
┌──────────▼──────────┐  ┌───────────▼──────────────┐
│   CONTEXT ENGINE    │  │   FEEDBACK ENGINE        │
│  (Retrieval +       │  │  (Track outcomes,        │
│   Ranking +         │  │   learn what worked)     │
│   Synthesis)        │  │                          │
└──────────┬──────────┘  └───────────┬──────────────┘
           │                          │
┌──────────▼──────────────────────────▼──────────────┐
│              KNOWLEDGE GRAPH                       │
│  (Code entities, relationships, conventions,       │
│   architectural patterns, domain concepts)         │
├─────────────────────────────────────────────────────┤
│  Convention       │  Architecture   │  Multi-lang   │
│  Detector          │  Analyzer       │  Parser       │
│  (naming, file     │  (modules,      │  (TS, Python, │
│   structure,       │   patterns,     │   Go, Rust)   │
│   testing)         │   cohesion)     │               │
└──────────┬──────────────────────────┬──────────────┘
           │                          │
┌──────────▼──────────┐  ┌───────────▼──────────────┐
│   INDEXER SERVICE   │  │   INTEGRATION BUS        │
│  (File watcher,     │  │  (Git, Slack, Notion,    │
│   parser, embedder) │  │   Jira, Linear, etc.)    │
└──────────────────────┘  └──────────────────────────┘
```

## Project Structure

```
contextbridge/
├── packages/
│   ├── core/           # Core engine: indexing, storage, context retrieval
│   │   ├── src/
│   │   │   ├── ast-parser.ts              # TS/JS AST parser
│   │   │   ├── multi-language-parser.ts   # Python, Go, Rust parsers
│   │   │   ├── context-engine.ts          # Context retrieval & synthesis
│   │   │   ├── convention-detector.ts     # Convention auto-discovery
│   │   │   ├── architecture-analyzer.ts   # Module boundaries & patterns
│   │   │   ├── knowledge-graph.ts         # Graph builder & clusterer
│   │   │   ├── dashboard.html             # D3.js visualization dashboard
│   │   │   ├── indexer.ts                 # File indexing engine
│   │   │   ├── storage.ts                 # SQLite persistence layer
│   │   │   ├── types.ts                   # Shared type definitions
│   │   │   └── index.ts                   # Public API exports
│   │   └── src/__tests__/                 # 7 test suites (146 tests)
│   ├── cli/            # CLI: 9 commands (init, context, ask, what-changed,
│   │                   #   status, conventions, architecture, graph, serve)
│   ├── mcp-server/     # MCP protocol server (8 tools) for AI tool integration
│   └── sdk/            # Node.js SDK for programmatic use + HTTP dashboard server
├── docs/plans/         # Design documents
└── package.json        # Monorepo root (pnpm workspaces + Turborepo)
```

## Tech Stack

- **Runtime:** Node.js ≥ 22
- **Language:** TypeScript 5.8
- **Monorepo:** pnpm workspaces + Turborepo
- **Storage:** SQLite (better-sqlite3) with WAL mode
- **AST Parsing:** TypeScript Compiler API + regex-based multi-language parsers
- **Visualization:** D3.js force-directed graph (dashboard)
- **CLI:** Commander.js + chalk
- **MCP:** @modelcontextprotocol/sdk
- **Testing:** Vitest (146 tests across 10 test suites)

## Roadmap

### Phase 1 (MVP) ✅
- [x] Local-first CLI with SQLite storage
- [x] TS/JS AST parser (functions, classes, types)
- [x] Basic context retrieval engine
- [x] MCP server for AI tool integration
- [x] Feedback tracking
- [x] Git integration (`cb what-changed`)

### Phase 2 (Complete) ✅
- [x] Multi-language support (Python, Go, Rust via regex-based parsers)
- [x] Convention detection (naming, file structure, testing patterns)
- [x] Architecture analysis (module boundaries, patterns, cohesion/coupling)
- [x] Knowledge graph (nodes, edges, clusters, community detection)
- [x] Web UI dashboard (D3.js force-directed graph + `cb serve`)
- [x] 146 tests across 10 test suites (core: 7, cli: 1, mcp-server: 1, sdk: 1)
- [x] CLI commands: `cb conventions`, `cb architecture`, `cb graph`, `cb serve`
- [x] MCP tools: `detect_conventions`, `analyze_architecture`, `get_graph`

### Phase 3 (Planned)
- [ ] Tree-sitter integration for precise multi-language AST parsing
- [ ] Cloud sync & team workspaces
- [ ] IDE extensions (VS Code, JetBrains)
- [ ] Integration bus (Slack, Notion, Jira, Linear)
- [ ] Enterprise features (SSO, audit, RBAC)
- [ ] File watching for auto re-indexing

## License

MIT
