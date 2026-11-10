import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

export function gitTopLevel(cwd: string): string {
  // Git prints forward slashes on Windows; resolve() gives the platform form.
  return resolve(git(cwd, ['rev-parse', '--show-toplevel']));
}

export function mainWorktreeRoot(cwd: string): string {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (basename(common) === '.git') return resolve(dirname(common));
  return gitTopLevel(cwd);
}
