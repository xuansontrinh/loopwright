import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createTempGitRepo, readJson, runCli } from './helpers.js';

const OLD_SKILLS = ['spec-create', 'spec-update', 'spec-complete', 'spec-handoff', 'ide-mcp'];
const CODEX_CMD = `command = 'node "$(git rev-parse --show-toplevel)/.codex/hooks/ide-mcp-context.mjs"'`;
const OLD_BLOCK = [
  '# BEGIN coding-agents-toolings ide-mcp',
  '[[hooks.UserPromptSubmit]]',
  '[[hooks.UserPromptSubmit.hooks]]',
  'type = "command"',
  CODEX_CMD,
  '[[hooks.PreToolUse]]',
  'matcher = "^Bash$"',
  '[[hooks.PreToolUse.hooks]]',
  'type = "command"',
  CODEX_CMD,
  '[[hooks.PostToolUse]]',
  'matcher = "^mcp__.*$"',
  '[[hooks.PostToolUse.hooks]]',
  'type = "command"',
  CODEX_CMD,
  '# END coding-agents-toolings ide-mcp',
  '',
].join('\n');
const CLAUDE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/ide-mcp-context.mjs"';

function put(repo: string, rel: string, content: string): void {
  const p = join(repo, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function legacyRepo(extra: { settings?: object; toml?: string } = {}): string {
  const repo = createTempGitRepo('lw-mig-');
  for (const s of OLD_SKILLS) put(repo, `.agents/skills/${s}/SKILL.md`, `# ${s}\n`);
  put(repo, '.codex/hooks/ide-mcp-context.mjs', '// old\n');
  put(repo, '.claude/hooks/ide-mcp-context.mjs', '// old\n');
  put(repo, '.codex/config.toml', `[features]\ncodex_hooks = true\n${extra.toml ?? ''}\n${OLD_BLOCK}`);
  const settings = extra.settings ?? {};
  put(
    repo,
    '.claude/settings.json',
    JSON.stringify({ ...settings, hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: CLAUDE_CMD }] }] } }, null, 2),
  );
  put(repo, 'agent-specs/keep/spec.md', 'mine\n');
  put(repo, '.gitignore', 'agent-specs/\n');
  return repo;
}

