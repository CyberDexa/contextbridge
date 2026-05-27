import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ContextResult {
  id: string;
  summary: string;
  sections: Array<{ header: string; content: string }>;
  tokenCost: number;
  queryMetadata: {
    confidence: number;
    interpretedIntent: string;
    entitiesFound: string[];
  };
}

export interface Stats {
  fileCount: number;
  functionCount: number;
  classCount: number;
  typeCount: number;
}

export function isIndexed(repoDir: string): boolean {
  return fs.existsSync(path.join(repoDir, '.contextbridge', 'contextbridge.db'));
}

/** Resolve the command array to run cb: [exe, ...baseArgs] */
export function resolveCbCommand(cliPath?: string): string[] {
  if (cliPath) return [cliPath];

  // Try cb from PATH
  try {
    // On Windows 'cb.cmd', on POSIX 'cb' — just use 'cb' and let spawn handle it
    return ['cb'];
  } catch {
    return ['npx', '--yes', '@cyberdexa/contextbridge-cli'];
  }
}

/**
 * Run a cb command and return stdout.
 * Throws with stderr content on non-zero exit.
 */
export function runCb(
  args: string[],
  repoDir: string,
  cliPath?: string,
  onStdout?: (chunk: string) => void,
): Promise<string> {
  const [exe, ...baseArgs] = resolveCbCommand(cliPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(exe, [...baseArgs, ...args], {
      cwd: repoDir,
      env: { ...process.env },
      shell: process.platform === 'win32', // shell needed on Windows for npx/cmd wrappers
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      onStdout?.(s);
    });

    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('error', (err) => {
      // If cb not found in PATH, fall back to npx on the fly
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && exe === 'cb') {
        runCb(args, repoDir, undefined, onStdout)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `cb exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Run cb with --format structured and parse JSON result */
export async function getContext(
  query: string,
  repoDir: string,
  cliPath?: string,
): Promise<ContextResult> {
  const raw = await runCb(['context', query, '--format', 'structured'], repoDir, cliPath);
  return JSON.parse(raw) as ContextResult;
}

/** Run cb conventions --json */
export async function getConventions(repoDir: string, cliPath?: string): Promise<unknown> {
  const raw = await runCb(['conventions', '--json'], repoDir, cliPath);
  return JSON.parse(raw);
}

/** Run cb architecture --json */
export async function getArchitecture(repoDir: string, cliPath?: string): Promise<unknown> {
  const raw = await runCb(['architecture', '--json'], repoDir, cliPath);
  return JSON.parse(raw);
}
