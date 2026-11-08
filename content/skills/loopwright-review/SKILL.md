---
name: loopwright-review
description: Use after a loopwright Build, to have a separate reviewer judge the change against the task file, locked tests and standards, run the fix loop, and record the verdict.
---
# loopwright review

Reviewers judge in their own context. This thread dispatches them, merges their verdicts, asks the user about undecided findings, and records the result. Do not fix code here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>` (`null` → tell the user to run `npx loopwright init`, stop).
3. `node "{{LW_HOME}}/hooks/lw.mjs" status` → `task` (relative to `<lw>`) and `baseCommit`. "no active task" → point the user to `/loopwright-flow`, stop.
4. Read the task file header (`tier`, `two-pass`, `fix-round cap`) and `<lw>/config.json` (`crossModelReview`, `models.crossModelReviewer`; missing → `off`).
5. Scope: small/standard → the task. Large → the first `S<n> [tested]` slice, or `whole` once every slice is `[passed]`.
6. Round `n` = number of `- R` lines in `## Review log` for this scope + 1.

## Passes

1. `node "{{LW_HOME}}/hooks/lw.mjs" stage review`, and set `stage: review` in the header.
2. **Blind pass.** Now spawn the `loopwright-reviewer` subagent and wait for its result. Give it only: the absolute task file path, the base commit, and "Follow `{{LW_HOME}}/prompts/reviewer.md`. Blind pass." Large tier: add "Scope: slice S<n> (its ACs; earlier slices passed)" or "Scope: whole-branch review of all slices". Never include the implementer report, chat history or your opinion.
3. **Second pass** (only if `two-pass: on`). Now spawn the `loopwright-reviewer` subagent and wait for its result, with the same three items plus "Second pass: verify the claims in this implementer report:" and the report verbatim. Report no longer available → skip and note it in the log line.
4. **Cross-model pass** (only if `crossModelReview` is not `off`). `command -v <claude|codex>` fails → skip, note it. Otherwise run with `PROMPT="Follow {{LW_HOME}}/prompts/reviewer.md. Task file: <abs path>. Base commit: <sha>. Blind pass."`:
   - claude (omit `--model` when the model is `inherit`): `claude -p --model <crossModelReviewer.claude> --output-format json --json-schema "$(cat "{{LW_HOME}}/schemas/verdict.json")" "$PROMPT"` — the verdict is the top-level `structured_output` field.
   - codex (best effort, untested): `codex exec --sandbox read-only --output-schema "{{LW_HOME}}/schemas/verdict.json" -m <crossModelReviewer.codex> "$PROMPT"` — omit `-m` when the model is `inherit`; the verdict is the final message.
   Any error, timeout or unparseable output → skip and note it. This pass never blocks on its own failure.
5. A subagent reply that is not one JSON verdict → dispatch it once more asking for only the JSON; still invalid → stop and show the user.

## Outcome

Large tier: tests locked by a later slice's Test stage appear in `lockedAfterBuild` and come back as undecided; when presenting one, say which slice locked it (its AC lines name the file).

Merge all passes: union of `blocking`, union of `undecided` (drop exact duplicates by location and expectation), sum of `droppedCount`. Decide from the arrays, not from the `pass` fields.

- **Blocking** present → `node "{{LW_HOME}}/hooks/lw.mjs" verdict fail --round <n>`. Fix rounds used = n − 1. If that equals the `fix-round cap`, stop: show every open finding and let the user decide (raise the cap, fix by hand, or accept). Otherwise show the findings briefly and run `/loopwright-build` with the Blocking findings verbatim; then review again (round n + 1). Undecided findings of this round are only counted; the next round re-checks them.
- Only **Undecided** → present each to the user, one at a time (Claude: `AskUserQuestion`; Codex: numbered text), with its location, expectation and proof; options: fix or dismiss. Record each answer under the round's log line: `  - U<k> <location>: fix|dismissed — <user's reason>`. Any "fix" → `verdict fail --round <n>` and Build with those findings, same cap rule. All dismissed → pass.
- Nothing open → `node "{{LW_HOME}}/hooks/lw.mjs" verdict pass --round <n>`.

Once the outcome is known (after the user's undecided answers) and before the verdict command, append one line to `## Review log`, followed by its `U<k>` lines if any:
`- R<n>: <pass|fail> — <k> blocking, <m> undecided, <d> dropped — <key finding one-liners>; <skipped-pass notes>`
Large tier: `- R<n> S<k>: …` for a slice, `- R<n> whole: …` for the whole-branch review.

## After a pass

- small/standard → `/loopwright-done`.
- large → mark the slice `S<n> [passed]`; next `[todo]` slice → `/loopwright-test`. When the last slice passes, run this skill again with scope `whole` (the diff against the base commit, all ACs); its fixes go through Build without new tests. Whole-branch pass → `/loopwright-done`.
- Any code edit after a pass makes the verdict stale; review again.
