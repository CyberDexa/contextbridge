# ContextBridge 🧠

**Give your AI coding tools a structural map of your codebase.**

When you ask Claude, Cursor, or Copilot about your codebase, they answer from their training data — not from your actual code. ContextBridge fixes that. It parses your repo into a structured index of functions, classes, types, and their relationships, then serves that knowledge to any AI tool via the MCP protocol or a CLI.

No cloud. No API keys. No embeddings. Runs locally on SQLite in seconds.

---

## The problem

AI tools lack your codebase's structure. They don't know:
- That `processPayment()` is called by three different handlers
- That your project uses a specific error handling pattern
- That `UserService` extends `BaseRepository` which is defined elsewhere
- What your team's naming and file structure conventions are

You end up copy-pasting files into prompts and still getting generic answers.

## What ContextBridge does

It parses your code (not just greps it) and builds a local knowledge base:

```
cb init            # parse your whole repo → SQLite index in .contextbridge/
cb context "..."   # retrieve the most relevant functions/classes for a task
cb conventions     # detect your codebase's naming, structure, and testing patterns
cb architecture    # map module boundaries and identify architectural patterns
cb graph           # visualize the knowledge graph
cb serve           # open interactive D3.js dashboard at localhost:4620
```

Then plug it into any MCP-compatible AI tool once, and it works everywhere.

---

## Install

```bash
npm install -g @cyberdexa/contextbridge-cli
```

Requires Node.js ≥ 18.

---

## Quick start

```bash
cd your-project
cb init
```

```
🔍 ContextBridge — Indexing repository...
  Directory: /home/user/your-project

✅ Done!
  247 files found
  247 files indexed
  0 files skipped (unchanged)

📊 Stats:
  247 files indexed
  1,840 functions
  93 classes
  312 types
```

Re-running `cb init` is fast — only changed files are re-indexed.

### Get focused context for a task

```bash
cb context "How does authentication work?"
cb context "Where are database queries made?" --format prompt
cb context "payment flow" --top 5
```

```
📋 Context Package
──────────────────────────────────────────────────
💡 Summary: Found 4 functions and 2 files related to "authentication"

📄 src/auth/middleware.ts
  • verifyToken — Validates JWT and attaches user to request context
  • requireAuth — Express middleware wrapping verifyToken
  • refreshSession — Extends session expiry on valid refresh token

📄 src/auth/jwt.ts
  • signToken — Signs payload with RS256, 15m expiry
  • decodeToken — Verifies signature and returns claims

──────────────────────────────────────────────────
Token cost: ~620 | Confidence: 91%
```

The output is token-efficient and structured — ready to paste directly into any prompt.

### Understand what changed

```bash
cb what-changed           # vs last commit
cb what-changed --since HEAD~5
cb what-changed --since "2 days ago"
```

Produces a context package for only the changed code — useful for generating PR descriptions or telling an AI what's new.

### Detect conventions

```bash
cb conventions
```

```
🎨 Codebase Conventions
──────────────────────────────────────────────────

📁 Naming
  HIGH camelCase functions
  HIGH PascalCase classes
  MED  UPPER_CASE constants

📁 File Structure
  HIGH src directory pattern
  MED  __tests__ co-location

📁 Testing
  HIGH *.test.ts naming
  MED  describe/it blocks
```

Feed this to an AI when asking it to add new code — it will follow your actual conventions.

### Analyze architecture

```bash
cb architecture
```

```
🏗️  Architecture Analysis

📦 Module Boundaries (5)

  src/auth     Cohesion: 81%   Coupling: 12%
  src/api      Cohesion: 74%   Coupling: 23%
  src/db       Cohesion: 68%   Coupling: 31%

🧩 Patterns
  HIGH Layered architecture
  MED  Repository pattern
```

### Visualize the knowledge graph

```bash
cb graph --stats
cb serve                   # interactive D3.js graph at http://localhost:4620
cb graph --dot -o graph.dot
cb graph --json -o graph.json
```

---

## MCP integration (Cursor, Claude Desktop, Cline, Codebuff)

This is the main event. Configure ContextBridge once and every MCP-compatible tool gets live access to your codebase index.

**Step 1 — index your repo** (run once, then on demand):

```bash
cd /path/to/your-project
cb init
```

**Step 2 — add to your MCP client config:**

