import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import {
  type IndexedFile,
  type IndexedFunction,
  type IndexedClass,
  type IndexedType,
  type Relationship,
  type FeedbackEntry,
} from './types.js';

export class Storage {
  private db: Database.Database;
  private initialized = false;

  constructor(private repoDir: string) {
    const dbDir = path.join(repoDir, '.contextbridge');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'contextbridge.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * Current schema version. Increment when making incompatible schema changes.
   * On mismatch the database is wiped and recreated automatically.
   */
  private static readonly SCHEMA_VERSION = 3;

  initialize(): void {
    if (this.initialized) return;

    // Schema version tracking — auto-wipe on incompatible changes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
    `);

    const row = this.db
      .prepare('SELECT version FROM schema_version LIMIT 1')
      .get() as { version: number } | undefined;

    const currentVersion = row?.version ?? 0; // treat missing row as version 0

    if (currentVersion !== Storage.SCHEMA_VERSION) {
      // Incompatible schema: wipe all user tables and start fresh
      this.db.exec(`
        DROP TABLE IF EXISTS embeddings;
        DROP TABLE IF EXISTS relationships;
        DROP TABLE IF EXISTS feedback;
        DROP TABLE IF EXISTS types;
        DROP TABLE IF EXISTS classes;
        DROP TABLE IF EXISTS functions;
        DROP TABLE IF EXISTS files;
        DELETE FROM schema_version;
      `);
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(Storage.SCHEMA_VERSION);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        token_count INTEGER DEFAULT 0,
        is_test INTEGER DEFAULT 0,
        last_indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        signature TEXT,
        doc_comment TEXT,
        complexity INTEGER DEFAULT 0,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        is_exported INTEGER DEFAULT 0,
        is_async INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        methods TEXT DEFAULT '[]',
        properties TEXT DEFAULT '[]',
        extends_id TEXT,
        implements_ids TEXT DEFAULT '[]',
        is_exported INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('interface', 'type', 'enum', 'type-alias')),
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        properties TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL CHECK(relation_type IN ('calls', 'imports', 'extends', 'implements', 'uses_type', 'has_function', 'has_test')),
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        context_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        accepted_items TEXT DEFAULT '[]',
        rejected_items TEXT DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file_id);
      CREATE INDEX IF NOT EXISTS idx_classes_file ON classes(file_id);
      CREATE INDEX IF NOT EXISTS idx_types_file ON types(file_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relation_type);
      CREATE INDEX IF NOT EXISTS idx_feedback_context ON feedback(context_id);

      CREATE TABLE IF NOT EXISTS embeddings (
        entity_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);

    this.initialized = true;
  }

  // ─── File Operations ─────────────────────────────────────

  upsertFile(file: Omit<IndexedFile, 'id'> & { id?: string }): string {
    const id = file.id || file.path;
    const stmt = this.db.prepare(`
      INSERT INTO files (id, path, language, content_hash, token_count, is_test, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        content_hash = excluded.content_hash,
        token_count = excluded.token_count,
        is_test = excluded.is_test,
        last_indexed_at = excluded.last_indexed_at
    `);
    stmt.run(
      id,
      file.path,
      file.language,
      file.contentHash,
      file.tokenCount,
      file.isTest ? 1 : 0,
      file.lastIndexedAt,
    );
    return id;
  }

  getFileByPath(filePath: string): IndexedFile | null {
    const row = this.db
      .prepare('SELECT * FROM files WHERE path = ?')
      .get(filePath) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToFile(row);
  }

  getAllFiles(): IndexedFile[] {
    const rows = this.db.prepare('SELECT * FROM files').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToFile(r));
  }

  deleteFile(fileId: string): void {
    this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  }

  // ─── Function Operations ─────────────────────────────────

  upsertFunction(fn: Omit<IndexedFunction, 'id'> & { id?: string }): string {
    const id = fn.id || `${fn.fileId}:${fn.fullName}`;
    this.db
      .prepare(
        `
      INSERT INTO functions (id, name, full_name, file_id, signature, doc_comment, complexity, start_line, end_line, is_exported, is_async)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        signature = excluded.signature,
        doc_comment = excluded.doc_comment,
        complexity = excluded.complexity,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        is_exported = excluded.is_exported,
        is_async = excluded.is_async
    `,
      )
      .run(
        id,
        fn.name,
        fn.fullName,
        fn.fileId,
        fn.signature,
        fn.docComment,
        fn.complexity,
        fn.startLine,
        fn.endLine,
        fn.isExported ? 1 : 0,
        fn.isAsync ? 1 : 0,
      );
    return id;
  }

  getFunctionsByFile(fileId: string): IndexedFunction[] {
    const rows = this.db
      .prepare('SELECT * FROM functions WHERE file_id = ?')
      .all(fileId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFunction(r));
  }

  getFunctionById(id: string): IndexedFunction | null {
    const row = this.db
      .prepare('SELECT * FROM functions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToFunction(row) : null;
  }

  getAllFunctions(): IndexedFunction[] {
    const rows = this.db.prepare('SELECT * FROM functions').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToFunction(r));
  }

  // ─── Class Operations ────────────────────────────────────

  upsertClass(cls: Omit<IndexedClass, 'id'> & { id?: string }): string {
    const id = cls.id || `${cls.fileId}:${cls.name}`;
    this.db
      .prepare(
        `
      INSERT INTO classes (id, name, file_id, methods, properties, extends_id, implements_ids, is_exported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        methods = excluded.methods,
        properties = excluded.properties,
        extends_id = excluded.extends_id,
        implements_ids = excluded.implements_ids,
        is_exported = excluded.is_exported
    `,
      )
      .run(id, cls.name, cls.fileId, JSON.stringify(cls.methods), JSON.stringify(cls.properties), cls.extendsId, JSON.stringify(cls.implementsIds), cls.isExported ? 1 : 0);
    return id;
  }

  getClassesByFile(fileId: string): IndexedClass[] {
    const rows = this.db
      .prepare('SELECT * FROM classes WHERE file_id = ?')
      .all(fileId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToClass(r));
  }

  getAllClasses(): IndexedClass[] {
    const rows = this.db.prepare('SELECT * FROM classes').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToClass(r));
  }

  // ─── Type Operations ─────────────────────────────────────

  upsertType(t: Omit<IndexedType, 'id'> & { id?: string }): string {
    const id = t.id || `${t.fileId}:${t.name}`;
    this.db
      .prepare(
        `
      INSERT INTO types (id, name, kind, file_id, properties)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        properties = excluded.properties
    `,
      )
      .run(id, t.name, t.kind, t.fileId, JSON.stringify(t.properties));
    return id;
  }

  getTypesByFile(fileId: string): IndexedType[] {
    const rows = this.db
      .prepare('SELECT * FROM types WHERE file_id = ?')
      .all(fileId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToType(r));
  }

  // ─── Relationship Operations ─────────────────────────────

  upsertRelationship(rel: Omit<Relationship, 'id'> & { id?: string }): string {
    const id = rel.id || `${rel.sourceId}:${rel.relationType}:${rel.targetId}`;
    this.db
      .prepare(
        `
      INSERT INTO relationships (id, source_id, target_id, relation_type, metadata)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        metadata = excluded.metadata
    `,
      )
      .run(id, rel.sourceId, rel.targetId, rel.relationType, JSON.stringify(rel.metadata));
    return id;
  }

  getRelationshipsForFile(fileId: string): Relationship[] {
    const rows = this.db
      .prepare('SELECT * FROM relationships WHERE source_id = ? OR target_id = ?')
      .all(fileId, fileId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRelationship(r));
  }

  // ─── Feedback Operations ─────────────────────────────────

  insertFeedback(feedback: Omit<FeedbackEntry, 'id' | 'createdAt'> & { id?: string }): string {
    const id = feedback.id || crypto.randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO feedback (id, query, context_id, rating, accepted_items, rejected_items, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        feedback.query,
        feedback.contextId,
        feedback.rating,
        JSON.stringify(feedback.acceptedItems),
        JSON.stringify(feedback.rejectedItems),
        new Date().toISOString(),
      );
    return id;
  }

  getFeedbackForContext(contextId: string): FeedbackEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM feedback WHERE context_id = ? ORDER BY created_at DESC')
      .all(contextId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFeedback(r));
  }

  // ─── Search ──────────────────────────────────────────────

  searchFunctions(query: string, limit = 20): IndexedFunction[] {
    // Extract meaningful keywords (skip common stop words)
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'what', 'which', 'who']);

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 1 && !stopWords.has(k));

    if (keywords.length === 0) {
      // Fallback: search the whole query
      return this.searchFunctionsFullQuery(query, limit);
    }

    // Build a query that matches ANY keyword across name, full_name, or doc_comment
    const conditions = keywords.map(() => '(name LIKE ? OR full_name LIKE ? OR doc_comment LIKE ?)').join(' OR ');
    const params = keywords.flatMap((k) => [`%${k}%`, `%${k}%`, `%${k}%`]);
    params.push(String(limit));

    const sql = `SELECT * FROM functions WHERE ${conditions} LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFunction(r));
  }

  private searchFunctionsFullQuery(query: string, limit = 20): IndexedFunction[] {
    const rows = this.db
      .prepare('SELECT * FROM functions WHERE name LIKE ? OR full_name LIKE ? OR doc_comment LIKE ? LIMIT ?')
      .all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFunction(r));
  }

  searchFiles(query: string, limit = 20): IndexedFile[] {
    // Same keyword extraction for file search
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'what', 'which', 'who']);

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 1 && !stopWords.has(k));

    if (keywords.length === 0) {
      const rows = this.db
        .prepare('SELECT * FROM files WHERE path LIKE ? LIMIT ?')
        .all(`%${query}%`, limit) as Record<string, unknown>[];
      return rows.map((r) => this.rowToFile(r));
    }

    const conditions = keywords.map(() => 'path LIKE ?').join(' OR ');
    const params = keywords.map((k) => `%${k}%`);
    params.push(String(limit));

    const sql = `SELECT * FROM files WHERE ${conditions} LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFile(r));
  }

  // ─── Stats ───────────────────────────────────────────────

  getStats(): { fileCount: number; functionCount: number; classCount: number; typeCount: number } {
    const fileCount = (this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
    const functionCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM functions').get() as { count: number }
    ).count;
    const classCount = (this.db.prepare('SELECT COUNT(*) as count FROM classes').get() as { count: number }).count;
    const typeCount = (this.db.prepare('SELECT COUNT(*) as count FROM types').get() as { count: number }).count;
    return { fileCount, functionCount, classCount, typeCount };
  }

  // ─── Embeddings ──────────────────────────────────────────

  upsertEmbedding(entityId: string, entityType: string, embedding: Float32Array): void {
    this.db
      .prepare(
        'INSERT INTO embeddings (entity_id, entity_type, embedding) VALUES (?, ?, ?) ON CONFLICT(entity_id) DO UPDATE SET embedding = excluded.embedding, entity_type = excluded.entity_type',
      )
      .run(entityId, entityType, Buffer.from(embedding.buffer));
  }

  /** Returns all stored embeddings. Use for in-process cosine similarity search. */
  getAllEmbeddings(): { entityId: string; entityType: string; embedding: Float32Array }[] {
    const rows = this.db
      .prepare('SELECT entity_id, entity_type, embedding FROM embeddings')
      .all() as { entity_id: string; entity_type: string; embedding: Buffer }[];
    return rows.map((r) => ({
      entityId: r.entity_id,
      entityType: r.entity_type,
      embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
    }));
  }

  hasEmbeddings(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as { count: number };
    return row.count > 0;
  }

  deleteEmbeddingsForFile(fileId: string): void {
    // Delete embeddings for all functions/classes belonging to this file.
    const fnIds = this.db
      .prepare('SELECT id FROM functions WHERE file_id = ?')
      .all(fileId) as { id: string }[];
    const clsIds = this.db
      .prepare('SELECT id FROM classes WHERE file_id = ?')
      .all(fileId) as { id: string }[];
    const ids = [...fnIds, ...clsIds].map((r) => r.id);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db.prepare(`DELETE FROM embeddings WHERE entity_id IN (${placeholders})`).run(...ids);
  }

  // ─── Close ───────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  // ─── Row Mappers ─────────────────────────────────────────

  private rowToFile(row: Record<string, unknown>): IndexedFile {
    return {
      id: row.id as string,
      path: row.path as string,
      language: row.language as string,
      contentHash: row.content_hash as string,
      tokenCount: row.token_count as number,
      isTest: Boolean(row.is_test),
      lastIndexedAt: row.last_indexed_at as string,
    };
  }

  private rowToFunction(row: Record<string, unknown>): IndexedFunction {
    return {
      id: row.id as string,
      name: row.name as string,
      fullName: row.full_name as string,
      fileId: row.file_id as string,
      signature: (row.signature as string) || '',
      docComment: (row.doc_comment as string) || '',
      complexity: row.complexity as number,
      startLine: row.start_line as number,
      endLine: row.end_line as number,
      isExported: Boolean(row.is_exported),
      isAsync: Boolean(row.is_async),
    };
  }

  private rowToClass(row: Record<string, unknown>): IndexedClass {
    return {
      id: row.id as string,
      name: row.name as string,
      fileId: row.file_id as string,
      methods: JSON.parse((row.methods as string) || '[]'),
      properties: JSON.parse((row.properties as string) || '[]'),
      extendsId: row.extends_id as string | null,
      implementsIds: JSON.parse((row.implements_ids as string) || '[]'),
      isExported: Boolean(row.is_exported),
    };
  }

  private rowToType(row: Record<string, unknown>): IndexedType {
    return {
      id: row.id as string,
      name: row.name as string,
      kind: row.kind as IndexedType['kind'],
      fileId: row.file_id as string,
      properties: JSON.parse((row.properties as string) || '[]'),
    };
  }

  private rowToRelationship(row: Record<string, unknown>): Relationship {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      relationType: row.relation_type as Relationship['relationType'],
      metadata: JSON.parse((row.metadata as string) || '{}'),
    };
  }

  private rowToFeedback(row: Record<string, unknown>): FeedbackEntry {
    return {
      id: row.id as string,
      query: row.query as string,
      contextId: row.context_id as string,
      rating: row.rating as FeedbackEntry['rating'],
      acceptedItems: JSON.parse((row.accepted_items as string) || '[]'),
      rejectedItems: JSON.parse((row.rejected_items as string) || '[]'),
      createdAt: row.created_at as string,
    };
  }
}
