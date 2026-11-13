---
name: loopwright-flow
description: Use to run or resume the whole loopwright loop (Plan, Test, Build, Review, Done) for a task, stopping at every point where the user must decide.
---
# loopwright flow

Runs the stage skills in order for the confirmed tier and resumes where a task left off. Each stage's own SKILL.md is the authority for that stage.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` → `<lw>`. `null` inside a git repo → no task has started here yet; `lw.mjs start` creates `.loopwright/` with the first task, so continue. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. Hooks check: `grep -l "loopwright/hooks/" .claude/settings.json .codex/config.toml .junie/config.json ~/.claude/settings.json ~/.codex/config.toml ~/.junie/config.json 2>/dev/null`. No match → warn the user once: "loopwright hooks are not installed, so locked tests, the stop gate and context restore are not enforced; run `npx loopwright init` to install them." Continue unless the user objects. In Codex, hooks also need approval via `/hooks`.
4. Junie: if a `loopwright-<role>` subagent fails because its configured model is not available to the user, spawn it again without `model` and `reasoningLevel` (Junie's default); this is not an error to report.

## Resume

`node "{{LW_HOME}}/hooks/lw.mjs" status`:
- Prints a task, and the user gave a new goal → the worktree is occupied: follow "Goal intake" below, never continue the task unasked. Prints a task, and no goal or the goal is that task → read `<lw>/<task>` and continue at its `stage` (plan: run `loopwright-plan`, which resumes the open plan; review: count rounds from the review log).
- "no active task" → `grep -l "^status: active" <lw>/tasks/*.md`.
  - One or more files → ask the user which one (or a new task). For the chosen file, offer to rebuild state from it: `node "{{LW_HOME}}/hooks/lw.mjs" start tasks/<file>.md --base <base commit from its header>`, then `node "{{LW_HOME}}/hooks/lw.mjs" stage <stage from its header>`. Locked-test hashes are lost with the state: if the task already has acceptance tests and is past Test, tell the user; re-lock the test files named in its AC lines (`stage test`, `lock <files>`, then `stage <stage>`) only if the user confirms they are unchanged.
  - None, or the user wants a new task → continue below.
- Also list stubs parked by `/loopwright-park` (`status: proposed` in `lw.mjs tasks`, from any worktree; `grep -l "^status: proposed" <lw>/tasks/*.md` lists this worktree's). Offer each as start, drop, or a new task instead. Start → run `loopwright-plan` on it as in that skill ("Parked stubs"); a stub that sits in another worktree starts in a new worktree instead (`lw.mjs worktree "<title>" --stub <absolute path>`, then print the start command). Drop → set `status: dropped` in the stub; never delete it.
- An `olderLayout` entry listed under this worktree is a task from before tasks were kept per worktree: offer `node "{{LW_HOME}}/hooks/lw.mjs" adopt <task>` to copy it and its state (with locks) in. Nothing moves or is deleted unasked.
- No stubs and no task, or the user wants a new task → run "Goal intake" below for the user's goal, then start at Plan with the goal or spec path.

## Goal intake

A new goal, while open tasks may exist: `node "{{LW_HOME}}/hooks/lw.mjs" tasks` lists every worktree's open tasks (`inProgress`, each with its `goal` and `current`) and the parked stubs (`proposed`). Whether a task is related to the goal is your judgment; ask the user when unsure.

First step, before any question or message: if `node "{{LW_HOME}}/hooks/lw.mjs" status` shows this worktree's task in `build` or `review`, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "handing a new goal to a new worktree"` once, so the stop gate does not push this session into that task or spend its stop-block cap on any turn of this intake. Never run `resume` in goal intake: the wait clears when that task's own work resumes (its stage skill's `stage` call, `reopen` or `verdict`), also when the user switches to continuing it.
- A related task in this worktree → ask whether to continue it. A related task in another worktree → do not start here; tell the user to continue it there and print the start command.
- Only unrelated tasks, and this worktree is free (`status` prints "no active task") → start the goal here.
- This worktree is occupied (`status` prints a task; the Plan stage counts) → say which task occupies it, suggest a new worktree, and never offer to close or shelve an unrelated task. On yes, pass the goal on stdin through a quoted heredoc, so backticks and `$` in it stay text (pick a delimiter that does not appear alone on a line in the goal), then print the start command.
  ```bash
  node "{{LW_HOME}}/hooks/lw.mjs" worktree "<title>" <<'LW_GOAL'
  <goal, exactly as the user wrote it>
  LW_GOAL
  ```
  It prints `{worktree, branch, base, stub, installMissing}`. Planning happens in the new session, from the stub, not here.
- `installMissing` true → the new worktree lacks the repo-mode install: say so and print `npx loopwright update` (run in that folder) before the start command.
- Start command, by tool: Claude `cd <path> && claude "/loopwright-flow"`; Codex `cd <path> && codex '$loopwright-flow'`; Junie `cd <path>`, then start Junie and run `/loopwright-flow`. This session does not change directory; the user starts the new session.

## Run

Follow each stage skill in turn (Claude Code `/loopwright-<stage>`, Codex `$loopwright-<stage>`):
- small feature: `loopwright-plan` → `loopwright-build` → `loopwright-review` → `loopwright-done`
- standard (and any fix): `loopwright-plan` → `loopwright-test` → `loopwright-build` → `loopwright-review` → `loopwright-done`
- large: `loopwright-plan` → for each slice in order: `loopwright-test` → `loopwright-build` → `loopwright-review` → then one whole-branch `loopwright-review` → `loopwright-done`
- A fix (`kind: fix` in the task file header; set by `/loopwright-fix`, or by Plan after the user agrees to run a bug-like goal as a fix) runs `loopwright-test` at every tier: a small fix is never built without a locked repro test. Large keeps its slice loop.
- Going back is the user's choice only: at a deviation, or an undecided review finding, run `node "{{LW_HOME}}/hooks/lw.mjs" reopen <plan|test> "<reason>"` (plan or test; accepted only after Build began) and set `stage: <plan|test>` in the task file header (for plan also `plan: draft`), then follow the stage skill it names. Locked tests may then be edited by the tester in Test and are re-locked.
- A failed review returns to `loopwright-build` and then `loopwright-review`, up to the task's fix-round cap.

Exploring is not a stage of the loop: to understand an unfamiliar codebase before any task, run `loopwright-explore` (`/loopwright-explore [folder]`).

Work found along the way that does not belong in the task goes to `loopwright-park` (`/loopwright-park`), which leaves the current task unchanged.

When a stage says to spawn the `loopwright-<role>` subagent, spawn the subagent and wait for its result; never do its work in this thread. After each stage, tell the user one line: what finished and what runs next.

## Gates: stop and wait for the user

- each high-impact question, the "run this as a fix?" question for a bug-like goal, the low-impact batch, the tier/settings proposal, and the final plan confirmation;
- tester `Uncovered`/`Needs` items and implementer `Deviations`;
- fixes: the no-repro gate (no locked repro test: provide evidence, find the faulty unit, or stop; never continue without one) and, after the final passing review (whole-branch for large), the sibling gate (include siblings in this fix or list them as follow-ups);
- each undecided review finding, and the fix-round cap being reached;
- each AGENTS.md / docs change, and the commit message and PR draft.

In Test (no-repro gate), Build and Review, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "<reason>"` before asking and `resume` after the answer, as those skills say; otherwise the stop gate pushes you past the gate. Never answer a gate yourself or treat silence as approval. Do not commit at any point.
