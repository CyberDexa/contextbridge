#!/usr/bin/env node

// Use esbuild from the CLI package (already installed in the monorepo)
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const monorepoRoot = resolve(root, '..', '..');

// Resolve esbuild from CLI package or monorepo root
const requireFrom = createRequire(resolve(monorepoRoot, 'packages', 'cli', 'package.json'));
const esbuild = requireFrom('esbuild');
const distDir = resolve(root, 'dist');
const entryFile = resolve(distDir, 'index.js');
const bundleFile = resolve(distDir, 'index.bundle.tmp.js');

// Read the compiled entry, strip ESM shebang so esbuild can process it
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
  target: 'node18',
  format: 'cjs',
  outfile: bundleFile,
  // Native modules and optional tree-sitter stay external
  external: [
    'better-sqlite3',
    'sqlite-vec',
    'tree-sitter',
    'tree-sitter-python',
    'tree-sitter-go',
    'tree-sitter-rust',
    'chokidar',
    '*/tree-sitter-parser.js',
  ],
  // Resolve workspace packages from their built dist dirs
  alias: {
    '@contextbridge/core': resolve(root, '..', 'core', 'dist', 'index.js'),
    '@contextbridge/sdk': resolve(root, '..', 'sdk', 'dist', 'index.js'),
  },
  sourcemap: false,
  minify: false,
});

// Prepend shebang and write final output
let bundled = readFileSync(bundleFile, 'utf-8');
bundled = bundled.replace(/^#!.*\n/, '');
writeFileSync(entryFile, shebang + bundled);
chmodSync(entryFile, 0o755);

// Clean up temp files
unlinkSync(cleanEntry);
unlinkSync(bundleFile);

console.log('✅ MCP server bundled successfully');
