import crypto from 'node:crypto';
import { Storage } from './storage.js';
import type {
  DetectedConvention,
  ConventionReport,
  ConventionCategory,
  IndexedFunction,
  IndexedFile,
} from './types.js';

export class ConventionDetector {
  constructor(private storage: Storage) {}

  /**
   * Run all convention detectors and return a report.
   */
  detectAll(): ConventionReport {
    const conventions: DetectedConvention[] = [];

    conventions.push(...this.detectNamingConventions());
    conventions.push(...this.detectFileStructurePatterns());
    conventions.push(...this.detectTestingPatterns());
    conventions.push(...this.detectExportPatterns());
    conventions.push(...this.detectDirectoryConventions());

    // Count files by convention category
    const fileCounts: Record<string, number> = {};
    for (const c of conventions) {
      fileCounts[c.category] = (fileCounts[c.category] || 0) + c.examples.length;
    }

    const summary = this.buildSummary(conventions);

    return { conventions, summary, fileCounts };
  }

  /**
   * Detect naming conventions across the codebase.
   */
  private detectNamingConventions(): DetectedConvention[] {
    const functions = this.storage.getAllFunctions();
    const results: DetectedConvention[] = [];

    // Analyze function naming
    const camelCase = functions.filter((f) => this.isCamelCase(f.name));
    const pascalCase = functions.filter((f) => this.isPascalCase(f.name));
    const snakeCase = functions.filter((f) => this.isSnakeCase(f.name));

    const total = functions.length || 1;

    if (camelCase.length / total > 0.3) {
      results.push({
        id: this.makeId('naming', 'camelCase-functions'),
        category: 'naming',
        name: 'camelCase function names',
        pattern: '^[a-z][a-zA-Z0-9]*$',
        confidence: Math.round((camelCase.length / total) * 100) / 100,
        examples: camelCase.slice(0, 5).map((f) => f.fullName),
        description: `${camelCase.length} of ${total} functions use camelCase naming`,
        suggestion: 'Continue using camelCase for functions and variables.',
      });
    }

    if (pascalCase.length / total > 0.2) {
      results.push({
        id: this.makeId('naming', 'pascalCase-functions'),
        category: 'naming',
        name: 'PascalCase function names',
        pattern: '^[A-Z][a-zA-Z0-9]*$',
        confidence: Math.round((pascalCase.length / total) * 100) / 100,
        examples: pascalCase.slice(0, 5).map((f) => f.fullName),
        description: `${pascalCase.length} functions use PascalCase (likely React components or classes)`,
        suggestion: 'PascalCase is idiomatic for React components and class constructors.',
      });
    }

    if (snakeCase.length / total > 0.3) {
      results.push({
        id: this.makeId('naming', 'snake_case-functions'),
        category: 'naming',
        name: 'snake_case function names',
        pattern: '^[a-z][a-z0-9]*(_[a-z0-9]+)*$',
        confidence: Math.round((snakeCase.length / total) * 100) / 100,
        examples: snakeCase.slice(0, 5).map((f) => f.fullName),
        description: `${snakeCase.length} functions use snake_case naming`,
        suggestion: 'Consider camelCase for consistency if this is a TypeScript codebase.',
      });
    }

    // Detect exported function naming convention
    const exportedFns = functions.filter((f) => f.isExported);
    const exportedCamel = exportedFns.filter((f) => this.isCamelCase(f.name));
    const exportedPascal = exportedFns.filter((f) => this.isPascalCase(f.name));

    if (exportedCamel.length / (exportedFns.length || 1) > 0.5) {
      results.push({
        id: this.makeId('naming', 'exported-camelCase'),
        category: 'naming',
        name: 'Exported functions use camelCase',
        pattern: 'Exported functions: camelCase',
        confidence: Math.round((exportedCamel.length / (exportedFns.length || 1)) * 100) / 100,
        examples: exportedCamel.slice(0, 5).map((f) => f.fullName),
        description: `${exportedCamel.length} of ${exportedFns.length} exported functions use camelCase`,
      });
    }

    if (exportedPascal.length / (exportedFns.length || 1) > 0.5) {
      results.push({
        id: this.makeId('naming', 'exported-pascalCase'),
        category: 'naming',
        name: 'Exported functions use PascalCase',
        pattern: 'Exported functions: PascalCase',
        confidence: Math.round((exportedPascal.length / (exportedFns.length || 1)) * 100) / 100,
        examples: exportedPascal.slice(0, 5).map((f) => f.fullName),
        description: `${exportedPascal.length} of ${exportedFns.length} exported functions use PascalCase`,
      });
    }

    return results;
  }

