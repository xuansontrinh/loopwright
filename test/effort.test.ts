import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, readConfig } from '../src/core/config.js';
import { parseAgentSource, renderClaudeAgent } from '../src/generate/agents.js';
import { createTempGitRepo, runCli } from './helpers.js';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const reviewer = () => parseAgentSource('reviewer', read('../content/agents/reviewer.md'));
const cfg = (obj: unknown) => {
  const p = join(mkdtempSync(join(tmpdir(), 'lw-eff-')), 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
};
const frontmatter = (s: string) => /^---\n([\s\S]*?)\n---/.exec(s)![1]!;

describe('AC1: renderClaudeAgent effort', () => {
  it('AC1: emits effort in frontmatter when set', () => {
    const out = renderClaudeAgent(reviewer(), 'opus', 'high');
    expect(frontmatter(out)).toMatch(/^effort: high$/m);
  });
  it('AC1: omits effort when empty or missing', () => {
    expect(renderClaudeAgent(reviewer(), 'opus', '')).not.toContain('effort:');
    expect(renderClaudeAgent(reviewer(), 'opus')).not.toContain('effort:');
  });
});

describe('AC2: defaults', () => {
  it('AC2: DEFAULT_CONFIG claude effort and cross-agent reviewer effort', () => {
    const m = DEFAULT_CONFIG.models as any;
    expect(m.claude.effort).toEqual({ scout: 'medium', tester: 'medium', implementer: 'medium', reviewer: 'high' });
    expect(m.crossAgentReviewer.effort).toEqual({ claude: 'high' });
  });
  it('AC2: default-config.json equals DEFAULT_CONFIG', () => {
    expect(JSON.parse(read('../content/hooks/default-config.json'))).toEqual(DEFAULT_CONFIG);
  });
});

describe('AC3: readConfig effort validation', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max', ''])('AC3: accepts claude effort %j', (v) => {
    expect(() => readConfig(cfg({ models: { claude: { effort: { scout: v } } } }))).not.toThrow();
  });
  it.each(['minimal', 'none', 'bogus', 'inherit'])('AC3: rejects claude effort %j naming path and key', (v) => {
    const p = cfg({ models: { claude: { effort: { scout: v } } } });
    expect(() => readConfig(p)).toThrow(p);
    expect(() => readConfig(p)).toThrow(/effort/);
  });
  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', ''])('AC3: accepts junie effort %j', (v) => {
    expect(() => readConfig(cfg({ models: { junie: { effort: { tester: v } } } }))).not.toThrow();
  });
  it.each(['none', 'bogus'])('AC3: rejects junie effort %j naming path', (v) => {
    const p = cfg({ models: { junie: { effort: { tester: v } } } });
    expect(() => readConfig(p)).toThrow(p);
  });
  it('AC3: codex effort is unvalidated', () => {
    expect(() => readConfig(cfg({ models: { codex: { effort: { scout: 'whatever' } } } }))).not.toThrow();
  });
  it('AC3: rejects invalid cross-agent reviewer claude effort', () => {
    const p = cfg({ models: { crossAgentReviewer: { effort: { claude: 'bogus' } } } });
    expect(() => readConfig(p)).toThrow(p);
  });
});

describe('AC4: init/update write effort', () => {
  const agentFile = (repo: string, role: string) => readFileSync(join(repo, `.claude/agents/loopwright-${role}.md`), 'utf8');
  it('AC4: init writes default effort into Claude agents', () => {
    const repo = createTempGitRepo('lw-eff-');
    const r = runCli(repo, ['init']);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const role of ['scout', 'tester', 'implementer']) expect(frontmatter(agentFile(repo, role))).toMatch(/^effort: medium$/m);
    expect(frontmatter(agentFile(repo, 'reviewer'))).toMatch(/^effort: high$/m);
  });
  it('AC4: update honors a changed config, and empty omits effort', () => {
    const repo = createTempGitRepo('lw-eff-');
    const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    expect(runCli(repo, ['init'], { home }).exitCode).toBe(0);
    mkdirSync(join(repo, '.loopwright'), { recursive: true });
    writeFileSync(
      join(repo, '.loopwright/config.json'),
      JSON.stringify({ models: { claude: { effort: { scout: 'max', reviewer: '' } } } }),
    );
    const r = runCli(repo, ['update'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(frontmatter(agentFile(repo, 'scout'))).toMatch(/^effort: max$/m);
    expect(agentFile(repo, 'reviewer')).not.toContain('effort:');
  });
});

describe('AC5: review skill headless effort', () => {
  it('AC5: headless claude -p call passes --effort from crossAgentReviewer.effort.claude', () => {
    const s = read('../content/skills/loopwright-review/SKILL.md');
    const line = s.split('\n').find((l) => l.includes('claude -p'))!;
    expect(line).toContain('--effort');
    expect(s).toContain('crossAgentReviewer.effort.claude');
  });
});
