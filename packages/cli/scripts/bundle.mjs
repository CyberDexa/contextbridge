#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const entryFile = resolve(distDir, 'index.js');
const bundleFile = resolve(distDir, 'index.bundle.tmp.js');
const coreDist = resolve(root, '..', 'core', 'dist');

// Read the original entry, strip shebang for esbuild
let src = readFileSync(entryFile, 'utf-8');
let shebang = '';
if (src.startsWith('#!/usr/bin/env node')) {
  shebang = src.slice(0, src.indexOf('\n')) + '\n';
  src = src.slice(src.indexOf('\n') + 1);
}
const cleanEntry = resolve(distDir, 'index.clean.tmp.mjs');
writeFileSync(cleanEntry, src);

await esbuild.build({
  entryPoints: [cleanEntry],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundleFile,
  // Keep native modules and optional modules external (lazy-loaded at runtime)
  external: [
    'better-sqlite3',
    'sqlite-vec',
    'tree-sitter',
    'tree-sitter-python',
    'tree-sitter-go',
    'tree-sitter-rust',
    'chokidar',
    '@xenova/transformers',
    'onnxruntime-node',
    '*/tree-sitter-parser.js',
  ],
  // Resolve workspace packages from their dist directories
  alias: {
    '@contextbridge/core': resolve(root, '..', 'core', 'dist', 'index.js'),
    '@contextbridge/sdk': resolve(root, '..', 'sdk', 'dist', 'index.js'),
  },
  sourcemap: false,
  minify: false,
});

// Copy tree-sitter-parser files so dynamic import works at runtime
const tsParserFiles = ['tree-sitter-parser.js', 'tree-sitter-parser.d.ts', 'tree-sitter-parser.js.map'];
for (const f of tsParserFiles) {
  const srcPath = resolve(coreDist, f);
  const dstPath = resolve(distDir, f);
  try {
    copyFileSync(srcPath, dstPath);
  } catch {
    // File might not exist (e.g. if only some are emitted)
  }
}

// Prepend shebang and write final output
let bundled = readFileSync(bundleFile, 'utf-8');
// Strip any shebang esbuild may have included
bundled = bundled.replace(/^#!.*\n/, '');
writeFileSync(entryFile, shebang + bundled);
chmodSync(entryFile, 0o755);

// Clean up temp files
unlinkSync(cleanEntry);
unlinkSync(bundleFile);

console.log('✅ CLI bundled successfully');
