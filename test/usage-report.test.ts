import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'usage-report.mjs');
const fixtures = join(root, 'test', 'fixtures', 'transcripts');
const mainPath = join(fixtures, 'main.jsonl');
const main = readFileSync(mainPath, 'utf8');

// The script is plain .mjs without types, so load it untyped.
const mod: any = await import(pathToFileURL(script).href);
const { parseTranscript, summarize, splitByStage, costUsd, reportSession } = mod;

function msg(over: Record<string, unknown> = {}) {
  return { id: 'x', model: 'claude-opus-5-5', input: 0, cacheWrite: 0, cacheRead: 0, output: 0, tools: [], ...over };
}

// Reads every top-level JSON object or array in the text, whether printed as one value,
// one value per line, or several pretty-printed values.
function jsonValues(text: string): any[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [v];
  } catch {
    // fall through to the scanner
  }
  const out: any[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') {
      if (depth++ === 0) start = i;
    } else if (c === '}' || c === ']') {
      if (--depth === 0) {
        const v = JSON.parse(text.slice(start, i + 1));
        if (Array.isArray(v)) out.push(...v);
        else out.push(v);
      }
    }
  }
  return out;
}

function run(args: string[], home?: string) {
  const h = home ?? mkdtempSync(join(tmpdir(), 'lw-usage-home-'));
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: h, USERPROFILE: h },
  });
}

describe('parseTranscript', () => {
  it('counts one API message once, taking its last usage', () => {
    const { messages } = parseTranscript(main);
    expect(messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(messages[0]).toMatchObject({
      model: 'claude-opus-5-5',
      input: 10,
      cacheWrite: 100,
      cacheRead: 1000,
      output: 50,
    });
  });

  it('collects tools from every line of one API message', () => {
    const { messages } = parseTranscript(main);
    expect(messages[0].tools.map((t: any) => t.name)).toEqual(['Read', 'Bash']);
    expect(messages[0].tools[1].command).toBe('node "/x/hooks/lw.mjs" status');
    expect(messages[1].tools[0]).toMatchObject({
      name: 'Bash',
      command: 'node "/x/hooks/lw.mjs" stage test',
    });
    expect(messages[3].tools).toEqual([]);
  });

  it('skips non-JSON lines and a truncated last line and counts them', () => {
    const r = parseTranscript(main);
    expect(r.skipped).toBe(2);
    expect(r.messages).toHaveLength(4);
  });

  it('reports no skipped lines for a clean transcript', () => {
    const clean = readFileSync(join(fixtures, 'main', 'subagents', 'agent-a1.jsonl'), 'utf8');
    const r = parseTranscript(clean);
    expect(r.skipped).toBe(0);
    expect(r.messages.map((m: any) => m.id)).toEqual(['s1', 's2']);
  });
});

describe('summarize', () => {
  it('reports turns and context size at the first and last turn', () => {
    const s = summarize(parseTranscript(main).messages);
    expect(s.turns).toBe(4);
    expect(s.contextStart).toBe(10 + 100 + 1000);
    expect(s.contextEnd).toBe(40 + 400 + 4000);
  });

  it('totals tokens and splits them by model', () => {
    const s = summarize(parseTranscript(main).messages);
    expect(s).toMatchObject({ input: 100, cacheWrite: 1000, cacheRead: 10000, output: 260 });
    expect(Object.keys(s.byModel).sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'mystery-model']);
    expect(s.byModel['claude-opus-5-5']).toEqual({ input: 30, cacheWrite: 300, cacheRead: 3000, output: 110 });
    expect(s.byModel['claude-sonnet-5-5']).toEqual({ input: 30, cacheWrite: 300, cacheRead: 3000, output: 70 });
  });

  it('leaves synthetic messages out of tokens and the model breakdown', () => {
    const s = summarize([
      msg({ id: 'a', input: 1, cacheWrite: 2, cacheRead: 3, output: 4 }),
      msg({ id: 'b', model: '<synthetic>', input: 900, cacheWrite: 900, cacheRead: 900, output: 900 }),
      msg({ id: 'c', input: 10, cacheWrite: 20, cacheRead: 30, output: 40 }),
    ]);
    expect(Object.keys(s.byModel)).toEqual(['claude-opus-5-5']);
    expect(s).toMatchObject({ input: 11, cacheWrite: 22, cacheRead: 33, output: 44 });
  });
});

describe('splitByStage', () => {
  it('splits the main thread at lw.mjs stage calls', () => {
    const parts = splitByStage(parseTranscript(main).messages);
    expect(parts.map((p: any) => p.stage)).toEqual(['(before first stage)', 'test', 'build']);
  });

  it('puts a message with a stage call in the stage it starts', () => {
    const parts = splitByStage(parseTranscript(main).messages);
    // m1 before; m2 starts test; m3 starts build, m4 follows it
    expect(parts.map((p: any) => p.summary.turns)).toEqual([1, 1, 2]);
    expect(parts[1].summary.input).toBe(20);
    expect(parts[2].summary.input).toBe(70);
  });

  it('does not split on other lw.mjs commands or other Bash calls', () => {
    const parts = splitByStage([
      msg({ id: 'a', tools: [{ name: 'Bash', command: 'node "/x/hooks/lw.mjs" status' }] }),
      msg({ id: 'b', tools: [{ name: 'Bash', command: 'git status' }] }),
    ]);
    expect(parts.map((p: any) => p.stage)).toEqual(['(before first stage)']);
    expect(parts[0].summary.turns).toBe(2);
  });
});

