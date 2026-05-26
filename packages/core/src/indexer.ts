import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import { AstParser } from './ast-parser.js';
import { PythonParser, GoParser, RustParser } from './multi-language-parser.js';
import { Storage } from './storage.js';
import type { ParseResult } from './types.js';

export interface IndexOptions {
  watch?: boolean;
  concurrency?: number;
  /** Use tree-sitter parsers for Python, Go, and Rust (more precise, requires native deps). */
  useTreeSitter?: boolean;
}

export interface IndexProgress {
  total: number;
  indexed: number;
  skipped: number;
  errors: number;
}

/** Event emitted by the watcher when a file change is indexed. */
export interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  filePath: string;
}

export class Indexer {
  private tsParser: AstParser;
  private pythonParser: PythonParser;
  private goParser: GoParser;
  private rustParser: RustParser;
  private storage: Storage;
  private _isIndexing = false;
  private _watcher: FSWatcher | null = null;
  private _repoDir = '';
  /** Whether tree-sitter parsers have been initialized yet. */
  private _treeSitterReady = false;

  // Map extensions to parsers
  private parserByExt: Map<string, 
    { language: string; parseFile: (filePath: string, content: string) => ParseResult }
  >;

  constructor(storage: Storage, tsParser?: AstParser) {
    this.storage = storage;
    this.tsParser = tsParser || new AstParser();
    this.pythonParser = new PythonParser();
    this.goParser = new GoParser();
    this.rustParser = new RustParser();

    this.parserByExt = new Map();

    // TypeScript/JavaScript extensions (always use TS Compiler API)
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      this.parserByExt.set(ext, {
        language: ext.startsWith('.t') ? 'typescript' : 'javascript',
        parseFile: (fp, c) => this.tsParser.parseFile(fp, c, ext.startsWith('.t') ? 'typescript' : 'javascript'),
      });
    }

