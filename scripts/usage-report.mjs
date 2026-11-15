#!/usr/bin/env node
// Usage report for Claude Code transcripts: tokens and cost per session, stage and subagent role.
// Maintainer tool for docs/benchmarking.md; not shipped in the package.
//
// Usage: node scripts/usage-report.mjs <session-id | path/to/session.jsonl | transcript-folder> [--json]
//
// Transcript format: observed in Claude Code 2.1.3xx transcripts, not a documented contract.
// - One JSON object per line. Assistant lines carry message.id, message.model, message.usage
//   (input_tokens, cache_creation_input_tokens, cache_creation.ephemeral_1h_input_tokens,
//   cache_read_input_tokens, output_tokens) and
//   message.content[] items of type "tool_use" with name and input.
// - One API message spans several lines that repeat its usage, so the last usage per id wins and
//   tools are collected from every line.
// - Subagent transcripts live at <folder>/<session-id>/subagents/agent-*.jsonl, each with an
//   agent-*.meta.json holding agentType.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// USD per million tokens, keyed by full model id. cacheWrite is the 5 minute rate, cacheWrite1h the 1 hour rate.
// https://platform.claude.com/docs/en/about-claude/pricing (Model pricing)
// On a Claude subscription Claude Code's main thread writes with the 1 hour TTL and subagents with 5 minutes
// (with an API key, usage credits or a cloud provider the main thread gets 5 minutes unless promptCacheTtl is
// 1h), so the 1 hour tokens (usage.cache_creation.ephemeral_1h_input_tokens) are priced apart.
// https://code.claude.com/docs/en/prompt-caching.md (Which TTL each request gets)
// Haiku 5.5 has a higher rate for prompts over 100,000 tokens; this table uses the lower one, so a Haiku
// cost is a lower bound for sessions with such prompts.
const PRICES = {
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  'claude-fable-5-2': { input: 8, cacheWrite: 10, cacheWrite1h: 16, cacheRead: 0.2, output: 40 },
  'claude-haiku-5-5': { input: 0.1, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
};

// Claude Code writes this model on messages it generates itself (no API call), so they cost nothing.
const SYNTHETIC = '<synthetic>';
const KINDS = ['input', 'cacheWrite', 'cacheRead', 'output'];
const BEFORE_FIRST_STAGE = '(before first stage)';

export function parseTranscript(text) {
  const byId = new Map();
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const m = entry?.type === 'assistant' ? entry.message : null;
    if (!m || typeof m.id !== 'string') continue;
    let msg = byId.get(m.id);
    if (!msg) {
      msg = {
        id: m.id,
        model: m.model ?? null,
        input: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 0,
        tools: [],
      };
      byId.set(m.id, msg);
    }
    const u = m.usage;
    if (u) {
      msg.input = u.input_tokens ?? 0;
      msg.cacheWrite = u.cache_creation_input_tokens ?? 0;
      msg.cacheWrite1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      msg.cacheRead = u.cache_read_input_tokens ?? 0;
      msg.output = u.output_tokens ?? 0;
    }
    for (const item of Array.isArray(m.content) ? m.content : []) {
      if (item?.type === 'tool_use') {
        msg.tools.push(
          typeof item.input?.command === 'string'
            ? { name: item.name, command: item.input.command }
            : { name: item.name },
        );
      }
    }
  }
  return { messages: [...byId.values()], skipped };
}

