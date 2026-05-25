import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AstParser } from './ast-parser.js';
import { PythonParser, GoParser, RustParser } from './multi-language-parser.js';
import { Storage } from './storage.js';
import type { IndexedFile, IndexedFunction, IndexedClass, IndexedType } from './types.js';

export interface IndexOptions {
  watch?: boolean;
  concurrency?: number;
}

export interface IndexProgress {
  total: number;
  indexed: number;
  skipped: number;
  errors: number;
}

export class Indexer {
  private tsParser: AstParser;
  private pythonParser: PythonParser;
  private goParser: GoParser;
  private rustParser: RustParser;
  private storage: Storage;
  private _isIndexing = false;

  // Map extensions to parsers
  private parserByExt: Map<string, 
    { language: string; parseFile: (filePath: string, content: string) => import('./types.js').ParseResult }
  >;

  constructor(storage: Storage, tsParser?: AstParser) {
    this.storage = storage;
    this.tsParser = tsParser || new AstParser();
    this.pythonParser = new PythonParser();
    this.goParser = new GoParser();
    this.rustParser = new RustParser();

    this.parserByExt = new Map();
    // TypeScript/JavaScript extensions
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      this.parserByExt.set(ext, {
        language: ext.startsWith('.t') ? 'typescript' : 'javascript',
        parseFile: (fp, c) => this.tsParser.parseFile(fp, c, ext.startsWith('.t') ? 'typescript' : 'javascript'),
      });
    }
    // Python extensions
    for (const ext of this.pythonParser.extensions) {
      this.parserByExt.set(ext, {
        language: 'python',
        parseFile: (fp, c) => this.pythonParser.parseFile(fp, c),
      });
    }
    // Go extensions
    for (const ext of this.goParser.extensions) {
      this.parserByExt.set(ext, {
        language: 'go',
        parseFile: (fp, c) => this.goParser.parseFile(fp, c),
      });
    }
    // Rust extensions
    for (const ext of this.rustParser.extensions) {
      this.parserByExt.set(ext, {
        language: 'rust',
        parseFile: (fp, c) => this.rustParser.parseFile(fp, c),
      });
    }
  }

  get isIndexing(): boolean {
    return this._isIndexing;
  }

  /**
   * Index the entire repository. Scans all supported files and builds the database.
   */
  indexRepo(repoDir: string, options?: IndexOptions): IndexProgress {
    this._isIndexing = true;
    this.storage.initialize();

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
        this.storage.upsertFile({ ...result.file, id: fileId });

        // Remove old data if file was previously indexed, then re-insert
        if (existing) {
          this.storage.deleteFile(fileId);
        }

        // Insert file
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

        progress.indexed++;
      } catch (err) {
        console.error(`Error indexing ${filePath}:`, err);
        progress.errors++;
      }
    }

    this._isIndexing = false;
    return progress;
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
        .filter((l) => l && !l.startsWith('#'));
    } catch {
      return [];
    }
  }

  private shouldIgnore(relativePath: string, gitignore: string[]): boolean {
    for (const pattern of gitignore) {
      if (relativePath.startsWith(pattern) || relativePath.includes(pattern)) {
        return true;
      }
    }
    return false;
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
