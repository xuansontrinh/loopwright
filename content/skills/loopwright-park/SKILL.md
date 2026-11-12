---
name: loopwright-park
description: Use when work turns up while doing a task that does not belong in it. Captures it as a startable local task stub so the current task stays unchanged and the new one is planned later in a fresh context.
---
# loopwright park

Captures work found mid-task (call it B) as a stub, so the current task (A) keeps its scope, tests, state and diff. B is picked up later through normal Plan. Park runs in this main thread; do not spawn the subagents here.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>`. `null` inside a git repo → no task has started here yet; `lw.mjs park` creates `.loopwright/`, so continue. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. `node "{{LW_HOME}}/hooks/lw.mjs" status`. It prints a task → that is A. If A's `stage` is `build` or `review`, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "parking follow-up work"` before asking anything, and `node "{{LW_HOME}}/hooks/lw.mjs" resume` after the answers, so the stop gate does not push you past the questions. Other stages need neither. "no active task" → park without a link.

## Steps

1. Restate B for the user to edit: a title, a one-paragraph goal, and evidence as `path:line` leads from what you already saw. No scouting: do not read more code to fill this in.
2. Ask one question, "Does this block the current task?", recommendation "no" (Claude: `AskUserQuestion`; Codex: numbered text). It needs an active task; with none, skip it.
3. Run `node "{{LW_HOME}}/hooks/lw.mjs" park "<title>"`, adding `--blocks` when the answer is yes and `--kind fix` when B is a bug. It prints `{stub, foundWhile, blocks}`.
4. Write the agreed goal under `## Goal` and the evidence under `## Evidence` of `<lw>/<stub>`.
5. Blocking → suggest running B first in another worktree (the stub is shared by all worktrees), and leave A as it is.
6. Tell the user the stub path and that it is listed under A's `## Follow-ups`. Resume A where it was.

## Rules

- Never change the current task (A): its scope, tests, state and diff stay as they were, apart from the follow-up line `park` adds to its task file. Do not edit code.
- Never start B. Starting it is `/loopwright-plan` or `/loopwright-flow` later, in a fresh context.
- Do not write task ids into the stub.