```json
{
  "mcpServers": {
    "contextbridge": {
      "command": "npx",
      "args": [
        "@cyberdexa/contextbridge-mcp",
        "--repo", "/path/to/your-project"
      ]
    }
  }
}
```

> **Note:** You can also set the `CONTEXTBRIDGE_REPO` env var instead of `--repo`. The server reads from the pre-built `.contextbridge/` index — run `cb init` (or `npx @cyberdexa/contextbridge-cli init`) first.

**Available MCP tools:**

| Tool | What it does |
|---|---|
| `get_context` | Context for any natural language query |
| `get_file_context` | Deep context for a specific file |
| `get_recent_changes` | Context for what's changed (git-aware) |
| `find_related` | Find entities related to a given name |
| `index_repo` | Trigger a re-index |
| `detect_conventions` | Return convention report |
| `analyze_architecture` | Return module boundaries and patterns |
| `get_graph` | Return graph as summary, JSON, or DOT |

Once configured, you can ask your AI tool: *"Follow our existing conventions and add an endpoint like the others in src/api"* — and it will know what "our conventions" and "the others" means.

---

## SDK usage (programmatic)

The SDK is included in the CLI package and can be used directly in Node.js projects that depend on ContextBridge as a library:

```typescript
import { ContextBridge } from '@cyberdexa/contextbridge-cli/sdk';

const bridge = new ContextBridge({ repoDir: '/path/to/repo' });
bridge.initialize();
await bridge.index();

// Query
const result = bridge.getContext('how does auth work');
console.log(result.summary);

// Conventions
const conventions = bridge.detectConventions();

// Architecture
const { modules, concepts } = bridge.analyzeArchitecture();

// Knowledge graph
const { nodes, edges, clusters } = bridge.getKnowledgeGraph();

// Dashboard server
const server = bridge.serve(4620);

bridge.close();
```

---

## How it works

ContextBridge does not use embeddings or LLMs. Everything is local:

1. **Parse** — TypeScript/JavaScript via the TS Compiler API. Python, Go, and Rust via regex-based parsers (+ optional tree-sitter for precise AST on Node 18–22).
2. **Store** — Functions, classes, types, and relationships are written to a local SQLite database in `.contextbridge/`.
3. **Retrieve** — Keyword scoring against names, signatures, and doc comments, boosted by structural signals (exports, complexity, relationships).
4. **Serve** — MCP tools and CLI commands query the same database.

The `.contextbridge/` directory should be added to `.gitignore`.

---

## Project structure

```
contextbridge/
├── packages/
│   ├── core/           # Indexer, storage, context engine, parsers, graph
│   ├── cli/            # 9 CLI commands — published as @cyberdexa/contextbridge-cli
│   ├── mcp-server/     # MCP server (8 tools) — bundled into the CLI package
│   └── sdk/            # ContextBridge class — bundled into the CLI package
└── docs/plans/
```

## Tech stack

- **Node.js** ≥ 18 · **TypeScript** 5.8
- **SQLite** via `better-sqlite3` (WAL mode, local-first)
- **TS Compiler API** for TypeScript/JavaScript AST parsing
- **Regex parsers** for Python, Go, Rust (optional tree-sitter for richer AST)
- **D3.js** force-directed graph (dashboard)
- **Commander.js** + chalk (CLI)
- **@modelcontextprotocol/sdk** (MCP server)
- **Vitest** — 146 tests across 10 suites

---

## Roadmap

### Done ✅
- Local-first CLI with SQLite storage
- TS/JS AST parsing (functions, classes, types, imports)
- Python, Go, Rust parsing (regex + optional tree-sitter)
- Context retrieval with keyword scoring
- Convention detection (naming, file structure, testing patterns)
- Architecture analysis (module boundaries, cohesion/coupling, pattern detection)
- Knowledge graph (nodes, edges, clusters, centrality)
- D3.js web dashboard (`cb serve`)
- MCP server with 8 tools
- Git-aware context (`cb what-changed`)
- Incremental indexing (content-hash based)
- File watching (`cb init --watch`)
- Schema versioning with auto-migration

### Planned
- Vector embeddings for semantic retrieval (complement keyword scoring)
- Cloud sync for team-shared indexes
- VS Code extension
- JetBrains plugin
- GitHub Actions integration

---

## License

MIT