  /**
   * Detect file structure patterns (e.g., barrel files, index files).
   */
  private detectFileStructurePatterns(): DetectedConvention[] {
    const files = this.storage.getAllFiles();
    const results: DetectedConvention[] = [];

    // Detect barrel/index files
    const barrelFiles = files.filter((f) => f.path.endsWith('/index.ts') || f.path.endsWith('/index.tsx'));
    if (barrelFiles.length > 2) {
      results.push({
        id: this.makeId('file-structure', 'barrel-files'),
        category: 'file-structure',
        name: 'Barrel export files (index.ts)',
        pattern: '**/index.ts',
        confidence: Math.min(barrelFiles.length / 10, 1),
        examples: barrelFiles.slice(0, 5).map((f) => f.path),
        description: `${barrelFiles.length} barrel files found. Common pattern for re-exporting modules.`,
        suggestion: 'Barrel files help keep imports clean but can cause circular dependency issues.',
      });
    }

    // Detect source directory patterns
    const srcFiles = files.filter((f) => f.path.startsWith('src/'));
    const libFiles = files.filter((f) => f.path.startsWith('lib/'));
    const packagesFiles = files.filter((f) => f.path.startsWith('packages/'));

    if (srcFiles.length / (files.length || 1) > 0.5) {
      results.push({
        id: this.makeId('file-structure', 'src-directory'),
        category: 'file-structure',
        name: 'Source code in src/ directory',
        pattern: 'src/**',
        confidence: Math.round((srcFiles.length / files.length) * 100) / 100,
        examples: [srcFiles[0]?.path, srcFiles[Math.floor(srcFiles.length / 2)]?.path].filter(Boolean),
        description: `${srcFiles.length} of ${files.length} files are under src/`,
      });
    }

    if (packagesFiles.length > 0) {
      results.push({
        id: this.makeId('file-structure', 'monorepo-packages'),
        category: 'file-structure',
        name: 'Monorepo package structure',
        pattern: 'packages/*/src/**',
        confidence: Math.min(packagesFiles.length / 20, 1),
        examples: packagesFiles.slice(0, 5).map((f) => f.path),
        description: `${packagesFiles.length} files in a monorepo packages/ structure`,
        suggestion: 'Monorepos benefit from shared conventions across packages.',
      });
    }

    // Detect __tests__ directories
    const testDirFiles = files.filter((f) => f.path.includes('__tests__/'));
    if (testDirFiles.length > 0) {
      results.push({
        id: this.makeId('file-structure', 'tests-directory'),
        category: 'file-structure',
        name: 'Tests in __tests__ directories',
        pattern: '**/__tests__/*',
        confidence: Math.min(testDirFiles.length / 5, 1),
        examples: testDirFiles.slice(0, 5).map((f) => f.path),
        description: `${testDirFiles.length} test files in __tests__/ directories`,
      });
    }

    return results;
  }

