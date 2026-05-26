#!/usr/bin/env node

import { Command } from 'commander';
import { ContextBridge } from '@contextbridge/sdk';
import type { ConventionCategory } from '@contextbridge/core';
import path from 'node:path';
import fs from 'node:fs';
import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { execSync, spawnSync } from 'node:child_process';

const program = new Command();

program
  .name('cb')
  .description('ContextBridge — Context orchestration for AI-assisted development')
  .version('0.1.3');

// ─── Init Command ──────────────────────────────────────────

program
  .command('init')
  .description('Initialize ContextBridge by indexing the current repository')
  .option('-w, --watch', 'Watch for file changes and re-index automatically')
  .option('--tree-sitter', 'Use tree-sitter parsers for Python, Go, and Rust (more precise)')
  .option('--semantic', 'Generate vector embeddings for semantic search (requires @xenova/transformers)')
  .action(async (options) => {
    const repoDir = process.cwd();
    const useTreeSitter = options.treeSitter || false;
    const useSemantic = options.semantic || false;

    const modeLabel = [useTreeSitter && 'tree-sitter', useSemantic && 'semantic'].filter(Boolean).join(', ');
    if (modeLabel) {
      console.log(chalk.blue(`🔍 ContextBridge — Indexing repository (${modeLabel})...`));
    } else {
      console.log(chalk.blue('🔍 ContextBridge — Indexing repository...'));
    }
    console.log(chalk.gray(`  Directory: ${repoDir}`));

    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    if (useTreeSitter) {
      // Check if tree-sitter native modules are available before proceeding
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('tree-sitter');
      } catch {
        console.log(chalk.yellow(
          '⚠️  tree-sitter native module could not be loaded (likely a Node version incompatibility).\n' +
          '   Falling back to regex-based parsers. Results will still be accurate for TypeScript/JS.\n' +
          '   To fix: use Node 18–22, or omit --tree-sitter.\n'
        ));
      }
    }

    if (useSemantic) {
      console.log(chalk.gray('  Loading embedding model (first run downloads ~22 MB)...'));
    }

    const progress = await bridge.index({ watch: options.watch, useTreeSitter, semantic: useSemantic })

    console.log(chalk.green(`\n✅ Done!`));
    console.log(`  ${chalk.yellow(progress.total)} files found`);
    console.log(`  ${chalk.green(progress.indexed)} files indexed`);
    console.log(`  ${chalk.gray(progress.skipped)} files skipped (unchanged)`);
    if (progress.errors > 0) {
      console.log(`  ${chalk.red(progress.errors)} errors`);
    }

    const stats = bridge.getStats();
    console.log(`\n${chalk.cyan('📊 Stats:')}`);
    console.log(`  ${stats.fileCount} files indexed`);
    console.log(`  ${stats.functionCount} functions`);
    console.log(`  ${stats.classCount} classes`);
    console.log(`  ${stats.typeCount} types`);

    if (options.watch) {
      console.log(chalk.cyan(`\n👀 Watching for file changes... (Ctrl+C to stop)`));

      // Graceful shutdown on Ctrl+C / SIGTERM
      const shutdown = () => {
        console.log(chalk.gray('\n  Stopping watcher...'));
        bridge.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } else {
      bridge.close();
    }
  });

// ─── Context Command ───────────────────────────────────────

program
  .command('context')
  .description('Get context for a task or question about the codebase')
  .argument('[query]', 'What do you want context on?')
  .option('-f, --format <format>', 'Output format: prompt, structured, minimal', 'prompt')
  .action(async (query, options) => {
    if (!query) {
      console.log(chalk.red('❌ Please provide a query. Usage: cb context "your question"'));
      process.exit(1);
    }

    const repoDir = process.cwd();
    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    const result = await bridge.getContext({ query, format: options.format as 'prompt' | 'structured' | 'minimal' });

    if (options.format === 'minimal') {
      console.log(result.summary);
    } else if (options.format === 'structured') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Default: prompt format — outputs markdown ready to paste into AI tools
      console.log(chalk.bold('\n📋 Context Package'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(result.summary);
      console.log();

      for (const section of result.sections) {
        console.log(section.content);
      }

      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.gray(`Token cost: ~${result.tokenCost} | Confidence: ${(result.queryMetadata.confidence * 100).toFixed(0)}%`));
      console.log(chalk.gray(`Intent: ${result.queryMetadata.interpretedIntent}`));
    }

    bridge.close();
  });

