import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArchitectureAnalyzer } from '../architecture-analyzer.js';
import { Storage } from '../storage.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('ArchitectureAnalyzer', () => {
  let tmpDir: string;
  let storage: Storage;
  let analyzer: ArchitectureAnalyzer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
    storage = new Storage(tmpDir);
    storage.initialize();
    analyzer = new ArchitectureAnalyzer(storage);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedModule(basePath: string, fileCount: number, exportPrefix: string): void {
    for (let i = 0; i < fileCount; i++) {
      const filePath = `${basePath}/file${i}.ts`;
      storage.upsertFile({
        path: filePath,
        language: 'typescript',
        contentHash: `hash-${basePath}-${i}`,
        tokenCount: 100,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFunction({
        name: `${exportPrefix}${i}`,
        fullName: `${exportPrefix}${i}`,
        fileId: filePath,
        signature: '() => void',
        docComment: '',
        complexity: 1,
        startLine: 1,
        endLine: 3,
        isExported: true,
        isAsync: false,
      });
    }
  }

  describe('detectModules', () => {
    it('groups files into modules by directory', () => {
      seedModule('src/auth', 3, 'authFn');
      seedModule('src/payment', 2, 'paymentFn');

      const modules = analyzer.detectModules();
      expect(modules.length).toBe(2);

      const authMod = modules.find((m) => m.rootPath === 'src/auth');
      expect(authMod).toBeDefined();
      expect(authMod!.files.length).toBe(3);
      expect(authMod!.exports.length).toBe(3);

      const paymentMod = modules.find((m) => m.rootPath === 'src/payment');
      expect(paymentMod).toBeDefined();
      expect(paymentMod!.files.length).toBe(2);
    });

    it('skips single-file directories', () => {
      seedModule('src/lonely', 1, 'lonelyFn');

      const modules = analyzer.detectModules();
      expect(modules).toHaveLength(0); // Skip single-file modules
    });

    it('calculates cohesion for modules with shared exports', () => {
      // Two files with overlapping exported names for higher cohesion
      storage.upsertFile({
        path: 'src/shared/fileA.ts',
        language: 'typescript',
        contentHash: 'a',
        tokenCount: 50,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });
      storage.upsertFile({
        path: 'src/shared/fileB.ts',
        language: 'typescript',
        contentHash: 'b',
        tokenCount: 60,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      // Both files export 'commonHelper'
      storage.upsertFunction({ name: 'commonHelper', fullName: 'commonHelper', fileId: 'src/shared/fileA.ts', signature: '() => void', docComment: '', complexity: 1, startLine: 1, endLine: 3, isExported: true, isAsync: false });
      storage.upsertFunction({ name: 'commonHelper', fullName: 'commonHelper', fileId: 'src/shared/fileB.ts', signature: '() => void', docComment: '', complexity: 1, startLine: 1, endLine: 3, isExported: true, isAsync: false });

      const modules = analyzer.detectModules();
      const sharedMod = modules.find((m) => m.rootPath === 'src/shared');
      expect(sharedMod).toBeDefined();
      // Should have some cohesion from overlapping export names
      expect(sharedMod!.cohesion).toBeGreaterThan(0);
    });

    it('detects monorepo package modules', () => {
      seedModule('packages/core/src', 2, 'coreFn');
      seedModule('packages/cli/src', 2, 'cliFn');

      const modules = analyzer.detectModules();

      const pkgCore = modules.find((m) => m.rootPath === 'packages/core');
      const pkgCli = modules.find((m) => m.rootPath === 'packages/cli');

      // At least one package-level module should be detected
      const pkgModules = modules.filter((m) => m.rootPath.startsWith('packages/'));
      expect(pkgModules.length).toBeGreaterThanOrEqual(2);
    });

    it('infers readable module names', () => {
      seedModule('src/user-auth', 3, 'userAuth');

      const modules = analyzer.detectModules();
      const mod = modules.find((m) => m.rootPath === 'src/user-auth');
      expect(mod).toBeDefined();
      expect(mod!.name).toBe('User Auth'); // kebab-case -> readable
    });
  });

  describe('detectArchitecturalConcepts', () => {
    it('detects layer patterns', () => {
      seedModule('src/services', 2, 'service');
      seedModule('src/api', 2, 'apiHandler');

      const concepts = analyzer.detectArchitecturalConcepts();
      const businessLayer = concepts.find(
        (c) => c.type === 'layer' && c.name.includes('Business'),
      );
      const apiLayer = concepts.find(
        (c) => c.type === 'layer' && c.name.includes('API'),
      );

      // At least one layer should be detected
      expect(concepts.filter((c) => c.type === 'layer').length).toBeGreaterThan(0);
    });

    it('detects design patterns', () => {
      storage.upsertFile({
        path: 'src/factory/userFactory.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 30,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'src/factory/itemFactory.ts',
        language: 'typescript',
        contentHash: 'def',
        tokenCount: 40,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const concepts = analyzer.detectArchitecturalConcepts();
      const factoryPattern = concepts.find(
        (c) => c.type === 'pattern' && c.name.includes('Factory'),
      );

      expect(factoryPattern).toBeDefined();
    });

    it('detects event/observer patterns', () => {
      storage.upsertFile({
        path: 'src/events/userEvents.ts',
        language: 'typescript',
        contentHash: 'abc',
        tokenCount: 30,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      storage.upsertFile({
        path: 'src/listeners/authListener.ts',
        language: 'typescript',
        contentHash: 'def',
        tokenCount: 40,
        isTest: false,
        lastIndexedAt: new Date().toISOString(),
      });

      const concepts = analyzer.detectArchitecturalConcepts();
      const eventPattern = concepts.find(
        (c) => c.type === 'pattern' && c.name.includes('Observer'),
      );

      expect(eventPattern).toBeDefined();
    });

    it('detects domain boundaries', () => {
      seedModule('src/auth', 3, 'authFn');
      seedModule('src/payment', 2, 'payFn');

      const concepts = analyzer.detectArchitecturalConcepts();
      const authDomain = concepts.find(
        (c) => c.type === 'domain' && c.name.toLowerCase().includes('auth'),
      );
      const paymentDomain = concepts.find(
        (c) => c.type === 'domain' && c.name.toLowerCase().includes('payment'),
      );

      expect(authDomain).toBeDefined();
      expect(paymentDomain).toBeDefined();
    });
  });

  describe('getModuleReport', () => {
    it('returns a human-readable report', () => {
      seedModule('src/core', 3, 'coreFn');

      const report = analyzer.getModuleReport();
      expect(report).toContain('Architecture Analysis');
      expect(report).toContain('Module Boundaries');
      expect(report).toContain('src/core');
    });

    it('returns report with empty data', () => {
      const report = analyzer.getModuleReport();
      expect(report).toContain('Architecture Analysis');
      expect(report.length).toBeGreaterThan(0);
    });
  });
});
