import { join } from 'node:path';
import { createSymlink, removePath, ensureDir, removeDir, readdirSync, existsSync, isSymlink, symlinkTarget, isEmptyDir, dirExists } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { choose, confirm } from '../utils/prompt.js';
import { cpSync } from 'node:fs';

export interface LinkClaudeOptions {
  root: string;
  dryRun: boolean;
  force: boolean;
}


export type ConflictKind =
  | 'none'              // path doesn't exist
  | 'correct-symlink'   // already points to .agents/skills
  | 'wrong-symlink'     // symlink points elsewhere
  | 'empty-dir'         // real empty directory
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
    if (target === expectedTarget) {
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

/** Carry out a planned action. Returns whether anything changed. */
export function applyLink(root: string, action: LinkAction, dryRun: boolean): boolean {
  const claudeSkillsPath = join(root, '.claude', 'skills');
  const agentsSkillsPath = join(root, '.agents', 'skills');
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
      if (action === 'merge') mergeIntoAgents(claudeSkillsPath, agentsSkillsPath);
      removeDir(claudeSkillsPath);
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success(action === 'merge' ? 'Merged existing skills and created symlink' : 'Replaced .claude/skills/ with symlink');
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

function mergeIntoAgents(source: string, dest: string): void {
  ensureDir(dest);
  for (const entry of readdirSync(source)) {
    const srcPath = join(source, entry);
    const destPath = join(dest, entry);
    if (!existsSync(destPath)) {
      cpSync(srcPath, destPath, { recursive: true });
      log.dim(`  Merged ${entry}`);
    } else {
      log.dim(`  Skipped ${entry} (already exists in .agents/skills/)`);
    }
  }
}
