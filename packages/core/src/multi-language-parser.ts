import crypto from 'node:crypto';
import type { IndexedFile, IndexedFunction, IndexedClass, IndexedType, ParseResult } from './types.js';

/**
 * Regex-based parser for Python source code.
 * Extracts functions, classes, and imports.
 */
export class PythonParser {
  readonly language = 'python' as const;
  readonly extensions = ['.py', '.pyw'];

  shouldParse(filePath: string): boolean {
    return this.extensions.some((ext) => filePath.endsWith(ext));
  }

  parseFile(filePath: string, content: string): ParseResult {
    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];

    const lines = content.split('\n');

    // Extract functions: def function_name(params):
    const funcRegex = /^\s*def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+(?:\[[^\]]*\])?))?\s*:/gm;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1];
      const params = match[2] || '';
      const returnType = match[3] || 'None';
      const startLine = this.getLineNumber(content, match.index) + 1;

      // Estimate end line (find next dedent or def/class at same level)
      const endLine = this.findBlockEnd(lines, startLine - 1);

      // Extract docstring
      const docComment = this.extractPythonDocstring(lines, startLine - 1);

      functions.push({
        fileId: filePath,
        name,
        fullName: name,
        signature: `(${params}) -> ${returnType}`,
        docComment,
        complexity: this.estimatePythonComplexity(lines, startLine - 1, endLine),
        startLine,
        endLine: endLine + 1,
        isExported: !name.startsWith('_'),
        isAsync: content.slice(match.index, match.index + 20).includes('async'),
      });
    }

    // Extract async functions
    const asyncFuncRegex = /^\s*async\s+def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+(?:\[[^\]]*\])?))?\s*:/gm;
    while ((match = asyncFuncRegex.exec(content)) !== null) {
      const name = match[1];
      const params = match[2] || '';
      const returnType = match[3] || 'None';
      const startLine = this.getLineNumber(content, match.index) + 1;
      const endLine = this.findBlockEnd(lines, startLine - 1);
      const docComment = this.extractPythonDocstring(lines, startLine - 1);

      functions.push({
        fileId: filePath,
        name,
        fullName: name,
        signature: `(${params}) -> ${returnType}`,
        docComment,
        complexity: this.estimatePythonComplexity(lines, startLine - 1, endLine),
        startLine,
        endLine: endLine + 1,
        isExported: !name.startsWith('_'),
        isAsync: true,
      });
    }

    // Extract classes: class ClassName(BaseClass):
    const classRegex = /^\s*class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/gm;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const bases = match[2] || '';
      const baseList = bases ? bases.split(',').map((b) => b.trim()).filter(Boolean) : [];
      const startLine = this.getLineNumber(content, match.index) + 1;
      const endLine = this.findBlockEnd(lines, startLine - 1);

      // Find methods within class
      const classMethods = this.findPythonMethods(lines, startLine - 1, endLine, className);

      classes.push({
        fileId: filePath,
        name: className,
        methods: classMethods.map((m) => `${filePath}:${className}.${m}`),
        properties: [],
        extendsId: baseList[0] ? `${filePath}:${baseList[0]}` : null,
        implementsIds: baseList.slice(1).map((b) => `${filePath}:${b}`),
        isExported: !className.startsWith('_'),
      });
    }

    // Extract top-level type hints for classes used as data containers
    // (Python dataclasses, typed dicts)
    const dataclassRegex = /@dataclass\s*\n\s*class\s+(\w+)/gm;
    while ((match = dataclassRegex.exec(content)) !== null) {
      const name = match[1];
      types.push({
        fileId: filePath,
        name,
        kind: 'type',
        properties: [],
      });
    }

    const typedDictRegex = /class\s+(\w+)\s*\(\s*(?:typing\.)?TypedDict\s*\)/gm;
    while ((match = typedDictRegex.exec(content)) !== null) {
      const name = match[1];
      types.push({
        fileId: filePath,
        name,
        kind: 'type',
        properties: [],
      });
    }

    const file: Omit<IndexedFile, 'id'> = {
      path: filePath,
      language: 'python',
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      tokenCount: Math.ceil(content.length / 4),
      isTest: filePath.includes('test_') || filePath.includes('_test') || filePath.endsWith('_test.py'),
      lastIndexedAt: new Date().toISOString(),
    };

    return { file, functions, classes, types, imports: [] };
  }

  private getLineNumber(content: string, offset: number): number {
    return content.slice(0, offset).split('\n').length - 1;
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    if (startLine >= lines.length - 1) return lines.length - 1;
    const baseIndent = this.getIndent(lines[startLine]);
    let endLine = startLine;
    for (let i = startLine + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      const indent = this.getIndent(lines[i]);
      if (indent <= baseIndent && lines[i].trim()) break;
      endLine = i;
    }
    return endLine;
  }

  private getIndent(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  private extractPythonDocstring(lines: string[], startLine: number): string {
    if (startLine + 1 >= lines.length) return '';
    const nextLine = lines[startLine + 1].trim();
    if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
      const delimiter = nextLine.slice(0, 3);
      if (nextLine.slice(3).includes(delimiter)) {
        return nextLine.slice(3, -3).trim();
      }
      const docLines: string[] = [nextLine.slice(3)];
      for (let i = startLine + 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.endsWith(delimiter)) {
          docLines.push(line.slice(0, -3));
          break;
        }
        docLines.push(line);
      }
      return docLines.join('\n').trim();
    }
    return '';
  }

  private estimatePythonComplexity(lines: string[], startLine: number, endLine: number): number {
    let complexity = 1;
    // Only control flow keywords (excludes 'and'/'or' which are logical operators)
    const keywords = /\b(if|elif|for|while|except|with|assert)\b/g;
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const matches = lines[i].match(keywords);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }

  private findPythonMethods(
    lines: string[],
    classStart: number,
    classEnd: number,
    _className: string,
  ): string[] {
    const methods: string[] = [];
    const methodRegex = /^\s{4,}def\s+(\w+)\s*\(/;
    for (let i = classStart + 1; i <= classEnd && i < lines.length; i++) {
      const m = lines[i].match(methodRegex);
      if (m) methods.push(m[1]);
    }
    return methods;
  }
}

