import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod: any = await import(pathToFileURL(join(root, 'scripts', 'usage-report.mjs')).href);

function line(id: string, model: string, cacheCreation: object | undefined, total: number) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model,
      content: [],
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: total,
        cache_creation: cacheCreation,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  });
}

const MTOK = 1_000_000;

describe('usage report cache write TTL', () => {
  it('reads the 1 hour share of cache writes, zero when the usage has no split', () => {
    const text = [
      line('a', 'claude-opus-5-5', { ephemeral_1h_input_tokens: 300, ephemeral_5m_input_tokens: 700 }, 1000),
      line('b', 'claude-opus-5-5', undefined, 50),
    ].join('\n');
    const { messages } = mod.parseTranscript(text);
    expect(messages.map((m: any) => [m.cacheWrite, m.cacheWrite1h])).toEqual([
      [1000, 300],
      [50, 0],
    ]);
  });

  it('prices 1 hour writes at the 1 hour rate and the rest at the 5 minute rate', () => {
    const cost = (model: string, oneHour: number) =>
      mod.costUsd(
        mod.summarize(mod.parseTranscript(line('a', model, { ephemeral_1h_input_tokens: oneHour }, MTOK)).messages),
      );
    // https://platform.claude.com/docs/en/about-claude/pricing (Model pricing)
    expect(cost('claude-opus-5-5', 0)).toBeCloseTo(5, 9);
    expect(cost('claude-opus-5-5', MTOK)).toBeCloseTo(8, 9);
    expect(cost('claude-opus-5-5', MTOK / 2)).toBeCloseTo(6.5, 9);
    expect(cost('claude-sonnet-5-5', MTOK)).toBeCloseTo(4, 9);
    expect(cost('claude-haiku-5-5', MTOK)).toBeCloseTo(0.2, 9);
  });

  it('keeps the four byModel keys when no write used the 1 hour TTL', () => {
    const s = mod.summarize(mod.parseTranscript(line('a', 'claude-opus-5-5', undefined, 10)).messages);
    expect(Object.keys(s.byModel['claude-opus-5-5']).sort()).toEqual(['cacheRead', 'cacheWrite', 'input', 'output']);
  });
});
