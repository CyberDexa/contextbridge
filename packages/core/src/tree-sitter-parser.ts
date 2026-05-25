import crypto from 'node:crypto';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import type { IndexedFile, IndexedFunction, IndexedClass, IndexedType, ParseResult } from './types.js';

/** Base class for tree-sitter-based language parsers. */
abstract class TreeSitterLanguageParser {
  abstract readonly language: string;
  abstract readonly extensions: string[];

  protected createParser(grammar: Parser.Language): Parser {
    const parser = new Parser();
    parser.setLanguage(grammar);
    return parser;
  }

  abstract parseFile(filePath: string, content: string): ParseResult;

  shouldParse(filePath: string): boolean {
    return this.extensions.some((ext) => filePath.endsWith(ext));
  }

  /** Recursively find all nodes of a given type. */
  protected findNodes(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const results: Parser.SyntaxNode[] = [];
    if (node.type === type) results.push(node);
    for (const child of node.namedChildren) {
      results.push(...this.findNodes(child, type));
    }
    return results;
  }

  /** Find the first child of a given field name. */
  protected getField(node: Parser.SyntaxNode, field: string): Parser.SyntaxNode | null {
    return node.childForFieldName(field) ?? null;
  }

  /** Count cyclomatic complexity by finding control-flow nodes. */
  protected estimateComplexity(node: Parser.SyntaxNode, keywords: string[]): number {
    let complexity = 1;
    for (const kw of keywords) {
      const matches = this.findNodes(node, kw);
      complexity += matches.length;
    }
    return complexity;
  }

  protected makeFile(
    filePath: string,
    content: string,
    language: string,
    isTest: boolean,
  ): Omit<IndexedFile, 'id'> {
    return {
      path: filePath,
      language,
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      tokenCount: Math.ceil(content.length / 4),
      isTest,
      lastIndexedAt: new Date().toISOString(),
    };
  }
}

/** Tree-sitter Python parser. */
export class TreeSitterPythonParser extends TreeSitterLanguageParser {
  readonly language = 'python';
  readonly extensions = ['.py', '.pyw'];

  private grammar: Parser.Language;

  constructor() {
    super();
    this.grammar = Python as unknown as Parser.Language;
  }

  parseFile(filePath: string, content: string): ParseResult {
    const parser = this.createParser(this.grammar);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];

    for (const node of root.namedChildren) {
      // Function definitions
      if (node.type === 'function_definition') {
        const nameNode = this.getField(node, 'name');
        const paramsNode = this.getField(node, 'parameters');
        const bodyNode = this.getField(node, 'body');
        const returnTypeNode = node.childForFieldName('return_type');

        const name = nameNode?.text ?? 'unknown';
        const params = paramsNode?.text ?? '';
        const returnType = returnTypeNode?.text ?? 'None';
        const isAsync = node.firstChild?.type === 'async';

        functions.push({
          fileId: filePath,
          name,
          fullName: name,
          signature: `(${params}) -> ${returnType}`,
          docComment: this.extractDocstring(bodyNode),
          complexity: this.estimateComplexity(bodyNode ?? node, [
            'if_statement', 'for_statement', 'while_statement',
            'try_statement', 'with_statement',
          ]),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: !name.startsWith('_'),
          isAsync,
        });
      }

      // Class definitions
      if (node.type === 'class_definition') {
        const nameNode = this.getField(node, 'name');
        const name = nameNode?.text ?? 'unknown';
        const bodyNode = this.getField(node, 'body');

        // Find base classes (argument_list → identifiers)
        const bases: string[] = [];
        const superclasses = this.getField(node, 'superclasses');
        if (superclasses) {
          for (const child of superclasses.namedChildren) {
            bases.push(child.text);
          }
        }

        // Find methods
        const methods: string[] = [];
        if (bodyNode) {
          for (const child of bodyNode.namedChildren) {
            if (child.type === 'function_definition') {
              const mNameNode = this.getField(child, 'name');
              if (mNameNode) methods.push(`${filePath}:${name}.${mNameNode.text}`);
            }
          }
        }

        classes.push({
          fileId: filePath,
          name,
          methods,
          properties: [],
          extendsId: bases[0] ? `${filePath}:${bases[0]}` : null,
          implementsIds: bases.slice(1).map((b) => `${filePath}:${b}`),
          isExported: !name.startsWith('_'),
        });

        // Check for dataclass / TypedDict
        const decorator = node.previousNamedSibling;
        if (decorator?.type === 'decorator') {
          const decName = decorator.text;
          if (decName.includes('dataclass') || decName.includes('TypedDict')) {
            types.push({ fileId: filePath, name, kind: 'type', properties: [] });
          }
        }
      }
    }

    return {
      file: this.makeFile(filePath, content, 'python', filePath.includes('test_') || filePath.endsWith('_test.py')),
      functions,
      classes,
      types,
    };
  }

  private extractDocstring(bodyNode: Parser.SyntaxNode | null): string {
    if (!bodyNode) return '';
    const exprStmt = bodyNode.namedChildren[0];
    if (exprStmt?.type === 'expression_statement') {
      const strNode = exprStmt.namedChildren[0];
      if (strNode?.type === 'string') {
        return strNode.text.slice(1, -1).trim(); // strip quotes
      }
    }
    return '';
  }
}

