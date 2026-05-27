# ContextBridge VS Code Extension

Gives you ContextBridge commands directly inside VS Code.

## Features

- **Status bar indicator** — shows `CB: Indexed` or `CB: Not indexed` at a glance
- **Command palette commands** (`Cmd+Shift+P`):
  - `ContextBridge: Index Repository` — runs `cb init` in a terminal
  - `ContextBridge: Index Repository (with Semantic Search)` — runs `cb init --semantic`
  - `ContextBridge: Get Context` — opens a query box and shows results in a panel
  - `ContextBridge: Get Context for Selection` — uses selected text as the query
  - `ContextBridge: Get File Context` — context for the active file
  - `ContextBridge: Show Conventions` — detected naming/structure conventions
  - `ContextBridge: Show Architecture` — module boundaries and patterns
  - `ContextBridge: Show Status` — index stats
- **Editor context menu** — right-click to get context for selection or active file
- **Keyboard shortcut** — `Cmd+Shift+B` (Mac) / `Ctrl+Shift+B` (Windows/Linux) for quick query

## Requirements

The extension shells out to the ContextBridge CLI. Install it globally first:

```bash
npm install -g @cyberdexa/contextbridge-cli
# or
npm install -g getcontextbridge
```

Then index your repo once:

```bash
cd your-project
cb init
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| `contextbridge.repoDir` | workspace root | Override the repository directory |
| `contextbridge.cliPath` | _(auto)_ | Path to `cb` executable |

The extension looks for `cb` in `PATH` automatically. If not found, it falls back to `npx @cyberdexa/contextbridge-cli`.

## Development

```bash
cd packages/vscode-extension
npm install
node scripts/bundle.mjs   # one-shot build
node scripts/bundle.mjs --watch  # watch mode

# To test locally: press F5 in VS Code with this folder open
# (opens an Extension Development Host window)
```

## License

MIT