// ─── Ask Command (Interactive) ─────────────────────────────

program
  .command('ask')
  .description('Enter interactive mode to ask questions about the codebase')
  .action(async () => {
    const repoDir = process.cwd();
    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    console.log(chalk.cyan('\n🧠 ContextBridge Interactive Mode'));
    console.log(chalk.gray('  Type your questions about the codebase.'));
    console.log(chalk.gray('  Type "exit" or press Ctrl+C to quit.\n'));

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle Ctrl+C gracefully
    const cleanup = () => {
      rl.close();
      bridge.close();
      console.log(chalk.gray('\nGoodbye!'));
      process.exit(0);
    };
    process.on('SIGINT', cleanup);

    try {
      while (true) {
        const query = await rl.question(chalk.green('cb> '));
        if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') break;
        if (!query.trim()) continue;

        const result = await bridge.getContext({ query });

        console.log(chalk.bold('\n📋 Context Package\n'));
        console.log(result.summary);
        console.log();

        for (const section of result.sections) {
          console.log(section.content);
        }

        console.log(chalk.gray('─'.repeat(40)));

        // Ask for feedback
        const feedback = await rl.question(chalk.gray('Was this helpful? (1-5, or skip): '));
        if (feedback && /^[1-5]$/.test(feedback)) {
          bridge.recordFeedback(result.id, parseInt(feedback) as 1 | 2 | 3 | 4 | 5);
          console.log(chalk.green('  Thanks for the feedback!'));
        }
      }
    } finally {
      process.off('SIGINT', cleanup);
      rl.close();
      bridge.close();
      console.log(chalk.gray('\nGoodbye!'));
    }
  });

// ─── What Changed Command ─────────────────────────────────

program
  .command('what-changed')
  .description('Show recent git changes with context from the index')
  .option('-d, --days <days>', 'Number of days to look back', '7')
  .option('-n, --count <count>', 'Number of commits to show', '10')
  .action(async (options) => {
    const repoDir = process.cwd();
    // Sanitize: enforce integer bounds to prevent shell injection
    const days = Math.max(1, Math.min(365, Math.floor(Number(options.days)))) || 7;
    const count = Math.max(1, Math.min(100, Math.floor(Number(options.count)))) || 10;

    // Check if we're in a git repo
    let isGit = false;
    try {
      isGit = execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf-8', stdio: 'pipe' }).trim() === 'true';
    } catch {
      isGit = false;
    }

    if (!isGit) {
      console.log(chalk.red('❌ Not a git repository.'));
      process.exit(1);
    }

    console.log(chalk.blue(`\n📜 Recent Changes (last ${days} days)\n`));

    // Use spawnSync with arg arrays — no shell interpolation
    const logResult = spawnSync('git', [
      'log', '--oneline',
      `--since=${days}.days.ago`,
      `--max-count=${count}`,
    ], { encoding: 'utf-8' });
    const logOutput = (logResult.stdout || '').trim();

    if (!logOutput) {
      console.log(chalk.yellow('  No changes found in the last ' + days + ' days.'));
      return;
    }

    console.log(logOutput);
    console.log();

    // Get diff stat using safe args
    try {
      const statResult = spawnSync('git', [
        'diff', '--stat', `HEAD~${Math.min(count, 20)}..HEAD`,
      ], { encoding: 'utf-8' });
      const statOutput = (statResult.stdout || '').trim();
      if (statOutput) {
        console.log(chalk.cyan('  Files changed:'));
        const lines = statOutput.split('\n').slice(-20);
        for (const line of lines) {
          console.log(`  ${line}`);
        }
      }
    } catch {
      // Diff stat is best-effort
    }

    // Try to find relevant context from the index for changed files
    const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');
    if (fs.existsSync(dbPath)) {
      console.log(chalk.cyan('\n  🔗 Cross-referencing with index...'));
      const bridge = new ContextBridge({ repoDir });
      bridge.initialize();

      try {
        const changedResult = spawnSync('git', [
          'diff', '--name-only', `HEAD~${Math.min(count, 20)}..HEAD`,
        ], { encoding: 'utf-8' });
        const changedFiles = (changedResult.stdout || '')
          .trim().split('\n').filter(Boolean).slice(0, 10);

        for (const file of changedFiles.slice(0, 5)) {
          if (/\.(ts|tsx|js|jsx)$/.test(file)) {
            try {
              const ctx = bridge.getFileContext(file);
              if (ctx && ctx.sections.length > 0) {
                console.log(chalk.gray(`  📄 ${file}: ${ctx.sections[0].content.length} chars of context`));
              }
            } catch {
              // File might not be in index
            }
          }
        }
      } catch {
        // Best effort
      }

      bridge.close();
    }

    console.log(chalk.gray(`\n  Run \`cb context\` with a specific query to dive deeper.`));
  });