/**
 * Regex-based parser for Go source code.
 * Extracts functions, structs, interfaces, and type aliases.
 */
export class GoParser {
  readonly language = 'go' as const;
  readonly extensions = ['.go'];

  shouldParse(filePath: string): boolean {
    return this.extensions.some((ext) => filePath.endsWith(ext));
  }

  parseFile(filePath: string, content: string): ParseResult {
    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];

    const lines = content.split('\n');

    // Extract functions: func FunctionName(params) returnType {
    const funcRegex = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\(?([^)]*)\)?)?\s*\{/gm;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(content)) !== null) {
      const receiver = match[2] ? `${match[1]}.${match[2]}` : null;
      const name = match[3];
      const params = match[4] || '';
      const returnType = match[5] || '';
      const fullName = receiver ? `${receiver}.${name}` : name;
      const startLine = this.getLineNumber(content, match.index) + 1;

      functions.push({
        fileId: filePath,
        name,
        fullName,
        signature: receiver ? `(${receiver}) ${name}(${params}) ${returnType}` : `${name}(${params}) ${returnType}`,
        docComment: this.extractGoComment(lines, startLine - 1),
        complexity: this.estimateGoComplexity(lines, startLine - 1, this.findBlockEnd(lines, startLine - 1, '{', '}')),
        startLine,
        endLine: this.findBlockEnd(lines, startLine - 1, '{', '}') + 1,
        isExported: /^[A-Z]/.test(name),
        isAsync: false,
      });
    }

    // Extract structs: type StructName struct {
    const structRegex = /^type\s+(\w+)\s+struct\s*\{/gm;
    while ((match = structRegex.exec(content)) !== null) {
      const name = match[1];
      const startLine = this.getLineNumber(content, match.index) + 1;
      const endLine = this.findBlockEnd(lines, startLine - 1, '{', '}');

      // Extract fields
      const fields: string[] = [];
      for (let i = startLine; i <= endLine && i < lines.length; i++) {
        const fieldMatch = lines[i].match(/^\s+(\w+)\s+/);
        if (fieldMatch && !lines[i].trim().startsWith('//')) {
          fields.push(fieldMatch[1]);
        }
      }

      classes.push({
        fileId: filePath,
        name,
        methods: [], // Methods found separately via func regex
        properties: fields,
        extendsId: null,
        implementsIds: [],
        isExported: /^[A-Z]/.test(name),
      });

      types.push({
        fileId: filePath,
        name,
        kind: 'type',
        properties: fields,
      });
    }

    // Extract interfaces: type InterfaceName interface {
    const interfaceRegex = /^type\s+(\w+)\s+interface\s*\{/gm;
    while ((match = interfaceRegex.exec(content)) !== null) {
      const name = match[1];
      const startLine = this.getLineNumber(content, match.index) + 1;
      const endLine = this.findBlockEnd(lines, startLine - 1, '{', '}');

      const methods: string[] = [];
      for (let i = startLine; i <= endLine && i < lines.length; i++) {
        const methodMatch = lines[i].match(/^\s+(\w+)\s*\(/);
        if (methodMatch) methods.push(methodMatch[1]);
      }

      types.push({
        fileId: filePath,
        name,
        kind: 'interface',
        properties: methods,
      });
    }

    // Extract type aliases
    const typeAliasRegex = /^type\s+(\w+)\s+(?!struct|interface)(\w+(?:\[[^\]]*\])?(?:\s*=\s*.*)?)/gm;
    while ((match = typeAliasRegex.exec(content)) !== null) {
      types.push({
        fileId: filePath,
        name: match[1],
        kind: 'type-alias',
        properties: [],
      });
    }

    const file: Omit<IndexedFile, 'id'> = {
      path: filePath,
      language: 'go',
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      tokenCount: Math.ceil(content.length / 4),
      isTest: filePath.endsWith('_test.go'),
      lastIndexedAt: new Date().toISOString(),
    };

    return { file, functions, classes, types, imports: [] };
  }

  private getLineNumber(content: string, offset: number): number {
    return content.slice(0, offset).split('\n').length - 1;
  }

  private findBlockEnd(lines: string[], startLine: number, open: string, close: string): number {
    let depth = 0;
    let found = false;
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === open) depth++;
        if (ch === close) {
          depth--;
          if (depth === 0 && found) return i;
        }
      }
      if (depth > 0) found = true;
    }
    return lines.length - 1;
  }

  private extractGoComment(lines: string[], startLine: number): string {
    const comments: string[] = [];
    for (let i = startLine - 1; i >= 0 && i >= startLine - 5; i--) {
      const line = lines[i].trim();
      if (line.startsWith('//')) {
        comments.unshift(line.slice(2).trim());
      } else if (line === '') {
        continue;
      } else {
        break;
      }
    }
    return comments.join('\n');
  }

  private estimateGoComplexity(lines: string[], startLine: number, endLine: number): number {
    let complexity = 1;
    const keywords = /\b(if|for|switch|case|select|go|defer)\b/g;
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const matches = lines[i].match(keywords);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }
}

