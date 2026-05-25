import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

function cb(args: string): string {
  try {
    return execSync(`node ${CLI} ${args}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (err: any) {
    // Throw on non-zero exit so test failures aren't silently masked.
    // Include stderr/stdout in the error message for diagnostics.
    const details = (err.stderr || err.stdout || '').trim();
    throw new Error(`CLI command failed: ${args}\n${details}`);
  }
}

function cbJson(args: string): any {
  const raw = cb(`${args} --json`);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

describe('CLI Integration', () => {
  describe('cb conventions', () => {
    it('returns conventions report', () => {
      const output = cb('conventions');
      expect(output).toContain('Codebase Conventions');
    });

    it('supports --json flag', () => {
      const result = cbJson('conventions');
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('conventions');
      expect(Array.isArray(result.conventions)).toBe(true);
      expect(result).toHaveProperty('summary');
    });

    it('supports --category filtering', () => {
      const output = cb('conventions --category naming');
      expect(output).toContain('Codebase Conventions');
    });

    it('supports --verbose flag', () => {
      const output = cb('conventions --verbose');
      expect(output).toContain('Codebase Conventions');
    });

    it('conventions in JSON contain expected fields', () => {
      const result = cbJson('conventions');
      for (const c of result.conventions.slice(0, 3)) {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('name');
        expect(c).toHaveProperty('category');
        expect(c).toHaveProperty('confidence');
        expect(c).toHaveProperty('description');
        expect(c).toHaveProperty('examples');
      }
    });
  });

  describe('cb architecture', () => {
    it('returns architecture analysis', () => {
      const output = cb('architecture');
      expect(output).toContain('Architecture Analysis');
    });

    it('supports --json flag', () => {
      const result = cbJson('architecture');
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('modules');
      expect(result).toHaveProperty('concepts');
      expect(Array.isArray(result.modules)).toBe(true);
      expect(Array.isArray(result.concepts)).toBe(true);
    });

    it('supports --modules-only flag', () => {
      const output = cb('architecture --modules-only');
      expect(output).toContain('Module Boundaries');
    });

    it('supports --concepts-only flag', () => {
      const output = cb('architecture --concepts-only');
      expect(output).toContain('Architecture Analysis');
    });

    it('modules have expected fields', () => {
      const result = cbJson('architecture');
      if (result.modules.length > 0) {
        const mod = result.modules[0];
        expect(mod).toHaveProperty('name');
        expect(mod).toHaveProperty('rootPath');
        expect(mod).toHaveProperty('files');
        expect(mod).toHaveProperty('cohesion');
        expect(mod).toHaveProperty('coupling');
        expect(mod.cohesion).toBeGreaterThanOrEqual(0);
        expect(mod.cohesion).toBeLessThanOrEqual(1);
      }
    });

    it('concepts have expected fields', () => {
      const result = cbJson('architecture');
      if (result.concepts.length > 0) {
        const c = result.concepts[0];
        expect(c).toHaveProperty('name');
        expect(c).toHaveProperty('type');
        expect(c).toHaveProperty('confidence');
      }
    });
  });

  describe('cb graph', () => {
    it('returns graph summary', () => {
      const output = cb('graph');
      expect(output).toContain('Knowledge Graph');
    });

    it('supports --stats flag', () => {
      const output = cb('graph --stats');
      expect(output).toContain('Nodes');
      expect(output).toContain('Edges');
    });

    it('supports --json flag', () => {
      const result = cbJson('graph');
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('clusters');
      expect(result).toHaveProperty('summary');
    });

    it('stats contain expected breakdowns', () => {
      const output = cb('graph --stats');
      expect(output).toContain('Node Types');
      expect(output).toContain('Edge Types');
      expect(output).toContain('Avg Degree');
    });

    it('supports DOT export', () => {
      const output = cb('graph --dot');
      // DOT format starts with digraph or graph
      expect(output).toMatch(/^\s*(di)?graph/);
      expect(output).toContain('{');
      expect(output).toContain('}');
    });
  });

  describe('cb serve', () => {
    const PORT = 4629;
    let serverProcess: ChildProcess | null = null;

    // Start the server once before all serve tests
    beforeAll(async () => {
      return new Promise<void>((resolve, reject) => {
        serverProcess = spawn('node', [CLI, 'serve', '--port', String(PORT)], {
          cwd: PROJECT_ROOT,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Monitor the process for crashes
        serverProcess.on('error', reject);
        serverProcess.on('exit', (code) => {
          if (code !== null && code !== 0 && serverProcess) {
            const stderr = (serverProcess.stderr as any)?.read() || '';
            reject(new Error(`Server exited with code ${code}: ${stderr}`));
          }
        });

        // Poll until the server is ready
        const maxAttempts = 30;
        let attempts = 0;
        const check = () => {
          attempts++;
          http.get(`http://localhost:${PORT}/api/health`, (res) => {
            if (res.statusCode === 200) {
              resolve();
            } else if (attempts < maxAttempts) {
              setTimeout(check, 200);
            } else {
              reject(new Error('Server did not become healthy'));
            }
          }).on('error', () => {
            if (attempts < maxAttempts) {
              setTimeout(check, 200);
            } else {
              reject(new Error('Server did not start'));
            }
          });
        };
        check();
      });
    }, 15_000);

    afterAll(async () => {
      if (serverProcess) {
        serverProcess.kill('SIGTERM');
        // Wait for the process to fully exit so the port is released
        await new Promise<void>((resolve) => {
          serverProcess!.on('close', () => resolve());
          // Force resolve after 3s if the process hangs
          setTimeout(resolve, 3000);
        });
      }
    });

    it('starts a server that responds to health checks', async () => {
      const result = await fetchJson(`http://localhost:${PORT}/api/health`);
      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('repo');
    }, 10_000);

    it('serves /api/graph with correct structure', async () => {
      const result = await fetchJson(`http://localhost:${PORT}/api/graph`);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('clusters');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalNodes');
      expect(result.summary).toHaveProperty('totalEdges');
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
    }, 10_000);

    it('serves /api/stats', async () => {
      const result = await fetchJson(`http://localhost:${PORT}/api/stats`);
      expect(result).toHaveProperty('fileCount');
      expect(result).toHaveProperty('functionCount');
      expect(result).toHaveProperty('graph');
    }, 10_000);

    it('serves /api/architecture', async () => {
      const result = await fetchJson(`http://localhost:${PORT}/api/architecture`);
      expect(result).toHaveProperty('modules');
      expect(result).toHaveProperty('concepts');
    }, 10_000);

    it('serves /api/conventions', async () => {
      const result = await fetchJson(`http://localhost:${PORT}/api/conventions`);
      expect(result).toHaveProperty('conventions');
      expect(result).toHaveProperty('summary');
    }, 10_000);

    it('serves the dashboard HTML at /', async () => {
      const result = await fetchText(`http://localhost:${PORT}/`);
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('ContextBridge');
    }, 10_000);

    it('returns HTML for unknown routes', async () => {
      const result = await fetchText(`http://localhost:${PORT}/unknown-page`);
      expect(result).toContain('<!DOCTYPE html>');
    }, 10_000);
  });
});

// ─── Helpers ────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
