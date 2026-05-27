import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { isIndexed, runCb, getContext, getConventions, getArchitecture } from './bridge';
import { ContextPanel } from './panel';

let statusBarItem: vscode.StatusBarItem;

// ─── Helpers ─────────────────────────────────────────────────────

function getRepoDir(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('contextbridge');
  const override = cfg.get<string>('repoDir');
  if (override) return override;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0].uri.fsPath;
}

function getCliPath(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('contextbridge');
  const p = cfg.get<string>('cliPath');
  return p || undefined;
}

function updateStatusBar(repoDir?: string): void {
  if (!repoDir) {
    statusBarItem.hide();
    return;
  }

  if (isIndexed(repoDir)) {
    statusBarItem.text = '$(database) CB: Indexed';
    statusBarItem.tooltip = 'ContextBridge: Repository is indexed. Click for status.';
    statusBarItem.command = 'contextbridge.showStatus';
    statusBarItem.color = undefined;
  } else {
    statusBarItem.text = '$(warning) CB: Not indexed';
    statusBarItem.tooltip = 'ContextBridge: Run "ContextBridge: Index Repository" to index this repo.';
    statusBarItem.command = 'contextbridge.init';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
  }
  statusBarItem.show();
}

function requireIndexed(repoDir: string): boolean {
  if (!isIndexed(repoDir)) {
    vscode.window
      .showWarningMessage(
        'ContextBridge: This repository has not been indexed yet.',
        'Index Now',
      )
      .then((choice) => {
        if (choice === 'Index Now') {
          vscode.commands.executeCommand('contextbridge.init');
        }
      });
    return false;
  }
  return true;
}

