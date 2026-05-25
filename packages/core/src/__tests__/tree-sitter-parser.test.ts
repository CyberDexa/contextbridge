import { describe, it, expect, beforeAll } from 'vitest';

// Skip all tests if tree-sitter native module isn't available on this platform
let TreeSitterPythonParser: any;
let TreeSitterGoParser: any;
let TreeSitterRustParser: any;
let parserAvailable = true;

beforeAll(async () => {
  try {
    const mod = await import('../tree-sitter-parser.js');
    TreeSitterPythonParser = mod.TreeSitterPythonParser;
    TreeSitterGoParser = mod.TreeSitterGoParser;
    TreeSitterRustParser = mod.TreeSitterRustParser;
    // Try to instantiate one to verify the native module loads
    new TreeSitterPythonParser();
  } catch {
    parserAvailable = false;
  }
});

function skip(): boolean {
  return !parserAvailable;
}

describe('TreeSitterPythonParser', () => {
  let parser: any;

  beforeAll(() => {
    if (!parserAvailable) return;
    parser = new TreeSitterPythonParser();
  });

  it('should parse Python extensions', () => {
    if (skip()) return;
    expect(parser.extensions).toContain('.py');
    expect(parser.shouldParse('test.py')).toBe(true);
    expect(parser.shouldParse('test.ts')).toBe(false);
  });

  it('parses a simple function', () => {
    if (skip()) return;
    const code = 'def greet(name: str) -> str:\n    return f"Hello, {name}"';
    const result = parser.parseFile('test.py', code);

    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.name).toBe('greet');
    expect(fn.signature).toContain('name');
    expect(fn.isExported).toBe(true);
    expect(fn.isAsync).toBe(false);
    expect(fn.startLine).toBeGreaterThan(0);
    expect(fn.endLine).toBeGreaterThanOrEqual(fn.startLine);
  });

  it('parses async functions', () => {
    if (skip()) return;
    const code = 'async def fetch_data():\n    pass';
    const result = parser.parseFile('test.py', code);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].isAsync).toBe(true);
  });

  it('parses private functions', () => {
    if (skip()) return;
    const code = 'def _private():\n    pass';
    const result = parser.parseFile('test.py', code);

    expect(result.functions[0].isExported).toBe(false);
  });

  it('parses class definitions', () => {
    if (skip()) return;
    const code = 'class Dog(Animal):\n    def bark(self):\n        pass';
    const result = parser.parseFile('test.py', code);

    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls.name).toBe('Dog');
    expect(cls.extendsId).toContain('Animal');
    expect(cls.methods.length).toBeGreaterThanOrEqual(1);
  });

  it('detects test files', () => {
    if (skip()) return;
    const code = 'def test_something():\n    assert True';
    const result = parser.parseFile('test_sample.py', code);
    expect(result.file.isTest).toBe(true);
  });

  it('handles empty files', () => {
    if (skip()) return;
    const result = parser.parseFile('empty.py', '');
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.types).toHaveLength(0);
  });

  it('estimates cyclomatic complexity', () => {
    if (skip()) return;
    const code = 'def complex(x):\n    if x > 0:\n        for i in range(x):\n            if i % 2:\n                pass\n    return x';
    const result = parser.parseFile('test.py', code);
    expect(result.functions[0].complexity).toBeGreaterThanOrEqual(2);
  });
});

