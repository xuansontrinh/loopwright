import { join } from 'node:path';
import {
  createSymlink,
  removePath,
  ensureDir,
  removeDir,
  readdirSync,
  existsSync,
  isSymlink,
  symlinkTarget,
  sameLinkTarget,
  isEmptyDir,
  dirExists,
} from '../utils/fs.js';
import { log } from '../utils/log.js';
import { choose, confirm } from '../utils/prompt.js';
import { cpSync, lstatSync, readFileSync, readlinkSync, unlinkSync } from 'node:fs';

export interface LinkClaudeOptions {
  root: string;
  dryRun: boolean;
  force: boolean;
}

export type ConflictKind =
  | 'none' // path doesn't exist
  | 'correct-symlink' // already points to .agents/skills
  | 'wrong-symlink' // symlink points elsewhere
  | 'empty-dir' // real empty directory
  | 'dir-with-content'; // real directory with files

export interface ConflictResult {
  kind: ConflictKind;
  currentTarget?: string;
  files?: string[];
}

export function detectConflict(claudeSkillsPath: string, expectedTarget: string): ConflictResult {
  if (!existsSync(claudeSkillsPath) && !isSymlink(claudeSkillsPath)) {
    return { kind: 'none' };
  }

  if (isSymlink(claudeSkillsPath)) {
    const target = symlinkTarget(claudeSkillsPath);
    if (sameLinkTarget(target, expectedTarget)) {
      return { kind: 'correct-symlink', currentTarget: target ?? undefined };
    }
    return { kind: 'wrong-symlink', currentTarget: target ?? undefined };
  }

  if (dirExists(claudeSkillsPath)) {
    if (isEmptyDir(claudeSkillsPath)) {
      return { kind: 'empty-dir' };
    }
    return {
      kind: 'dir-with-content',
      files: readdirSync(claudeSkillsPath),
    };
  }

  return { kind: 'none' };
}

const RELATIVE_TARGET = '../.agents/skills';

export type LinkAction = 'create' | 'keep' | 'repoint' | 'replace-empty' | 'merge' | 'replace' | 'skip' | 'abort';

/**
 * Pre-flight: inspect .claude/skills and resolve any prompt before anything is written.
 * Dry-run never prompts and returns the action it would take ('skip' when it would ask).
 */
export async function planLink(opts: LinkClaudeOptions): Promise<LinkAction> {
  const conflict = detectConflict(join(opts.root, '.claude', 'skills'), RELATIVE_TARGET);
  switch (conflict.kind) {
    case 'none':
      return 'create';
    case 'correct-symlink':
      return 'keep';
    case 'empty-dir':
      return 'replace-empty';
    case 'wrong-symlink': {
      if (opts.dryRun || opts.force) return 'repoint';
      log.warn(`.claude/skills currently points to ${conflict.currentTarget}`);
      return (await confirm('Re-point to .agents/skills?')) ? 'repoint' : 'skip';
    }
    case 'dir-with-content': {
      if (opts.dryRun) {
        log.dim(`  .claude/skills/ exists with files: ${conflict.files?.join(', ')}`);
        log.dim('  Would prompt for action');
        return 'skip';
      }
      log.warn(`.claude/skills/ is a directory with: ${conflict.files?.join(', ')}`);
      if (opts.force) return 'merge';
      const action = await choose('How to handle existing .claude/skills/?', [
        'merge — copy files into .agents/skills/, then symlink',
        'replace — delete .claude/skills/, create symlink',
        'skip — leave .claude/skills/ as-is',
        'abort — stop install',
      ]);
      if (action.startsWith('merge')) return 'merge';
      if (action.startsWith('replace')) return 'replace';
      if (action.startsWith('abort')) return 'abort';
      return 'skip';
    }
    default:
      return 'skip';
  }
}

