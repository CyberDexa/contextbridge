import { describe, it, expect } from 'vitest';
import { PythonParser, GoParser, RustParser } from '../multi-language-parser.js';

// ─── PythonParser ──────────────────────────────────────────

describe('PythonParser', () => {
  const parser = new PythonParser();

  describe('shouldParse', () => {
    it('accepts .py files', () => {
      expect(parser.shouldParse('foo.py')).toBe(true);
    });

    it('accepts .pyw files', () => {
      expect(parser.shouldParse('foo.pyw')).toBe(true);
    });

    it('rejects non-Python files', () => {
      expect(parser.shouldParse('foo.ts')).toBe(false);
      expect(parser.shouldParse('foo.js')).toBe(false);
      expect(parser.shouldParse('foo.go')).toBe(false);
    });
  });

  describe('parseFile', () => {
    it('parses an empty file', () => {
      const result = parser.parseFile('empty.py', '');
      expect(result.file.path).toBe('empty.py');
      expect(result.file.language).toBe('python');
      expect(result.functions).toHaveLength(0);
      expect(result.classes).toHaveLength(0);
    });

    it('extracts regular functions', () => {
      const code = `
def greet(name: str) -> str:
    """Greets a user."""
    return f"Hello {name}"

def helper():
    return 42
`;
      const result = parser.parseFile('app.py', code);

      expect(result.functions).toHaveLength(2);
      const greet = result.functions.find((f) => f.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet!.signature).toContain('name: str');
    });

    it('extracts async functions', () => {
      const code = `
async def fetch_data(url: str) -> dict:
    return {"data": url}
`;
      const result = parser.parseFile('async_app.py', code);

      const fetchFn = result.functions.find((f) => f.name === 'fetch_data');
      expect(fetchFn).toBeDefined();
      expect(fetchFn!.isAsync).toBe(true);
    });

    it('extracts classes with base classes', () => {
      const code = `
class Animal:
    def speak(self):
        pass

class Dog(Animal):
    def bark(self):
        return "woof"
`;
      const result = parser.parseFile('animals.py', code);

      expect(result.classes).toHaveLength(2);
      const dog = result.classes.find((c) => c.name === 'Dog');
      expect(dog).toBeDefined();
      expect(dog!.extendsId).toBe('animals.py:Animal');
    });

    it('extracts docstrings from functions', () => {
      const code = 'def process(data: list) -> dict:\n    """Process input data."""\n    return {"result": data}\n';
      const result = parser.parseFile('process.py', code);

      const proc = result.functions.find((f) => f.name === 'process');
      expect(proc).toBeDefined();
      expect(proc!.docComment).toContain('Process input data');
    });

    it('detects private functions (leading underscore)', () => {
      const code = `
def _internal_helper():
    return "secret"

def public_api():
    return "public"
`;
      const result = parser.parseFile('visibility.py', code);

      const internal = result.functions.find((f) => f.name === '_internal_helper');
      const publicFn = result.functions.find((f) => f.name === 'public_api');

      expect(internal).toBeDefined();
      expect(internal!.isExported).toBe(false);
      expect(publicFn).toBeDefined();
      expect(publicFn!.isExported).toBe(true);
    });

    it('estimates cyclomatic complexity', () => {
      const code = 'def complex_fn(x, y):\n    if x > 0:\n        if y > 0:\n            return x + y\n        elif x == 0:\n            return 0\n    for i in range(x):\n        print(i)\n    return -1\n';
      const result = parser.parseFile('complex.py', code);

      const fn = result.functions.find((f) => f.name === 'complex_fn');
      expect(fn).toBeDefined();
      expect(fn!.complexity).toBeGreaterThan(1);
    });

    it('detects test files', () => {
      const result = parser.parseFile('test_auth.py', '');
      expect(result.file.isTest).toBe(true);
    });

    it('detects test files with _test suffix', () => {
      const result = parser.parseFile('auth_test.py', '');
      expect(result.file.isTest).toBe(true);
    });
  });
});

// ─── GoParser ──────────────────────────────────────────────

