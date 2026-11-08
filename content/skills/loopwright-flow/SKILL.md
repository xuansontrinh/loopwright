---
name: loopwright-flow
description: Use to run or resume the whole loopwright loop (Plan, Test, Build, Review, Done) for a task, stopping at every point where the user must decide.
---
# loopwright flow

Runs the stage skills in order for the confirmed tier and resumes where a task left off. Each stage's own SKILL.md is the authority for that stage.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>`. `null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. Hooks check: `grep -l "loopwright/hooks/" .claude/settings.json .codex/config.toml ~/.claude/settings.json ~/.codex/config.toml 2>/dev/null`. No match → warn the user once: "loopwright hooks are not installed, so locked tests, the stop gate and context restore are not enforced; run `npx loopwright init` to install them." Continue unless the user objects. In Codex, hooks also need approval via `/hooks`.

## Resume

`node "{{LW_HOME}}/hooks/lw.mjs" status`:
- Prints a task → read `<lw>/<task>` and continue at its `stage` (plan: run `loopwright-plan`, which resumes the open plan; review: count rounds from the review log).
- "no active task" → `grep -l "^status: active" <lw>/tasks/*.md`.
  - One or more files → ask the user which one (or a new task). For the chosen file, offer to rebuild state from it: `node "{{LW_HOME}}/hooks/lw.mjs" start tasks/<file>.md --base <base commit from its header>`, then `node "{{LW_HOME}}/hooks/lw.mjs" stage <stage from its header>`. Locked-test hashes are lost with the state: if the task already has acceptance tests and is past Test, tell the user; re-lock the test files named in its AC lines (`stage test`, `lock <files>`, then `stage <stage>`) only if the user confirms they are unchanged.
  - None, or the user wants a new task → start at Plan with the user's goal or spec path.

## Run

Follow each stage skill in turn (Claude Code `/loopwright-<stage>`, Codex `$loopwright-<stage>`):
- small: `loopwright-plan` → `loopwright-build` → `loopwright-review` → `loopwright-done`
- standard: `loopwright-plan` → `loopwright-test` → `loopwright-build` → `loopwright-review` → `loopwright-done`
- large: `loopwright-plan` → for each slice in order: `loopwright-test` → `loopwright-build` → `loopwright-review` → then one whole-branch `loopwright-review` → `loopwright-done`
- A failed review returns to `loopwright-build` and then `loopwright-review`, up to the task's fix-round cap.

When a stage says to spawn the `loopwright-<role>` subagent, spawn the subagent and wait for its result; never do its work in this thread. After each stage, tell the user one line: what finished and what runs next.

## Gates: stop and wait for the user

- each high-impact question, the low-impact batch, the tier/settings proposal, and the final plan confirmation;
- tester `Uncovered`/`Needs` items and implementer `Deviations`;
- each undecided review finding, and the fix-round cap being reached;
- each AGENTS.md / docs change, and the commit message and PR draft.

In Build and Review, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "<reason>"` before asking and `resume` after the answer, as those skills say; otherwise the stop gate pushes you past the gate. Never answer a gate yourself or treat silence as approval. Do not commit at any point.
