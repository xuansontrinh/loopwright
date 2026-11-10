import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempGitRepo, runCli } from './helpers.js';

const fm = (p: string) => /^---\n([\s\S]*?)\n---/.exec(readFileSync(p, 'utf8'))![1]!;
const claude = (repo: string, r: string) => fm(join(repo, `.claude/agents/loopwright-${r}.md`));
const junie = (repo: string, r: string) => fm(join(repo, `.junie/agents/loopwright-${r}.md`));
const codex = (repo: string, r: string) => readFileSync(join(repo, `.codex/agents/loopwright-${r}.toml`), 'utf8');
const manifest = (repo: string) => readFileSync(join(repo, '.loopwright/manifest.json'), 'utf8');

describe('--profile flag', () => {
  it('init --profile deep is recorded in manifest and reused by update', () => {
    const repo = createTempGitRepo();
    expect(runCli(repo, ['init', '--profile', 'deep']).exitCode).toBe(0);
    expect(manifest(repo)).toContain('deep');
    expect(claude(repo, 'scout')).toMatch(/^effort: xhigh$/m);
    expect(runCli(repo, ['update']).exitCode).toBe(0);
    expect(manifest(repo)).toContain('deep');
    expect(claude(repo, 'scout')).toMatch(/^effort: xhigh$/m);
  });
  it('update --profile overrides the recorded profile', () => {
    const repo = createTempGitRepo();
    runCli(repo, ['init', '--profile', 'deep']);
    expect(runCli(repo, ['update', '--profile', 'lean']).exitCode).toBe(0);
    expect(claude(repo, 'scout')).toMatch(/^effort: low$/m);
    expect(claude(repo, 'reviewer')).toMatch(/^effort: medium$/m);
  });
  it('invalid profile prints error and exits 1', () => {
    const repo = createTempGitRepo();
    const r = runCli(repo, ['init', '--profile', 'bogus']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/bogus/);
    expect(r.stderr).toMatch(/thorough/);
  });
});

describe('--profile never writes config.json', () => {
  it('init/update --profile leave config.json free of profile and efforts', () => {
    const repo = createTempGitRepo();
    runCli(repo, ['init']);
    const before = readFileSync(join(repo, '.loopwright/config.json'), 'utf8');
    expect(runCli(repo, ['update', '--profile', 'deep']).exitCode).toBe(0);
    expect(readFileSync(join(repo, '.loopwright/config.json'), 'utf8')).toBe(before);
    const r2 = createTempGitRepo();
    runCli(r2, ['init', '--profile', 'deep']);
    expect(readFileSync(join(r2, '.loopwright/config.json'), 'utf8')).not.toMatch(/"profile"/);
    expect(readFileSync(join(r2, '.loopwright/config.json'), 'utf8')).not.toMatch(/xhigh/);
  });
  it('old per-role effort keys in config.json (even invalid) do not change rendered efforts', () => {
    const repo = createTempGitRepo();
    runCli(repo, ['init']);
    const p = join(repo, '.loopwright/config.json');
    const c = JSON.parse(readFileSync(p, 'utf8'));
    c.models.claude.effort = { scout: 'low', tester: 'bogus' };
    c.models.junie.effort = { reviewer: 'nonsense' };
    c.models.crossAgentReviewer.effort = { claude: 'bogus' };
    writeFileSync(p, JSON.stringify(c));
    expect(runCli(repo, ['update', '--profile', 'deep']).exitCode).toBe(0);
    for (const r of ['scout', 'tester', 'implementer', 'reviewer']) expect(claude(repo, r)).toMatch(/^effort: xhigh$/m);
    expect(runCli(repo, ['update', '--profile', 'lean']).exitCode).toBe(0);
    expect(claude(repo, 'scout')).toMatch(/^effort: low$/m);
    expect(claude(repo, 'tester')).toMatch(/^effort: low$/m);
    expect(claude(repo, 'reviewer')).toMatch(/^effort: medium$/m);
  });
});

describe('rendered agents', () => {
  it('thorough renders claude frontmatter and junie reasoningLevel', () => {
    const repo = createTempGitRepo();
    expect(runCli(repo, ['init', '--profile', 'thorough', '--experimental', 'junie-hooks']).exitCode).toBe(0);
    for (const r of ['scout', 'tester', 'implementer']) {
      expect(claude(repo, r)).toMatch(/^effort: high$/m);
      expect(junie(repo, r)).toMatch(/^reasoningLevel: high$/m);
    }
    expect(claude(repo, 'reviewer')).toMatch(/^effort: xhigh$/m);
    expect(junie(repo, 'reviewer')).toMatch(/^reasoningLevel: xhigh$/m);
  });
  it.each([
    ['lean', ['low', 'low', 'low', 'medium']],
    ['balanced', ['medium', 'medium', 'medium', 'high']],
    ['thorough', ['high', 'high', 'high', 'xhigh']],
    ['deep', ['xhigh', 'xhigh', 'xhigh', 'xhigh']],
  ] as const)('profile %s renders codex model_reasoning_effort per role', (name, efforts) => {
    const repo = createTempGitRepo();
    expect(runCli(repo, ['init', '--profile', name]).exitCode).toBe(0);
    ['scout', 'tester', 'implementer', 'reviewer'].forEach((r, i) => {
      expect(codex(repo, r)).toMatch(new RegExp(`^model_reasoning_effort = "${efforts[i]}"$`, 'm'));
    });
  });
  it('codex without --profile renders balanced efforts', () => {
    const repo = createTempGitRepo();
    runCli(repo, ['init']);
    expect(codex(repo, 'scout')).toMatch(/^model_reasoning_effort = "medium"$/m);
    expect(codex(repo, 'reviewer')).toMatch(/^model_reasoning_effort = "high"$/m);
  });
  it('update --profile re-renders codex efforts', () => {
    const repo = createTempGitRepo();
    runCli(repo, ['init', '--profile', 'deep']);
    expect(runCli(repo, ['update', '--profile', 'lean']).exitCode).toBe(0);
    expect(codex(repo, 'scout')).toMatch(/^model_reasoning_effort = "low"$/m);
    expect(codex(repo, 'reviewer')).toMatch(/^model_reasoning_effort = "medium"$/m);
  });
  it('models.codex.effort in config.json (even invalid) is ignored', () => {
    const repo = createTempGitRepo();
    runCli(repo, ['init']);
    const p = join(repo, '.loopwright/config.json');
    const c = JSON.parse(readFileSync(p, 'utf8'));
    c.models.codex.effort = { scout: 'low', reviewer: 'bogus' };
    writeFileSync(p, JSON.stringify(c));
    expect(runCli(repo, ['update', '--profile', 'thorough']).exitCode).toBe(0);
    expect(codex(repo, 'scout')).toMatch(/^model_reasoning_effort = "high"$/m);
    expect(codex(repo, 'reviewer')).toMatch(/^model_reasoning_effort = "xhigh"$/m);
    expect(codex(repo, 'reviewer')).not.toMatch(/bogus/);
  });
});

describe('HELP and summary', () => {
  it('HELP documents --profile and the profile names', () => {
    const r = runCli(createTempGitRepo(), ['--help']);
    expect(r.stdout).toContain('--profile');
    for (const n of ['lean', 'balanced', 'thorough', 'deep']) expect(r.stdout).toContain(n);
  });
  it('init summary mentions the profile', () => {
    const r = runCli(createTempGitRepo(), ['init', '--profile', 'thorough']);
    expect(r.stdout.toLowerCase()).toMatch(/profile/);
    expect(r.stdout).toContain('thorough');
  });
});
