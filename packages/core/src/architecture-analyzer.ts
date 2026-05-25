import crypto from 'node:crypto';
import { Storage } from './storage.js';
import type { ModuleBoundary, ArchitecturalConcept, IndexedFile } from './types.js';

/**
 * Analyzes the codebase to detect module boundaries, architectural layers,
 * and higher-level patterns from indexed data.
 */
export class ArchitectureAnalyzer {
  constructor(private storage: Storage) {}

  /**
   * Detect module boundaries by analyzing directory structure and import patterns.
   */
  detectModules(): ModuleBoundary[] {
    const files = this.storage.getAllFiles();
    const modules = this.groupFilesByDirectory(files);
    const boundaries: ModuleBoundary[] = [];

    // Build a file-path-based import graph approximation using exported functions
    // Since the relationships table may not have import edges, we estimate coupling
    // from shared function/type references across modules
    const fileExports = new Map<string, Set<string>>();
    for (const file of files) {
      const fns = this.storage.getFunctionsByFile(file.id);
      fileExports.set(file.id, new Set(fns.filter(f => f.isExported).map(f => f.fullName)));
    }

    for (const [modulePath, moduleFiles] of modules) {
      if (moduleFiles.length < 2) continue; // Skip single-file modules

      const filePaths = moduleFiles.map((f) => f.path);
      const allExports = this.getModuleExports(moduleFiles);
      const allImports = this.getModuleImports(moduleFiles);

      // Calculate cohesion: ratio of shared export names across files in the module
      const cohesion = this.calculateFileCohesion(moduleFiles, fileExports);

      // Calculate coupling: how many unique external file references exist
      const coupling = this.calculateFileCoupling(moduleFiles, fileExports);

      boundaries.push({
        id: this.makeId(modulePath),
        name: this.inferModuleName(modulePath),
        rootPath: modulePath,
        files: filePaths,
        exports: allExports,
        imports: allImports,
        subModules: this.findSubModules(modulePath, modules),
        cohesion: Math.round(cohesion * 100) / 100,
        coupling: Math.round(coupling * 100) / 100,
      });
    }

    return boundaries;
  }

  /**
   * Detect architectural concepts like layers, patterns, and domain boundaries.
   */
  detectArchitecturalConcepts(): ArchitecturalConcept[] {
    const concepts: ArchitecturalConcept[] = [];
    const modules = this.detectModules();
    const files = this.storage.getAllFiles();

    // 1. Detect architectural layers
    const layers = this.detectLayers(modules, files);
    concepts.push(...layers);

    // 2. Detect design patterns
    const patterns = this.detectDesignPatterns(files);
    concepts.push(...patterns);

    // 3. Detect domain boundaries
    const domains = this.detectDomainBoundaries(modules);
    concepts.push(...domains);

    return concepts;
  }

  /**
   * Get a module boundary report as a human-readable string.
   */
  getModuleReport(): string {
    const modules = this.detectModules();
    const concepts = this.detectArchitecturalConcepts();

    let report = '## Architecture Analysis\n\n';

    // Module summary
    report += `### Module Boundaries (${modules.length} detected)\n\n`;
    for (const mod of modules.slice(0, 10)) {
      report += `#### ${mod.name}\n`;
      report += `- **Path:** ${mod.rootPath}\n`;
      report += `- **Files:** ${mod.files.length}\n`;
      report += `- **Cohesion:** ${Math.round(mod.cohesion * 100)}%\n`;
      report += `- **Coupling:** ${Math.round(mod.coupling * 100)}%\n`;
      if (mod.subModules.length > 0) {
        report += `- **Sub-modules:** ${mod.subModules.join(', ')}\n`;
      }
      report += '\n';
    }

    // Architectural concepts
    if (concepts.length > 0) {
      report += `### Architectural Concepts\n\n`;
      for (const concept of concepts) {
        report += `- **${concept.name}** (${concept.type}, ${Math.round(concept.confidence * 100)}%)\n`;
        report += `  ${concept.description}\n\n`;
      }
    }

    return report;
  }

  // ─── Module Detection Helpers ──────────────────────────────