/** Tree-sitter Go parser. */
export class TreeSitterGoParser extends TreeSitterLanguageParser {
  readonly language = 'go';
  readonly extensions = ['.go'];

  private grammar: Parser.Language;

  constructor() {
    super();
    this.grammar = Go as unknown as Parser.Language;
  }

  parseFile(filePath: string, content: string): ParseResult {
    const parser = this.createParser(this.grammar);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];

    for (const node of root.namedChildren) {
      // Function declarations
      if (node.type === 'function_declaration') {
        const nameNode = this.getField(node, 'name');
        const paramsNode = this.getField(node, 'parameters');
        const resultNode = this.getField(node, 'result');
        const bodyNode = this.getField(node, 'body');

        const name = nameNode?.text ?? 'unknown';
        const params = paramsNode?.text ?? '';
        const returnType = resultNode?.text ?? '';
        const receiver = this.extractReceiver(node);
        const fullName = receiver ? `${receiver}.${name}` : name;

        functions.push({
          fileId: filePath,
          name,
          fullName,
          signature: receiver
            ? `(${receiver}) ${name}(${params}) ${returnType}`
            : `${name}(${params}) ${returnType}`,
          docComment: this.extractComment(node),
          complexity: this.estimateComplexity(bodyNode ?? node, [
            'if_statement', 'for_statement', 'switch_statement',
            'select_statement', 'go_statement', 'defer_statement',
          ]),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          isExported: /^[A-Z]/.test(name),
          isAsync: false,
        });
      }

      // Type declarations (structs, interfaces, type aliases)
      if (node.type === 'type_declaration') {
        for (const spec of node.namedChildren) {
          if (spec.type === 'type_spec') {
            const nameNode = this.getField(spec, 'name');
            const typeNode = this.getField(spec, 'type');
            const name = nameNode?.text ?? 'unknown';
            const isExported = /^[A-Z]/.test(name);

            if (!typeNode) continue;

            if (typeNode.type === 'struct_type') {
              const fields = this.extractStructFields(typeNode);
              classes.push({
                fileId: filePath,
                name,
                methods: [],
                properties: fields,
                extendsId: null,
                implementsIds: [],
                isExported,
              });
              types.push({ fileId: filePath, name, kind: 'type', properties: fields });
            } else if (typeNode.type === 'interface_type') {
              const methods = this.extractInterfaceMethods(typeNode);
              types.push({ fileId: filePath, name, kind: 'interface', properties: methods });
            } else {
              types.push({ fileId: filePath, name, kind: 'type-alias', properties: [] });
            }
          }
        }
      }
    }

    return {
      file: this.makeFile(filePath, content, 'go', filePath.endsWith('_test.go')),
      functions,
      classes,
      types,
    };
  }

  private extractReceiver(funcNode: Parser.SyntaxNode): string | null {
    const params = this.getField(funcNode, 'parameters');
    if (!params) return null;
    // In Go, a method receiver is the first parameter_declaration with the special
    // "receiver" field in tree-sitter.  If there is no receiver field, the function
    // is a plain function (not a method).
    const receiverNode = params.childForFieldName('receiver');
    if (receiverNode) {
      // The receiver node wraps the actual type; walk its named children to find
      // the type_identifier (handles both `u User` and `u *User`).
      for (const child of receiverNode.namedChildren) {
        if (child.type === 'type_identifier' || child.type === 'pointer_type') {
          return child.text;
        }
      }
      return receiverNode.text;
    }
    return null;
  }

  private extractStructFields(structNode: Parser.SyntaxNode): string[] {
    const fields: string[] = [];
    for (const child of structNode.namedChildren) {
      if (child.type === 'field_declaration') {
        for (const f of child.namedChildren) {
          if (f.type === 'field_identifier') fields.push(f.text);
        }
      }
    }
    return fields;
  }

  private extractInterfaceMethods(ifaceNode: Parser.SyntaxNode): string[] {
    const methods: string[] = [];
    for (const child of ifaceNode.namedChildren) {
      if (child.type === 'method_spec') {
        const nameNode = this.getField(child, 'name');
        if (nameNode) methods.push(nameNode.text);
      }
    }
    return methods;
  }

  private extractComment(funcNode: Parser.SyntaxNode): string {
    const prev = funcNode.previousNamedSibling;
    if (prev?.type === 'comment') return prev.text.replace(/^\/\/\s?/gm, '').trim();
    return '';
  }
}

/** Tree-sitter Rust parser. */
export class TreeSitterRustParser extends TreeSitterLanguageParser {
  readonly language = 'rust';
  readonly extensions = ['.rs'];

  private grammar: Parser.Language;

  constructor() {
    super();
    this.grammar = Rust as unknown as Parser.Language;
  }

  parseFile(filePath: string, content: string): ParseResult {
    const parser = this.createParser(this.grammar);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];

    // Track current impl block for method full names
    let currentImpl: string | null = null;

