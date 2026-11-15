# Benchmarking token cost

How to measure what a loopwright task costs on the main thread, so two loopwright versions can be compared. For maintainers; Claude Code only, because the report reads Claude Code transcripts.

The benchmark runs one fixed task twice: once on the installed version you want as the baseline, once after installing the version you want to test. Both runs must use the same model, the same billing mode (a Claude subscription, or an API key with usage credits) and the same answers at every gate, which the answer sheet below fixes. One run is one sample, so treat a small difference as noise.

## Run the task

1. From the loopwright checkout, copy the fixture to a temp folder named after the run, and make it a git repo. Use `baseline` for the first run and `after` for the second, so each run has its own folder and its own transcripts:

   ```bash
   RUN=baseline
   cp -r bench/fixture /tmp/lw-bench-$RUN
   cd /tmp/lw-bench-$RUN
   git init
   git add -A
   git commit -m "fixture"
   node --test
   ```

   The tests pass before you start.

2. Start Claude Code in `/tmp/lw-bench-baseline` (or `/tmp/lw-bench-after`) and run `/loopwright-flow`. When the run is done, return to the loopwright checkout for the report.
3. Paste this goal, word for word:

   ```text
   Add summarizeByCategory(items) in src/summary.mjs and export it from src/index.mjs. It returns one entry per category, { category, lines, totalCents }, sorted by category name. lines is the number of items in the category and totalCents is the sum of their line totals. Categories match case-insensitively and keep the spelling of the first item seen. An empty list returns an empty array.
   ```

4. Answer every gate from the answer sheet. Do not add instructions of your own.

## Answer sheet

Give the same answer at the same gate in both runs.

| Gate | Answer |
|---|---|
| Goal restatement | Confirm as written, with the recommended profile (`balanced`) |
| Each high-impact question | The option marked recommended |
| Low-impact batch | `ok` |
| Tier and settings proposal | Tier `standard`, profile `balanced`, two-pass off, defaults for the rest |
| Plan confirmation | Confirm. On the second run, when a fresh context is offered, take it, then follow the instruction it prints |
| Tester report (`Uncovered`, `Needs`) | Accept as written |
| Implementer report (`Deviations`) | Accept as written |
| Undecided review finding | Fix it |
| Fix-round cap reached | Stop the run and note it; do not compare it |
| Done: `AGENTS.md` or docs proposals | Decline each |
| Done: commit message and PR draft | Accept; do not commit |

Run the task to Done. A run that stops early or answers a gate differently is not comparable.

## Find the session id

Claude Code stores each session as a transcript named after its id, in a project folder named after the working folder. Each run has its own folder, so the transcripts of the two runs do not mix:

```bash
RUN=baseline
ls -t ~/.claude/projects/*lw-bench-$RUN/*.jsonl | head -1
```

The file name without `.jsonl` is the session id. If you cleared the context during the run, the run has more than one transcript; pass the run's project folder, and the report covers each:

```bash
ls -d ~/.claude/projects/*lw-bench-$RUN
```

## Report each run

Run these from the loopwright checkout. Read the transcript with the usage report. A session id, a transcript path or a folder of transcripts all work:

```bash
RUN=baseline
node scripts/usage-report.mjs ~/.claude/projects/*lw-bench-$RUN
node scripts/usage-report.mjs ~/.claude/projects/*lw-bench-$RUN --json > $RUN.json
```

Set `RUN=after` for the second run.

The text report has one block per session: a main-thread line, one line per stage, one line per subagent role. `--json` prints the report as an object for one session or an array for a folder, with the same numbers. The commands above save the baseline run as `baseline.json` and the second run as `after.json`.

A cost shows as `cost unknown` when a model has no price in the script's table. The tokens are still reported.

## Compare

Compare these three numbers for the main thread, summed over all transcripts of a run when there are several:

| Number | Where in the JSON |
|---|---|
| Cache-read tokens | `main.cacheRead` |
| Turns | `main.turns` |
| Total cost | `main.costUsd` plus each role's `costUsd` |

Report the real change in each, whichever way it goes. The benchmark does not exercise a fresh context between slices, because the task is `standard` tier.

## Results

Four runs of the fixture task, all on model `claude-opus-5-5`, `standard` tier, `balanced` profile, on a Claude subscription, where the main thread writes its cache with the 1-hour TTL. "This change" is the first loopwright version that has `lw.mjs brief`. Main cache-read, main cost and total cost come from `main.cacheRead`, `main.costUsd` and the sum with each role's `costUsd`; main turns from `main.turns`. For `after3` the figures are summed over its two sessions.

| Run | Date | loopwright | Fresh context | Main turns | Main cache-read | Main cost | Total cost |
|---|---|---|---|---|---|---|---|
| baseline | 2026-11-14 | installed 0.1.6 (before this change) | no | 42 | 2,766,163 | $1.37 | $1.66 |
| after | 2026-11-15 | this change | offered, not taken | 38 | 2,367,896 | $1.22 | $1.50 |
| after2 | 2026-11-15 | this change | offered, not taken | 36 | 2,280,161 | $1.19 | $1.47 |
| after3 | 2026-11-15 | this change | taken (two sessions) | 41 | 2,235,629 | $1.47 | $1.75 |

One setup call per stage, a `stage` or `reopen` that writes the header, and chained commands cut main-thread turns by 10 to 14% and total cost by about 10 to 11% (`after`, `after2`).

Taking the fresh context (`after3`) cut cache-read tokens a further 2% but raised cost. The new session wrote its cache again: cache-write grew from 61,711 to 89,604 tokens against `after2`, and output grew from 11,952 to 15,439 tokens. A 1-hour cache write costs 40 times a cache read ($8 against $0.20 per million tokens on Opus 5.5 on a subscription; see [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)). On a short task the fresh context therefore costs more. It is expected to pay off only when much of the task remains.

Each configuration is one sample, so small differences are noise.
