---
name: loopwright-build
description: Use when a loopwright task is ready to implement, after Plan (small tier) or Test (standard and large), or when Review sends blocking findings back for a fix round.
---
# loopwright build

The implementer subagent writes the code. This thread dispatches it and hands the result to Review; do not edit code here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>` (`null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue and the next step reports "no active task". Not a git repo → tell the user loopwright must run inside a git repo, stop).
3. `node "{{LW_HOME}}/hooks/lw.mjs" status` → `task` (relative to `<lw>`) and `lockedTests`. "no active task" → point the user to `/loopwright-plan` or `/loopwright-flow`, stop.
4. Read the task file header (`tier`, `checks`).
   - Header not `plan: confirmed` → stop; the plan is not confirmed yet, point the user to `/loopwright-plan`.
   - `standard` or `large` with no `lockedTests` (or, large, the current slice is still `[todo]`) → run `/loopwright-test` first.
   - `large` → the current slice is the first `S<n> [tested]` line; build only that slice. Every slice `[passed]` → this is a whole-branch fix round; no slice limit.

## Steps

1. `node "{{LW_HOME}}/hooks/lw.mjs" stage build`, and set `stage: build` in the task file header.
2. Now spawn the `loopwright-implementer` subagent and wait for its result. On Claude Code pass `effort` = the output of `node "{{LW_HOME}}/hooks/lw.mjs" effort implementer` on the spawn; if the spawn rejects `effort`, fall back to spawning without it (the agent file's effort applies). The prompt contains only:
   - the absolute task file path (`<lw>/<task>`);
   - large tier: "Implement slice S<n> only.";
   - small tier (no locked tests): "This task has no locked acceptance tests. Write tests covering each acceptance criterion (AC…) as part of your change.";
   - fix round: the findings to fix, verbatim from Review (location, expectation, proof).
   Never paste chat history, your own summary of the decisions, or design ideas; the task file is the source.
3. Keep the implementer report verbatim in this conversation; a two-pass review needs it.
4. `Deviations` not "none" → run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "deviations in build"` (so the stop gate lets you end the turn), then show each to the user before Review, one at a time (Claude: `AskUserQuestion`; Codex: numbered text, then end the turn). After the answers, run `node "{{LW_HOME}}/hooks/lw.mjs" resume`. The user either accepts it (write a new decision `D<n> [asked]` to the task file) or wants it fixed (spawn the `loopwright-implementer` subagent and wait for its result again, with the deviation as the finding).
5. Go straight to `/loopwright-review`. The stop gate blocks ending the turn in Build without a passing review.

## Rules

- Never write task ids (AC, D, S shorthands) into tests, code, comments, commit messages or PR drafts.
- Never edit locked tests or ask the implementer to. A locked test that looks wrong goes to the user.
- Do not run `lw.mjs verdict` here; only Review records verdicts.