  /**
   * Detect testing patterns and conventions.
   */
  private detectTestingPatterns(): DetectedConvention[] {
    const files = this.storage.getAllFiles();
    const results: DetectedConvention[] = [];

    const testFiles = files.filter((f) => f.isTest);
    const totalFiles = files.length || 1;

    if (testFiles.length === 0) {
      results.push({
        id: this.makeId('testing', 'no-tests'),
        category: 'testing',
        name: 'No test files detected',
        pattern: 'N/A',
        confidence: 1,
        examples: [],
        description: 'No test files found in the codebase.',
        suggestion: 'Consider adding tests for critical functionality.',
      });
      return results;
    }

    // Detect test naming conventions
    const dotTest = testFiles.filter((f) => f.path.endsWith('.test.ts') || f.path.endsWith('.test.tsx'));
    const dotSpec = testFiles.filter((f) => f.path.endsWith('.spec.ts') || f.path.endsWith('.spec.tsx'));
    const testUnderTest = testFiles.filter((f) => f.path.includes('__tests__/'));

    if (dotTest.length / (testFiles.length || 1) > 0.5) {
      results.push({
        id: this.makeId('testing', 'test-suffix'),
        category: 'testing',
        name: 'Test files use .test.ts suffix',
        pattern: '*.test.ts',
        confidence: Math.round((dotTest.length / testFiles.length) * 100) / 100,
        examples: dotTest.slice(0, 5).map((f) => f.path),
        description: `${dotTest.length} of ${testFiles.length} test files use .test.ts naming (Vitest/Jest convention)`,
      });
    }

    if (dotSpec.length / (testFiles.length || 1) > 0.5) {
      results.push({
        id: this.makeId('testing', 'spec-suffix'),
        category: 'testing',
        name: 'Test files use .spec.ts suffix',
        pattern: '*.spec.ts',
        confidence: Math.round((dotSpec.length / testFiles.length) * 100) / 100,
        examples: dotSpec.slice(0, 5).map((f) => f.path),
        description: `${dotSpec.length} of ${testFiles.length} test files use .spec.ts naming`,
      });
    }

    // Test-to-source ratio
    const testRatio = Math.round((testFiles.length / totalFiles) * 100);
    results.push({
      id: this.makeId('testing', 'test-coverage-ratio'),
      category: 'testing',
      name: 'Test file ratio',
      pattern: `${testFiles.length} test files / ${totalFiles} total files`,
      confidence: 1,
      examples: [],
      description: `${testRatio}% of files are test files (${testFiles.length} of ${totalFiles})`,
      suggestion: testRatio < 15 ? 'Test coverage appears low. Consider adding more tests.' : undefined,
    });

    // Detect co-located vs separate test patterns
    const coLocated = testFiles.filter(
      (f) => !f.path.includes('__tests__/'),
    );
    if (coLocated.length / (testFiles.length || 1) > 0.5) {
      results.push({
        id: this.makeId('testing', 'colocated-tests'),
        category: 'testing',
        name: 'Co-located test files',
        pattern: 'Tests next to source files',
        confidence: Math.round((coLocated.length / testFiles.length) * 100) / 100,
        examples: coLocated.slice(0, 5).map((f) => f.path),
        description: `${coLocated.length} test files are co-located with source files`,
      });
    }

    return results;
  }

  /**
   * Detect export patterns (named vs default exports).
   */
  private detectExportPatterns(): DetectedConvention[] {
    const functions = this.storage.getAllFunctions();
    const results: DetectedConvention[] = [];

    const exported = functions.filter((f) => f.isExported);
    const notExported = functions.filter((f) => !f.isExported);

    if (exported.length > 0) {
      results.push({
        id: this.makeId('exports', 'export-ratio'),
        category: 'exports',
        name: 'Export visibility',
        pattern: `${exported.length} exported / ${functions.length} total functions`,
        confidence: 1,
        examples: exported.slice(0, 5).map((f) => f.fullName),
        description: `${Math.round((exported.length / (functions.length || 1)) * 100)}% of functions are exported`,
      });
    }

    // Detect barrel export patterns
    const files = this.storage.getAllFiles();
    const barrelFiles = files.filter(
      (f) => f.path.endsWith('/index.ts') || f.path.endsWith('/index.tsx'),
    );

    if (barrelFiles.length > 0) {
      results.push({
        id: this.makeId('exports', 'barrel-exports'),
        category: 'exports',
        name: 'Barrel export pattern',
        pattern: 'index.ts re-exports',
        confidence: Math.min(barrelFiles.length / 5, 1),
        examples: barrelFiles.slice(0, 5).map((f) => f.path),
        description: `${barrelFiles.length} barrel index files found`,
        suggestion: 'Named exports are preferred over barrel re-exports for tree-shaking.',
      });
    }

    return results;
  }

