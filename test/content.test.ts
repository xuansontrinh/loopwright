import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot, listContent, renderTemplate } from '../src/core/content.js';
import { parseAgentSource } from '../src/generate/agents.js';

const ROLES = ['scout', 'tester', 'implementer', 'reviewer'];
const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const agent = (role: string) => parseAgentSource(role, read(`agents/${role}.md`));

const SKILLS = ['flow', 'plan', 'test', 'build', 'review', 'done'].map((s) => `loopwright-${s}`);
const skill = (name: string) => read(`skills/${name}/SKILL.md`);
function skillMeta(name: string): { name?: string; description?: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill(name));
  if (!m) throw new Error(`${name}: missing frontmatter`);
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name: fm.name, description: fm.description, body: m[2]! };
}

describe('content', () => {
  it('no TODO-BODY remains in agents, prompts or schemas', () => {
    for (const sub of ['agents', 'prompts', 'schemas']) {
      for (const f of listContent(sub)) expect(read(`${sub}/${f}`), `${sub}/${f}`).not.toContain('TODO-BODY');
    }
  });

  it('every agent parses with a body and a safe unquoted description', () => {
    for (const role of ROLES) {
      const a = agent(role);
      expect(a.name).toBe(`loopwright-${role}`);
      expect(a.body.length).toBeGreaterThan(200);
      expect(a.description).not.toContain(': ');
      expect(a.description).not.toMatch(/^[#'"]/);
    }
  });

  it('reviewer prompt carries the review procedure', () => {
    const p = read('prompts/reviewer.md');
    for (const s of ['Blocking', 'Undecided', 'proof', 'check-locks', "Don't report anything", 'lockedAfterBuild', 'forcedRestartAfterBuild', 'task state was force-restarted after Build began; user must confirm locked tests', 'schemas/verdict.json', '`droppedCount` is a non-negative integer']) {
      expect(p, s).toContain(s);
    }
  });

  it('reviewer agent follows the shared prompt and never edits', () => {
    const b = agent('reviewer').body;
    expect(b).toContain('{{LW_HOME}}/prompts/reviewer.md');
    expect(b).toContain('Do not modify any file');
  });

  it('scout states it is read-only', () => {
    expect(agent('scout').body).toContain('Do not modify any file');
  });

  it('implementer contains the comment rule verbatim', () => {
    expect(agent('implementer').body).toContain(
      'Comments explain why, briefly. State each rationale in exactly one place. Never restate what the code does.',
    );
  });

  it('tester references lw.mjs lock', () => {
    expect(agent('tester').body).toContain('node "{{LW_HOME}}/hooks/lw.mjs" lock');
  });

  it('tester treats an absent named module as the expected failure', () => {
    const b = agent('tester').body;
    expect(b).toContain('"Module not found" or a missing export at that path is the expected failure');
    expect(b).toContain('If the task file names no module path or interface for an AC, stop and report it under Needs.');
  });

  it('verdict schema is valid JSON with required keys', () => {
    const s = JSON.parse(read('schemas/verdict.json'));
    expect(s).not.toHaveProperty('$schema');
    expect(s.type).toBe('object');
    expect(s.required.sort()).toEqual(['blocking', 'droppedCount', 'pass', 'undecided']);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.droppedCount).toEqual({ type: 'integer' });
    const f = s.$defs.Finding;
    expect(f.required.sort()).toEqual(['confidence', 'expectation', 'impact', 'location', 'proof']);
    expect(f.additionalProperties).toBe(false);
    expect(f.properties.impact).toEqual({ type: 'string', enum: ['high'] });
    expect(f.properties.confidence.enum).toEqual(['high', 'mid', 'low']);
    expect(s.properties.blocking.items.$ref).toBe('#/$defs/Finding');
  });

  describe('skills', () => {
    it('the six skills exist and no TODO-BODY remains in content/skills', () => {
      expect(listContent('skills')).toEqual([...SKILLS].sort().map((n) => `${n}/SKILL.md`));
      for (const f of listContent('skills')) expect(read(`skills/${f}`), f).not.toContain('TODO-BODY');
    });

    it('every skill name matches folder and is spec-valid', () => {
      for (const n of SKILLS) {
        const { name } = skillMeta(n);
        expect(name).toBe(n);
        expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(name!.length).toBeLessThanOrEqual(64);
      }
    });

    it('every skill has a safe description and a real body', () => {
      for (const n of SKILLS) {
        const { description, body } = skillMeta(n);
        expect(description, n).toBeTruthy();
        expect(description!.length, n).toBeGreaterThan(40);
        expect(description, n).not.toContain(': ');
        expect(description, n).not.toMatch(/^[#'"]/);
        expect(description, n).not.toMatch(/TODO/);
        expect(body.length, n).toBeGreaterThan(500);
      }
    });

    it('no unknown placeholders', () => {
      for (const n of SKILLS) expect(() => renderTemplate(skill(n), { LW_HOME: '.agents/loopwright' }), n).not.toThrow();
    });

    it('every skill runs lw.mjs from the worktree root and tells agents to spawn subagents', () => {
      for (const n of SKILLS) {
        const b = skill(n);
        expect(b, n).toContain('node "{{LW_HOME}}/hooks/lw.mjs"');
        expect(b, n).toContain('git rev-parse --show-toplevel');
        expect(b, n).toContain('spawn the');
      }
    });

    it('dir → null inside git is not an error: lw.mjs start creates .loopwright/', () => {
      for (const n of SKILLS) {
        const setup = skill(n).split('## Setup')[1]!.split('\n## ')[0]!;
        expect(setup, n).toContain('`null` inside a git repo');
        expect(setup, n).toContain('creates `.loopwright/`');
        expect(setup, n).toContain('Not a git repo → tell the user loopwright must run inside a git repo');
        expect(setup, n).not.toMatch(/`null` → tell the user to run `npx loopwright init`/);
      }
    });

    it('subagent-dispatching skills name their role with the spawn phrase', () => {
      const roles: Record<string, string> = {
        'loopwright-plan': 'scout',
        'loopwright-test': 'tester',
        'loopwright-build': 'implementer',
        'loopwright-review': 'reviewer',
      };
      for (const [n, role] of Object.entries(roles)) {
        expect(skill(n), n).toContain(`spawn the \`loopwright-${role}\` subagent and wait for its result`);
      }
    });

    const phrases: Record<string, string[]> = {
      'loopwright-flow': ['rebuild state', 'loopwright/hooks/', 'lw.mjs" status', '--base', ...SKILLS.filter((s) => s !== 'loopwright-flow')],
      'loopwright-plan': [
        'Assumption ledger', '-2', 'high-impact', 'low-impact', 'loopwright-scout', 'small', 'standard', 'large',
        'two-pass', 'maxFixRounds', 'AskUserQuestion', '/plan', 'asked', 'batch-confirmed', 'overridden',
        'lw.mjs" start', 'lw.mjs" dir', 'creates `.loopwright/`', '## Goal', 'plan: draft', 'plan: confirmed', '--force',
      ],
      'loopwright-test': ['lw.mjs" stage test', 'lw.mjs" status', 'lockedTests', 'plan: confirmed'],
      'loopwright-build': ['lw.mjs" stage build', 'task file path', 'chat history', 'slice', 'plan: confirmed', 'lw.mjs" await-user', 'lw.mjs" resume', 'AskUserQuestion'],
      'loopwright-review': [
        'lw.mjs" stage review', 'Blocking', 'Undecided', 'crossAgentReview', 'crossAgentReviewer', 'verdict pass',
        'verdict fail', '{{LW_HOME}}/prompts/reviewer.md', '{{LW_HOME}}/schemas/verdict.json', 'structured_output',
        'LOOPWRIGHT_HOOKS=off codex exec --sandbox read-only --output-schema', 'LOOPWRIGHT_HOOKS=off claude -p', '--json-schema', 'implementer report', 'Review log', 'whole-branch',
        'lw.mjs" await-user', 'lw.mjs" resume', 'Second pass.', '--allowedTools', '--disallowedTools', ' -- "$PROMPT"', '-o ', 'sandbox',
      ],
      'loopwright-done': ['AGENTS.md', 'docs/agents', '@AGENTS.md', 'do not commit', 'status: done', 'lw.mjs" done', 'rejected'],
    };
    it('cross-agent claude allowlist permits only read-only lw.mjs subcommands, quoted and unquoted', () => {
      const b = skill('loopwright-review');
      for (const sub of ['status', 'check-locks', 'fingerprint']) {
        expect(b).toContain(`Bash(node "{{LW_HOME}}/hooks/lw.mjs" ${sub})`);
        expect(b).toContain(`Bash(node {{LW_HOME}}/hooks/lw.mjs ${sub})`);
      }
      expect(b).not.toContain('lw.mjs:*');
      expect(read('prompts/reviewer.md')).toContain('Use only `status`, `check-locks`, `fingerprint`');
    });

    it('review second pass is not labelled blind and the slice-lock workaround is gone', () => {
      const b = skill('loopwright-review');
      const second = b.split('\n').find((l) => l.includes('**Second pass**'))!;
      expect(second).toContain('Second pass.');
      expect(second).not.toContain('Blind pass');
      expect(b).not.toContain("later slice's Test stage");
    });

    for (const [n, list] of Object.entries(phrases)) {
      it(`${n} carries its required phrases`, () => {
        const b = skill(n);
        for (const s of list) expect(b, `${n}: ${s}`).toContain(s);
      });
    }
  });
});

describe('cross-agent rename', () => {
  const root = new URL('../', import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

  it('review skill uses the cross-agent names and heading', () => {
    const b = skill('loopwright-review');
    expect(b).toContain('**Cross-agent pass**');
    expect(b).toContain('`models.crossAgentReviewer`');
  });

  it('README uses the new keys and support-table label', () => {
    const r = readFileSync(root + 'README.md', 'utf8');
    expect(r).toContain('"crossAgentReview": "off"');
    expect(r).toContain('"crossAgentReviewer"');
    expect(r).toContain('Cross-agent review');
  });

  it('no cross-model wording remains', () => {
    const targets = [...files(root + 'src'), ...files(root + 'content'), root + 'README.md', root + 'CLAUDE.md', root + 'docs/dogfood-checklist.md'];
    for (const f of targets) expect(readFileSync(f, 'utf8'), f).not.toMatch(/cross[-_ ]?model/i);
  });
});