describe('costUsd', () => {
  const tokens = { input: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 };

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])('prices %s by its full id', (model) => {
    const c = costUsd(summarize([msg({ model, ...tokens })]));
    expect(typeof c).toBe('number');
    expect(c).toBeGreaterThan(0);
    expect(Number.isFinite(c)).toBe(true);
  });

  it('charges each token kind and scales with the token count', () => {
    for (const kind of ['input', 'cacheWrite', 'cacheRead', 'output']) {
      const one = costUsd(summarize([msg({ [kind]: 1_000_000 })]));
      const two = costUsd(summarize([msg({ [kind]: 2_000_000 })]));
      expect(one).toBeGreaterThan(0);
      expect(two).toBeCloseTo(one * 2, 9);
    }
  });

  it('adds up the cost of every model in the summary', () => {
    const a = costUsd(summarize([msg({ id: 'a', model: 'claude-opus-5-5', ...tokens })]));
    const b = costUsd(summarize([msg({ id: 'b', model: 'claude-haiku-5-5', ...tokens })]));
    const both = costUsd(
      summarize([
        msg({ id: 'a', model: 'claude-opus-5-5', ...tokens }),
        msg({ id: 'b', model: 'claude-haiku-5-5', ...tokens }),
      ]),
    );
    expect(both).toBeCloseTo(a + b, 9);
  });

  it('gives no cost when any model has no price', () => {
    expect(costUsd(summarize(parseTranscript(main).messages))).toBeNull();
    expect(
      costUsd(summarize([msg({ id: 'a', ...tokens }), msg({ id: 'b', model: 'mystery-model', input: 1 })])),
    ).toBeNull();
  });

  it('does not price a model by a shortened id', () => {
    expect(costUsd(summarize([msg({ model: 'opus', ...tokens })]))).toBeNull();
  });

  it('ignores synthetic messages when pricing', () => {
    const c = costUsd(
      summarize([msg({ id: 'a', ...tokens }), msg({ id: 'b', model: '<synthetic>', input: 5, output: 5 })]),
    );
    expect(typeof c).toBe('number');
    expect(c).toBeCloseTo(costUsd(summarize([msg({ id: 'a', ...tokens })])), 9);
  });
});

describe('reportSession', () => {
  it('summarises the main thread with its stages and cost', () => {
    const r = reportSession(mainPath);
    expect(r.session).toBe('main');
    expect(r.skipped).toBe(2);
    expect(r.main.turns).toBe(4);
    expect(r.main.costUsd).toBeNull();
    expect(r.main.stages.map((s: any) => s.stage)).toEqual(['(before first stage)', 'test', 'build']);
  });

  it('groups subagents by role and names a run without a meta file unknown', () => {
    const r = reportSession(mainPath);
    expect(Object.keys(r.roles).sort()).toEqual(['loopwright-reviewer', 'unknown']);
    expect(r.roles['loopwright-reviewer'].runs).toBe(2);
    expect(r.roles.unknown.runs).toBe(1);
  });

  it('adds up the runs of one role and prices them', () => {
    const r = reportSession(mainPath);
    expect(r.roles['loopwright-reviewer']).toMatchObject({
      turns: 3,
      input: 18,
      cacheWrite: 180,
      cacheRead: 1800,
      output: 24,
    });
    expect(typeof r.roles['loopwright-reviewer'].costUsd).toBe('number');
    expect(r.roles.unknown).toMatchObject({ turns: 1, input: 1, cacheRead: 100, output: 3 });
  });

  it('reports no roles for a session without subagents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-usage-solo-'));
    cpSync(mainPath, join(dir, 'solo.jsonl'));
    const r = reportSession(join(dir, 'solo.jsonl'));
    expect(r.session).toBe('solo');
    expect(r.roles).toEqual({});
  });
});

describe('usage-report CLI', () => {
  it('prints totals for a transcript with bad lines and exits 0', () => {
    const r = run([mainPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('2 lines skipped');
    expect(r.stdout).toContain('main');
    expect(r.stdout).toContain('build');
    expect(r.stdout).toContain('loopwright-reviewer');
    expect(r.stdout).toContain('unknown');
  });

  it('prints reportSession objects with --json', () => {
    const r = run([mainPath, '--json']);
    expect(r.status).toBe(0);
    const values = jsonValues(r.stdout);
    expect(values).toHaveLength(1);
    expect(values[0]).toEqual(JSON.parse(JSON.stringify(reportSession(mainPath))));
  });

  it('reports every transcript in a folder and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-usage-folder-'));
    mkdirSync(join(dir, 'sub'));
    cpSync(fixtures, dir, { recursive: true });
    cpSync(mainPath, join(dir, 'other.jsonl'));
    writeFileSync(join(dir, 'notes.txt'), 'not a transcript');
    const r = run([dir, '--json']);
    expect(r.status).toBe(0);
    const sessions = jsonValues(r.stdout)
      .map((v) => v.session)
      .sort();
    expect(sessions).toEqual(['main', 'other']);
  });

  it('finds a session by id under ~/.claude/projects', () => {
    const home = mkdtempSync(join(tmpdir(), 'lw-usage-home-'));
    const proj = join(home, '.claude', 'projects', '-some-project');
    mkdirSync(proj, { recursive: true });
    cpSync(mainPath, join(proj, 'sess-123.jsonl'));
    const r = run(['sess-123', '--json'], home);
    expect(r.status).toBe(0);
    const values = jsonValues(r.stdout);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ session: 'sess-123', skipped: 2 });
  });

  it('prints its own message for a session id it cannot find', () => {
    const r = run(['no-such-session']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage-report: no transcript found for');
    expect(r.stderr).toContain('no-such-session');
  });
});
