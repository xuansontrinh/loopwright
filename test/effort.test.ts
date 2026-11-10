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
  it('AC2: DEFAULT_CONFIG carries no effort maps', () => {
    const m = DEFAULT_CONFIG.models as any;
    expect(m.claude.effort).toBeUndefined();
    expect(m.crossAgentReviewer.effort).toBeUndefined();
  });
  it('AC2: default-config.json equals DEFAULT_CONFIG', () => {
    expect(JSON.parse(read('../content/hooks/default-config.json'))).toEqual(DEFAULT_CONFIG);
  });
});

describe('AC3: readConfig ignores per-role effort keys', () => {
  it('AC3: invalid effort keys do not throw and are not applied', () => {
    const c = readConfig(
      cfg({
        models: {
          claude: { effort: { scout: 'bogus' } },
          junie: { effort: { tester: 'none' } },
          crossAgentReviewer: { effort: { claude: 'bogus' } },
        },
      }),
    );
    expect(c.models.claude.effort).toEqual({
      scout: 'medium',
      tester: 'medium',
      implementer: 'medium',
      reviewer: 'high',
    });
    expect(c.models.junie.effort?.tester).toBe('medium');
    expect(c.models.crossAgentReviewer.effort?.claude).toBe('high');
  });
});

describe('AC4: init/update write effort', () => {
  const agentFile = (repo: string, role: string) =>
    readFileSync(join(repo, `.claude/agents/loopwright-${role}.md`), 'utf8');
  it('AC4: init writes default effort into Claude agents', () => {
    const repo = createTempGitRepo('lw-eff-');
    const r = runCli(repo, ['init']);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const role of ['scout', 'tester', 'implementer'])
      expect(frontmatter(agentFile(repo, role))).toMatch(/^effort: medium$/m);
    expect(frontmatter(agentFile(repo, 'reviewer'))).toMatch(/^effort: high$/m);
  });
  it('AC4: update ignores effort keys in config.json', () => {
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
    expect(frontmatter(agentFile(repo, 'scout'))).toMatch(/^effort: medium$/m);
    expect(frontmatter(agentFile(repo, 'reviewer'))).toMatch(/^effort: high$/m);
  });
});

describe('AC5: review skill headless effort', () => {
  it('AC5: headless claude -p call passes --effort from lw.mjs effort reviewer', () => {
    const s = read('../content/skills/loopwright-review/SKILL.md');
    const line = s.split('\n').find((l) => l.includes('claude -p'))!;
    expect(line).toContain('--effort');
    expect(s).toContain('output of `lw.mjs effort reviewer`');
    expect(s).not.toContain('crossAgentReviewer.effort');
  });
});