// ─── Activate ────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  // Refresh status bar when workspace changes or files change
  updateStatusBar(getRepoDir());
  const watcher = vscode.workspace.createFileSystemWatcher('**/.contextbridge/contextbridge.db');
  watcher.onDidCreate(() => updateStatusBar(getRepoDir()));
  watcher.onDidChange(() => updateStatusBar(getRepoDir()));
  watcher.onDidDelete(() => updateStatusBar(getRepoDir()));
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar(getRepoDir())),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('contextbridge')) {
        updateStatusBar(getRepoDir());
      }
    }),
  );

  // ─── Commands ─────────────────────────────────────────────────

  context.subscriptions.push(
    // Index Repository
    vscode.commands.registerCommand('contextbridge.init', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: 'ContextBridge: Index',
        cwd: repoDir,
      });
      terminal.show();

      const cliPath = getCliPath();
      if (cliPath) {
        terminal.sendText(`node "${cliPath}" init`);
      } else {
        terminal.sendText('cb init 2>/dev/null || npx --yes @cyberdexa/contextbridge-cli init');
      }

      // Poll for completion
      const interval = setInterval(() => {
        if (isIndexed(repoDir)) {
          updateStatusBar(repoDir);
          clearInterval(interval);
        }
      }, 1500);
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
    }),

    // Index with Semantic Search
    vscode.commands.registerCommand('contextbridge.initSemantic', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: 'ContextBridge: Index (Semantic)',
        cwd: repoDir,
      });
      terminal.show();

      const cliPath = getCliPath();
      if (cliPath) {
        terminal.sendText(`node "${cliPath}" init --semantic`);
      } else {
        terminal.sendText(
          'cb init --semantic 2>/dev/null || npx --yes @cyberdexa/contextbridge-cli init --semantic',
        );
      }

      const interval = setInterval(() => {
        if (isIndexed(repoDir)) {
          updateStatusBar(repoDir);
          clearInterval(interval);
        }
      }, 1500);
      setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
    }),

    // Get Context (query input box)
    vscode.commands.registerCommand('contextbridge.getContext', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }
      if (!requireIndexed(repoDir)) return;

      const query = await vscode.window.showInputBox({
        prompt: 'ContextBridge — What do you need context on?',
        placeHolder: 'e.g. "how does authentication work"',
      });
      if (!query) return;

      ContextPanel.showLoading(context.extensionUri, `CB: ${query.slice(0, 40)}`, `Fetching context for "${query}"…`);

      try {
        const result = await getContext(query, repoDir, getCliPath());
        ContextPanel.showContext(context.extensionUri, query, result);
      } catch (err) {
        ContextPanel.showError(context.extensionUri, 'ContextBridge Error', String(err));
      }
    }),

    // Get Context for Selection
    vscode.commands.registerCommand('contextbridge.getContextForSelection', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }
      if (!requireIndexed(repoDir)) return;

      const editor = vscode.window.activeTextEditor;
      const selection = editor?.document.getText(editor.selection).trim();
      if (!selection) {
        vscode.window.showWarningMessage('ContextBridge: No text selected.');
        return;
      }

      const query = selection.length > 120 ? selection.slice(0, 120) + '…' : selection;
      ContextPanel.showLoading(context.extensionUri, `CB: ${query.slice(0, 40)}`, `Fetching context for selection…`);

      try {
        const result = await getContext(query, repoDir, getCliPath());
        ContextPanel.showContext(context.extensionUri, query, result);
      } catch (err) {
        ContextPanel.showError(context.extensionUri, 'ContextBridge Error', String(err));
      }
    }),

    // Get File Context
    vscode.commands.registerCommand('contextbridge.getFileContext', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }
      if (!requireIndexed(repoDir)) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('ContextBridge: No active file.');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const relPath = path.relative(repoDir, filePath);

      ContextPanel.showLoading(context.extensionUri, `CB: ${path.basename(filePath)}`, `Fetching context for ${relPath}…`);

      try {
        const result = await getContext(`file:${relPath}`, repoDir, getCliPath());
        ContextPanel.showContext(context.extensionUri, `file: ${relPath}`, result);
      } catch (err) {
        // Fallback: use the filename as a query
        try {
          const basename = path.basename(filePath, path.extname(filePath));
          const result = await getContext(basename, repoDir, getCliPath());
          ContextPanel.showContext(context.extensionUri, `file: ${relPath}`, result);
        } catch (err2) {
          ContextPanel.showError(context.extensionUri, 'ContextBridge Error', String(err2));
        }
      }
    }),

    // Show Conventions
    vscode.commands.registerCommand('contextbridge.showConventions', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }
      if (!requireIndexed(repoDir)) return;

      ContextPanel.showLoading(context.extensionUri, 'CB: Conventions', 'Detecting conventions…');

      try {
        const data = await getConventions(repoDir, getCliPath());
        ContextPanel.showJson(context.extensionUri, 'ContextBridge: Conventions', data);
      } catch (err) {
        ContextPanel.showError(context.extensionUri, 'ContextBridge Error', String(err));
      }
    }),

    // Show Architecture
    vscode.commands.registerCommand('contextbridge.showArchitecture', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }
      if (!requireIndexed(repoDir)) return;

      ContextPanel.showLoading(context.extensionUri, 'CB: Architecture', 'Analyzing architecture…');

      try {
        const data = await getArchitecture(repoDir, getCliPath());
        ContextPanel.showJson(context.extensionUri, 'ContextBridge: Architecture', data);
      } catch (err) {
        ContextPanel.showError(context.extensionUri, 'ContextBridge Error', String(err));
      }
    }),

    // Show Status
    vscode.commands.registerCommand('contextbridge.showStatus', async () => {
      const repoDir = getRepoDir();
      if (!repoDir) {
        vscode.window.showErrorMessage('ContextBridge: No workspace folder is open.');
        return;
      }

      const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');
      if (!fs.existsSync(dbPath)) {
        const choice = await vscode.window.showWarningMessage(
          'ContextBridge: Repository not indexed.',
          'Index Now',
        );
        if (choice === 'Index Now') {
          vscode.commands.executeCommand('contextbridge.init');
        }
        return;
      }

      const dbStats = fs.statSync(dbPath);
      const sizeMb = (dbStats.size / 1024 / 1024).toFixed(2);

      ContextPanel.showLoading(context.extensionUri, 'CB: Status', 'Loading status…');

      try {
        const raw = await runCb(['status'], repoDir, getCliPath());
        ContextPanel.showJson(context.extensionUri, 'ContextBridge: Status', {
          repoDir,
          dbPath,
          dbSizeMb: Number(sizeMb),
          raw: raw.trim(),
        });
      } catch {
        // Show basic info if status command fails
        ContextPanel.showJson(context.extensionUri, 'ContextBridge: Status', {
          repoDir,
          dbPath,
          dbSizeMb: Number(sizeMb),
          indexed: true,
        });
      }
    }),
  );
}

export function deactivate(): void {
  statusBarItem?.dispose();
}