// ─── Status Command ────────────────────────────────────────

program
  .command('status')
  .description('Show indexing status for the current repository')
  .option('--conventions', 'Also show detected conventions summary')
  .action(async (options) => {
    const repoDir = process.cwd();
    const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');

    if (!fs.existsSync(dbPath)) {
      console.log(chalk.yellow('⚠️  Not indexed yet. Run `cb init` to index this repository.'));
      return;
    }

    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    const stats = bridge.getStats();
    const dbStats = fs.statSync(dbPath);

    console.log(chalk.cyan('\n📊 ContextBridge Status\n'));
    console.log(`  ${chalk.bold('Files:')}     ${stats.fileCount}`);
    console.log(`  ${chalk.bold('Functions:')} ${stats.functionCount}`);
    console.log(`  ${chalk.bold('Classes:')}   ${stats.classCount}`);
    console.log(`  ${chalk.bold('Types:')}     ${stats.typeCount}`);
    console.log(`  ${chalk.bold('DB Size:')}   ${(dbStats.size / 1024).toFixed(1)} KB`);

    if (options.conventions) {
      const report = bridge.detectConventions();
      console.log(`\n${chalk.magenta('🎨 Convention Summary:')}`);
      for (const c of report.conventions.filter((c) => c.confidence > 0.7)) {
        const badge = c.confidence > 0.9 ? chalk.green('●') : chalk.yellow('●');
        console.log(`  ${badge} ${c.name} (${Math.round(c.confidence * 100)}%)`);
      }
    }

    bridge.close();
  });

// ─── Conventions Command ──────────────────────────────────

