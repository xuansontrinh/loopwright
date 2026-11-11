import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAgentSource, renderClaudeAgent, renderJunieAgent } from '../src/generate/agents.js';

// Junie's documented tool labels: https://junie.jetbrains.com/docs/junie-cli-subagents.html (Supported tool groups)

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const scout = () => parseAgentSource('scout', read('../content/agents/scout.md'));
const toolList = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const junieTools = (md: string) => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md)![1]!;
  const block = /^tools:\n((?:  - .*\n?)+)/m.exec(fm + '\n');
  return block
    ? block[1]!
        .split('\n')
        .filter(Boolean)
        .map((l) => l.replace(/^  - /, ''))
    : [];
};

describe('scout tools', () => {
  it('lists Bash, WebSearch and WebFetch next to the read tools', () => {
    const tools = toolList(scout().tools);
    for (const t of ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch']) expect(tools).toContain(t);
  });

  it('limits Bash to read-only git and the existing test commands', () => {
    const body = scout().body;
    expect(body).toMatch(/git log/);
    expect(body).toMatch(/read-only/i);
    expect(body).toMatch(/existing test/i);
    for (const banned of ['edit', 'install', 'commit', 'network']) expect(body.toLowerCase()).toContain(banned);
  });

  it('limits web queries to public names and requires cited URLs', () => {
    const body = scout().body;
    expect(body).toMatch(/public/i);
    expect(body).toMatch(/secret/i);
    expect(body).toMatch(/URL/);
    expect(body).toMatch(/data/i);
  });
});

describe('agent tool rendering per target', () => {
  const src = () =>
    parseAgentSource(
      'scout',
      '---\nname: loopwright-scout\ndescription: d\ntools: Read, Grep, Glob, Bash, WebSearch, WebFetch\n---\nbody\n',
    );

  it('Claude keeps every tool label', () => {
    const out = renderClaudeAgent(src(), 'inherit');
    expect(out).toContain('tools: Read, Grep, Glob, Bash, WebSearch, WebFetch');
  });

  it('Junie drops WebFetch and keeps the other labels in order', () => {
    const out = renderJunieAgent(src(), 'inherit');
    expect(junieTools(out)).toEqual(['Read', 'Grep', 'Glob', 'Bash', 'WebSearch']);
    expect(out).not.toContain('WebFetch');
  });

  it('Junie keeps the tool list unchanged when every label is documented', () => {
    const s = parseAgentSource('r', '---\nname: n\ndescription: d\ntools: Read, Grep, Glob\n---\nbody\n');
    expect(junieTools(renderJunieAgent(s, 'inherit'))).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('the shipped scout renders for Claude with all tools and for Junie without WebFetch', () => {
    expect(renderClaudeAgent(scout(), 'inherit')).toContain('WebFetch');
    const j = renderJunieAgent(scout(), 'inherit');
    expect(junieTools(j)).toContain('Bash');
    expect(junieTools(j)).toContain('WebSearch');
    expect(junieTools(j)).not.toContain('WebFetch');
  });
});
