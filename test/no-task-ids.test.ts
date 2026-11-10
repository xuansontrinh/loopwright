import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = fileURLToPath(new URL('./', import.meta.url));
const self = fileURLToPath(import.meta.url);
const ID = new RegExp('\\b(?:' + ['A', 'C'].join('') + '|[DS])\\d+\\b');
const TITLE = /\b(?:it|test|describe)(?:\.\w+)*\(\s*(['"`])(.*?)\1/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...walk(p));
    } else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function offenders(file: string): string[] {
  const hits: string[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const parts: string[] = [];
      const title = TITLE.exec(line);
      if (title) parts.push(title[2]!);
      const c = /(?:^|\s)\/\/.*$|\/\*.*$|^\s*\*.*$/.exec(line);
      if (c) parts.push(c[0]);
      for (const part of parts) {
        // fixture lines that model the task-file shape the hooks parse
        if (ID.test(part.replace(/- D\d+:/g, ''))) hits.push(`${relative(testDir, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  return hits;
}

describe('test files', () => {
  it('name no task id in a test title, describe title or comment', () => {
    const all = walk(testDir)
      .filter((f) => f !== self)
      .flatMap(offenders);
    expect(all).toEqual([]);
  });
});
