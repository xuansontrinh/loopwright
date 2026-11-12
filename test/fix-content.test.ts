import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';
import { parseAgentSource } from '../src/generate/agents.js';
import { createTempGitRepo, runCli } from './helpers.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const skill = (name: string) => read(`skills/loopwright-${name}/SKILL.md`);
const agentBody = (role: string) => parseAgentSource(role, read(`agents/${role}.md`)).body;
const lines = (body: string) => body.split('\n');
const linesWith = (body: string, needle: RegExp) => lines(body).filter((l) => needle.test(l));
const section = (body: string, heading: RegExp) => {
  const parts = body.split(/^(?=## )/m);
  return parts.find((p) => heading.test(p.split('\n')[0]!)) ?? '';
};

describe('fix skill', () => {
  it('exists with a spec-valid name and a real description', () => {
    expect(existsSync(contentRoot() + 'skills/loopwright-fix/SKILL.md')).toBe(true);
    const body = skill('fix');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(body)![1]!;
    expect(fm).toMatch(/^name: loopwright-fix$/m);
    const desc = /^description: (.*)$/m.exec(fm)![1]!;
    expect(desc.length).toBeGreaterThan(40);
    expect(desc).not.toContain(': ');
  });

  it('has the standard setup that tolerates a missing .loopwright directory', () => {
    const body = skill('fix');
    const setup = section(body, /^## Setup/);
    expect(setup).toContain('git rev-parse --show-toplevel');
    expect(setup).toContain('node "{{LW_HOME}}/hooks/lw.mjs" dir');
    expect(setup).toContain('`null` inside a git repo');
    expect(setup).toContain('creates `.loopwright/`');
    expect(setup).toContain('Not a git repo → tell the user loopwright must run inside a git repo');
  });

  it('sets kind: fix and hands the bug report to the plan skill', () => {
    const body = skill('fix');
    expect(body).toContain('kind: fix');
    expect(body).toContain('loopwright-plan');
    expect(body).toContain('loopwright-flow');
    expect(body).toMatch(/bug/i);
  });

  it('is installed by init into .agents/skills and .claude/skills', () => {
    const repo = createTempGitRepo('lw-fix-');
    const r = runCli(repo, ['init']);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const base of ['.agents/skills', '.claude/skills']) {
      const p = join(repo, base, 'loopwright-fix', 'SKILL.md');
      expect(existsSync(p), p).toBe(true);
      const text = readFileSync(p, 'utf8');
      expect(text).not.toContain('{{');
      expect(text).toContain('kind: fix');
    }
  });
});

describe('plan skill for fixes', () => {
  const plan = () => skill('plan');

  it('puts a kind header in the task file template and treats a missing kind as feature', () => {
    const template = plan().split('```markdown')[1]!.split('```')[0]!;
    expect(template).toMatch(/^kind: /m);
    expect(plan()).toMatch(/kind: fix/);
    expect(plan()).toMatch(/missing[^\n]*kind[^\n]*feature|no `?kind`?[^\n]*feature/i);
  });

  it('defines the Bug report, Root cause and Follow-ups sections', () => {
    const body = plan();
    for (const h of ['## Bug report', '## Root cause', '## Follow-ups']) expect(body).toContain(h);
  });

  it('asks for missing evidence in one message after the scout ran', () => {
    const intake = linesWith(plan(), /evidence/i).join('\n');
    expect(intake).toMatch(/one message/i);
    expect(intake).toMatch(/scout/i);
    expect(intake).toContain('## Bug report');
    expect(intake).toMatch(/don't know|do not know/i);
  });

  it('treats the root-cause hypothesis as a high-impact assumption for the user to correct', () => {
    const l = linesWith(plan(), /hypothesis/i).join('\n');
    expect(l).toContain('## Root cause');
    expect(l).toMatch(/high-impact/);
  });

  it('writes fix criteria with a leading repro or regression tag', () => {
    const body = plan();
    expect(body).toContain('[repro]');
    expect(body).toContain('[regression]');
    expect(linesWith(body, /\[repro\]/).join('\n')).toMatch(/interface:/);
    expect(linesWith(body, /\[repro\]/).join('\n')).toMatch(/test:/);
  });

  it('asks one sibling question: include them in this fix or list them as follow-ups', () => {
    const q = linesWith(plan(), /sibling/i).join('\n');
    expect(q).toMatch(/include/i);
    expect(q).toContain('Follow-ups');
    expect(q).toMatch(/recommend/i);
  });
});

describe('test, build and flow skills for fixes', () => {
  it('test skill skips Test for small features only', () => {
    const l = linesWith(skill('test'), /tier: small/).join('\n');
    expect(l).toMatch(/feature/);
    expect(l).toMatch(/fix/);
  });

  it('test skill compares the repro failure with the reported symptom', () => {
    const body = skill('test');
    const l = linesWith(body, /symptom|observed/i).join('\n');
    expect(l).toContain('## Bug report');
    expect(l).toMatch(/observed/);
    expect(l).toMatch(/mismatch|differ|does not match/i);
    expect(l).toMatch(/tester/);
  });

  it('test skill turns a missing repro into a user gate with three ways forward', () => {
    const body = skill('test');
    const gate = linesWith(body, /await-user/).join('\n');
    expect(gate).toMatch(/repro/i);
    expect(gate).toContain('resume');
    const all = body.toLowerCase();
    expect(all).toContain('evidence');
    expect(all).toContain('faulty unit');
    expect(all).toMatch(/stop the task|stop\b/);
    expect(body).toContain('loopwright-scout');
  });

  it('test skill never offers to continue without a repro', () => {
    for (const name of ['test', 'flow', 'fix']) {
      for (const l of linesWith(skill(name), /continue without/i)) {
        expect(l, name).toMatch(/\b(no|never|not)\b/i);
      }
    }
    expect(skill('test')).toMatch(/no repro, no fix|no continue|never[^\n]*continue without/i);
  });

  it('build skill sends a fix with no locked tests back to Test', () => {
    const l = linesWith(skill('build'), /lockedTests/).join('\n');
    expect(l).toMatch(/fix/);
    expect(l).toContain('/loopwright-test');
    expect(l).toMatch(/small/);
  });

  it('flow skill runs Test for a fix at every tier', () => {
    const l = linesWith(skill('flow'), /fix/i).join('\n');
    expect(l).toMatch(/every tier|any tier|all tiers/i);
    expect(l).toContain('loopwright-test');
  });

  it('flow skill lists the no-repro and sibling gates', () => {
    const gates = section(skill('flow'), /^## Gates/);
    expect(gates).toMatch(/no-repro|repro/i);
    expect(gates).toMatch(/sibling/i);
  });
});

describe('agent fix sections', () => {
  it('tester has a fix tasks section', () => {
    const body = agentBody('tester');
    const fix = section(body, /Fix tasks/i);
    expect(fix).not.toBe('');
    expect(fix).toContain('## Bug report');
    expect(fix).toContain('[repro]');
    expect(fix).toContain('[regression]');
    expect(fix).toMatch(/correct behavior/i);
    expect(fix).toMatch(/never[^\n]*(bug|issue number)/i);
    expect(linesWith(fix, /regression/).join('\n')).toMatch(/pass/i);
    expect(fix).toMatch(/side by side/i);
    expect(fix).toMatch(/symptom/i);
    expect(fix).toMatch(/Needs/);
  });

  it('implementer reports the root cause before changing code and may not suppress the symptom', () => {
    const body = agentBody('implementer');
    const fix = section(body, /Fix tasks/i);
    expect(fix).not.toBe('');
    expect(fix).toContain('Root cause:');
    expect(fix).toMatch(/before (changing|editing)/i);
    expect(fix).toMatch(/Deviation/);
    expect(fix).toMatch(/forbidden/i);
    expect(fix).toMatch(/catch/i);
    expect(fix).toMatch(/special-cas/i);
    expect(fix).toMatch(/skip|remov/i);
    expect(fix).toMatch(/widen/i);
  });

  it('scout takes fix inputs and can investigate a faulty unit', () => {
    const body = agentBody('scout');
    const fix = section(body, /Fix tasks/i);
    expect(fix).not.toBe('');
    expect(fix).toContain('git log');
    expect(fix).toMatch(/existing tests?/i);
    expect(fix).toMatch(/symptom/i);
    expect(fix).toMatch(/faulty unit/i);
    expect(fix).toMatch(/suspect/i);
  });

  it('reviewer prompt checks the root cause and searches for siblings', () => {
    const fix = section(read('prompts/reviewer.md'), /Fix tasks/i);
    expect(fix).not.toBe('');
    expect(fix).toContain('## Root cause');
    expect(fix).toMatch(/blocking/i);
    expect(fix).toMatch(/symptom/i);
    expect(fix).toContain('siblings');
    expect(fix).toContain('path');
    expect(fix).toContain('line');
    expect(fix).toContain('why');
    expect(linesWith(fix, /sibling/i).join('\n')).toMatch(/never[^\n]*blocking|not[^\n]*blocking/i);
  });
});

type Schema = Record<string, any>;
function validate(schema: Schema, root: Schema, value: unknown): boolean {
  if (schema.$ref) {
    const target = (schema.$ref as string)
      .replace(/^#\//, '')
      .split('/')
      .reduce((acc: any, k) => acc[k], root);
    return validate(target, root, value);
  }
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const obj = value as Record<string, unknown>;
      for (const k of schema.required ?? []) if (!(k in obj)) return false;
      const props = schema.properties ?? {};
      for (const [k, v] of Object.entries(obj)) {
        if (props[k]) {
          if (!validate(props[k], root, v)) return false;
        } else if (schema.additionalProperties === false) return false;
      }
      return true;
    }
    case 'array':
      return Array.isArray(value) && (!schema.items || value.every((v) => validate(schema.items, root, v)));
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

describe('verdict schema siblings', () => {
  const schema = JSON.parse(read('schemas/verdict.json')) as Schema;
  const base = { pass: true, blocking: [], undecided: [], droppedCount: 0 };
  const ok = (v: unknown) => validate(schema, schema, v);

  it('requires a siblings array alongside the four existing keys', () => {
    expect([...schema.required].sort()).toEqual(['blocking', 'droppedCount', 'pass', 'siblings', 'undecided']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.siblings.type).toBe('array');
  });

  it('describes each sibling as path, line and why with no extra keys', () => {
    const item = schema.properties.siblings.items;
    const def = item.$ref
      ? item.$ref
          .replace(/^#\//, '')
          .split('/')
          .reduce((a: any, k: string) => a[k], schema)
      : item;
    expect([...def.required].sort()).toEqual(['line', 'path', 'why']);
    expect(def.additionalProperties).toBe(false);
    expect(def.properties.path.type).toBe('string');
    expect(def.properties.line.type).toBe('integer');
    expect(def.properties.why.type).toBe('string');
  });

  it('accepts a verdict with an empty siblings array', () => {
    expect(ok({ ...base, siblings: [] })).toBe(true);
  });

  it('accepts a verdict listing a sibling', () => {
    expect(ok({ ...base, siblings: [{ path: 'src/a.ts', line: 12, why: 'same unchecked parse' }] })).toBe(true);
  });

  it('rejects a verdict without siblings', () => {
    expect(ok(base)).toBe(false);
  });

  it('rejects a sibling with an extra key, a missing key or a wrong type', () => {
    expect(ok({ ...base, siblings: [{ path: 'a', line: 1, why: 'w', extra: true }] })).toBe(false);
    expect(ok({ ...base, siblings: [{ path: 'a', line: 1 }] })).toBe(false);
    expect(ok({ ...base, siblings: [{ path: 'a', line: '1', why: 'w' }] })).toBe(false);
  });
});

describe('review and done skills for fixes', () => {
  it('review skill asks the sibling gate after a passing verdict', () => {
    const body = skill('review');
    const gate = linesWith(body, /sibling/i).join('\n');
    expect(gate).toMatch(/pass/i);
    expect(gate).toContain('await-user');
    expect(gate).toMatch(/verdict/);
    expect(gate).toMatch(/recommend/i);
  });

  it('review skill runs await-user after the verdict command for siblings', () => {
    const l = linesWith(skill('review'), /sibling/i).join('\n');
    expect(l).toMatch(/await-user[^\n]*after[^\n]*verdict|after the `?verdict`? command/i);
  });

  it('review skill reopens plan when siblings are included and records follow-ups otherwise', () => {
    const l = linesWith(skill('review'), /sibling/i).join('\n');
    expect(l).toMatch(/reopen plan|reopen" plan|reopen <?plan/);
    expect(l).toContain('## Follow-ups');
    expect(l).toMatch(/include|also fix/i);
  });

  it('done skill puts root cause, repro before and after, and follow-ups in the PR draft', () => {
    const l = linesWith(skill('done'), /root cause/i).join('\n');
    expect(l).toMatch(/root cause/i);
    expect(l).toMatch(/repro/i);
    expect(l).toMatch(/failed before/i);
    expect(l).toMatch(/passes after/i);
    expect(l).toMatch(/follow-ups/i);
  });
});