/**
 * Regex-based parser for Rust source code.
 * Extracts functions, structs, enums, traits, and impls.
 */
export class RustParser {
  readonly language = 'rust' as const;
  readonly extensions = ['.rs'];

  shouldParse(filePath: string): boolean {
    return this.extensions.some((ext) => filePath.endsWith(ext));
  }

  parseFile(filePath: string, content: string): ParseResult {
    const functions: Omit<IndexedFunction, 'id'>[] = [];
    const classes: Omit<IndexedClass, 'id'>[] = [];
    const types: Omit<IndexedType, 'id'>[] = [];

    const lines = content.split('\n');

    // Extract functions: fn function_name(params) -> ReturnType {
    const funcRegex = /^\s*(?:pub(?:\s*\(\s*(?:crate|super|self)\s*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<\s*[^>]*\s*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?/gm;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1];
      const params = match[2] || '';
      const returnType = (match[3] || '()').trim();
      const fullLine = content.slice(match.index, match.index + match[0].length);
      const isAsync = fullLine.includes('async fn');
      const isUnsafe = fullLine.includes('unsafe fn');
      const isPublic = fullLine.trim().startsWith('pub');
      const startLine = this.getLineNumber(content, match.index) + 1;

      const blockStart = content.indexOf('{', match.index + match[0].length);
      const endLine = blockStart !== -1
        ? this.findBlockEnd(lines, this.getLineNumber(content, blockStart), '{', '}')
        : startLine - 1;

      // Check if it's a method (inside impl block)
      const fullName = this.getRustFullName(lines, startLine - 1, name);

      functions.push({
        fileId: filePath,
        name,
        fullName,
        signature: `fn ${name}(${params}) -> ${returnType}`,
        docComment: this.extractRustDocComment(lines, startLine - 1),
        complexity: this.estimateRustComplexity(lines, startLine - 1, endLine),
        startLine,
        endLine: endLine + 1,
        isExported: isPublic,
        isAsync,
      });
    }

    // Extract structs: struct StructName {
    // The regex stops after the struct name (no braces captured).
    // We use charAt to detect what follows: '(' for tuple, '{' for regular.
    const structRegex = /^\s*(?:pub\s+)?struct\s+(\w+)\s*(?:<[^>]+>)?\s*/gm;
    while ((match = structRegex.exec(content)) !== null) {
      const name = match[1];
      const isTuple = content.charAt(match.index + match[0].length) === '(';
      const startLine = this.getLineNumber(content, match.index) + 1;
      const isPublic = content.slice(match.index, match.index + match[0].length).trim().startsWith('pub');

      let properties: string[] = [];
      let endLine = startLine - 1;

      if (isTuple) {
        // Find the tuple content after the opening paren
        const parenStart = match.index + match[0].length;
        const parenEnd = content.indexOf(')', parenStart);
        if (parenEnd !== -1) {
          const tupleContent = content.slice(parenStart + 1, parenEnd);
          properties = tupleContent.split(',').map((f) => f.trim().split(':')[0]?.trim()).filter(Boolean);
        }
      } else {
        const blockIdx = content.indexOf('{', match.index + match[0].length);
        if (blockIdx !== -1) {
          endLine = this.findBlockEnd(lines, this.getLineNumber(content, blockIdx), '{', '}');
          properties = this.extractRustFields(lines, this.getLineNumber(content, blockIdx) + 1, endLine);
        }
      }

      classes.push({
        fileId: filePath,
        name,
        methods: [],
        properties,
        extendsId: null,
        implementsIds: [],
        isExported: isPublic,
      });

      types.push({
        fileId: filePath,
        name,
        kind: 'type',
        properties,
      });
    }

    // Extract enums: enum EnumName {
    const enumRegex = /^\s*(?:pub\s+)?enum\s+(\w+)\s*(?:<[^>]+>)?\s*\{/gm;
    while ((match = enumRegex.exec(content)) !== null) {
      const name = match[1];
      const startLine = this.getLineNumber(content, match.index) + 1;
      const blockIdx = content.indexOf('{', match.index + match[0].length);
      const endLine = blockIdx !== -1
        ? this.findBlockEnd(lines, this.getLineNumber(content, blockIdx), '{', '}')
        : startLine - 1;

      const variants: string[] = [];
      for (let i = this.getLineNumber(content, blockIdx) + 1; i <= endLine && i < lines.length; i++) {
        const variantMatch = lines[i].match(/^\s+(\w+)/);
        if (variantMatch) variants.push(variantMatch[1]);
      }

      types.push({
        fileId: filePath,
        name,
        kind: 'enum',
        properties: variants,
      });
    }

    // Extract traits: trait TraitName {
    const traitRegex = /^\s*(?:pub\s+)?trait\s+(\w+)\s*(?:<[^>]+>)?\s*\{/gm;
    while ((match = traitRegex.exec(content)) !== null) {
      const name = match[1];
      const blockIdx = content.indexOf('{', match.index + match[0].length);
      const endLine = blockIdx !== -1
        ? this.findBlockEnd(lines, this.getLineNumber(content, blockIdx), '{', '}')
        : this.getLineNumber(content, match.index);

      const methodSigs: string[] = [];
      for (let i = this.getLineNumber(content, blockIdx) + 1; i <= endLine && i < lines.length; i++) {
        const sigMatch = lines[i].match(/^\s+fn\s+(\w+)/);
        if (sigMatch) methodSigs.push(sigMatch[1]);
      }

      types.push({
        fileId: filePath,
        name,
        kind: 'interface',
        properties: methodSigs,
      });
    }

    // Extract type aliases
    const typeAliasRegex = /^\s*(?:pub\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=\s*[^;]+;/gm;
    while ((match = typeAliasRegex.exec(content)) !== null) {
      types.push({
        fileId: filePath,
        name: match[1],
        kind: 'type-alias',
        properties: [],
      });
    }

    const file: Omit<IndexedFile, 'id'> = {
      path: filePath,
      language: 'rust',
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      tokenCount: Math.ceil(content.length / 4),
      isTest: filePath.includes('test') || filePath.endsWith('_test.rs'),
      lastIndexedAt: new Date().toISOString(),
    };

    return { file, functions, classes, types, imports: [] };
  }

  private getLineNumber(content: string, offset: number): number {
    return content.slice(0, offset).split('\n').length - 1;
  }

  private findBlockEnd(lines: string[], startLine: number, open: string, close: string): number {
    let depth = 0;
    let found = false;
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === open) depth++;
        if (ch === close) {
          depth--;
          if (depth === 0 && found) return i;
        }
      }
      if (depth > 0) found = true;
    }
    return lines.length - 1;
  }

  private extractRustDocComment(lines: string[], startLine: number): string {
    const comments: string[] = [];
    for (let i = startLine - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('///')) {
        comments.unshift(line.slice(3).trim());
      } else if (line.startsWith('//!')) {
        comments.unshift(line.slice(3).trim());
      } else if (line === '') {
        continue;
      } else {
        break;
      }
    }
    return comments.join('\n');
  }