export class SymlinkUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`cannot create symlinks here: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'SymlinkUnavailableError';
  }
}

/** Create and remove a throwaway link so a failure surfaces before anything is deleted. */
function probeSymlink(root: string): void {
  const probe = join(root, '.claude', `.lw-link-probe-${process.pid}`);
  try {
    createSymlink('probe-target', probe);
  } catch (e) {
    throw new SymlinkUnavailableError(e);
  }
  try {
    unlinkSync(probe);
  } catch {
    /* best effort */
  }
}

/** Carry out a planned action. Returns whether anything changed. */
export function applyLink(root: string, action: LinkAction, dryRun: boolean): boolean {
  const claudeSkillsPath = join(root, '.claude', 'skills');
  const agentsSkillsPath = join(root, '.agents', 'skills');
  if (!dryRun && ['create', 'repoint', 'replace-empty', 'merge', 'replace'].includes(action)) probeSymlink(root);
  switch (action) {
    case 'create':
      if (dryRun) {
        log.dim(`  Would create symlink .claude/skills → ${RELATIVE_TARGET}`);
        return false;
      }
      ensureDir(join(root, '.claude'));
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success(`Created symlink .claude/skills → ${RELATIVE_TARGET}`);
      return true;
    case 'keep':
      log.dim('  .claude/skills already linked correctly');
      return false;
    case 'repoint':
      if (dryRun) {
        log.dim(`  Would re-point symlink .claude/skills → ${RELATIVE_TARGET}`);
        return false;
      }
      removePath(claudeSkillsPath);
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success(`Re-pointed symlink .claude/skills → ${RELATIVE_TARGET}`);
      return true;
    case 'replace-empty':
      if (dryRun) {
        log.dim('  Would replace empty .claude/skills/ with symlink');
        return false;
      }
      removeDir(claudeSkillsPath);
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success('Replaced empty .claude/skills/ with symlink');
      return true;
    case 'merge':
    case 'replace':
      if (dryRun) return false;
      if (action === 'merge') {
        const { copied, conflicts } = mergeIntoAgents(claudeSkillsPath, agentsSkillsPath);
        if (conflicts.length > 0) {
          log.warn(`Kept .claude/skills/ (differs from .agents/skills/: ${conflicts.join(', ')}); symlink skipped`);
          return copied > 0;
        }
      }
      removeDir(claudeSkillsPath);
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success(
        action === 'merge' ? 'Merged existing skills and created symlink' : 'Replaced .claude/skills/ with symlink',
      );
      return true;
    default:
      if (action === 'skip') log.dim('  Skipped symlink');
      return false;
  }
}

/** Plan and apply in one step ('abort' changes nothing). */
export async function linkClaude(opts: LinkClaudeOptions): Promise<boolean> {
  return applyLink(opts.root, await planLink(opts), opts.dryRun);
}

function mergeIntoAgents(source: string, dest: string): { copied: number; conflicts: string[] } {
  ensureDir(dest);
  let copied = 0;
  const conflicts: string[] = [];
  for (const entry of readdirSync(source)) {
    const srcPath = join(source, entry);
    const destPath = join(dest, entry);
    if (!lstatSync(destPath, { throwIfNoEntry: false })) {
      cpSync(srcPath, destPath, { recursive: true });
      copied++;
      log.dim(`  Merged ${entry}`);
    } else if (!sameEntry(srcPath, destPath)) {
      conflicts.push(entry);
    }
  }
  return { copied, conflicts };
}

/** Structural equality without following symlinks. */
function sameEntry(a: string, b: string): boolean {
  const sa = lstatSync(a, { throwIfNoEntry: false });
  const sb = lstatSync(b, { throwIfNoEntry: false });
  if (!sa || !sb) return false;
  if (sa.isSymbolicLink() || sb.isSymbolicLink()) {
    return sa.isSymbolicLink() && sb.isSymbolicLink() && readlinkSync(a) === readlinkSync(b);
  }
  if (sa.isDirectory() && sb.isDirectory()) {
    const na = readdirSync(a).sort();
    const nb = readdirSync(b).sort();
    return na.length === nb.length && na.every((n, i) => n === nb[i] && sameEntry(join(a, n), join(b, n)));
  }
  if (sa.isFile() && sb.isFile()) return readFileSync(a).equals(readFileSync(b));
  return false;
}
