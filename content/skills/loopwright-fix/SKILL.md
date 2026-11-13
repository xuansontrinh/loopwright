---
name: loopwright-fix
description: Use to fix a bug from a description, issue text or log path. Runs the loopwright loop with a locked repro test that fails for the reported reason before any code changes.
---
# loopwright fix

Entry for bug fixes. It reuses Plan, Test, Build, Review and Done with `kind: fix`; it is not a separate pipeline. The point: a separate tester locks a test that reproduces the reported bug, and the implementer fixes the root cause without being able to change that test. No repro, no fix.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` prints the `.loopwright` directory (`<lw>` below). `null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/`, so continue with a new task. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. `node "{{LW_HOME}}/hooks/lw.mjs" status`. "no active task" → this worktree is free; the bug is a new goal, so run "Goal intake" below before Steps (a related task in another worktree is not started again here). It prints a task → this worktree is occupied; follow "Goal intake" below instead of starting a second task here.
4. Hooks check: `grep -l "loopwright/hooks/" .claude/settings.json .codex/config.toml .junie/config.json ~/.claude/settings.json ~/.codex/config.toml ~/.junie/config.json 2>/dev/null`. No match → warn the user once: "loopwright hooks are not installed, so locked tests, the stop gate and context restore are not enforced; run `npx loopwright init` to install them." Continue unless the user objects.

## Goal intake

A new goal, while open tasks may exist: `node "{{LW_HOME}}/hooks/lw.mjs" tasks` lists every worktree's open tasks (`inProgress`, each with its `goal` and `current`) and the parked stubs. Whether a task is related to the goal is your judgment; ask the user when unsure.

First step, before any question or message: if `node "{{LW_HOME}}/hooks/lw.mjs" status` shows this worktree's task in `build` or `review`, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "handing a new goal to a new worktree"` once, so the stop gate does not push this session into that task or spend its stop-block cap on any turn of this intake. Never run `resume` in goal intake: the wait clears when that task's own work resumes (its stage skill's `stage` call, `reopen` or `verdict`), also when the user switches to continuing it.
- A related task in this worktree → ask whether to continue it with `/loopwright-flow`. A related task in another worktree → do not start here; tell the user to continue it there and print the start command.
- Only unrelated tasks, and this worktree is free (`status` prints "no active task") → start the goal here.
- This worktree is occupied (`status` prints a task; the Plan stage counts) → say which task occupies it, suggest a new worktree, and never offer to close or shelve an unrelated task. On yes, pass the goal on stdin through a quoted heredoc, so backticks and `$` in it stay text (pick a delimiter that does not appear alone on a line in the goal), then print the start command.
  ```bash
  node "{{LW_HOME}}/hooks/lw.mjs" worktree "<title>" --kind fix <<'LW_GOAL'
  <goal, exactly as the user wrote it>
  LW_GOAL
  ```
  It prints `{worktree, branch, base, stub, installMissing}`. Planning happens in the new session, from the stub, not here.
- `installMissing` true → the new worktree lacks the repo-mode install: say so and print `npx loopwright update` (run in that folder) before the start command.
- Start command, by tool: Claude `cd <path> && claude "/loopwright-flow"`; Codex `cd <path> && codex '$loopwright-flow'`; Junie `cd <path>`, then start Junie and run `/loopwright-flow`. This session does not change directory; the user starts the new session.

## Steps

1. Input: a bug description, issue text, or a path to a log or report. None given → ask the user for one.
2. Follow `loopwright-plan` with `kind: fix` (`/loopwright-plan` in Claude Code, `$loopwright-plan` in Codex). The plan skill's fix rules apply: the scout reads the report first, the user is asked once for missing evidence, and the root-cause hypothesis is confirmed with the user.
3. Continue as `/loopwright-flow` does: Test runs at every tier, then Build, Review and Done. `/loopwright-flow` resumes a fix task like any other.

## Rules

- Do not edit code in this skill; the stages do the work. When a stage says to spawn the `loopwright-<role>` subagent, spawn the subagent and wait for its result; never do its work in this thread.
- Never offer to continue without a locked repro test.