  private groupFilesByDirectory(files: IndexedFile[]): Map<string, IndexedFile[]> {
    const groups = new Map<string, IndexedFile[]>();

    for (const file of files) {
      // Group by top-level directory + one level deep
      const parts = file.path.split('/');
      if (parts.length === 1) continue;

      const modulePath = parts.slice(0, 2).join('/');
      const existing = groups.get(modulePath) || [];
      existing.push(file);
      groups.set(modulePath, existing);

      // Also add packages/ subdirs at a deeper level
      if (parts[0] === 'packages' && parts.length >= 3) {
        const pkgPath = parts.slice(0, 3).join('/');
        const pkgExisting = groups.get(pkgPath) || [];
        if (!pkgExisting.includes(file)) {
          pkgExisting.push(file);
          groups.set(pkgPath, pkgExisting);
        }
      }
    }

    return groups;
  }

  private getModuleExports(files: IndexedFile[]): string[] {
    const exports: string[] = [];
    for (const file of files) {
      const functions = this.storage.getFunctionsByFile(file.id);
      const exportedFns = functions.filter((f) => f.isExported);
      exports.push(...exportedFns.map((f) => f.fullName));
    }
    return [...new Set(exports)];
  }

  private getModuleImports(files: IndexedFile[]): string[] {
    const fileIds = new Set(files.map((f) => f.id));
    const imports: string[] = [];
    for (const file of files) {
      const rels = this.storage.getRelationshipsForFile(file.id);
      for (const rel of rels) {
        if (rel.relationType === 'imports' && !fileIds.has(rel.targetId)) {
          imports.push(rel.targetId);
        }
      }
    }
    return [...new Set(imports)];
  }

