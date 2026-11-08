import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this module to the package root so it works from src/ and from the bundled dist/. */
export function contentRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'content') + '/';
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate package root for content/');
    dir = parent;
  }
}

export function listContent(subdir: string, root: string = contentRoot()): string[] {
  const base = join(root, subdir);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(base, p).split('\\').join('/'));
    }
  };
  walk(base);
  return out.sort();
}

export function readContent(rel: string, root: string = contentRoot()): string {
  return readFileSync(join(root, rel), 'utf8');
}

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^{}]*)\}\}/g, (_m, key: string) => {
    if (!Object.hasOwn(vars, key)) throw new Error(`Unknown template placeholder: {{${key}}}`);
    return vars[key]!;
  });
}