export function summarize(messages) {
  const real = messages.filter((m) => m.model !== SYNTHETIC);
  const s = {
    turns: real.length,
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    contextStart: 0,
    contextEnd: 0,
    byModel: {},
  };
  const context = (m) => m.input + m.cacheWrite + m.cacheRead;
  if (real.length) {
    s.contextStart = context(real[0]);
    s.contextEnd = context(real[real.length - 1]);
  }
  for (const m of real) {
    const by = (s.byModel[m.model ?? 'unknown'] ??= { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
    for (const k of KINDS) {
      s[k] += m[k];
      by[k] += m[k];
    }
    // Only a model with 1 hour writes gets the key, so byModel keeps its four keys otherwise.
    if (m.cacheWrite1h) by.cacheWrite1h = (by.cacheWrite1h ?? 0) + m.cacheWrite1h;
  }
  return s;
}

// `node <lw.mjs path or $VAR> stage <name>`. Anchoring on `node` skips text that only quotes a stage call
// (a heredoc body, a sed script), and `$VAR` covers calls made through a shell variable like `node $L stage test`.
const STAGE_CALL = /\bnode\s+(?:"[^"]*lw\.mjs"|'[^']*lw\.mjs'|\S*lw\.mjs|\$\{?\w+\}?)\s+stage\s+["']?([\w-]+)/;

// The stage a message starts, from a `lw.mjs stage <name>` Bash call; the last one wins.
function stageStarted(msg) {
  let stage = null;
  for (const t of msg.tools) {
    const hit = t.name === 'Bash' && t.command ? STAGE_CALL.exec(t.command) : null;
    if (hit) stage = hit[1];
  }
  return stage;
}

export function splitByStage(messages) {
  const parts = [];
  let current = null;
  for (const m of messages) {
    const started = stageStarted(m);
    if (started || !current) {
      current = { stage: started ?? BEFORE_FIRST_STAGE, messages: [] };
      parts.push(current);
    }
    current.messages.push(m);
  }
  return parts.map((p) => ({ stage: p.stage, summary: summarize(p.messages) }));
}

export function costUsd(summary) {
  let total = 0;
  for (const [model, tokens] of Object.entries(summary.byModel)) {
    const price = PRICES[model];
    if (!price) return null;
    for (const k of KINDS) total += (tokens[k] * price[k]) / 1_000_000;
    // cacheWrite already counts every cache write at the 5 minute rate; add the 1 hour premium.
    total += ((tokens.cacheWrite1h ?? 0) * (price.cacheWrite1h - price.cacheWrite)) / 1_000_000;
  }
  return total;
}

function withCost(summary) {
  return { ...summary, costUsd: costUsd(summary) };
}

export function reportSession(transcriptPath) {
  const session = basename(transcriptPath, '.jsonl');
  let { messages, skipped } = parseTranscript(readFileSync(transcriptPath, 'utf8'));
  const main = withCost(summarize(messages));
  main.stages = splitByStage(messages).map((p) => ({ stage: p.stage, ...withCost(p.summary) }));

  const byRole = {};
  const subDir = join(dirname(transcriptPath), session, 'subagents');
  const files = existsSync(subDir) ? readdirSync(subDir).filter((f) => /^agent-.*\.jsonl$/.test(f)) : [];
  for (const file of files.sort()) {
    const metaPath = join(subDir, file.replace(/\.jsonl$/, '.meta.json'));
    let role = 'unknown';
    try {
      role = JSON.parse(readFileSync(metaPath, 'utf8')).agentType || 'unknown';
    } catch {
      // No meta file, or one that is not JSON: the run still counts, under "unknown".
    }
    const run = parseTranscript(readFileSync(join(subDir, file), 'utf8'));
    const r = (byRole[role] ??= { messages: [], runs: 0 });
    r.messages.push(...run.messages);
    r.runs++;
    skipped += run.skipped;
  }
  const roles = {};
  for (const [role, { messages: msgs, runs }] of Object.entries(byRole)) {
    roles[role] = { ...withCost(summarize(msgs)), runs };
  }
  return { session, skipped, main, roles };
}

const n = (v) => v.toLocaleString('en-US');
const usd = (v) => (v === null ? 'cost unknown' : `$${v.toFixed(2)}`);

function line(label, s, extra = '') {
  return `${label}  turns ${n(s.turns)}  input ${n(s.input)}  cache-write ${n(s.cacheWrite)}  cache-read ${n(s.cacheRead)}  output ${n(s.output)}  context ${n(s.contextStart)} -> ${n(s.contextEnd)}  ${usd(s.costUsd)}${extra}`;
}

function formatReport(r) {
  const out = [];
  const skipped = r.skipped ? ` (${r.skipped} ${r.skipped === 1 ? 'line' : 'lines'} skipped)` : '';
  out.push(`session ${r.session}${skipped}`);
  out.push(line('  main', r.main));
  for (const s of r.main.stages) out.push(line(`    stage ${s.stage}`, s));
  for (const [role, s] of Object.entries(r.roles)) {
    out.push(line(`  role ${role}`, s, `  runs ${s.runs}`));
  }
  return out.join('\n');
}

function resolveTranscripts(arg) {
  if (existsSync(arg)) {
    if (statSync(arg).isDirectory()) {
      const files = readdirSync(arg)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
        .map((f) => join(arg, f));
      return { files, folder: true };
    }
    return { files: [arg], folder: false };
  }
  const projects = join(homedir(), '.claude', 'projects');
  const found = [];
  if (existsSync(projects)) {
    for (const dir of readdirSync(projects)) {
      const p = join(projects, dir, `${arg}.jsonl`);
      if (existsSync(p)) found.push(p);
    }
  }
  return { files: found, folder: false };
}

function main(argv) {
  const json = argv.includes('--json');
  const arg = argv.find((a) => a !== '--json');
  if (!arg) {
    console.error(
      'usage: node scripts/usage-report.mjs <session-id | path/to/session.jsonl | transcript-folder> [--json]',
    );
    return 1;
  }
  const { files, folder } = resolveTranscripts(arg);
  if (!files.length) {
    console.error(`usage-report: no transcript found for ${arg}`);
    return 1;
  }
  const reports = files.map(reportSession);
  if (json) console.log(JSON.stringify(folder ? reports : reports[0], null, 2));
  else console.log(reports.map(formatReport).join('\n\n'));
  return 0;
}

// Run only as the entry point, so tests can import the functions.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
