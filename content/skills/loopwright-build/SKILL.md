---
name: loopwright-build
description: Use when a loopwright task is ready to implement, after Plan (small tier) or Test (standard and large), or when Review sends blocking findings back for a fix round.
---
# loopwright build

The implementer subagent writes the code. This thread dispatches it and hands the result to Review; do not edit code here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" brief implementer` → `dir` (`<lw>`), `task` (relative to `<lw>`), `stage`, `lockedTests`, `effort`. `dir` `null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue and `task: null` reports "no active task". Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. `task: null` → "no active task": point the user to `/loopwright-plan` or `/loopwright-flow`, stop.
4. Read the task file header (`tier`, `checks`).
   - Header not `plan: confirmed` → stop; the plan is not confirmed yet, point the user to `/loopwright-plan`.
   - `standard` or `large` with no `lockedTests` (or, large, the current slice is still `[todo]`) → run `/loopwright-test` first.
   - `kind: fix` with no `lockedTests`, at any tier including small → run `/loopwright-test` first; a fix is never built without a locked repro test.
   - `large` → the current slice is the first `S<n> [tested]` line; build only that slice. Every slice `[passed]` → this is a whole-branch fix round; no slice limit.
   - `## Review log` has a `- Simplify:` line ending in `— apply pending` (an approved Simplify apply was interrupted) → run `/loopwright-review` to finish it, and stop here: skip steps 5–7 and the Steps below.
