---
name: loopwright-plan
description: Use to start a loopwright task from a goal or an imported spec. Scouts the repo, builds an assumption ledger, asks the user about high-impact assumptions one at a time, confirms tier and checks, then writes the task file. Nothing is built in this stage.
---
# loopwright plan

Plan runs in this main thread. You state assumptions; the user decides. Do not edit code in this stage, and nothing is built until the user confirms the plan.

## Setup

1. Run every loopwright command from the worktree root: `cd "$(git rev-parse --show-toplevel)"`.
2. `node "{{LW_HOME}}/hooks/lw.mjs" dir` prints the `.loopwright` directory (`<lw>` below). `null` inside a git repo → no task has started here yet; `lw.mjs start` (section 3) creates `.loopwright/`, so continue with a new task. Not a git repo → tell the user loopwright must run inside a git repo, stop.
3. `node "{{LW_HOME}}/hooks/lw.mjs" status`. "no active task" → this worktree is free; a new goal still goes through "Goal intake" below first (a related task in another worktree is not started again here), then continue with a new task. If it prints a task, read `<lw>/<task>`:
   - `stage: plan` and reopened (`status` `history` has a `reopen` event after the last `stage build` event; that event's `reason` says why) → this is the same task returning to Plan for added scope, not a second task: keep its decisions, ACs and tests, run sections 2–6 only for what the reason adds or changes (a new slice starts `[todo]`), then section 7. Do not ask whether the plan is abandoned.
   - `stage: plan`, and the user gave a new goal unrelated to this plan → the worktree is occupied: follow "Goal intake" below, do not resume.
   - `stage: plan` → resume this plan: the first `— pending` item under `## Open questions`, else the proposal (step 6), else the confirmation (step 7). If the user says this plan is abandoned, offer to start the new one with `start tasks/<new file>.md --force` (the old task file stays).
   - past `plan` → the task is in progress; tell the user to continue it with `/loopwright-flow`. Do not start a second here; a new goal follows "Goal intake".
4. `node "{{LW_HOME}}/hooks/lw.mjs" config` prints the main checkout's config; read `maxFixRounds` from it (missing key → 3).
5. `git status --porcelain` not empty → uncommitted changes will be part of the reviewed diff. Ask the user whether to commit/stash them first or include them; record the answer as a decision once the task file exists.
6. Upstream check: `GIT_TERMINAL_PROMPT=0 git fetch --quiet` (never prompts for credentials; it fails offline or without auth → skip this check). Then list `git log --oneline HEAD..@{u}`; with no upstream, use `HEAD..origin/HEAD`; with neither, skip. Repeat in any sibling repo the goal touches (e.g. a separate frontend repo). New upstream commits → tell the user and ask whether to pull first. A commit or branch that already touches the goal's feature → ask whether someone has already done this work. Record the answers as decisions once the task file exists.

## Goal intake

A new goal, while open tasks may exist: `node "{{LW_HOME}}/hooks/lw.mjs" tasks` lists every worktree's open tasks (`inProgress`, each with its `goal` and `current`) and the parked stubs. Whether a task is related to the goal is your judgment; ask the user when unsure.

First step, before any question or message: if `node "{{LW_HOME}}/hooks/lw.mjs" status` shows this worktree's task in `build` or `review`, run `node "{{LW_HOME}}/hooks/lw.mjs" await-user "handing a new goal to a new worktree"` once, so the stop gate does not push this session into that task or spend its stop-block cap on any turn of this intake. Never run `resume` in goal intake: the wait clears when that task's own work resumes (its stage skill's `stage` call, `reopen` or `verdict`), also when the user switches to continuing it.
- A related task in this worktree → ask whether to continue it with `/loopwright-flow`. A related task in another worktree → do not start here; tell the user to continue it there and print the start command.
- Only unrelated tasks, and this worktree is free (`status` prints "no active task") → start the goal here.
- This worktree is occupied (`status` prints a task; the Plan stage counts) → say which task occupies it, suggest a new worktree, and never offer to close or shelve an unrelated task. On yes, pass the goal on stdin through a quoted heredoc, so backticks and `$` in it stay text (pick a delimiter that does not appear alone on a line in the goal), then print the start command.
  ```bash
  node "{{LW_HOME}}/hooks/lw.mjs" worktree "<title>" <<'LW_GOAL'
  <goal, exactly as the user wrote it>
  LW_GOAL
  ```
  Add `--kind fix` for a fix. It prints `{worktree, branch, base, stub, installMissing}`. Planning happens in the new session, from the stub, not here.
- `installMissing` true → the new worktree lacks the repo-mode install: say so and print `npx loopwright update` (run in that folder) before the start command.
- Start command, by tool: Claude `cd <path> && claude "/loopwright-flow"`; Codex `cd <path> && codex '$loopwright-flow'`; Junie `cd <path>`, then start Junie and run `/loopwright-flow`. This session does not change directory; the user starts the new session.

## Parked stubs

Invoked without a goal (and no active task) → run `grep -l "^status: proposed" <lw>/tasks/*.md` and list the stubs `/loopwright-park` left, one line each (title, `kind`, `found while`, `blocks`). Offer: start one, drop one, or a new task. Drop → set `status: dropped` in the stub; never delete it. Start → treat the stub as an imported spec: run `start tasks/<stub>.md`, and fill that same file in place (status `active`, the Plan template's header lines and sections) instead of creating a second file. Keep its `kind`, `found while` and `blocks` lines. Its `## Goal` is confirmed with the batch; its `## Evidence` is a lead for the scout, not a verified fact.

## 1. Input

- A goal in the user's words, or a path to an imported spec/plan (e.g. from superpowers).
- Called from `/loopwright-fix` → `kind: fix`; read "Fix tasks" below. Otherwise `kind: feature`.
- A goal that looks like a bug, without `/loopwright-fix` → never switch silently. Ask one question first (format of section 4), recommendation first: "Run this as a fix (repro test first)?" Yes → `kind: fix`; no → `kind: feature`. Record the answer as a decision once the task file exists.
- Imported spec: read it fully. Do not interview from scratch; run the assumption pass over it. What the spec states explicitly becomes a decision tagged `batch-confirmed` once the user confirms the batch; what it leaves implicit goes in the ledger.

## 2. Scout

Before writing any assumption, spawn the `loopwright-scout` subagent and wait for its result. Give it only the goal text or the spec path (a fix: the bug report text, and "Fix tasks: report the fix inputs"). On Claude Code pass `effort` = the output of `node "{{LW_HOME}}/hooks/lw.mjs" effort scout` on the spawn; if the spawn rejects `effort`, fall back to spawning without it (the agent file's effort applies).
Never ask the user a question the repo can answer. If the scout report leaves a repo fact open, look it up yourself or spawn the `loopwright-scout` subagent and wait for its result again with that one question.

## 3. Assumption ledger

List every assumption you would otherwise make silently, one line each: `A<n> [high|low] <assumption> — <evidence: scout path:line, or "none">`.
- **high-impact**: a wrong guess changes public behavior, an interface or name others use, a data/file format, scope, architecture, the test runner, or forces more than a small rework. When unsure, tag high.
- **low-impact**: everything else (internal naming, file placement following an existing pattern, minor edge-case choices).
- Cover: scope in/out, behavior and edge cases, interfaces and paths, error handling, compatibility, how it is tested (no test runner in the repo → high-impact), docs to update, extending an existing mechanism (the scout's `Mechanisms` line) vs adding something new. Behavior that differs by environment, deployment or tenant is high-impact unless it extends a mechanism the scout found.

Show the user the whole ledger in one compact message, then run `node "{{LW_HOME}}/hooks/lw.mjs" start tasks/<file>.md` (path relative to `<lw>`; if `dir` printed `null`, this creates `.loopwright/`, so run `dir` again for `<lw>`) and create the task file (see Task file) with status `active`, stage `plan` and `plan: draft`. Copy `baseCommit`, `worktree` and `branch` from its output into the header. Put every unresolved ledger line under `## Open questions` with `— pending`; move each to Decisions or Assumptions as it is resolved, so a resumed session knows what is still open. Starting early lets the hooks restore this task after compaction; it builds nothing.

## 4. High-impact questions, one at a time

For each high-impact item, most impactful first: ask ONE question, wait for the answer, write it to the task file immediately, then ask the next.
- Write every question for a reader who does not know the code: first say in one plain sentence what the feature does for its users and what will change; never rely on a route, function or status name alone.
- Claude Code: use `AskUserQuestion` with 2–4 options, your recommendation first and marked "(recommended)".
- Codex: numbered plain-text options, recommendation first. The first time, add: "Tip: `/plan` mode offers structured prompts."
Record the answer as `D<n> [asked] <decision> — rejected: <option, why>`. An answer that raises a new high-impact question goes into the ledger and is asked the same way.

## 5. Low-impact batch

Send all low-impact items in ONE numbered message: "Reply ok, or override by number." Do not ask them one by one.
Write the result immediately: accepted → `[batch-confirmed]`, changed by the user → `[overridden]` with the user's version. Choices about what to build go under Decisions; facts about the repo or environment go under Assumptions.

## 6. Proposal

In one message, propose and explain each in one line:
- **tier**: `small` (one area, few files, low risk; no acceptance-test stage for features, the implementer writes tests for every AC; a fix always runs Test), `standard` (default; tests first, then build), `large` (several separable parts; split into ordered slices, each run Test → Build → Review, then one whole-branch review).
- **profile**: `lean` (trivial or mechanical), `balanced` (default; most tasks), `thorough` (cross-module work, risky changes), `deep` (major refactors, complex redesigns). It sets subagent effort for the task; the user confirms. Written as `profile: <name>` in the header; Test, Build and Review read it via `lw.mjs effort <role>`.
- **two-pass** review on/off: on when the implementer's claims matter beyond what tests show (performance, migrations, concurrency, external APIs); otherwise off.
- **fix-round cap**: default `maxFixRounds` from config; may be lower for small tasks.
- **check commands**: exact lint / typecheck / test commands from the scout report.
- **acceptance criteria** `AC<n>` (fix tasks: see "Fix tasks"): observable behavior, each with the module path and export the test will use (the tester stops without one), and the planned test file. Large tier: slices `S<n>` with their ACs.
The user confirms or edits each item; write the outcome to the header and sections immediately.

## 7. Confirm

Show the task file path and a short summary (tier, decisions count, ACs). Ask for explicit confirmation. Until the user confirms, keep editing the plan; never start Test or Build.
On explicit confirmation, set the header line to `plan: confirmed` (Test and Build refuse to run without it). Then, unless the task was reopened (keep its base commit so the review scope stays whole), if `git rev-parse HEAD` differs from the recorded base commit, rerun `node "{{LW_HOME}}/hooks/lw.mjs" start tasks/<file>.md --force` and update the header. Then the next stage is `/loopwright-test` (standard, large, and every fix) or `/loopwright-build` (small feature); under `/loopwright-flow`, return to the flow.

## Fix tasks

`kind: fix` adds this to the steps above. A missing `kind` header means `feature`, so older task files keep working.
- Sections: `## Bug report` (observed, expected, steps to reproduce, environment or version, logs or stack trace, already tried), `## Root cause` (starts as a hypothesis; Build confirms it), `## Follow-ups` (siblings the user chose not to include).
- Evidence intake: the scout runs first (section 2) and fills in what the repo can answer. Then ask for the missing evidence in one message, listing only the `## Bug report` items the scout could not fill in. Write the answers to `## Bug report`; "I don't know" is a valid answer and is recorded as such.
- The root-cause hypothesis goes in `## Root cause` and in the ledger as a high-impact assumption, shown to the user, who may correct it.
- Acceptance criteria keep the line shape with a leading tag:
  - `AC<n> [repro] <input or steps> → actual <symptom>, expected <behavior> — interface: <module, export> — test: <file>`: at least one.
  - `AC<n> [regression] <nearby behavior that must not change> — interface: <module, export> — test: <file>`: optional.
- The proposal states that Test always runs for fixes, whatever the tier. Tier is still about size.
- If the scout reports the same defect pattern elsewhere (siblings), ask one question, recommendation first: include them in this fix (one `[repro]` criterion each), or list them under `## Follow-ups`.

## Task file

Path: `<lw>/tasks/<YYYY-MM-DD>-<readable-title>.md` — today's date and a short title from the goal. Keep meaningful casing (`2026-11-08-add-CLAUDE-to-project.md`); spaces become `-`; replace only filesystem-unsafe characters (`/ \ : * ? " < > |`). If the name exists, append `-2`, `-3`, … before `.md`.
One line per entry; target ≤ ~150 lines. Template:

```markdown
# <title>

kind: <feature|fix>
status: active
stage: plan
plan: draft
tier: <small|standard|large>
profile: <lean|balanced|thorough|deep>
two-pass: <on|off>
fix-round cap: <n>
checks: `<lint>` · `<typecheck>` · `<test>`
worktree: <path> (branch <branch>)
base commit: <sha>

## Goal
<one paragraph: what and why>

## Decisions
- D1 [asked] <decision> — rejected: <option, why>
- D2 [batch-confirmed] <decision>
- D3 [overridden] <user's version> (was: <your assumption>)

## Assumptions
- A1 [confirmed] <fact about repo or environment> — <evidence>

## Acceptance criteria
- AC1 <observable behavior> — interface: <module path, export> — test: <file>

## Slices
- S1 [todo] <slice> — AC1, AC2

## Review log

## Open questions
- <question> — <who answers, when>
```

Omit `## Slices` unless the tier is large. Keep `## Goal` and the `- D<n>` line shape: the context-reinjection hook reads them.