    // Default: Regex-based parsers (zero-dependency)
    for (const ext of this.pythonParser.extensions) {
      this.parserByExt.set(ext, {
        language: 'python',
        parseFile: (fp, c) => this.pythonParser.parseFile(fp, c),
      });
    }
    for (const ext of this.goParser.extensions) {
      this.parserByExt.set(ext, {
        language: 'go',
        parseFile: (fp, c) => this.goParser.parseFile(fp, c),
      });
    }
    for (const ext of this.rustParser.extensions) {
      this.parserByExt.set(ext, {
        language: 'rust',
        parseFile: (fp, c) => this.rustParser.parseFile(fp, c),
      });
    }
  }

  /** Initialize tree-sitter parsers (lazy-loaded to avoid import if not used). */
  private async initTreeSitterParsers(): Promise<void> {
    if (this._treeSitterReady) return;
    try {
      // Dynamic import for ESM compatibility
      const mod = await import('./tree-sitter-parser.js');
      const { TreeSitterPythonParser, TreeSitterGoParser, TreeSitterRustParser } = mod;

      const tsp = new TreeSitterPythonParser();
      const tsg = new TreeSitterGoParser();
      const tsr = new TreeSitterRustParser();

      for (const ext of tsp.extensions) {
        this.parserByExt.set(ext, {
          language: 'python',
          parseFile: (fp, c) => tsp.parseFile(fp, c),
        });
      }
      for (const ext of tsg.extensions) {
        this.parserByExt.set(ext, {
          language: 'go',
          parseFile: (fp, c) => tsg.parseFile(fp, c),
        });
      }
      for (const ext of tsr.extensions) {
        this.parserByExt.set(ext, {
          language: 'rust',
          parseFile: (fp, c) => tsr.parseFile(fp, c),
        });
      }
      this._treeSitterReady = true;
    } catch (err) {
      console.warn('Tree-sitter parsers not available, falling back to regex-based parsers:',
        (err as Error).message);
      this._treeSitterReady = true; // Don't retry
    }
  }

  get isIndexing(): boolean {
    return this._isIndexing;
  }

  /**
   * Index the entire repository. Scans all supported files and builds the database.
   * Set options.watch to true to start a file watcher after initial indexing.
   * Set options.useTreeSitter to true for precise tree-sitter AST parsing (Python, Go, Rust).
   */
  indexRepo(repoDir: string, options?: IndexOptions): Promise<IndexProgress> {
    return this._doIndexRepo(repoDir, options);
  }

  private async _doIndexRepo(repoDir: string, options?: IndexOptions): Promise<IndexProgress> {
    // Lazy-init tree-sitter parsers if requested
    if (options?.useTreeSitter) {
      await this.initTreeSitterParsers();
    }

    this._isIndexing = true;
    this.storage.initialize();
    this._repoDir = repoDir;

    const progress: IndexProgress = { total: 0, indexed: 0, skipped: 0, errors: 0 };
    const files = this.findCodeFiles(repoDir);

    progress.total = files.length;

    for (const filePath of files) {
      try {
        const relativePath = path.relative(repoDir, filePath);
        const existing = this.storage.getFileByPath(relativePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const currentHash = crypto.createHash('sha256').update(content).digest('hex');

        // Skip if content hasn't changed
        if (existing && existing.contentHash === currentHash) {
          progress.skipped++;
          continue;
        }

        const language = this.detectLanguage(filePath);
        const ext = path.extname(filePath);
        const parser = this.parserByExt.get(ext);

        let result;
        if (parser) {
          result = parser.parseFile(relativePath, content);
        } else {
          // Fallback to TypeScript parser
          result = this.tsParser.parseFile(relativePath, content, language);
        }

        // Upsert file
        const fileId = relativePath; // Use path as ID

        // Remove stale data before re-indexing (cascade-deletes functions/classes/types)
        if (existing) {
          this.storage.deleteFile(fileId);
        }

        // Insert the freshly parsed file row
        this.storage.upsertFile({ ...result.file, id: fileId });

        // Insert functions
        for (const fn of result.functions) {
          this.storage.upsertFunction({ ...fn, id: `${fileId}:${fn.fullName}`, fileId });
        }

        // Insert classes
        for (const cls of result.classes) {
          this.storage.upsertClass({ ...cls, id: `${fileId}:${cls.name}`, fileId });
        }

        // Insert types
        for (const t of result.types) {
          this.storage.upsertType({ ...t, id: `${fileId}:${t.name}`, fileId });
        }

        // ─── Relationships ─────────────────────────────────────
        // Import relationships: resolve relative paths to indexed file IDs
        for (const importSpec of result.imports) {
          if (!importSpec.startsWith('.')) continue; // skip package imports, only relative
          const resolvedRel = this.resolveImport(relativePath, importSpec);
          if (resolvedRel && resolvedRel !== fileId) {
            const targetFile = this.storage.getFileByPath(resolvedRel);
            if (targetFile) {
              this.storage.upsertRelationship({
                id: `${fileId}->imports->${resolvedRel}`,
                sourceId: fileId,
                targetId: targetFile.id,
                relationType: 'imports',
                metadata: { specifier: importSpec },
              });
            }
          }
        }

        // Extends / implements relationships for classes
        for (const cls of result.classes) {
          if (cls.extendsId) {
            this.storage.upsertRelationship({
              id: `${fileId}:${cls.name}->extends->${cls.extendsId}`,
              sourceId: `${fileId}:${cls.name}`,
              targetId: cls.extendsId,
              relationType: 'extends',
              metadata: {},
            });
          }
          for (const implId of cls.implementsIds) {
            this.storage.upsertRelationship({
              id: `${fileId}:${cls.name}->implements->${implId}`,
              sourceId: `${fileId}:${cls.name}`,
              targetId: implId,
              relationType: 'implements',
              metadata: {},
            });
          }
        }

        progress.indexed++;
      } catch (err) {
        console.error(`Error indexing ${filePath}:`, err);
        progress.errors++;
      }
    }

    this._isIndexing = false;

    // Start file watcher if requested
    if (options?.watch) {
      this.startWatching(repoDir);
    }

    return progress;
  }

  // ─── File Watching ──────────────────────────────────────

  /** Start watching the repository for file changes. */
  startWatching(
    repoDir: string,
    onChange?: (event: WatchEvent, progress: IndexProgress) => void,
  ): void {
    if (this._watcher) {
      this.stopWatching();
    }

    this._repoDir = repoDir;
    const extensions = Array.from(this.parserByExt.keys());

    this._watcher = chokidar.watch(repoDir, {
      ignored: [
        /(^|[\/\\])\./,      // hidden files/directories
        /node_modules/,
        /dist/,
        /\.contextbridge/,
        /\.git/,
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this._watcher.on('add', (filePath: string) => {
      if (!extensions.some((ext) => filePath.endsWith(ext))) return;
      try {
        this.indexFile(repoDir, filePath);
        onChange?.({ type: 'add', filePath }, { total: 0, indexed: 1, skipped: 0, errors: 0 });
      } catch (err) {
        onChange?.({ type: 'add', filePath }, { total: 0, indexed: 0, skipped: 0, errors: 1 });
      }
    });

    this._watcher.on('change', (filePath: string) => {
      if (!extensions.some((ext) => filePath.endsWith(ext))) return;
      try {
        this.indexFile(repoDir, filePath);
        onChange?.({ type: 'change', filePath }, { total: 0, indexed: 1, skipped: 0, errors: 0 });
      } catch (err) {
        onChange?.({ type: 'change', filePath }, { total: 0, indexed: 0, skipped: 0, errors: 1 });
      }
    });

    this._watcher.on('unlink', (filePath: string) => {
      if (!extensions.some((ext) => filePath.endsWith(ext))) return;
      try {
        this.removeFile(repoDir, filePath);
        onChange?.({ type: 'unlink', filePath }, { total: 0, indexed: 0, skipped: 0, errors: 0 });
      } catch (err) {
        onChange?.({ type: 'unlink', filePath }, { total: 0, indexed: 0, skipped: 0, errors: 1 });
      }
    });

    this._watcher.on('ready', () => {
      if (!this._watcher) return;
    });
  }

  /** Stop the file watcher. */
  stopWatching(): void {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  /** Check if the watcher is active. */
  get isWatching(): boolean {
    return this._watcher !== null;
  }

  /**
   * Index a single file incrementally.
   */
  indexFile(repoDir: string, filePath: string): void {
    this.storage.initialize();

    const relativePath = path.relative(repoDir, filePath);
    const ext = path.extname(filePath);
    if (!this.parserByExt.has(ext)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const language = this.detectLanguage(filePath);
    const parser = this.parserByExt.get(ext);
    let result;
    if (parser) {
      result = parser.parseFile(relativePath, content);
    } else {
      result = this.tsParser.parseFile(relativePath, content, language);
    }
    const fileId = relativePath;

    // Remove old data and re-insert
    this.storage.deleteFile(fileId);
    this.storage.upsertFile({ ...result.file, id: fileId });

    for (const fn of result.functions) {
      this.storage.upsertFunction({ ...fn, id: `${fileId}:${fn.fullName}`, fileId });
    }
    for (const cls of result.classes) {
      this.storage.upsertClass({ ...cls, id: `${fileId}:${cls.name}`, fileId });
    }
    for (const t of result.types) {
      this.storage.upsertType({ ...t, id: `${fileId}:${t.name}`, fileId });
    }

    // Relationships for incremental index
    for (const importSpec of result.imports) {
      if (!importSpec.startsWith('.')) continue;
      const resolvedRel = this.resolveImport(fileId, importSpec);
      if (resolvedRel && resolvedRel !== fileId) {
        const targetFile = this.storage.getFileByPath(resolvedRel);
        if (targetFile) {
          this.storage.upsertRelationship({
            id: `${fileId}->imports->${resolvedRel}`,
            sourceId: fileId,
            targetId: targetFile.id,
            relationType: 'imports',
            metadata: { specifier: importSpec },
          });
        }
      }
    }
    for (const cls of result.classes) {
      if (cls.extendsId) {
        this.storage.upsertRelationship({
          id: `${fileId}:${cls.name}->extends->${cls.extendsId}`,
          sourceId: `${fileId}:${cls.name}`,
          targetId: cls.extendsId,
          relationType: 'extends',
          metadata: {},
        });
      }
    }
  }

  /**
   * Remove a file from the index when it's deleted.
   */
  removeFile(repoDir: string, filePath: string): void {
    const relativePath = path.relative(repoDir, filePath);
    this.storage.deleteFile(relativePath);
  }

  private findCodeFiles(dir: string): string[] {
    const files: string[] = [];
    const gitignore = this.parseGitignore(dir);

    const walk = (currentDir: string) => {
      let entries;
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(dir, fullPath);

        if (this.shouldIgnore(relativePath, gitignore)) continue;

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue; // Skip hidden dirs
          if (entry.name === 'node_modules') continue;
          if (entry.name === 'dist') continue;
          if (entry.name === '.contextbridge') continue;
          walk(fullPath);
        } else if (entry.isFile() && this.parserByExt.has(path.extname(entry.name))) {
          files.push(fullPath);
        }
      }
    };

    walk(dir);
    return files;
  }

  private parseGitignore(dir: string): string[] {
    const gitignorePath = path.join(dir, '.gitignore');
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      return content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
    } catch {
      return [];
    }
  }

  private shouldIgnore(relativePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchesGitignorePattern(relativePath, pattern)) return true;
    }
    return false;
  }

  /**
   * Match a relative file path against a single gitignore pattern.
   * Handles: exact names, *.ext, dir/, globstar patterns, and basic path prefixes.
   */
  private matchesGitignorePattern(filePath: string, pattern: string): boolean {
    const isDir = pattern.endsWith('/');
    const p = isDir ? pattern.slice(0, -1) : pattern;

    // Convert gitignore glob to regex
    const regexStr = p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars (not * ?)
      .replace(/\*\*/g, '\x00GLOBSTAR\x00')  // protect **
      .replace(/\*/g, '[^/]*')               // * = anything except /
      .replace(/\?/g, '[^/]')               // ? = single char except /
      .replace(/\x00GLOBSTAR\x00/g, '.*');   // ** = anything

    const hasSlash = p.includes('/');
    const segments = filePath.split('/');

    try {
      const regex = new RegExp(`^${regexStr}$`);

      if (hasSlash) {
        // Pattern with slash: match from root
        if (regex.test(filePath)) return true;
        // Also test as prefix for directory patterns
        if (isDir) {
          for (let i = 1; i <= segments.length; i++) {
            if (regex.test(segments.slice(0, i).join('/'))) return true;
          }
        }
      } else {
        // No slash: match against any path segment or basename
        for (const segment of segments) {
          if (regex.test(segment)) return true;
        }
        // Also match against the basename
        const basename = segments[segments.length - 1];
        if (regex.test(basename)) return true;
      }
    } catch {
      // Invalid regex fallback: simple substring
      return filePath.includes(p);
    }

    return false;
  }

  /**
   * Resolve a relative import specifier (e.g. './utils') to a repo-relative file path.
   * Returns the file path without extension, trying common extensions.
   */
  private resolveImport(fromRelative: string, importSpec: string): string | null {
    const fromDir = path.dirname(fromRelative);
    const resolved = path.normalize(path.join(fromDir, importSpec));

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of extensions) {
      const candidate = resolved.endsWith(ext) ? resolved : resolved + ext;
      if (this.storage.getFileByPath(candidate)) return candidate;
    }

    // Try index files
    for (const ext of extensions) {
      const candidate = path.join(resolved, `index${ext}`);
      if (this.storage.getFileByPath(candidate)) return candidate;
    }

    return null;
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.py':
      case '.pyw':
        return 'python';
      case '.go':
        return 'go';
      case '.rs':
        return 'rust';
      default:
        return 'unknown';
    }
  }

  /**
   * Get supported language parsers for the current indexer.
   */
  getSupportedLanguages(): string[] {
    return ['typescript', 'javascript', 'python', 'go', 'rust'];
  }
}
