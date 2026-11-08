import type { CommandOptions } from '../core/options.js';
import { runInstall } from './init.js';

/** Re-apply the current version, honoring the existing manifest. */
export function runUpdate(opts: CommandOptions): Promise<number> {
  return runInstall(opts, 'updated');
}
