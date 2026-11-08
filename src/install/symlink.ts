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

export async function linkClaude(opts: LinkClaudeOptions): Promise<boolean> {
  const claudeSkillsPath = join(opts.root, '.claude', 'skills');
  const agentsSkillsPath = join(opts.root, '.agents', 'skills');

  const conflict = detectConflict(claudeSkillsPath, RELATIVE_TARGET);

  switch (conflict.kind) {
    case 'none': {
      if (opts.dryRun) {
        log.dim(`  Would create symlink .claude/skills → ${RELATIVE_TARGET}`);
        return false;
      }
      ensureDir(join(opts.root, '.claude'));
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success(`Created symlink .claude/skills → ${RELATIVE_TARGET}`);
      return true;
    }

    case 'correct-symlink': {
      log.dim('  .claude/skills already linked correctly');
      return false;
    }

    case 'wrong-symlink': {
      if (opts.dryRun) {
        log.dim(`  Would re-point symlink from ${conflict.currentTarget} → ${RELATIVE_TARGET}`);
        return false;
      }
      if (!opts.force) {
        log.warn(`.claude/skills currently points to ${conflict.currentTarget}`);
        const ok = await confirm('Re-point to .agents/skills?');
        if (!ok) {
          log.dim('  Skipped symlink');
          return false;
        }
      }
      removePath(claudeSkillsPath);
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success(`Re-pointed symlink .claude/skills → ${RELATIVE_TARGET}`);
      return true;
    }

    case 'empty-dir': {
      if (opts.dryRun) {
        log.dim('  Would replace empty .claude/skills/ with symlink');
        return false;
      }
      removeDir(claudeSkillsPath);
      createSymlink(RELATIVE_TARGET, claudeSkillsPath);
      log.success('Replaced empty .claude/skills/ with symlink');
      return true;
    }

    case 'dir-with-content': {
      if (opts.dryRun) {
        log.dim(`  .claude/skills/ exists with files: ${conflict.files?.join(', ')}`);
        log.dim('  Would prompt for action');
        return false;
      }

      log.warn(`.claude/skills/ is a directory with: ${conflict.files?.join(', ')}`);

      if (opts.force) {
        // Force mode: merge into .agents/skills, then replace with symlink
        mergeIntoAgents(claudeSkillsPath, agentsSkillsPath);
        removeDir(claudeSkillsPath);
        createSymlink(RELATIVE_TARGET, claudeSkillsPath);
        log.success('Merged existing skills and created symlink');
        return true;
      }

      const action = await choose('How to handle existing .claude/skills/?', [
        'merge — copy files into .agents/skills/, then symlink',
        'replace — delete .claude/skills/, create symlink',
        'skip — leave .claude/skills/ as-is',
        'abort — stop install',
      ]);

      if (action.startsWith('merge')) {
        mergeIntoAgents(claudeSkillsPath, agentsSkillsPath);
        removeDir(claudeSkillsPath);
        createSymlink(RELATIVE_TARGET, claudeSkillsPath);
        log.success('Merged existing skills and created symlink');
        return true;
      }

      if (action.startsWith('replace')) {
        removeDir(claudeSkillsPath);
        createSymlink(RELATIVE_TARGET, claudeSkillsPath);
        log.success('Replaced .claude/skills/ with symlink');
        return true;
      }

      if (action.startsWith('abort')) {
        log.error('Aborted');
        process.exit(1);
      }

      log.dim('  Skipped symlink');
      return false;
    }

    default:
      return false;
  }
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
