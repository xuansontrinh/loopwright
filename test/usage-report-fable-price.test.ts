import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod: any = await import(pathToFileURL(join(root, 'scripts', 'usage-report.mjs')).href);

const MTOK = 1_000_000;

describe('usage report Fable 5.2 prices', () => {
  it('prices every token kind at the published Fable 5.2 rates', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'a',
        model: 'claude-fable-5-2',
        content: [],
        usage: {
          input_tokens: MTOK,
          cache_creation_input_tokens: MTOK,
          cache_creation: { ephemeral_1h_input_tokens: MTOK },
          cache_read_input_tokens: MTOK,
          output_tokens: MTOK,
        },
      },
    });
    const summary = mod.summarize(mod.parseTranscript(line).messages);
    // https://platform.claude.com/docs/en/about-claude/pricing (Model pricing): $8 input, $16 1h write, $0.20 read, $40 output
    expect(mod.costUsd(summary)).toBeCloseTo(8 + 16 + 0.2 + 40, 9);
  });
});
