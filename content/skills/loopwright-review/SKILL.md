---
name: loopwright-review
description: Use after a loopwright Build, to have a separate reviewer judge the change against the task file, locked tests and standards, run the fix loop, and record the verdict.
---
# loopwright review

Reviewers judge in their own context. This thread dispatches them, merges their verdicts, asks the user about undecided findings, and records the result. Do not fix code here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>` (`null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue and the next step reports "no active task". Not a git repo → tell the user loopwright must run inside a git repo, stop).
3. `node "{{LW_HOME}}/hooks/lw.mjs" status` → `task` (relative to `<lw>`) and `baseCommit`. "no active task" → point the user to `/loopwright-flow`, stop.
4. Read the task file header (`tier`, `two-pass`, `fix-round cap`) and `<lw>/config.json` (`crossAgentReview`, `models.crossAgentReviewer`; missing → `off`).
5. Scope: small/standard → the task. Large → the first `S<n> [tested]` slice, or `whole` once every slice is `[passed]`.
6. Round `n` = number of `- R` lines in `## Review log` for this scope + 1.

## Passes

1. `node "{{LW_HOME}}/hooks/lw.mjs" stage review`, and set `stage: review` in the header.
2. **Blind pass.** Now spawn the `loopwright-reviewer` subagent and wait for its result. Give it only: the absolute task file path, the base commit, and "Follow `{{LW_HOME}}/prompts/reviewer.md`. Blind pass." Large tier: add "Scope: slice S<n> (its ACs; earlier slices passed)" or "Scope: whole-branch review of all slices". Never include the implementer report, chat history or your opinion.
3. **Second pass** (only if `two-pass: on`). Now spawn the `loopwright-reviewer` subagent and wait for its result, with the task file path, the base commit, "Follow `{{LW_HOME}}/prompts/reviewer.md`. Second pass.", and then "Verify the claims in this implementer report:" with the report verbatim. Report no longer available → skip and note it in the log line.
4. **Cross-agent pass** (only if `crossAgentReview` is not `off`). `command -v <claude|codex>` fails → skip, note it. Otherwise, from the worktree root, set `PROMPT="Follow {{LW_HOME}}/prompts/reviewer.md. Task file: <abs path>. Base commit: <sha>. Blind pass."` and run (`LOOPWRIGHT_HOOKS=off` keeps loopwright's own hooks, such as the stop gate, out of the headless reviewer session):
   - claude (omit `--model` when the model is `inherit`; add one `"Bash(<cmd>:*)"` per check command in the task header; the `lw.mjs` entries allow only the read-only `status`, `check-locks` and `fingerprint`, in the quoted form the reviewer prompt uses and unquoted; the prompt must come after `--` because the tool flags take several values):
     `LOOPWRIGHT_HOOKS=off claude -p --model <crossAgentReviewer.claude> --output-format json --json-schema "$(cat "{{LW_HOME}}/schemas/verdict.json")" --allowedTools "Read" "Grep" "Glob" "Bash(git diff:*)" "Bash(git status:*)" "Bash(git log:*)" 'Bash(node "{{LW_HOME}}/hooks/lw.mjs" status)' 'Bash(node "{{LW_HOME}}/hooks/lw.mjs" check-locks)' 'Bash(node "{{LW_HOME}}/hooks/lw.mjs" fingerprint)' "Bash(node {{LW_HOME}}/hooks/lw.mjs status)" "Bash(node {{LW_HOME}}/hooks/lw.mjs check-locks)" "Bash(node {{LW_HOME}}/hooks/lw.mjs fingerprint)" "Bash(<check command>:*)" --disallowedTools "Edit" "Write" "MultiEdit" "NotebookEdit" -- "$PROMPT"`
     The verdict is the top-level `structured_output` field.
   - codex (best effort, untested; omit `-m` when the model is `inherit`): `OUT="$(mktemp)"; LOOPWRIGHT_HOOKS=off codex exec --sandbox read-only --output-schema "{{LW_HOME}}/schemas/verdict.json" -o "$OUT" -m <crossAgentReviewer.codex> "$PROMPT"`, then read the verdict from `$OUT`.
   Any error, timeout or unparseable output → skip and note it. This pass never blocks on its own failure. A check-command failure reported only by this pass that looks sandbox-caused (permission denied, read-only filesystem) is noted in the log, not counted as blocking.
5. A subagent reply that is not one JSON verdict → dispatch it once more asking for only the JSON; still invalid → stop and show the user.

## Outcome

Human gates: before you ask the user anything in this stage (an undecided finding, the fix-round cap, an invalid verdict; `AskUserQuestion` or a turn-ending question), run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "<what you are waiting for>"`, so the stop gate lets you end the turn. After the user answers, run `node "{{LW_HOME}}/hooks/lw.mjs" resume`. (`stage` and `verdict` also clear it.)

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