describe('legacy migration', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lw-h-'));
  });

  it('detects a full legacy install (dry-run lists, removes nothing)', () => {
    const repo = legacyRepo();
    const r = runCli(repo, ['init', '--dry-run'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    for (const s of OLD_SKILLS) expect(r.stdout).toContain(`Would ask to remove legacy: .agents/skills/${s}`);
    expect(r.stdout).toContain('Would ask to remove legacy: .codex/hooks/ide-mcp-context.mjs');
    expect(r.stdout).toContain('Would ask to remove legacy: .claude/hooks/ide-mcp-context.mjs');
    expect(r.stdout).toContain('Would ask to remove legacy: coding-agents-toolings block in .codex/config.toml');
    expect(r.stdout).toContain('Would ask to remove legacy: ide-mcp hook entries in .claude/settings.json');
    expect(r.stdout).not.toContain('agent-specs');
    expect(existsSync(join(repo, '.agents/skills/spec-create/SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, '.codex/hooks/ide-mcp-context.mjs'))).toBe(true);
  });

  it('removes legacy on confirm and keeps agent-specs/', () => {
    const repo = legacyRepo();
    const r = runCli(repo, ['init'], { home, input: 'y\n' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain('Remove these legacy coding-agents-toolings files?');
    for (const s of OLD_SKILLS) expect(existsSync(join(repo, '.agents/skills', s))).toBe(false);
    expect(existsSync(join(repo, '.codex/hooks/ide-mcp-context.mjs'))).toBe(false);
    expect(existsSync(join(repo, '.claude/hooks/ide-mcp-context.mjs'))).toBe(false);
    expect(readFileSync(join(repo, '.codex/config.toml'), 'utf8')).not.toContain('coding-agents-toolings');
    expect(JSON.stringify(readJson(join(repo, '.claude/settings.json')))).not.toContain('ide-mcp-context');
    expect(readFileSync(join(repo, 'agent-specs/keep/spec.md'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('agent-specs/');
    expect(existsSync(join(repo, '.agents/skills/loopwright-flow/SKILL.md'))).toBe(true);
  });

  it('--force removes without asking', () => {
    const repo = legacyRepo();
    expect(runCli(repo, ['init', '--force'], { home }).exitCode).toBe(0);
    expect(existsSync(join(repo, '.agents/skills/spec-create'))).toBe(false);
  });

  it('keeps legacy on decline and still installs', () => {
    const repo = legacyRepo();
    const r = runCli(repo, ['init'], { home, input: 'n\nn\nn\nn\n' });
    expect(r.exitCode, r.stderr).toBe(0);
    for (const s of OLD_SKILLS) expect(existsSync(join(repo, '.agents/skills', s, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(repo, '.codex/config.toml'), 'utf8')).toContain('coding-agents-toolings');
    expect(existsSync(join(repo, '.agents/skills/loopwright-flow/SKILL.md'))).toBe(true);
  });

  it('flags legacy dirs containing extra files', () => {
    const repo = legacyRepo();
    put(repo, '.agents/skills/ide-mcp/notes.md', 'x\n');
    const r = runCli(repo, ['init', '--dry-run'], { home });
    expect(r.stdout).toContain('.agents/skills/ide-mcp (contains extra files)');
  });

  it('preserves user entries in settings.json and config.toml while removing legacy ones', () => {
    const repo = legacyRepo({ settings: { model: 'opus' }, toml: '[mcp_servers.x]\ncommand = "x"\n' });
    const sp = join(repo, '.claude/settings.json');
    const s = readJson(sp);
    s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: 'echo user' }] });
    writeFileSync(sp, JSON.stringify(s));
    const r = runCli(repo, ['init', '--force'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = readJson(sp);
    expect(out.model).toBe('opus');
    expect(out.hooks.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: 'echo user' }] }]);
    const toml = readFileSync(join(repo, '.codex/config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.x]');
    expect(toml).toContain('codex_hooks = true');
    expect(toml).not.toContain('coding-agents-toolings');
  });

  it('does not migrate on update', () => {
    const repo = createTempGitRepo('lw-mig-');
    expect(runCli(repo, ['init'], { home }).exitCode).toBe(0);
    put(repo, '.agents/skills/spec-create/SKILL.md', 'x\n');
    runCli(repo, ['update'], { home });
    expect(existsSync(join(repo, '.agents/skills/spec-create/SKILL.md'))).toBe(true);
  });
});

describe('legacy migration: still-referenced hook scripts', () => {
  const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
  it('keeps .claude hook script when a mixed user+legacy group survives', () => {
    const repo = legacyRepo();
    const sp = join(repo, '.claude/settings.json');
    const group = { hooks: [{ type: 'command', command: 'echo user' }, { type: 'command', command: CLAUDE_CMD }] };
    writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [group] } }));
    const dry = runCli(repo, ['init', '--dry-run'], { home });
    expect(dry.stdout).toContain('manual cleanup needed: .claude/settings.json still references ide-mcp-context.mjs');
    const r = runCli(repo, ['init', '--force'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readJson(sp).hooks.UserPromptSubmit).toEqual([group]);
    expect(existsSync(join(repo, '.claude/hooks/ide-mcp-context.mjs'))).toBe(true);
    expect(r.stdout).toContain('manual cleanup needed: .claude/settings.json still references ide-mcp-context.mjs');
  });

  it('keeps .codex hook script when the legacy block has no END marker', () => {
    const repo = legacyRepo();
    put(repo, '.codex/config.toml', OLD_BLOCK.replace('# END coding-agents-toolings ide-mcp\n', ''));
    const r = runCli(repo, ['init', '--force'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(existsSync(join(repo, '.codex/hooks/ide-mcp-context.mjs'))).toBe(true);
    expect(r.stdout).toContain('manual cleanup needed: .codex/config.toml still references ide-mcp-context.mjs');
  });
});