  /**
   * Detect directory and organizational conventions.
   */
  private detectDirectoryConventions(): DetectedConvention[] {
    const files = this.storage.getAllFiles();
    const results: DetectedConvention[] = [];

    // Group files by top-level directory
    const dirGroups = new Map<string, IndexedFile[]>();
    for (const file of files) {
      const topDir = file.path.split('/')[0] || '(root)';
      const existing = dirGroups.get(topDir) || [];
      existing.push(file);
      dirGroups.set(topDir, existing);
    }

    // Detect common patterns
    const hasDocsDir = dirGroups.has('docs');
    const hasScriptsDir = dirGroups.has('scripts');
    const hasConfigDir = files.some(
      (f) => f.path.startsWith('.') && f.path.split('/').length === 1,
    );

    if (hasDocsDir) {
      results.push({
        id: this.makeId('directory', 'docs-directory'),
        category: 'directory',
        name: 'Documentation in docs/',
        pattern: 'docs/ directory',
        confidence: 0.9,
        examples: dirGroups.get('docs')?.slice(0, 3).map((f) => f.path) || [],
        description: 'Project has a dedicated docs/ directory for documentation',
      });
    }

    if (hasScriptsDir) {
      results.push({
        id: this.makeId('directory', 'scripts-directory'),
        category: 'directory',
        name: 'Build/tool scripts in scripts/',
        pattern: 'scripts/ directory',
        confidence: 0.9,
        examples: dirGroups.get('scripts')?.slice(0, 3).map((f) => f.path) || [],
        description: 'Project has a scripts/ directory for build and tool scripts',
      });
    }

    // Detect package manager
    const hasPnpmLock = files.some((f) => f.path === 'pnpm-lock.yaml');
    const hasNpmLock = files.some((f) => f.path === 'package-lock.json');
    const hasYarnLock = files.some((f) => f.path === 'yarn.lock');

    if (hasPnpmLock) {
      results.push({
        id: this.makeId('directory', 'pnpm-package-manager'),
        category: 'directory',
        name: 'pnpm package manager',
        pattern: 'pnpm-lock.yaml',
        confidence: 1,
        examples: ['pnpm-lock.yaml'],
        description: 'Project uses pnpm as the package manager',
      });
    }

    // Detect monorepo tooling
    const hasTurbo = files.some((f) => f.path === 'turbo.json');
    if (hasTurbo) {
      results.push({
        id: this.makeId('directory', 'turborepo'),
        category: 'directory',
        name: 'Turborepo monorepo',
        pattern: 'turbo.json',
        confidence: 1,
        examples: ['turbo.json'],
        description: 'Project uses Turborepo for monorepo orchestration',
      });
    }

    return results;
  }

  /**
   * Detect a specific convention by category and name.
   */
  getConvention(id: string): DetectedConvention | null {
    const report = this.detectAll();
    return report.conventions.find((c) => c.id === id) || null;
  }

  /**
   * Get conventions filtered by category.
   */
  getConventionsByCategory(category: ConventionCategory): DetectedConvention[] {
    const report = this.detectAll();
    return report.conventions.filter((c) => c.category === category);
  }

  // ─── String Analysis Helpers ──────────────────────────────

  private isCamelCase(name: string): boolean {
    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  }

  private isPascalCase(name: string): boolean {
    return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  }

  private isSnakeCase(name: string): boolean {
    return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name);
  }

  // ─── Helpers ──────────────────────────────────────────────

  private makeId(category: string, name: string): string {
    return crypto
      .createHash('md5')
      .update(`${category}:${name}`)
      .digest('hex')
      .slice(0, 12);
  }

  private buildSummary(conventions: DetectedConvention[]): string {
    const categories = [...new Set(conventions.map((c) => c.category))];
    const highConfidence = conventions.filter((c) => c.confidence > 0.7);

    let summary = `## Convention Report\n\n`;
    summary += `Detected **${conventions.length}** conventions across **${categories.length}** categories:\n\n`;

    for (const cat of categories) {
      const catConvs = conventions.filter((c) => c.category === cat);
      summary += `- **${this.formatCategory(cat)}**: ${catConvs.length} patterns found\n`;
    }

    summary += `\n### High-Confidence Patterns (>70%)\n\n`;
    for (const c of highConfidence) {
      summary += `- **${c.name}** (${Math.round(c.confidence * 100)}%): ${c.description}\n`;
    }

    return summary;
  }

  private formatCategory(cat: string): string {
    const labels: Record<string, string> = {
      naming: 'Naming',
      'file-structure': 'File Structure',
      testing: 'Testing',
      exports: 'Exports',
      imports: 'Imports',
      directory: 'Directory',
      architecture: 'Architecture',
    };
    return labels[cat] || cat;
  }
}
