import type { Targets } from '../core/targets.js';

export interface HookSpec {
  event: string;
  matcher?: string;
  script: string;
}

export type HookTool = 'claude' | 'codex' | 'junie';

/** Substring identifying commands managed by loopwright. */
export const MANAGED_HOOK_HINT = 'loopwright/hooks/';

export function hookSpecs(tool: HookTool): HookSpec[] {
  return [
    {
      event: 'PreToolUse',
      matcher: tool === 'claude' ? 'Edit|Write|MultiEdit' : '^apply_patch$', // junie edits also arrive as apply_patch
      script: 'guard-locked-tests.mjs',
    },
    { event: 'Stop', script: 'stop-gate.mjs' },
    { event: 'SessionStart', matcher: 'compact', script: 'reinject-context.mjs' },
  ];
}

export function hookCommand(tool: HookTool, targets: Targets, script: string): string {
  // Junie runs hooks from ~/.junie, so it needs an absolute path in repo mode too.
  if (targets.mode === 'global' || tool === 'junie') {
    return `node "${targets.lwHome}/hooks/${script}" --tool ${tool}`;
  }
  const base = tool === 'claude' ? '$CLAUDE_PROJECT_DIR' : '$(git rev-parse --show-toplevel)';
  return `node "${base}/.agents/loopwright/hooks/${script}" --tool ${tool}`;
}
