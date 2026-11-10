import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { mergeClaudeHooks, removeClaudeHooks, SettingsParseError } from '../src/install/claude-settings.js';
import { upsertCodexBlock, removeCodexBlock, renderCodexHookBlock } from '../src/install/codex-config.js';
import { hookSpecs, hookCommand } from '../src/install/hook-wiring.js';
import { resolveTargets } from '../src/core/targets.js';

const globalT = (home: string) => resolveTargets({ mode: 'global', home } as any);
const cmdFor = (tool: 'claude' | 'codex') => {
  const t = globalT('/tmp/a b/');
  return (s: { script: string }) => hookCommand(tool, t, s.script);
};
const HINT = 'loopwright/hooks/';

describe('claude settings', () => {
  it('merges into empty settings', () => {
    const out = mergeClaudeHooks('', hookSpecs('claude'), cmdFor('claude'));
    const j = JSON.parse(out);
    expect(Object.keys(j.hooks).sort()).toEqual(['PreToolUse', 'SessionStart', 'Stop']);
    expect(j.hooks.PreToolUse[0].matcher).toBe('Edit|Write|MultiEdit');
    expect(j.hooks.Stop[0].matcher).toBeUndefined();
    expect(out.endsWith('\n')).toBe(true);
  });
  it('idempotent merge', () => {
    const a = mergeClaudeHooks('', hookSpecs('claude'), cmdFor('claude'));
    expect(mergeClaudeHooks(a, hookSpecs('claude'), cmdFor('claude'))).toBe(a);
  });
  it('preserves foreign hooks on merge and remove', () => {
    const user = {
      model: 'x',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-pre' }] }],
      },
    };
    const text = JSON.stringify(user, null, 2) + '\n';
    const merged = JSON.parse(mergeClaudeHooks(text, hookSpecs('claude'), cmdFor('claude')));
    expect(merged.hooks.Stop[0]).toEqual(user.hooks.Stop[0]);
    expect(merged.hooks.PreToolUse[0]).toEqual(user.hooks.PreToolUse[0]);
    expect(merged.hooks.Stop).toHaveLength(2);
    const removed = removeClaudeHooks(JSON.stringify(merged), HINT);
    expect(JSON.parse(removed)).toEqual(user);
  });
  it('remove drops empty events and hooks we created', () => {
    const a = mergeClaudeHooks('{"model":"x"}', hookSpecs('claude'), cmdFor('claude'));
    expect(JSON.parse(removeClaudeHooks(a, HINT))).toEqual({ model: 'x' });
  });
  it('keeps a mixed group containing a foreign hook', () => {
    const mixed = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'echo hi' },
              { type: 'command', command: 'node /x/loopwright/hooks/stop-gate.mjs' },
            ],
          },
        ],
      },
    };
    const text = JSON.stringify(mixed);
    const merged = JSON.parse(mergeClaudeHooks(text, hookSpecs('claude'), cmdFor('claude')));
    expect(merged.hooks.Stop[0]).toEqual(mixed.hooks.Stop[0]);
    expect(JSON.parse(removeClaudeHooks(text, HINT))).toEqual(mixed);
  });
  it('throws on invalid JSON without writing', () => {
    expect(() => mergeClaudeHooks('{nope', hookSpecs('claude'), cmdFor('claude'), '/r/.claude/settings.json')).toThrow(
      SettingsParseError,
    );
    expect(() => mergeClaudeHooks('{nope', hookSpecs('claude'), cmdFor('claude'), '/r/.claude/settings.json')).toThrow(
      /\/r\/\.claude\/settings\.json/,
    );
    expect(() => removeClaudeHooks('[1]', HINT)).toThrow(SettingsParseError);
  });
});

describe('codex config', () => {
  const block = () => renderCodexHookBlock(hookSpecs('codex'), cmdFor('codex'));
  it('rendered codex config parses with smol-toml', () => {
    const p: any = parse(block());
    expect(p.hooks.PreToolUse[0].matcher).toBe('^apply_patch$');
    expect(p.hooks.PreToolUse[0].hooks[0].type).toBe('command');
    expect(p.hooks.Stop[0].hooks[0].command).toContain(
      `"${join('/tmp/a b/', '.config', 'loopwright', 'hooks', 'stop-gate.mjs')}"`,
    );
    expect(p.hooks.SessionStart[0].matcher).toBe('compact');
  });
  it('parses repo-mode commands with $(...) and quotes', () => {
    const t = { mode: 'repo' } as any;
    const b = renderCodexHookBlock(hookSpecs('codex'), (s) => hookCommand('codex', t, s.script));
    const p: any = parse(b);
    expect(p.hooks.Stop[0].hooks[0].command).toBe(
      'node "$(git rev-parse --show-toplevel)/.agents/loopwright/hooks/stop-gate.mjs" --tool codex',
    );
  });
  it('falls back to escaped basic string when command has a single quote', () => {
    const b = renderCodexHookBlock([{ event: 'Stop', script: 's.mjs' }], () => `node "/it's/x" \\y`);
    expect((parse(b) as any).hooks.Stop[0].hooks[0].command).toBe(`node "/it's/x" \\y`);
  });
  it('upsert replaces previous block and preserves user comments', () => {
    const user = '# my comment\nmodel = "o3"\r\n\n[features]\n# keep me\n';
    const once = upsertCodexBlock(user, block());
    expect(once.startsWith(user)).toBe(true);
    expect(upsertCodexBlock(once, block())).toBe(once);
    const b2 = block().replace('compact', 'compact2');
    const twice = upsertCodexBlock(once, b2);
    expect(twice.match(/# BEGIN loopwright/g)).toHaveLength(1);
    expect(twice).toContain('compact2');
    expect(twice.startsWith(user)).toBe(true);
    expect(removeCodexBlock(once)).toBe(user);
  });
  it('upsert into empty text and remove back to empty', () => {
    const t = upsertCodexBlock('', block());
    expect(t.startsWith('# BEGIN loopwright')).toBe(true);
    expect(removeCodexBlock(t)).toBe('');
  });
  it('preserves text after the block', () => {
    const text = upsertCodexBlock('a = 1\n', block()) + '\n[x]\nb = 2\n';
    const out = upsertCodexBlock(text, block());
    expect(out).toBe(text);
    expect(removeCodexBlock(text)).toBe('a = 1\n\n[x]\nb = 2\n');
  });
});

describe('hook commands', () => {
  it('quotes hook commands with spaces', () => {
    const c = hookCommand('claude', globalT('/tmp/a b/'), 'stop-gate.mjs');
    expect(c).toContain(`"${join('/tmp/a b/', '.config', 'loopwright', 'hooks', 'stop-gate.mjs')}"`);
    expect(c).toMatch(/--tool claude$/);
  });
  it('repo commands', () => {
    const t = { mode: 'repo' } as any;
    expect(hookCommand('claude', t, 'x.mjs')).toBe(
      'node "$CLAUDE_PROJECT_DIR/.agents/loopwright/hooks/x.mjs" --tool claude',
    );
  });
  it('specs', () => {
    expect(hookSpecs('codex').map((s) => s.matcher)).toEqual(['^apply_patch$', undefined, 'compact']);
  });
});