program
  .command('conventions')
  .description('Detect and display coding conventions in the codebase')
  .option('-c, --category <category>', 'Filter by category: naming, file-structure, testing, exports, directory')
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Show detailed examples')
  .action(async (options) => {
    const repoDir = process.cwd();
    const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');

    if (!fs.existsSync(dbPath)) {
      console.log(chalk.yellow('⚠️  Not indexed yet. Run `cb init` to index this repository.'));
      return;
    }

    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    let report;
    if (options.category) {
      const conventions = bridge.getConventionsByCategory(
        options.category as ConventionCategory,
      );
      report = { conventions, summary: `Filtered by ${options.category}`, fileCounts: {} };
    } else {
      report = bridge.detectConventions();
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      bridge.close();
      return;
    }

    console.log(chalk.cyan('\n🎨 Codebase Conventions\n'));
    console.log(chalk.gray('─'.repeat(60)));

    const categories = [...new Set(report.conventions.map((c) => c.category))];

    for (const cat of categories) {
      const catConvs = report.conventions.filter((c) => c.category === cat);
      const catLabel = cat.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      console.log(chalk.bold(`\n📁 ${catLabel}`));

      for (const conv of catConvs) {
        const badge =
          conv.confidence > 0.9
            ? chalk.green('HIGH')
            : conv.confidence > 0.7
              ? chalk.yellow('MED ')
              : chalk.red('LOW ');
        console.log(`  ${badge} ${chalk.bold(conv.name)}`);
        console.log(`       ${conv.description}`);
        if (conv.suggestion) {
          console.log(`       ${chalk.italic.gray(`💡 ${conv.suggestion}`)}`);
        }
        if (options.verbose && conv.examples.length > 0) {
          for (const ex of conv.examples.slice(0, 3)) {
            console.log(`       ${chalk.gray(`→ ${ex}`)}`);
          }
        }
      }
    }

    console.log(chalk.gray('\n' + '─'.repeat(60)));
    console.log(chalk.gray(`  ${report.conventions.length} conventions detected across ${categories.length} categories`));

    bridge.close();
  });

// ─── Architecture Command ────────────────────────────────

program
  .command('architecture')
  .description('Analyze module boundaries and architectural patterns')
  .option('-j, --json', 'Output as JSON')
  .option('-m, --modules-only', 'Show only module boundaries')
  .option('-c, --concepts-only', 'Show only architectural concepts')
  .action(async (options) => {
    const repoDir = process.cwd();
    const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');

    if (!fs.existsSync(dbPath)) {
      console.log(chalk.yellow('⚠️  Not indexed yet. Run `cb init` to index this repository.'));
      return;
    }

    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    const arch = bridge.analyzeArchitecture();

    if (options.json) {
      console.log(JSON.stringify(arch, null, 2));
      bridge.close();
      return;
    }

    console.log(chalk.cyan('\n🏗️  Architecture Analysis\n'));
    console.log(chalk.gray('─'.repeat(60)));

    if (!options.conceptsOnly) {
      console.log(chalk.bold(`\n📦 Module Boundaries (${arch.modules.length})\n`));
      for (const mod of arch.modules) {
        const cohesionColor =
          mod.cohesion > 0.5 ? chalk.green : mod.cohesion > 0.2 ? chalk.yellow : chalk.red;
        const couplingColor =
          mod.coupling < 0.3 ? chalk.green : mod.coupling < 0.6 ? chalk.yellow : chalk.red;

        console.log(`  ${chalk.bold(mod.name)}`);
        console.log(`    Path:     ${mod.rootPath}`);
        console.log(`    Files:    ${mod.files.length}`);
        console.log(`    Cohesion: ${cohesionColor(`${Math.round(mod.cohesion * 100)}%`)} (higher = tighter)`);
        console.log(`    Coupling: ${couplingColor(`${Math.round(mod.coupling * 100)}%`)} (lower = more independent)`);
        if (mod.subModules.length > 0) {
          console.log(`    Sub:      ${mod.subModules.join(', ')}`);
        }
        console.log();
      }
    }

    if (!options.modulesOnly && arch.concepts.length > 0) {
      console.log(chalk.bold(`\n🧩 Architectural Patterns (${arch.concepts.length})\n`));
      for (const c of arch.concepts) {
        const badge =
          c.confidence > 0.8 ? chalk.green('HIGH') : c.confidence > 0.5 ? chalk.yellow('MED ') : chalk.red('LOW ');
        console.log(`  ${badge} ${chalk.bold(c.name)} (${c.type})`);
        console.log(`       ${c.description}`);
        if (c.evidence.length > 0) {
          console.log(`       Evidence: ${c.evidence.slice(0, 3).join(', ')}`);
        }
        console.log();
      }
    }

    console.log(chalk.gray('─'.repeat(60)));
    bridge.close();
  });

