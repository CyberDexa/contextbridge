import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConventionDetector } from '../convention-detector.js';
import { Storage } from '../storage.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('ConventionDetector', () => {
  let tmpDir: string;
  let storage: Storage;
  let detector: ConventionDetector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
    storage = new Storage(tmpDir);
    storage.initialize();
    detector = new ConventionDetector(storage);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectAll', () => {
    it('returns a convention report with summary', () => {
      // Seed a file with camelCase functions
      storage.upsertFile({
        path: 'src/utils.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      for (const name of ['getUser', 'setUser', 'updateProfile', 'deleteItem', 'fetchData']) {
        storage.upsertFunction({
          name,
          fullName: name,
          fileId: 'src/utils.ts',
          signature: '() => void',
          docComment: '',
          complexity: 1,
          startLine: 1,
          endLine: 3,
          isExported: name !== 'fetchData',
          isAsync: false,
        });
      }

      storage.upsertFile({
        path: 'src/components/Button.tsx',
        language: 'typescript',
        contentHash: 'def',
        tokenCount: 50,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFunction({
        name: 'Button',
        fullName: 'Button',
        fileId: 'src/components/Button.tsx',
        signature: '(props: ButtonProps) => JSX.Element',
        docComment: '',
        complexity: 2,
        startLine: 1,
        endLine: 20,
        isExported: true,
        isAsync: false,
      });

      const report = detector.detectAll();

      expect(report.conventions.length).toBeGreaterThan(0);
      expect(report.summary).toContain('Convention Report');
      expect(report.fileCounts).toBeDefined();
    });

    it('detects camelCase function convention when dominant', () => {
      storage.upsertFile({
        path: 'src/app.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      for (const name of ['getData', 'setData', 'updateState', 'clearCache']) {
        storage.upsertFunction({
          name,
          fullName: name,
          fileId: 'src/app.ts',
          signature: '() => void',
          docComment: '',
          complexity: 1,
          startLine: 1,
          endLine: 3,
          isExported: true,
          isAsync: false,
        });
      }

      const report = detector.detectAll();
      const camelConv = report.conventions.find(
        (c) => c.category === 'naming' && c.name.includes('camelCase'),
      );

      expect(camelConv).toBeDefined();
      expect(camelConv!.confidence).toBeGreaterThan(0.5);
      expect(camelConv!.examples.length).toBeGreaterThan(0);
    });

    it('detects PascalCase functions (React components)', () => {
      storage.upsertFile({
        path: 'src/App.tsx',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      for (const name of ['App', 'Header', 'Footer', 'Sidebar']) {
        storage.upsertFunction({
          name,
          fullName: name,
          fileId: 'src/App.tsx',
          signature: '(props: any) => JSX.Element',
          docComment: '',
          complexity: 2,
          startLine: 1,
          endLine: 10,
          isExported: true,
          isAsync: false,
        });
      }

      const report = detector.detectAll();
      const pascalConv = report.conventions.find(
        (c) => c.category === 'naming' && c.name.includes('PascalCase'),
      );

      expect(pascalConv).toBeDefined();
      expect(pascalConv!.confidence).toBeGreaterThan(0.5);
    });

    it('detects barrel file patterns', () => {
      // Create multiple index.ts barrel files
      const barrels = [
        'src/components/index.ts',
        'src/utils/index.ts',
        'src/hooks/index.ts',
      ];

      for (const barrel of barrels) {
        storage.upsertFile({
          path: barrel,
          language: 'typescript',
          contentHash: 'abc',
          tokenCount: 10,
          isTest: false,
          lastIndexedAt: new Date().toISOString(),
        });
      }

      const report = detector.detectAll();
      const barrelConv = report.conventions.find(
        (c) => c.category === 'file-structure' && c.name.includes('Barrel'),
      );

      expect(barrelConv).toBeDefined();
      expect(barrelConv!.examples.length).toBeGreaterThanOrEqual(3);
    });

    it('detects test file patterns', () => {
      storage.upsertFile({
        path: 'src/math.test.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: true,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'src/utils.test.ts',
        language: 'typescript',
        contentHash: 'def',
        tokenCount: 80,
        isTest: true,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'src/__tests__/auth.test.ts',
        language: 'typescript',
        contentHash: 'ghi',
        tokenCount: 60,
        isTest: true,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'src/auth.ts',
        language: 'typescript',
        contentHash: 'jkl',
        tokenCount: 200,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const report = detector.detectAll();
      const testSuffix = report.conventions.find(
        (c) => c.category === 'testing' && c.name.includes('.test.ts'),
      );

      expect(testSuffix).toBeDefined();
      expect(testSuffix!.confidence).toBeGreaterThan(0.5);
    });

    it('detects __tests__ directory pattern', () => {
      storage.upsertFile({
        path: 'src/__tests__/foo.test.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 50,
        isTest: true,
        lastIndexedAt: new Date().toISOString(),
      });

      const report = detector.detectAll();
      const testsDir = report.conventions.find(
        (c) => c.category === 'file-structure' && c.name.includes('__tests__'),
      );

      expect(testsDir).toBeDefined();
    });

    it('detects monorepo package structure', () => {
      storage.upsertFile({
        path: 'packages/core/src/index.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'packages/cli/src/index.ts',
        language: 'typescript',
        contentHash: 'def',
        tokenCount: 200,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const report = detector.detectAll();
      const monorepo = report.conventions.find(
        (c) => c.category === 'file-structure' && c.name.includes('Monorepo'),
      );

      expect(monorepo).toBeDefined();
    });

    it('detects pnpm and turborepo tooling', () => {
      storage.upsertFile({
        path: 'pnpm-lock.yaml',
        language: 'yaml',
        contentHash: 'lock',
        tokenCount: 500,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'turbo.json',
        language: 'json',
        contentHash: 'turbo',
        tokenCount: 20,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const report = detector.detectAll();

      const pnpm = report.conventions.find(
        (c) => c.category === 'directory' && c.name.includes('pnpm'),
      );
      const turbo = report.conventions.find(
        (c) => c.category === 'directory' && c.name.includes('Turborepo'),
      );

      expect(pnpm).toBeDefined();
      expect(turbo).toBeDefined();
    });

    it('reports no tests when no test files exist', () => {
      storage.upsertFile({
        path: 'src/only-code.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const report = detector.detectAll();
      const noTests = report.conventions.find(
        (c) => c.category === 'testing' && c.name.includes('No test'),
      );

      expect(noTests).toBeDefined();
    });

    it('returns export visibility ratios', () => {
      storage.upsertFile({
        path: 'src/module.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 50,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFunction({
        name: 'publicFn',
        fullName: 'publicFn',
        fileId: 'src/module.ts',
        signature: '() => void',
        docComment: '',
        complexity: 1,
        startLine: 1,
        endLine: 3,
        isExported: true,
        isAsync: false,
      });

      storage.upsertFunction({
        name: 'privateHelper',
        fullName: 'privateHelper',
        fileId: 'src/module.ts',
        signature: '() => void',
        docComment: '',
        complexity: 1,
        startLine: 5,
        endLine: 7,
        isExported: false,
        isAsync: false,
      });

      const report = detector.detectAll();
      const exports = report.conventions.find(
        (c) => c.category === 'exports' && c.name.includes('Export'),
      );

      expect(exports).toBeDefined();
      expect(exports!.description).toContain('50%');
    });
  });

  describe('getConvention', () => {
    it('returns a convention by id', () => {
      storage.upsertFile({
        path: 'src/app.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const report = detector.detectAll();
      if (report.conventions.length > 0) {
        const conv = detector.getConvention(report.conventions[0].id);
        expect(conv).not.toBeNull();
        expect(conv!.id).toBe(report.conventions[0].id);
      }
    });

    it('returns null for non-existent id', () => {
      const conv = detector.getConvention('nonexistent-id');
      expect(conv).toBeNull();
    });
  });

  describe('getConventionsByCategory', () => {
    it('filters conventions by category', () => {
      storage.upsertFile({
        path: 'src/app.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFunction({
        name: 'getData',
        fullName: 'getData',
        fileId: 'src/app.ts',
        signature: '() => void',
        docComment: '',
        complexity: 1,
        startLine: 1,
        endLine: 3,
        isExported: true,
        isAsync: false,
      });

      const naming = detector.getConventionsByCategory('naming');
      expect(naming.length).toBeGreaterThanOrEqual(0);
      expect(naming.every((c) => c.category === 'naming')).toBe(true);

      const testing = detector.getConventionsByCategory('testing');
      expect(testing.every((c) => c.category === 'testing')).toBe(true);
    });
  });
});
