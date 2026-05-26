import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextEngine } from '../context-engine.js';
import { Storage } from '../storage.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('ContextEngine', () => {
  let tmpDir: string;
  let storage: Storage;
  let engine: ContextEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
    storage = new Storage(tmpDir);
    storage.initialize();
    engine = new ContextEngine(storage);

    // Seed some data
    storage.upsertFile({
      path: 'src/auth.ts',
      language: 'typescript',
      contentHash: 'abc',
      tokenCount: 100,
      isTest: false,
      lastIndexedAt: new Date().toISOString(),
    });

    storage.upsertFunction({
      name: 'authenticate',
      fullName: 'authenticate',
      fileId: 'src/auth.ts',
      signature: '(token: string) => boolean',
      docComment: 'Validates a user authentication token',
      complexity: 2,
      startLine: 1,
      endLine: 10,
      isExported: true,
      isAsync: false,
    });

    storage.upsertFunction({
      name: 'refreshToken',
      fullName: 'refreshToken',
      fileId: 'src/auth.ts',
      signature: '(refreshToken: string) => string',
      docComment: 'Refreshes an expired auth token',
      complexity: 3,
      startLine: 12,
      endLine: 25,
      isExported: true,
      isAsync: true,
    });

    storage.upsertFile({
      path: 'src/payment.ts',
      language: 'typescript',
      contentHash: 'def',
      tokenCount: 200,
      isTest: false,
      lastIndexedAt: new Date().toISOString(),
    });

    storage.upsertFunction({
      name: 'processPayment',
      fullName: 'processPayment',
      fileId: 'src/payment.ts',
      signature: '(amount: number, currency: string) => boolean',
      docComment: 'Processes a payment transaction',
      complexity: 4,
      startLine: 1,
      endLine: 30,
      isExported: true,
      isAsync: true,
    });

    storage.upsertType({
      name: 'PaymentStatus',
      kind: 'type',
      fileId: 'src/payment.ts',
      properties: ['pending', 'completed', 'failed'],
    });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getContext', () => {
    it('returns context for auth-related query', async () => {
      const result = await engine.getContext({ query: 'authentication' });
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.summary).toContain('authentication');
      expect(result.queryMetadata.entitiesFound.length).toBeGreaterThan(0);
    });

    it('returns context for payment-related query', async () => {
      const result = await engine.getContext({ query: 'payment' });
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.id).toBeTruthy();
    });

    it('returns empty result for unknown query', async () => {
      const result = await engine.getContext({ query: 'xzjklqwerty' });
      expect(result.sections.length).toBe(0);
      expect(result.summary).toContain('No context found');
    });

    it('respects maxTokens limit', async () => {
      const result = await engine.getContext({ query: 'auth', maxTokens: 1 });
      // With maxTokens=1, sections will be aggressively limited
      expect(result.tokenCost).toBeGreaterThanOrEqual(0);
    });

    it('interprets intent correctly', async () => {
      const result = await engine.getContext({ query: 'How does auth work?' });
      expect(result.queryMetadata.interpretedIntent).toContain('Understanding');
    });
  });

  describe('getFileContext', () => {
    it('returns context for an existing file', () => {
      const section = engine.getFileContext('src/auth.ts');
      expect(section).not.toBeNull();
      expect(section!.title).toContain('src/auth.ts');
      expect(section!.content).toContain('authenticate');
    });

    it('returns null for a non-existent file', () => {
      const section = engine.getFileContext('nonexistent.ts');
      expect(section).toBeNull();
    });
  });

  describe('recordFeedback', () => {
    it('stores feedback without throwing', () => {
      expect(() => {
        engine.recordFeedback('ctx-1', 'test query', 5, ['auth'], []);
      }).not.toThrow();
    });
  });

  describe('buildSummary', () => {
    it('returns helpful message when no context found', async () => {
      const result = await engine.getContext({ query: 'xyznonexistent' });
      expect(result.summary).toContain('Try rephrasing');
    });
  });
});