// ─── Graph Command ────────────────────────────────────────

program
  .command('graph')
  .description('Explore and export the knowledge graph')
  .option('-j, --json', 'Export as dashboard-ready JSON')
  .option('-d, --dot', 'Export as DOT format (Graphviz)')
  .option('-s, --stats', 'Show graph statistics')
  .option('-o, --output <file>', 'Write output to file')
  .action(async (options) => {
    const repoDir = process.cwd();
    const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');

    if (!fs.existsSync(dbPath)) {
      console.log(chalk.yellow('⚠️  Not indexed yet. Run `cb init` to index this repository.'));
      return;
    }

    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    if (options.stats) {
      const graph = bridge.getKnowledgeGraph();
      console.log(chalk.cyan('\n📊 Knowledge Graph Stats\n'));
      console.log(`  ${chalk.bold('Nodes:')}  ${graph.stats.nodeCount}`);
      console.log(`  ${chalk.bold('Edges:')}  ${graph.stats.edgeCount}`);
      console.log(`  ${chalk.bold('Clusters:')} ${graph.clusters.length}`);
      console.log(`  ${chalk.bold('Avg Degree:')} ${graph.stats.averageDegree}`);
      console.log(`\n  ${chalk.bold('Node Types:')}`);
      for (const [type, count] of Object.entries(graph.stats.nodeTypeBreakdown)) {
        console.log(`    ${type}: ${count}`);
      }
      console.log(`\n  ${chalk.bold('Edge Types:')}`);
      for (const [type, count] of Object.entries(graph.stats.edgeTypeBreakdown)) {
        console.log(`    ${type}: ${count}`);
      }
    } else if (options.dot) {
      const dot = bridge.exportGraphDot();
      if (options.output) {
        fs.writeFileSync(options.output, dot);
        console.log(chalk.green(`✅ Graph exported to ${options.output}`));
      } else {
        console.log(dot);
      }
    } else if (options.json) {
      const json = bridge.exportGraphJson();
      if (options.output) {
        fs.writeFileSync(options.output, json);
        console.log(chalk.green(`✅ Graph exported to ${options.output}`));
      } else {
        console.log(json);
      }
    } else {
      // Default: show graph summary
      const graph = bridge.getKnowledgeGraph();
      console.log(chalk.cyan('\n🧠 Knowledge Graph\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`  Nodes: ${graph.stats.nodeCount} | Edges: ${graph.stats.edgeCount} | Clusters: ${graph.clusters.length}`);
      console.log(chalk.gray('─'.repeat(60)));

      if (graph.clusters.length > 0) {
        console.log(chalk.bold('\n📦 Top Clusters:\n'));
        for (const cluster of graph.clusters.slice(0, 8)) {
          console.log(`  ${chalk.bold(cluster.name)} — ${cluster.nodes.length} nodes, density: ${cluster.density}`);
        }
      }

      console.log(chalk.gray('\n  Use --json, --dot, or --stats for detailed output.'));
    }

    bridge.close();
  });

// ─── Serve Command ────────────────────────────────────────

program
  .command('serve')
  .description('Start the dashboard server with API endpoints')
  .option('-p, --port <port>', 'Port to listen on', '4620')
  .action(async (options) => {
    const repoDir = process.cwd();
    const dbPath = path.join(repoDir, '.contextbridge', 'contextbridge.db');

    if (!fs.existsSync(dbPath)) {
      console.log(chalk.yellow('⚠️  Not indexed yet. Run `cb init` first.'));
      return;
    }

    const port = parseInt(options.port, 10);
    const bridge = new ContextBridge({ repoDir });
    bridge.initialize();

    const server = bridge.serve(port);

    // Handle graceful shutdown
    const shutdown = () => {
      console.log(chalk.gray('\n  Shutting down...'));
      server.close(() => {
        bridge.close();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ─── Parse Arguments ───────────────────────────────────────

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