5. Moved branch. Skip this on a fix round (called with Review findings). `headMoved` in `brief` (new commits since the base commit, at least one already on the upstream branch, and not answered yet for this HEAD) → run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "branch moved"`, list the commits to the user and ask one question: are they pulled commits (leave them out of the review) or this task's own commits (keep them in)? After the answer run `node "{{LW_HOME}}/hooks/lw.mjs" resume` and record it as a decision `D<n> [asked]`.
   - `headMoved.keptEarlier` → an earlier answer kept commits in the review, so the branch holds both kinds whatever the answer: list only the new commits, and a 'pulled' answer takes the keep-base path below, with the both-kinds notice.
   - `headMoved.localOnly` → the listed short shas exist only locally, so they are the task's own work and the branch holds both kinds whatever the answer: a 'pulled' answer takes the keep-base path below, with the both-kinds notice. Never judge this from the commit subjects.
   - Pulled → run `node "{{LW_HOME}}/hooks/lw.mjs" start <task> --force --base HEAD && node "{{LW_HOME}}/hooks/lw.mjs" stage build` as one call, update `base commit` in the task file header to the new HEAD, then run `node "{{LW_HOME}}/hooks/lw.mjs" accept-locks --restart --reason "<the decision in words>"`.
   - This task's own commits, or a branch holding both kinds → run `node "{{LW_HOME}}/hooks/lw.mjs" keep-base --reason "<the decision in words>"`; the base stays. Both kinds: add `--pulled` to that command, so the locked tests the new commits changed show in `pulledLocks` (step 7), and tell the user the pulled commits stay in the review, because the base cannot move past the task's own commits.
6. Upstream check. Skip this check on a fix round (called with Review findings). Otherwise run `GIT_TERMINAL_PROMPT=0 git fetch --quiet` (never prompts for credentials; failure, e.g. offline or no auth → skip). List `git log --oneline HEAD..@{u}`; with no upstream, use `HEAD..origin/HEAD`; with neither, skip. For `large`, check before each slice's first Build. If the new commits touch the task's files or feature, or a sibling repo the task touches, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "upstream changed"`, show them to the user and ask whether to pull first or stop (someone may already have done this work) before spawning the implementer. Before asking, run `brief` and note whether `ownCommits` is present (the task already has commits since its base, answered as its own or only local). After the answer, run `node "{{LW_HOME}}/hooks/lw.mjs" resume` and record it as a decision `D<n> [asked]`. If the user pulled and `ownCommits` was present, the base stays: run `node "{{LW_HOME}}/hooks/lw.mjs" keep-base --pulled --reason "<the pull decision in words>"` instead of the restart below, tell the user the pulled commits stay in the review (the base cannot move past the task's own commits), and go to step 7. If it pulled and `ownCommits` was absent, rebase the review scope so pulled commits are not judged as this task's change: run `node "{{LW_HOME}}/hooks/lw.mjs" start <task> --force --base HEAD && node "{{LW_HOME}}/hooks/lw.mjs" stage build` as one call (`start` keeps locks and history and resets the stage to plan; `stage build` sets it back), and update `base commit` in the task file header to the new HEAD, then run `node "{{LW_HOME}}/hooks/lw.mjs" accept-locks --restart --reason "<the pull decision in words>"` (the pull is the approved restart, so it is not raised again in Review). Otherwise continue.
7. After a pull (step 5 or 6), run `brief` again, as in step 2. `pulledLocks` present (a pulled commit changed those locked tests) → before the implementer runs, send only the listed files to Test: `node "{{LW_HOME}}/hooks/lw.mjs" reopen test "<the pull decision in words>"` when Build has begun, `node "{{LW_HOME}}/hooks/lw.mjs" stage test` otherwise, then run `/loopwright-test` for those files. After the tester re-locked them, run `node "{{LW_HOME}}/hooks/lw.mjs" accept-locks --reason "<the pull decision in words>" <path>…` with the `pulledLocks` paths, so the re-locks are accepted under the pull decision, and continue with Steps.

## Steps

1. `node "{{LW_HOME}}/hooks/lw.mjs" stage build` (it updates the task file header `stage:` line; if it prints `"header": false`, set that line by hand).
2. Now spawn the `loopwright-implementer` subagent and wait for its result. On Claude Code pass `effort` = the `effort` from `brief` on the spawn; if `brief` has no `effort` (it warns on stderr) or the spawn rejects `effort`, spawn without it (the agent file's effort applies). The prompt contains only:
   - the absolute task file path (`<lw>/<task>`);
   - large tier: "Implement slice S<n> only.";
   - small feature (no locked tests): "This task has no locked acceptance tests. Write tests covering each acceptance criterion (AC…) as part of your change.";
   - fix round: the findings to fix, verbatim from Review (location, expectation, proof).
   Never paste chat history, your own summary of the decisions, or design ideas; the task file is the source.
3. Keep the implementer report verbatim in this conversation; a two-pass review needs it.
   Fix task: write the report's `Root cause:` line to `## Root cause` in the task file. A root cause that differs from the plan's hypothesis is a `Deviation`, handled in step 4.
4. `Deviations` not "none" → run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "deviations in build"` (so the stop gate lets you end the turn), then show each to the user before Review, one at a time (Claude: `AskUserQuestion`; Codex: numbered text, then end the turn). After the answers, run `node "{{LW_HOME}}/hooks/lw.mjs" resume`. The user either accepts it (write a new decision `D<n> [asked]` to the task file), wants it fixed (run `node "{{LW_HOME}}/hooks/lw.mjs" stage build` first, so a `reopen` the implementer runs on its own does not directly follow the `resume` and is not counted as the user's choice; then spawn the `loopwright-implementer` subagent and wait for its result again, with the deviation as the finding), or wants to go back: offer that when the deviation needs a changed decision or locked test. Going back: directly after `resume`, run `node "{{LW_HOME}}/hooks/lw.mjs" reopen <plan|test> "<reason>"` (it sets the header `stage:` line, and `plan: draft` for plan; if it prints `"header": false`, set those lines by hand), record the decision, and continue with `/loopwright-plan` or `/loopwright-test` as the target says.
5. Go straight to `/loopwright-review`, which runs Simplify before its passes. The stop gate blocks ending the turn in Build without a passing review.

## Rules

- Never write task ids (AC, D, S shorthands) into tests, code, comments, commit messages or PR drafts.
- Never edit locked tests or ask the implementer to. A locked test that looks wrong goes to the user.
- Do not run `lw.mjs verdict` here; only Review records verdicts.
