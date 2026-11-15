import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod: any = await import(pathToFileURL(join(root, 'scripts', 'usage-report.mjs')).href);

function bash(command: string) {
  return {
    id: 'x',
    model: 'claude-opus-5-5',
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    tools: [{ name: 'Bash', command }],
  };
}

const stages = (commands: string[]) => mod.splitByStage(commands.map(bash)).map((p: any) => p.stage);

describe('usage report stage calls', () => {
  it('splits at a stage call made through a shell variable', () => {
    expect(stages(['git status', 'L=/h/.config/loopwright/hooks/lw.mjs && node $L stage test >/dev/null'])).toEqual([
      '(before first stage)',
      'test',
    ]);
    expect(stages(['node ${LW} stage build'])).toEqual(['build']);
  });

  it('splits at a quoted or bare script path', () => {
    expect(stages(['node "/x/hooks/lw.mjs" stage review', 'node /x/lw.mjs stage done'])).toEqual(['review', 'done']);
  });

  it('does not split at text that only quotes a stage call', () => {
    expect(stages(['git status', "python3 - <<'EOF'\nuse `lw.mjs\\\" stage test` before the slice\nEOF"])).toEqual([
      '(before first stage)',
    ]);
  });
});
