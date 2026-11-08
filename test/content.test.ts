import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot, listContent } from '../src/core/content.js';
import { parseAgentSource } from '../src/generate/agents.js';

const ROLES = ['scout', 'tester', 'implementer', 'reviewer'];
const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const agent = (role: string) => parseAgentSource(role, read(`agents/${role}.md`));

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
    for (const s of ['Blocking', 'Undecided', 'proof', 'check-locks', "Don't report anything", 'lockedAfterBuild', 'schemas/verdict.json', '`droppedCount` is a non-negative integer']) {
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
});
