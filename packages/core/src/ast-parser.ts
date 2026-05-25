import ts from 'typescript';
import crypto from 'node:crypto';
import {
  type IndexedFile,
  type IndexedFunction,
  type IndexedClass,
  type IndexedType,
  type ParseResult,
} from './types.js';

export class AstParser {
  /**
   * Parse a TypeScript/JavaScript file and extract code entities.
   */
  parseFile(filePath: string, content: string, language: string): ParseResult {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      this.getScriptKind(filePath),
    );

    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];
    const imports: string[] = [];

    const visit = (node: ts.Node) => {
      // ─── Import Declarations ───────────────────────
      if (ts.isImportDeclaration(node)) {
        const spec = node.moduleSpecifier;
        if (ts.isStringLiteral(spec)) {
          imports.push(spec.text);
        }
      }

      // ─── Export-from (re-exports) ──────────────────
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const spec = node.moduleSpecifier;
        if (ts.isStringLiteral(spec)) {
          imports.push(spec.text);
        }
      }
      // ─── Functions ─────────────────────────────────
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
        const name = node.name?.text || '(anonymous)';
        const fullName = this.getFullName(node);
        functions.push(this.extractFunction(node, filePath, name, fullName, content));
      }

      // ─── Arrow Functions (const foo = () => ...) ────
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)) {
        const name = ts.isIdentifier(node.name) ? node.name.text : '(anonymous)';
        functions.push(this.extractFunction(node.initializer, filePath, name, name, content));
      }

      // ─── Methods in classes ────────────────────────
      if (ts.isMethodDeclaration(node)) {
        const parent = node.parent;
        if (ts.isClassDeclaration(parent) && parent.name) {
          const className = parent.name.text;
          const name = (node.name && ts.isIdentifier(node.name)) ? node.name.text : '(anonymous)';
          const fullName = `${className}.${name}`;
          functions.push(this.extractFunction(node, filePath, name, fullName, content));
        }
      }

      // ─── Classes ───────────────────────────────────
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const methods: ts.MethodDeclaration[] = [];
        const properties: ts.PropertyDeclaration[] = [];

        node.members.forEach((member) => {
          if (ts.isMethodDeclaration(member)) methods.push(member);
          if (ts.isPropertyDeclaration(member)) properties.push(member);
        });

        const extendsClause = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
        const implementsClause = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ImplementsKeyword);

        classes.push({
          fileId: filePath,
          name: className,
          methods: methods.map((m) => `${filePath}:${className}.${(m.name && ts.isIdentifier(m.name) ? m.name.text : '(anon)')}`),
          properties: properties
            .filter((p) => p.name && ts.isIdentifier(p.name))
            .map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : '(computed)')),
          extendsId: extendsClause?.types[0]                ? `${filePath}:${extendsClause!.types[0].getText(sourceFile)}`
            : null,
          implementsIds: (implementsClause?.types || []).map((t) => `${filePath}:${t.getText(sourceFile)}`),
          isExported: this.isExported(node),
        });
      }

      // ─── Interfaces ────────────────────────────────
      if (ts.isInterfaceDeclaration(node) && node.name) {
        types.push({
          fileId: filePath,
          name: node.name.text,
          kind: 'interface',
          properties: node.members
            .filter(ts.isPropertySignature)
            .map((p) => (ts.isIdentifier(p.name) ? p.name.text : '(computed)')),
        });
      }

      // ─── Type Aliases ──────────────────────────────
      if (ts.isTypeAliasDeclaration(node) && node.name) {
        types.push({
          fileId: filePath,
          name: node.name.text,
          kind: 'type',
          properties: [],
        });
      }

      // ─── Enums ─────────────────────────────────────
      if (ts.isEnumDeclaration(node) && node.name) {
        types.push({
          fileId: filePath,
          name: node.name.text,
          kind: 'enum',
          properties: node.members.map((m) => (ts.isIdentifier(m.name) ? m.name.text : '(computed)')),
        });
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    const file: Omit<IndexedFile, 'id'> = {
      path: filePath,
      language,
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      tokenCount: this.estimateTokenCount(content),
      isTest: filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts') || filePath.endsWith('.test.tsx'),
      lastIndexedAt: new Date().toISOString(),
    };

    return { file, functions, classes, types, imports };
  }

  /**
   * Check if a file should be parsed based on its extension.
   */
  shouldParse(filePath: string): boolean {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    return extensions.some((ext) => filePath.endsWith(ext));
  }

  /**
   * Extract supported languages from this parser.
   */
  supportedLanguages(): string[] {
    return ['typescript', 'javascript'];
  }

  private extractFunction(
    node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
    filePath: string,
    name: string,
    fullName: string,
    content: string,
  ): Omit<IndexedFunction, 'id'> {
    const signature = node.parameters
      .map((p) => {
        const name = ts.isIdentifier(p.name) ? p.name.text : '(destructured)';
        const type = p.type ? p.type.getText() : 'unknown';
        return `${name}: ${type}`;
      })
      .join(', ');

    const returnType = node.type ? node.type.getText() : 'void';
    const fullSignature = `(${signature}) => ${returnType}`;

    // Extract JSDoc comment
    const docComment = this.extractJSDoc(node, content);

    // Estimate complexity (rough: count if/for/while/switch/catch)
    const complexity = this.estimateComplexity(node);

    const sf = node.getSourceFile();
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

    // Check if exported
    const isExported = this.isExported(node);

    return {
      fileId: filePath,
      name,
      fullName,
      signature: fullSignature,
      docComment,
      complexity,
      startLine,
      endLine,
      isExported,
      isAsync: node.kind === ts.SyntaxKind.ArrowFunction
        ? (node as ts.ArrowFunction).modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false
        : (node as ts.FunctionDeclaration).modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    };
  }

  private getFullName(node: ts.Node): string {
    const name = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      ? node.name?.text || '(anonymous)'
      : '(anonymous)';
    return name;
  }

  private extractJSDoc(node: ts.Node, content: string): string {
    const comments = ts.getJSDocCommentsAndTags(node);
    if (comments.length === 0) return '';
    return comments
      .map((c) => {
        if (typeof c === 'string') return c;
        return c.getText();
      })
      .join('\n')
      .replace(/\/\*\*/g, '')
      .replace(/\*\//g, '')
      .replace(/^\s*\*/gm, '')
      .trim();
  }

  private estimateComplexity(node: ts.Node): number {
    let complexity = 1; // Base complexity
    const visit = (n: ts.Node) => {
      if (
        ts.isIfStatement(n) ||
        ts.isForStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n) ||
        ts.isSwitchStatement(n) ||
        ts.isCatchClause(n) ||
        ts.isConditionalExpression(n)
      ) {
        complexity++;
      }
      n.forEachChild(visit);
    };
    node.forEachChild(visit);
    return complexity;
  }

  private isExported(node: ts.Declaration): boolean {
    const modifiers = ts.getCombinedModifierFlags(node);
    return (modifiers & ts.ModifierFlags.Export) !== 0 || (modifiers & ts.ModifierFlags.Default) !== 0;
  }

  private getScriptKind(filePath: string): ts.ScriptKind {
    if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
    if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
  }

  private estimateTokenCount(content: string): number {
    // Rough estimate: ~4 chars per token for code
    return Math.ceil(content.length / 4);
  }
}
