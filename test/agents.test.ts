import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, readConfig } from '../src/core/config.js';
import { parseAgentSource, renderClaudeAgent, renderCodexAgent } from '../src/generate/agents.js';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const reviewer = () => parseAgentSource('reviewer', read('../content/agents/reviewer.md'));

describe('agent generation', () => {
  it('renders the Claude reviewer golden', () => {
    expect(renderClaudeAgent(reviewer(), 'opus')).toBe(read('./fixtures/agents/reviewer.claude.md'));
  });

  it('omits model for inherit in Claude output', () => {
    expect(renderClaudeAgent(reviewer(), 'inherit')).not.toContain('model:');
  });

  it('renders the Codex reviewer golden and parses as TOML', () => {
    const out = renderCodexAgent(reviewer(), 'inherit');
    expect(out).toBe(read('./fixtures/agents/reviewer.codex.toml'));
    const t = parse(out);
    expect(Object.keys(t).sort()).toEqual(['description', 'developer_instructions', 'name']);
    expect(t.name).toBe('loopwright-reviewer');
  });

  it('emits model and effort for Codex when set', () => {
    const t = parse(renderCodexAgent(reviewer(), 'gpt-5', 'high'));
    expect(t.model).toBe('gpt-5');
    expect(t.model_reasoning_effort).toBe('high');
  });

  it("body containing ''' round-trips through smol-toml", () => {
    const body = `a '''quoted''' b\nback\\slash "q" """tri"""\nend`;
    const src = { ...reviewer(), body };
    const t = parse(renderCodexAgent(src, 'inherit'));
    expect((t.developer_instructions as string).trimEnd()).toBe(body);
  });

  it('parseAgentSource rejects missing description', () => {
    expect(() => parseAgentSource('x', '---\nname: n\n---\nbody\n')).toThrow(/description/);
  });
});

describe('readConfig', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'lw-cfg-'));

  it('returns default when missing', () => {
    expect(readConfig(join(tmp(), 'nope.json'))).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial config', () => {
    const p = join(tmp(), 'c.json');
    writeFileSync(p, JSON.stringify({ maxFixRounds: 5, models: { claude: { scout: 'sonnet' } } }));
    const c = readConfig(p);
    expect(c.maxFixRounds).toBe(5);
    expect(c.models.claude.scout).toBe('sonnet');
    expect(c.models.claude.reviewer).toBe('opus');
    expect(c.docsDir).toBe('docs/agents');
  });

  it('throws with path on invalid JSON', () => {
    const p = join(tmp(), 'bad.json');
    writeFileSync(p, '{nope');
    expect(() => readConfig(p)).toThrow(p);
  });
});

describe('DEFAULT_CONFIG cross-agent keys', () => {
  it('uses crossAgent* names with unchanged defaults', () => {
    expect(DEFAULT_CONFIG.crossAgentReview).toBe('off');
    expect(DEFAULT_CONFIG.models.crossAgentReviewer).toEqual({ claude: 'opus', codex: 'inherit' });
    expect(JSON.stringify(DEFAULT_CONFIG)).not.toMatch(/crossModel/);
  });
});
