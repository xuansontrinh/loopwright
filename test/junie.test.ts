import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempGitRepo, readJson, runCli } from './helpers.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { parseAgentSource, renderJunieAgent } from '../src/generate/agents.js';
import { resolveTargets } from '../src/core/targets.js';
import { EXPERIMENTAL_FEATURES, parseExperimental } from '../src/core/experimental.js';
import { removeJunieHooks, upsertJunieHooks } from '../src/install/junie-config.js';
import { hookSpecs } from '../src/install/hook-wiring.js';

const ROLES = ['scout', 'tester', 'implementer', 'reviewer'];
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const reviewer = () => parseAgentSource('reviewer', read('../content/agents/reviewer.md'));
const frontmatter = (s: string) => /^---\n([\s\S]*?)\n---\n/.exec(s)![1];
const featureNames = (): string[] =>
  Array.isArray(EXPERIMENTAL_FEATURES)
    ? (EXPERIMENTAL_FEATURES as any[]).map((x) => (typeof x === 'string' ? x : x.name))
    : Object.keys(EXPERIMENTAL_FEATURES);

describe('AC1: junie config defaults', () => {
  it('AC1: DEFAULT_CONFIG.models.junie has D9 defaults', () => {
    expect(DEFAULT_CONFIG.models.junie).toMatchObject({
      scout: 'opus',
      tester: 'sonnet',
      implementer: 'sonnet',
      reviewer: 'gpt',
    });
    expect((DEFAULT_CONFIG.models.junie as any).effort).toBeUndefined();
  });
  it('AC1: default-config.json deep-equals DEFAULT_CONFIG', () => {
    expect(JSON.parse(read('../content/hooks/default-config.json'))).toEqual(DEFAULT_CONFIG);
  });
});