describe('GoParser', () => {
  const parser = new GoParser();

  describe('shouldParse', () => {
    it('accepts .go files', () => {
      expect(parser.shouldParse('main.go')).toBe(true);
    });

    it('rejects non-Go files', () => {
      expect(parser.shouldParse('main.ts')).toBe(false);
      expect(parser.shouldParse('main.py')).toBe(false);
    });
  });

  describe('parseFile', () => {
    it('parses an empty file', () => {
      const result = parser.parseFile('empty.go', '');
      expect(result.file.path).toBe('empty.go');
      expect(result.file.language).toBe('go');
      expect(result.functions).toHaveLength(0);
      expect(result.classes).toHaveLength(0);
    });

    it('extracts exported functions', () => {
      const code = `
package main

// Greet returns a greeting message.
func Greet(name string) string {
	return "Hello " + name
}

func helper() int {
	return 42
}
`;
      const result = parser.parseFile('main.go', code);

      expect(result.functions.length).toBeGreaterThanOrEqual(1);
      const greet = result.functions.find((f) => f.name === 'Greet');
      expect(greet).toBeDefined();
      expect(greet!.isExported).toBe(true);
      expect(greet!.signature).toContain('string');
    });

    it('identifies non-exported functions', () => {
      const code = `
package main

func internalHelper() string {
	return "secret"
}
`;
      const result = parser.parseFile('internal.go', code);

      const fn = result.functions.find((f) => f.name === 'internalHelper');
      expect(fn).toBeDefined();
      expect(fn!.isExported).toBe(false);
    });

    it('extracts structs with fields', () => {
      const code = `
package models

type User struct {
	ID   int
	Name string
	Email string
}
`;
      const result = parser.parseFile('models.go', code);

      const userStruct = result.classes.find((c) => c.name === 'User');
      expect(userStruct).toBeDefined();
      expect(userStruct!.properties).toContain('ID');
      expect(userStruct!.properties).toContain('Name');
      expect(userStruct!.properties).toContain('Email');

      const userType = result.types.find((t) => t.name === 'User');
      expect(userType).toBeDefined();
    });

    it('extracts interfaces', () => {
      const code = `
package service

type Repository interface {
	FindByID(id int) (Entity, error)
	Save(entity Entity) error
}
`;
      const result = parser.parseFile('repo.go', code);

      const iface = result.types.find((t) => t.kind === 'interface');
      expect(iface).toBeDefined();
      expect(iface!.name).toBe('Repository');
    });

    it('extracts method receivers', () => {
      const code = 'package models\n\ntype User struct {\n\tName string\n}\n\nfunc (u *User) GetName() string {\n\treturn u.Name\n}\n';
      const result = parser.parseFile('user.go', code);

      const method = result.functions.find((f) => f.name === 'GetName');
      expect(method).toBeDefined();
      expect(method!.fullName).toContain('User');
      expect(method!.signature).toContain('User');
    });

    it('detects test files', () => {
      const result = parser.parseFile('auth_test.go', '');
      expect(result.file.isTest).toBe(true);
    });

    it('extracts Go comments as docstrings', () => {
      const code = `
package main

// SayHello returns a friendly greeting.
// It uses the provided name.
func SayHello(name string) string {
	return "Hello " + name
}
`;
      const result = parser.parseFile('hello.go', code);

      const fn = result.functions.find((f) => f.name === 'SayHello');
      expect(fn).toBeDefined();
      expect(fn!.docComment).toContain('friendly greeting');
    });
  });
});

// ─── RustParser ────────────────────────────────────────────