  private getRustFullName(lines: string[], lineNo: number, funcName: string): string {
    // Look backwards for an impl block
    for (let i = lineNo - 1; i >= 0; i--) {
      const line = lines[i].trim();
      const implMatch = line.match(/^\s*impl\s*(?:<[^>]+>\s*)?(\w+)/);
      if (implMatch) {
        return `${implMatch[1]}::${funcName}`;
      }
      // Only stop at top-level declarations (check raw line without trimming).
      // Indented fn/struct inside impl blocks should not stop the search.
      const rawLine = lines[i];
      if (/^(?:pub\s+)?(?:fn|struct|enum|trait|mod)\s/.test(rawLine)) {
        // Check this line and the next 3 for an opening brace to confirm it's a definition start
        const hasBraceNearby = [i, i + 1, i + 2, i + 3].some(
          (j) => j < lines.length && lines[j].includes('{')
        );
        if (hasBraceNearby) break;
      }
    }
    return funcName;
  }

  private extractRustFields(lines: string[], startLine: number, endLine: number): string[] {
    const fields: string[] = [];
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
      const fieldMatch = trimmed.match(/^(?:pub\s+)?(\w+)\s*:/);
      if (fieldMatch) fields.push(fieldMatch[1]);
    }
    return fields;
  }

  private estimateRustComplexity(lines: string[], startLine: number, endLine: number): number {
    let complexity = 1;
    // Count unique control flow branches; 'if' covers both 'if' and 'else if'
    const keywords = /\b(if|for|while|loop|match|unsafe)\b/g;
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const matches = lines[i].match(keywords);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }
}