describe('AC2: renderJunieAgent', () => {
  it('AC2: emits Junie frontmatter with model and reasoningLevel', () => {
    const out = renderJunieAgent(reviewer(), 'gpt', 'high');
    const fm = frontmatter(out);
    expect(fm).toContain('name: loopwright-reviewer');
    expect(fm).toContain('description: ');
    expect(fm).toMatch(/^model: gpt$/m);
    expect(fm).toMatch(/^reasoningLevel: high$/m);
    expect(fm).toMatch(/^tools:/m);
    expect(out).toContain('You are the loopwright reviewer');
    expect(out).not.toContain('{{');
  });
  it('AC2: tools is a YAML list of documented Junie labels matching the role source', () => {
    const fm = frontmatter(renderJunieAgent(reviewer(), 'gpt'));
    const documented = ['Read', 'Bash', 'Glob', 'Grep', 'Write', 'Edit', 'WebSearch', 'AskUserQuestion'];
    const inline = /^tools:[ \t]*(.*)$/m.exec(fm)!;
    let items: string[];
    if (inline[1].trim() === '') {
      const block = /^tools:[ \t]*\n((?:[ \t]*-[ \t]*.*(?:\n|$))+)/m.exec(fm);
      expect(block).not.toBeNull();
      items = block![1]
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim());
    } else {
      expect(inline[1].trim()).toMatch(/^\[.*\]$/);
      items = inline[1]
        .trim()
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    items = items.map((s) => s.replace(/^["']|["']$/g, ''));
    const source = /^tools:\s*(.*)$/m
      .exec(frontmatter(read('../content/agents/reviewer.md')))![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect([...items].sort()).toEqual([...source].sort());
    for (const i of items) expect(documented).toContain(i);
  });
  it('AC2: omits model on inherit and reasoningLevel when unset', () => {
    const fm = frontmatter(renderJunieAgent(reviewer(), 'inherit'));
    expect(fm).not.toContain('model:');
    expect(fm).not.toContain('reasoningLevel:');
  });
});

describe('AC3: junie targets', () => {
  it('AC3: repo and global junie agents dirs', () => {
    const repo = createTempGitRepo();
    const t: any = resolveTargets({
      mode: 'repo',
      cwd: repo,
      home: '/h',
      dryRun: false,
      force: false,
      hook: true,
      symlink: true,
    });
    expect(t.junieAgentsDir).toBe(join(t.root, '.junie/agents'));
    const g: any = resolveTargets({
      mode: 'global',
      cwd: '/',
      home: '/home/u',
      dryRun: false,
      force: false,
      hook: true,
      symlink: true,
    });
    expect(g.junieAgentsDir).toBe(join('/home/u', '.junie', 'agents'));
  });
});

describe('AC6: experimental registry and junie config block', () => {
  it('AC6: registry contains junie-hooks', () => {
    expect(featureNames()).toContain('junie-hooks');
  });
  it('AC6: parseExperimental validates, expands all, rejects unknown', () => {
    expect(parseExperimental('junie-hooks')).toEqual(['junie-hooks']);
    expect(parseExperimental('all')).toEqual(featureNames());
    expect(() => parseExperimental('nope')).toThrow(/junie-hooks/);
  });
  const cmd = (s: { script: string }) => `node "/x/loopwright/hooks/${s.script}" --tool junie`;
  it('AC6: upsert is idempotent, preserves keys, remove restores them', () => {
    const user = JSON.stringify({ model: 'x', other: { a: 1 } }, null, 2) + '\n';
    const a = upsertJunieHooks(user, hookSpecs('claude'), cmd);
    expect(upsertJunieHooks(a, hookSpecs('claude'), cmd)).toBe(a);
    const j = JSON.parse(a);
    expect(j.model).toBe('x');
    expect(j.other).toEqual({ a: 1 });
    expect(a).toContain('loopwright/hooks/guard-locked-tests.mjs');
    const back = JSON.parse(removeJunieHooks(a, 'loopwright/hooks/'));
    expect(back).toEqual({ model: 'x', other: { a: 1 } });
  });
});

const tmpHome = () => mkdtempSync(join(tmpdir(), 'lw-h-'));
function repoDir(): string {
  const dir = join(createTempGitRepo('lw-jn-'), 'my repo');
  mkdirSync(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('junie install lifecycle', () => {
  let repo: string;
  let home: string;
  const run = (args: string[], input?: string) => runCli(repo, args, { home, input });
  const agent = (r: string) => join(repo, `.junie/agents/loopwright-${r}.md`);
  beforeEach(() => {
    repo = repoDir();
    home = tmpHome();
  });

  it('AC4: init writes four junie agents from config.models.junie, idempotently', () => {
    const r = run(['init']);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const role of ROLES) expect(existsSync(agent(role)), role).toBe(true);
    const rev = readFileSync(agent('reviewer'), 'utf8');
    expect(rev).toMatch(/^model: gpt$/m);
    expect(rev).toMatch(/^reasoningLevel: high$/m);
    expect(readFileSync(agent('scout'), 'utf8')).toMatch(/^model: opus$/m);
    expect(existsSync(join(repo, '.junie/config.json'))).toBe(false);
    const before = ROLES.map((x) => readFileSync(agent(x), 'utf8'));
    expect(run(['update']).exitCode).toBe(0);
    expect(ROLES.map((x) => readFileSync(agent(x), 'utf8'))).toEqual(before);
  });

  it('AC4: update honors a changed config.models.junie', () => {
    run(['init']);
    const cp = join(repo, '.loopwright/config.json');
    const c = readJson(cp);
    c.models.junie.tester = 'gpt';
    writeFileSync(cp, JSON.stringify(c));
    expect(run(['update', '--force']).exitCode).toBe(0);
    expect(readFileSync(agent('tester'), 'utf8')).toMatch(/^model: gpt$/m);
  });

  it('AC4: global init writes ~/.junie/agents', () => {
    const r = runCli(repo, ['init', '--global'], { home, input: 'y\n' });
    expect(r.exitCode, r.stderr).toBe(0);
    for (const role of ROLES) expect(existsSync(join(home, `.junie/agents/loopwright-${role}.md`))).toBe(true);
  });

  it('AC5: uninstall removes junie agents and prunes empty dirs, keeping other .junie content', () => {
    run(['init']);
    expect(run(['uninstall']).exitCode).toBe(0);
    expect(existsSync(join(repo, '.junie'))).toBe(false);
    run(['init']);
    mkdirSync(join(repo, '.junie/other'), { recursive: true });
    writeFileSync(join(repo, '.junie/other/keep.md'), 'k');
    writeFileSync(join(repo, '.junie/agents/mine.md'), 'm');
    expect(run(['uninstall']).exitCode).toBe(0);
    for (const role of ROLES) expect(existsSync(agent(role))).toBe(false);
    expect(existsSync(join(repo, '.junie/other/keep.md'))).toBe(true);
    expect(existsSync(join(repo, '.junie/agents/mine.md'))).toBe(true);
  });

  it('AC5: uninstall keeps a user-edited junie agent', () => {
    run(['init']);
    writeFileSync(agent('scout'), 'mine\n');
    run(['uninstall'], 'n\n');
    expect(readFileSync(agent('scout'), 'utf8')).toBe('mine\n');
    expect(existsSync(agent('tester'))).toBe(false);
  });

  it('AC6: --experimental junie-hooks writes project .junie/config.json block', () => {
    const r = run(['init', '--experimental', 'junie-hooks']);
    expect(r.exitCode, r.stderr).toBe(0);
    const text = readFileSync(join(repo, '.junie/config.json'), 'utf8');
    expect(text).toContain('loopwright/hooks/guard-locked-tests.mjs');
    expect(text).toContain('--tool junie');
    JSON.parse(text);
    const again = run(['update']);
    expect(again.exitCode, again.stderr).toBe(0);
    expect(readFileSync(join(repo, '.junie/config.json'), 'utf8')).toBe(text);
  });

  it('AC6: --global --experimental junie-hooks writes ~/.junie/config.json', () => {
    const r = runCli(repo, ['init', '--global', '--experimental', 'junie-hooks'], { home, input: 'y\n' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.junie/config.json'), 'utf8')).toContain('--tool junie');
  });

  it('AC6: unknown experimental name errors listing valid ones', () => {
    const r = run(['init', '--experimental', 'bogus']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('junie-hooks');
  });

  it('AC6/AC9: all expands to explicit names stored in manifest options.experimental', () => {
    const r = run(['init', '--experimental', 'all']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readJson(join(repo, '.loopwright/manifest.json')).options.experimental).toEqual(featureNames());
  });

  it('AC9: manifest records experimental; init prints unstable warning', () => {
    const r = run(['init', '--experimental', 'junie-hooks']);
    expect(readJson(join(repo, '.loopwright/manifest.json')).options.experimental).toEqual(['junie-hooks']);
    expect(r.stdout.toLowerCase()).toContain('junie-hooks');
    expect(r.stdout.toLowerCase()).toMatch(/unstable|experimental/);
  });

  it('AC9: update keeps the list; dropping a name removes its block', () => {
    run(['init', '--experimental', 'junie-hooks']);
    run(['update']);
    expect(readFileSync(join(repo, '.junie/config.json'), 'utf8')).toContain('loopwright/hooks/');
    expect(run(['update', '--experimental', '']).exitCode).toBe(0);
    const p = join(repo, '.junie/config.json');
    const left = existsSync(p) ? readFileSync(p, 'utf8') : '';
    expect(left).not.toContain('loopwright/hooks/');
    expect(readJson(join(repo, '.loopwright/manifest.json')).options.experimental ?? []).toEqual([]);
  });

  it('AC9: uninstall removes enabled experimental blocks, keeping user keys', () => {
    mkdirSync(join(repo, '.junie'), { recursive: true });
    writeFileSync(join(repo, '.junie/config.json'), JSON.stringify({ keep: 1 }));
    run(['init', '--experimental', 'junie-hooks']);
    expect(run(['uninstall']).exitCode).toBe(0);
    expect(readJson(join(repo, '.junie/config.json'))).toEqual({ keep: 1 });
  });

  it('AC8: HELP and init summary mention Junie, --experimental and --config-location', () => {
    const help = run(['--help']).stdout;
    expect(help).toContain('Junie');
    expect(help).toContain('--experimental');
    const r = run(['init', '--experimental', 'junie-hooks']);
    expect(r.stdout).toContain('Junie');
    expect(r.stdout).toContain('--config-location');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('Junie');
    expect(readme).toContain('Experimental');
    expect(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).description).toContain(
      'Junie',
    );
  });
});
