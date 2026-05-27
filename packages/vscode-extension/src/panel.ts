import * as vscode from 'vscode';
import type { ContextResult } from './bridge';

export class ContextPanel {
  static readonly viewType = 'contextbridge.panel';

  private static _current: ContextPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, title: string, html: string): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (ContextPanel._current) {
      ContextPanel._current._panel.reveal(column);
      ContextPanel._current._update(title, html);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ContextPanel.viewType,
      title,
      column,
      { enableScripts: false, retainContextWhenHidden: true },
    );

    ContextPanel._current = new ContextPanel(panel, extensionUri);
    ContextPanel._current._update(title, html);
  }

  static showContext(extensionUri: vscode.Uri, query: string, result: ContextResult): void {
    ContextPanel.show(extensionUri, `CB: ${query.slice(0, 40)}`, renderContext(query, result));
  }

  static showJson(extensionUri: vscode.Uri, title: string, data: unknown): void {
    ContextPanel.show(extensionUri, title, renderJson(title, data));
  }

  static showError(extensionUri: vscode.Uri, title: string, message: string): void {
    ContextPanel.show(extensionUri, title, renderError(message));
  }

  static showLoading(extensionUri: vscode.Uri, title: string, message: string): void {
    ContextPanel.show(extensionUri, title, renderLoading(message));
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private _update(title: string, html: string): void {
    this._panel.title = title;
    this._panel.webview.html = html;
  }

  dispose(): void {
    ContextPanel._current = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}

// ─── HTML renderers ──────────────────────────────────────────

function shell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #333);
    --accent: var(--vscode-textLink-foreground, #4ec9b0);
    --dim: var(--vscode-descriptionForeground, #888);
    --code-bg: var(--vscode-textBlockQuote-background, #1e1e1e);
    --badge-bg: var(--vscode-badge-background, #4d4d4d);
    --badge-fg: var(--vscode-badge-foreground, #fff);
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    background: var(--bg);
    color: var(--fg);
    margin: 0;
    padding: 16px 20px;
    line-height: 1.5;
  }
  h1 { font-size: 1.1em; margin: 0 0 4px 0; color: var(--accent); }
  h2 { font-size: 1em; margin: 12px 0 4px 0; color: var(--fg); border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .summary { margin: 8px 0 16px 0; color: var(--dim); }
  .section { margin-bottom: 16px; }
  .entity { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; }
  .entity-name { font-family: var(--vscode-editor-font-family, monospace); color: var(--accent); }
  .entity-desc { color: var(--dim); font-size: 0.9em; }
  .meta { display: flex; gap: 16px; font-size: 0.85em; color: var(--dim); border-top: 1px solid var(--border); padding-top: 8px; margin-top: 16px; }
  .meta span { display: flex; gap: 4px; align-items: center; }
  .badge { background: var(--badge-bg); color: var(--badge-fg); padding: 1px 6px; border-radius: 3px; font-size: 0.8em; }
  pre { background: var(--code-bg); padding: 10px 12px; border-radius: 4px; overflow-x: auto; font-size: 0.9em; white-space: pre-wrap; word-break: break-all; }
  .error { color: var(--vscode-errorForeground, #f44); }
  .loading { color: var(--dim); display: flex; align-items: center; gap: 8px; }
  .spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .file-path { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; color: var(--dim); }
</style>
</head>
<body>${body}</body>
</html>`;
}

function renderContext(query: string, result: ContextResult): string {
  const confidence = Math.round((result.queryMetadata?.confidence ?? 0) * 100);
  const entitiesFound = result.queryMetadata?.entitiesFound ?? [];

  // Parse the section content into file blocks with entity bullet points
  let sectionsHtml = '';
  for (const section of result.sections) {
    const lines = section.content.split('\n').filter(Boolean);
    let content = '';
    for (const line of lines) {
      if (line.startsWith('📄') || line.startsWith('  📄')) {
        const filePath = line.replace(/📄\s*/, '').trim();
        content += `<h2><span class="file-path">📄 ${esc(filePath)}</span></h2>`;
      } else if (line.startsWith('  •') || line.startsWith('•')) {
        const parts = line.replace(/[•\s]+/, '').split(' — ');
        const name = parts[0]?.trim() ?? '';
        const desc = parts.slice(1).join(' — ').trim();
        content += `<div class="entity">
          <span class="entity-name">${esc(name)}</span>
          ${desc ? `<span class="entity-desc">— ${esc(desc)}</span>` : ''}
        </div>`;
      } else if (line.trim()) {
        content += `<div style="margin:2px 0">${esc(line)}</div>`;
      }
    }
    sectionsHtml += `<div class="section">${content}</div>`;
  }

  const badgesHtml = entitiesFound.slice(0, 8)
    .map(e => `<span class="badge">${esc(e)}</span>`)
    .join(' ');

  return shell(`
    <h1>🔍 ${esc(query)}</h1>
    <div class="summary">${esc(result.summary)}</div>
    ${sectionsHtml}
    <div class="meta">
      <span>~${result.tokenCost} tokens</span>
      <span>${confidence}% confidence</span>
      ${badgesHtml ? `<span style="flex:1">${badgesHtml}</span>` : ''}
    </div>
  `);
}

function renderJson(title: string, data: unknown): string {
  return shell(`
    <h1>${esc(title)}</h1>
    <pre>${esc(JSON.stringify(data, null, 2))}</pre>
  `);
}

function renderError(message: string): string {
  return shell(`<p class="error">❌ ${esc(message)}</p>`);
}

function renderLoading(message: string): string {
  return shell(`<div class="loading"><div class="spinner"></div>${esc(message)}</div>`);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