describe('RustParser', () => {
  const parser = new RustParser();

  describe('shouldParse', () => {
    it('accepts .rs files', () => {
      expect(parser.shouldParse('main.rs')).toBe(true);
    });

    it('rejects non-Rust files', () => {
      expect(parser.shouldParse('main.ts')).toBe(false);
      expect(parser.shouldParse('main.go')).toBe(false);
    });
  });

  describe('parseFile', () => {
    it('parses an empty file', () => {
      const result = parser.parseFile('empty.rs', '');
      expect(result.file.path).toBe('empty.rs');
      expect(result.file.language).toBe('rust');
      expect(result.functions).toHaveLength(0);
    });

    it('extracts public functions', () => {
      const code = `
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

fn helper() -> i32 {
    42
}
`;
      const result = parser.parseFile('lib.rs', code);

      expect(result.functions.length).toBeGreaterThanOrEqual(1);
      const greet = result.functions.find((f) => f.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet!.isExported).toBe(true);
      expect(greet!.signature).toContain('name');
    });

    it('identifies private (non-pub) functions', () => {
      const code = `
fn internal() -> String {
    "secret".to_string()
}
`;
      const result = parser.parseFile('internal.rs', code);

      const fn = result.functions.find((f) => f.name === 'internal');
      expect(fn).toBeDefined();
      expect(fn!.isExported).toBe(false);
    });

    it('extracts async functions', () => {
      const code = `
pub async fn fetch(url: &str) -> Result<String, Error> {
    Ok("data".to_string())
}
`;
      const result = parser.parseFile('async.rs', code);

      const fn = result.functions.find((f) => f.name === 'fetch');
      expect(fn).toBeDefined();
      expect(fn!.isAsync).toBe(true);
    });

    it('extracts structs with fields', () => {
      const code = 'pub struct User {\n    pub id: u64,\n    pub name: String,\n    email: String,\n}\n';
      const result = parser.parseFile('models.rs', code);

      const user = result.classes.find((c) => c.name === 'User');
      expect(user).toBeDefined();
      expect(user!.properties).toContain('id');
      expect(user!.properties).toContain('name');
      expect(user!.properties).toContain('email');
      expect(user!.isExported).toBe(true);

      const userType = result.types.find((t) => t.name === 'User' && t.kind === 'type');
      expect(userType).toBeDefined();
    });

    it('extracts enums', () => {
      const code = `
pub enum Status {
    Active,
    Inactive,
    Pending,
}
`;
      const result = parser.parseFile('status.rs', code);

      const status = result.types.find((t) => t.kind === 'enum');
      expect(status).toBeDefined();
      expect(status!.name).toBe('Status');
    });

    it('extracts traits', () => {
      const code = `
pub trait Repository {
    fn find_by_id(&self, id: u64) -> Option<Entity>;
    fn save(&self, entity: Entity) -> Result<(), Error>;
}
`;
      const result = parser.parseFile('repo.rs', code);

      const trait = result.types.find((t) => t.kind === 'interface');
      expect(trait).toBeDefined();
      expect(trait!.name).toBe('Repository');
    });

    it('detects impl methods with full name', () => {
      const code = 'pub struct Calculator;\n\nimpl Calculator {\n    pub fn add(&self, a: i32, b: i32) -> i32 {\n        a + b\n    }\n\n    fn multiply(&self, a: i32, b: i32) -> i32 {\n        a * b\n    }\n}\n';
      const result = parser.parseFile('calc.rs', code);

      const add = result.functions.find((f) => f.name === 'add');
      expect(add).toBeDefined();
      expect(add!.fullName).toContain('Calculator');
      expect(add!.isExported).toBe(true);

      const mul = result.functions.find((f) => f.name === 'multiply');
      expect(mul).toBeDefined();
      expect(mul!.fullName).toContain('Calculator');
    });

    it('extracts doc comments', () => {
      const code = [
        '/// Returns a friendly greeting for the given name.',
        '/// ',
        '/// # Examples',
        '///',
        '/// let msg = greet("World");',
        '/// assert_eq!(msg, "Hello, World!");',
        'pub fn greet(name: &str) -> String {',
        '    format!("Hello, {}!", name)',
        '}',
      ].join('\n');
      const result = parser.parseFile('greet.rs', code);

      const fn = result.functions.find((f) => f.name === 'greet');
      expect(fn).toBeDefined();
      expect(fn!.docComment).toContain('friendly greeting');
    });

    it('detects test files', () => {
      const result = parser.parseFile('auth_test.rs', '');
      expect(result.file.isTest).toBe(true);
    });

    it('extracts unsafe functions', () => {
      const code = `
pub unsafe fn raw_pointer() -> *const i32 {
    std::ptr::null()
}
`;
      const result = parser.parseFile('unsafe.rs', code);

      const fn = result.functions.find((f) => f.name === 'raw_pointer');
      expect(fn).toBeDefined();
    });
  });
});
