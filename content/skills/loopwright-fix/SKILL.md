---
name: loopwright-fix
description: Use to fix a bug from a description, issue text or log path. Runs the loopwright loop with a locked repro test that fails for the reported reason before any code changes.
---
# loopwright fix

Entry for bug fixes. It reuses Plan, Test, Build, Review and Done with `kind: fix`; it is not a separate pipeline. The point: a separate tester locks a test that reproduces the reported bug, and the implementer fixes the root cause without being able to change that test. No repro, no fix.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` prints the `.loopwright` directory (`<lw>` below). `null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/`, so continue with a new task. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. `node "{{LW_HOME}}/hooks/lw.mjs" status`. It prints a task → the task is in progress; tell the user to continue it with `/loopwright-flow` and do not start a second. "no active task" → continue.
4. Hooks check: `grep -l "loopwright/hooks/" .claude/settings.json .codex/config.toml .junie/config.json ~/.claude/settings.json ~/.codex/config.toml ~/.junie/config.json 2>/dev/null`. No match → warn the user once: "loopwright hooks are not installed, so locked tests, the stop gate and context restore are not enforced; run `npx loopwright init` to install them." Continue unless the user objects.

## Steps

1. Input: a bug description, issue text, or a path to a log or report. None given → ask the user for one.
2. Follow `loopwright-plan` with `kind: fix` (`/loopwright-plan` in Claude Code, `$loopwright-plan` in Codex). The plan skill's fix rules apply: the scout reads the report first, the user is asked once for missing evidence, and the root-cause hypothesis is confirmed with the user.
3. Continue as `/loopwright-flow` does: Test runs at every tier, then Build, Review and Done. `/loopwright-flow` resumes a fix task like any other.

## Rules

- Do not edit code in this skill; the stages do the work. When a stage says to spawn the `loopwright-<role>` subagent, spawn the subagent and wait for its result; never do its work in this thread.
- Never offer to continue without a locked repro test.