    for (const node of root.namedChildren) {
      // impl blocks
      if (node.type === 'impl_item') {
        const typeNode = node.namedChildren.find((c) =>
          c.type === 'type_identifier' || c.type === 'generic_type'
        );
        currentImpl = typeNode?.text ?? null;
        // Process children inside impl
        for (const child of node.namedChildren) {
          if (child.type === 'function_item') {
            functions.push(this.parseRustFunction(child, filePath, currentImpl));
          }
        }
        currentImpl = null;
        continue;
      }

      // Function items
      if (node.type === 'function_item') {
        functions.push(this.parseRustFunction(node, filePath, null));
      }

      // Struct items
      if (node.type === 'struct_item') {
        const nameNode = this.getField(node, 'name');
        const name = nameNode?.text ?? 'unknown';
        const isPublic = node.text.trimStart().startsWith('pub');
        const fields = this.extractRustFields(node);

        classes.push({
          fileId: filePath,
          name,
          methods: [],
          properties: fields,
          extendsId: null,
          implementsIds: [],
          isExported: isPublic,
        });
        types.push({ fileId: filePath, name, kind: 'type', properties: fields });
      }

      // Enum items
      if (node.type === 'enum_item') {
        const nameNode = this.getField(node, 'name');
        const name = nameNode?.text ?? 'unknown';
        const variants: string[] = [];
        for (const child of node.namedChildren) {
          if (child.type === 'enum_variant') {
            const vName = this.getField(child, 'name');
            if (vName) variants.push(vName.text);
          }
        }
        types.push({ fileId: filePath, name, kind: 'enum', properties: variants });
      }

      // Trait items
      if (node.type === 'trait_item') {
        const nameNode = this.getField(node, 'name');
        const name = nameNode?.text ?? 'unknown';
        const methodSigs: string[] = [];
        for (const child of node.namedChildren) {
          if (child.type === 'function_signature_item') {
            const mName = this.getField(child, 'name');
            if (mName) methodSigs.push(mName.text);
          }
        }
        types.push({ fileId: filePath, name, kind: 'interface', properties: methodSigs });
      }

      // Type aliases
      if (node.type === 'type_item') {
        const nameNode = this.getField(node, 'name');
        if (nameNode) {
          types.push({ fileId: filePath, name: nameNode.text, kind: 'type-alias', properties: [] });
        }
      }
    }

    return {
      file: this.makeFile(filePath, content, 'rust', filePath.includes('test') || filePath.endsWith('_test.rs')),
      functions,
      classes,
      types,
    };
  }

  private parseRustFunction(
    node: Parser.SyntaxNode,
    filePath: string,
    implName: string | null,
  ): Omit<IndexedFunction, 'id'> {
    const nameNode = this.getField(node, 'name');
    const name = nameNode?.text ?? 'unknown';
    const paramsNode = this.getField(node, 'parameters');
    const params = paramsNode?.text ?? '';
    const returnTypeNode = this.getField(node, 'return_type');
    const returnType = returnTypeNode?.text.replace(/^->\s*/, '').trim() ?? '()';
    const bodyNode = this.getField(node, 'body');
    const isPublic = node.text.trimStart().startsWith('pub');

    // Check modifiers
    const modifiers = node.children.filter((c) =>
      ['async', 'unsafe'].includes(c.type)
    );
    const isAsync = modifiers.some((m) => m.type === 'async');

    const fullName = implName ? `${implName}::${name}` : name;
    const docComment = this.extractRustDocComment(node);

    return {
      fileId: filePath,
      name,
      fullName,
      signature: `fn ${name}(${params}) -> ${returnType}`,
      docComment,
      complexity: this.estimateComplexity(bodyNode ?? node, [
        'if_expression', 'match_expression', 'for_expression',
        'while_expression', 'loop_expression',
      ]),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      isExported: isPublic,
      isAsync,
    };
  }

  private extractRustFields(structNode: Parser.SyntaxNode): string[] {
    const fields: string[] = [];
    const fieldDecls = this.findNodes(structNode, 'field_declaration');
    for (const fd of fieldDecls) {
      const nameNode = this.getField(fd, 'name');
      if (nameNode) fields.push(nameNode.text);
    }
    // Also handle tuple struct fields
    const tupleFields = structNode.namedChildren.filter((c) =>
      c.type === 'field_pattern' || c.type === 'type_identifier'
    );
    for (const tf of tupleFields) {
      if (!fields.includes(tf.text)) fields.push(tf.text);
    }
    return fields;
  }

  private extractRustDocComment(funcNode: Parser.SyntaxNode): string {
    const comments: string[] = [];
    let prev = funcNode.previousSibling;
    while (prev) {
      if (prev.type === 'line_comment' && prev.text.startsWith('///')) {
        comments.unshift(prev.text.replace(/^\/\/\/\s?/, ''));
        prev = prev.previousSibling;
      } else if (prev.type === 'line_comment' && prev.text.startsWith('//!')) {
        comments.unshift(prev.text.replace(/^\/\/!\s?/, ''));
        prev = prev.previousSibling;
      } else {
        break;
      }
    }
    return comments.join('\n');
  }
}