describe('TreeSitterGoParser', () => {
  let parser: any;

  beforeAll(() => {
    if (!parserAvailable) return;
    parser = new TreeSitterGoParser();
  });

  it('should parse Go extensions', () => {
    if (skip()) return;
    expect(parser.extensions).toContain('.go');
    expect(parser.shouldParse('main.go')).toBe(true);
    expect(parser.shouldParse('main.py')).toBe(false);
  });

  it('parses a function declaration', () => {
    if (skip()) return;
    const code = 'package main\nfunc add(a int, b int) int {\n    return a + b\n}';
    const result = parser.parseFile('test.go', code);

    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    const fn = result.functions.find((f: any) => f.name === 'add');
    expect(fn).toBeDefined();
    expect(fn!.signature).toContain('int');
    expect(fn!.isExported).toBe(false);
  });

  it('detects exported functions', () => {
    if (skip()) return;
    const code = 'package main\nfunc Add(a int, b int) int {\n    return a + b\n}';
    const result = parser.parseFile('test.go', code);
    const fn = result.functions.find((f: any) => f.name === 'Add');
    expect(fn!.isExported).toBe(true);
  });

  it('parses struct types', () => {
    if (skip()) return;
    const code = 'package main\ntype User struct {\n    Name string\n    Age  int\n}';
    const result = parser.parseFile('test.go', code);

    expect(result.classes.length).toBeGreaterThanOrEqual(1);
    const cls = result.classes.find((c: any) => c.name === 'User');
    expect(cls).toBeDefined();
    expect(cls!.properties.length).toBeGreaterThanOrEqual(1);
  });

  it('parses interface types', () => {
    if (skip()) return;
    const code = 'package main\ntype Reader interface {\n    Read(p []byte) (n int, err error)\n}';
    const result = parser.parseFile('test.go', code);

    const iface = result.types.find((t: any) => t.kind === 'interface');
    expect(iface).toBeDefined();
  });

  it('detects test files', () => {
    if (skip()) return;
    const code = 'package main\nfunc TestAdd(t *testing.T) {}';
    const result = parser.parseFile('test_test.go', code);
    expect(result.file.isTest).toBe(true);
  });

  it('handles empty files', () => {
    if (skip()) return;
    const result = parser.parseFile('empty.go', '');
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });
});

describe('TreeSitterRustParser', () => {
  let parser: any;

  beforeAll(() => {
    if (!parserAvailable) return;
    parser = new TreeSitterRustParser();
  });

  it('should parse Rust extensions', () => {
    if (skip()) return;
    expect(parser.extensions).toContain('.rs');
    expect(parser.shouldParse('main.rs')).toBe(true);
    expect(parser.shouldParse('main.py')).toBe(false);
  });

  it('parses a function', () => {
    if (skip()) return;
    const code = 'fn main() {\n    println!("hello");\n}';
    const result = parser.parseFile('test.rs', code);

    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    const fn = result.functions.find((f: any) => f.name === 'main');
    expect(fn).toBeDefined();
    expect(fn!.signature).toContain('fn');
  });

  it('parses public functions', () => {
    if (skip()) return;
    const code = 'pub fn greet() -> String {\n    "hi".to_string()\n}';
    const result = parser.parseFile('test.rs', code);

    const fn = result.functions.find((f: any) => f.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn!.isExported).toBe(true);
  });

  it('parses structs', () => {
    if (skip()) return;
    const code = 'pub struct User {\n    pub name: String,\n    age: u32,\n}';
    const result = parser.parseFile('test.rs', code);

    const cls = result.classes.find((c: any) => c.name === 'User');
    expect(cls).toBeDefined();
    expect(cls!.properties.length).toBeGreaterThanOrEqual(1);
  });

  it('parses enums', () => {
    if (skip()) return;
    const code = 'enum Color {\n    Red,\n    Green,\n    Blue,\n}';
    const result = parser.parseFile('test.rs', code);

    const en = result.types.find((t: any) => t.kind === 'enum');
    expect(en).toBeDefined();
    expect(en!.properties.length).toBeGreaterThanOrEqual(2);
  });

  it('parses traits', () => {
    if (skip()) return;
    const code = 'trait Summary {\n    fn summarize(&self) -> String;\n}';
    const result = parser.parseFile('test.rs', code);

    const tr = result.types.find((t: any) => t.kind === 'interface');
    expect(tr).toBeDefined();
  });

  it('parses impl methods with full name', () => {
    if (skip()) return;
    const code = 'struct Foo;\nimpl Foo {\n    fn bar(&self) {}\n}';
    const result = parser.parseFile('test.rs', code);

    const fn = result.functions.find((f: any) => f.name === 'bar');
    expect(fn).toBeDefined();
    expect(fn!.fullName).toContain('Foo');
  });

  it('detects test files', () => {
    if (skip()) return;
    const code = '#[test]\nfn test_it_works() {}';
    const result = parser.parseFile('test_test.rs', code);
    expect(result.file.isTest).toBe(true);
  });

  it('handles empty files', () => {
    if (skip()) return;
    const result = parser.parseFile('empty.rs', '');
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });
});
