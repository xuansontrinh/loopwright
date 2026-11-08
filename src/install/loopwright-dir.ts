import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../core/config.js';

/** Create `.loopwright/` with a self-ignoring .gitignore, a default config (only if absent), tasks/ and state/. */
export function scaffoldLoopwrightDir(stateDir: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(join(stateDir, 'tasks'), { recursive: true });
  mkdirSync(join(stateDir, 'state'), { recursive: true });
  const ignore = join(stateDir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8');
  const cfg = join(stateDir, 'config.json');
  if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');
}