  private calculateFileCohesion(
    files: IndexedFile[],
    fileExports: Map<string, Set<string>>,
  ): number {
    if (files.length <= 1) return 1;
    const fileIds = new Set(files.map((f) => f.id));

    // Cohesion = average Jaccard similarity of export sets across files
    let totalSimilarity = 0;
    let comparisons = 0;

    const ids = [...fileIds];
    for (let i = 0; i < ids.length; i++) {
      const exportsA = fileExports.get(ids[i]) || new Set();
      for (let j = i + 1; j < ids.length; j++) {
        const exportsB = fileExports.get(ids[j]) || new Set();
        const intersection = new Set([...exportsA].filter((x) => exportsB.has(x)));
        const union = new Set([...exportsA, ...exportsB]);
        totalSimilarity += union.size > 0 ? intersection.size / union.size : 0;
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private calculateFileCoupling(
    files: IndexedFile[],
    fileExports: Map<string, Set<string>>,
  ): number {
    if (files.length === 0) return 0;
    const fileIds = new Set(files.map((f) => f.id));

    // Coupling = proportion of exports referenced by files outside the module
    let externalRefs = 0;
    let totalExports = 0;

    for (const file of files) {
      const exports = fileExports.get(file.id) || new Set();
      totalExports += exports.size;

      // Check if these exports are referenced by other modules (files not in this module)
      for (const expName of exports) {
        const searchResults = this.storage.searchFunctions(expName, 100);
        const refsOutside = searchResults.filter(
          (f) => !fileIds.has(f.fileId),
        );
        if (refsOutside.length > 0) externalRefs++;
      }
    }

    return totalExports > 0 ? Math.min(externalRefs / totalExports, 1) : 0;
  }

  private findSubModules(modulePath: string, allModules: Map<string, IndexedFile[]>): string[] {
    const subModules: string[] = [];
    const prefix = modulePath + '/';

    for (const [path, files] of allModules) {
      if (path.startsWith(prefix) && files.length > 1) {
        subModules.push(path);
      }
    }

    return subModules;
  }

  // ─── Concept Detection Helpers ─────────────────────────────

  private detectLayers(modules: ModuleBoundary[], files: IndexedFile[]): ArchitecturalConcept[] {
    const concepts: ArchitecturalConcept[] = [];

    // Detect common layer patterns
    const layerPatterns = [
      { name: 'Presentation Layer', keywords: ['component', 'view', 'page', 'ui', 'render', 'screen'] },
      { name: 'Business Logic Layer', keywords: ['service', 'usecase', 'use-case', 'domain', 'business'] },
      { name: 'Data Access Layer', keywords: ['repository', 'dao', 'database', 'store', 'persistence'] },
      { name: 'API Layer', keywords: ['api', 'route', 'handler', 'controller', 'endpoint', 'rest'] },
      { name: 'Utility Layer', keywords: ['util', 'helper', 'common', 'shared', 'lib'] },
      { name: 'Configuration Layer', keywords: ['config', 'setting', 'env', 'constant'] },
    ];

    for (const layer of layerPatterns) {
      const matchingModules = modules.filter((m) =>
        layer.keywords.some((kw) => m.rootPath.toLowerCase().includes(kw)),
      );
      const matchingFiles = files.filter((f) =>
        layer.keywords.some((kw) => f.path.toLowerCase().includes(kw)),
      );

      const confidence = Math.min(
        (matchingModules.length + matchingFiles.length / 10) / 5,
        1,
      );

      if (confidence > 0.2) {
        concepts.push({
          id: this.makeId(`layer-${layer.name}`),
          name: layer.name,
          type: 'layer',
          relatedFiles: matchingFiles.slice(0, 10).map((f) => f.path),
          description: `Detected ${matchingModules.length} modules and ${matchingFiles.length} files matching ${layer.name.toLowerCase()} patterns.`,
          confidence: Math.round(confidence * 100) / 100,
          evidence: matchingModules.slice(0, 3).map((m) => m.rootPath),
        });
      }
    }

    return concepts;
  }

  private detectDesignPatterns(files: IndexedFile[]): ArchitecturalConcept[] {
    const concepts: ArchitecturalConcept[] = [];

    // Factory pattern detection
    const factoryFiles = files.filter((f) => f.path.toLowerCase().includes('factory'));
    if (factoryFiles.length > 0) {
      concepts.push({
        id: this.makeId('pattern-factory'),
        name: 'Factory Pattern',
        type: 'pattern',
        relatedFiles: factoryFiles.slice(0, 10).map((f) => f.path),
        description: `${factoryFiles.length} files suggest Factory pattern usage.`,
        confidence: Math.min(factoryFiles.length / 3, 0.9),
        evidence: factoryFiles.slice(0, 3).map((f) => f.path),
      });
    }

    // Builder pattern detection
    const builderFiles = files.filter((f) => f.path.toLowerCase().includes('builder'));
    if (builderFiles.length > 0) {
      concepts.push({
        id: this.makeId('pattern-builder'),
        name: 'Builder Pattern',
        type: 'pattern',
        relatedFiles: builderFiles.slice(0, 10).map((f) => f.path),
        description: `${builderFiles.length} files suggest Builder pattern usage.`,
        confidence: Math.min(builderFiles.length / 3, 0.9),
        evidence: builderFiles.slice(0, 3).map((f) => f.path),
      });
    }

    // Observer/Event pattern
    const eventFiles = files.filter(
      (f) =>
        f.path.toLowerCase().includes('event') ||
        f.path.toLowerCase().includes('observer') ||
        f.path.toLowerCase().includes('listener'),
    );
    if (eventFiles.length > 0) {
      concepts.push({
        id: this.makeId('pattern-observer'),
        name: 'Observer/Event Pattern',
        type: 'pattern',
        relatedFiles: eventFiles.slice(0, 10).map((f) => f.path),
        description: `${eventFiles.length} files suggest Observer/Event-driven pattern.`,
        confidence: Math.min(eventFiles.length / 3, 0.9),
        evidence: eventFiles.slice(0, 3).map((f) => f.path),
      });
    }

    return concepts;
  }

  private detectDomainBoundaries(modules: ModuleBoundary[]): ArchitecturalConcept[] {
    const concepts: ArchitecturalConcept[] = [];
    const domainKeywords = [
      'auth', 'user', 'payment', 'order', 'product', 'inventory',
      'notification', 'billing', 'subscription', 'analytics',
      'search', 'upload', 'export', 'import', 'report',
    ];

    for (const keyword of domainKeywords) {
      const matchingModules = modules.filter(
        (m) =>
          m.rootPath.toLowerCase().includes(keyword) ||
          m.name.toLowerCase().includes(keyword),
      );

      if (matchingModules.length > 0) {
        const label = keyword.charAt(0).toUpperCase() + keyword.slice(1);
        concepts.push({
          id: this.makeId(`domain-${keyword}`),
          name: `${label} Domain`,
          type: 'domain',
          relatedFiles: matchingModules.flatMap((m) => m.files),
          description: `${matchingModules.length} modules related to ${label} functionality.`,
          confidence: Math.min(matchingModules.length / 3, 0.95),
          evidence: matchingModules.map((m) => m.rootPath),
        });
      }
    }

    return concepts;
  }

  // ─── Helpers ──────────────────────────────────────────────

  private inferModuleName(modulePath: string): string {
    const parts = modulePath.split('/');
    const lastName = parts[parts.length - 1];

    // Convert kebab-case/dashed directory names to readable names
    return lastName
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private makeId(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  }
}
