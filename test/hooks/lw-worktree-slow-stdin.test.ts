import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LW, isolatedEnv, makeRepo } from './helpers.js';

/** Run `worktree` and write the goal to stdin in delayed chunks, as a slow pipe writer would. */
function createWithChunks(cwd: string, title: string, chunks: string[], delayMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('node', [LW, 'worktree', title], { cwd, env: isolatedEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    (async () => {
      for (const chunk of chunks) {
        await new Promise((r) => setTimeout(r, delayMs));
        child.stdin.write(chunk);
      }
      child.stdin.end();
    })();
  });
}

function goalOf(stdout: string) {
  const wt = realpathSync.native(JSON.parse(stdout).worktree as string);
  const dir = join(wt, '.loopwright/tasks');
  const [name] = readdirSync(dir);
  return readFileSync(join(dir, name), 'utf8');
}

describe('worktree: goal piped through stdin by a slow writer', () => {
  it('keeps a goal written after the command has started', async () => {
    const r = await createWithChunks(makeRepo(), 'slow goal', ['Add a cache to the parser.\n'], 800);
    expect(r.code, r.stderr).toBe(0);
    expect(goalOf(r.stdout)).toMatch(/^## Goal\s*\nAdd a cache to the parser\.\s*\n/m);
  });

  it('keeps a goal written in two parts with a pause between them', async () => {
    const r = await createWithChunks(makeRepo(), 'split goal', ['part one ', 'part two\n'], 600);
    expect(r.code, r.stderr).toBe(0);
    expect(goalOf(r.stdout)).toMatch(/^## Goal\s*\npart one part two\s*\n/m);
  });
});
